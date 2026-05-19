import "dotenv/config";
// Sentry must be imported before anything it instruments (http, express, pg).
import { Sentry, sentryEnabled } from "./sentry";
import express, { type Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { makeCostCeiling } from "./cost-ceiling";
import { registerRoutes } from "./routes";
import { setupAuth } from "./auth";
import { serveStatic } from "./static";
import { createServer } from "http";
import { WebhookHandlers } from "./webhookHandlers";
import { logger, httpLogger } from "./logger";

const STRIPE_ENABLED = process.env.ENABLE_STRIPE === "1";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for Stripe integration.');
  }

  try {
    const { runMigrations } = await import("stripe-replit-sync");
    const { getStripeSync } = await import("./stripeClient");

    console.log('Initializing Stripe schema...');
    await runMigrations({ databaseUrl, schema: 'stripe' });
    console.log('Stripe schema ready');

    const stripeSync = await getStripeSync();

    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (publicBaseUrl && publicBaseUrl.startsWith("https://")) {
      try {
        console.log('Setting up managed webhook...');
        const result = await stripeSync.findOrCreateManagedWebhook(
          `${publicBaseUrl.replace(/\/$/, '')}/api/stripe/webhook`
        );
        if (result?.webhook) {
          console.log(`Webhook configured: ${result.webhook.url}`);
        } else {
          console.log('Webhook setup returned no result, will retry on next startup');
        }
      } catch (webhookErr) {
        console.error('Webhook setup failed (non-fatal):', webhookErr);
      }
    } else {
      console.log('PUBLIC_BASE_URL not https, skipping managed webhook setup');
    }

    stripeSync.syncBackfill()
      .then(() => console.log('Stripe data synced'))
      .catch((err: any) => console.error('Error syncing Stripe data:', err));
  } catch (error) {
    console.error('Failed to initialize Stripe:', error);
  }
}

if (STRIPE_ENABLED) {
  initStripe().catch(err => console.error('Stripe init error:', err));
} else {
  console.log('[Stripe] Disabled (set ENABLE_STRIPE=1 to enable)');
}

if (STRIPE_ENABLED) {
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        return res.status(400).json({ error: 'Missing stripe-signature' });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;
        if (!Buffer.isBuffer(req.body)) {
          console.error('STRIPE WEBHOOK ERROR: req.body is not a Buffer');
          return res.status(500).json({ error: 'Webhook processing error' });
        }

        await WebhookHandlers.processWebhook(req.body as Buffer, sig);
        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error('Webhook error:', error.message);
        res.status(400).json({ error: 'Webhook processing error' });
      }
    }
  );
}

app.use(
  express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// CORS — origin whitelist (replaces previous wildcard `*`). For prod
// AWS deploy, set CORS_ALLOWED_ORIGINS to a comma-separated list of
// exact origins (scheme + host + port). In dev, fallback to "*" only
// when NODE_ENV !== "production".
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CORS_DEV_FALLBACK = process.env.NODE_ENV !== "production";

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    const origin = req.headers.origin;
    if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    } else if (CORS_DEV_FALLBACK && !CORS_ALLOWED_ORIGINS.length) {
      // Dev convenience: wildcard echo so local Vite + curl still work.
      // In prod, CORS_ALLOWED_ORIGINS MUST be set or origin is omitted.
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
  }
  next();
});

// Rate limiting — defense against brute-force, scraping, and runaway
// usage (incl. cost protection on LLM-firing routes).
//
// General API limiter: 60 req/min per IP — generous enough that a
// chatty UI doesn't trip but bots/scrapers will.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_API_PER_MIN || 60),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Rate limit exceeded — try again in a moment" },
});

// Tighter limiter on LLM-firing routes — these cost real money
// ($0.10-$0.50 per turn). 30 turns/hour/user is a generous cap that
// still bounds the worst case to ~$15/hour even before cost-ceiling
// enforcement kicks in.
const llmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LLM_PER_HOUR || 30),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: any) => req.user?.id || req.ip,
  message: { error: "Hourly LLM request limit exceeded — wait an hour or contact support to raise the cap" },
});

// Cost ceiling — caps per-user 24h LLM spend in dollars. Belt-and-
// suspenders with the LLM rate limiter (which caps count, not cost).
const costCeiling = makeCostCeiling();

// Only apply the LLM limiter + cost ceiling on POST (the LLM-firing
// verb). GET on the same path returns message history and must NOT be
// cost-gated — otherwise a budget-exhausted user can't read their own
// past turns.
function postOnly(mw: (req: Request, res: Response, next: NextFunction) => any) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();
    return mw(req, res, next);
  };
}

app.use("/api/", apiLimiter);
app.use("/api/research/sessions/:id/messages", postOnly(llmLimiter), postOnly(costCeiling));

// Backwards-compat shim — routes the legacy `log(msg, source)` calls in this
// file (and any external caller) through Pino. New code should use `logger`
// (from ./logger) or `req.log` (attached by httpLogger).
export function log(message: string, source = "express") {
  logger.info({ source }, message);
}

// Structured JSON request logs (CloudWatch-friendly), with X-Request-ID
// honored from upstream and echoed back on the response. Replaces the
// previous middleware that captured response JSON bodies (PII risk).
app.use(httpLogger);

// Liveness probe — must respond fast, no I/O. ALB / Docker HEALTHCHECK
// hit this every ~30s, so a green response only means "process is up".
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// Readiness probe — green only when downstreams the app actually needs
// are usable. 503 with details lets the orchestrator pull the instance
// out of rotation without killing it (transient DB blip recovers on its own).
app.get("/ready", async (_req, res) => {
  const checks: Record<string, { ok: boolean; error?: string }> = {};

  try {
    const { pool } = await import("./db");
    await pool.query("SELECT 1");
    checks.db = { ok: true };
  } catch (err: any) {
    checks.db = { ok: false, error: err?.message || "db check failed" };
  }

  try {
    const { isServerMppReady } = await import("./mpp-client");
    checks.mpp = { ok: isServerMppReady() };
  } catch (err: any) {
    checks.mpp = { ok: false, error: err?.message || "mpp check failed" };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks });
});

(async () => {
  const { seedDatabase } = await import("./seed");
  const { startTelegramBot } = await import("./telegram");
  const { runSeedMigration } = await import("./run-seed");
  setupAuth(app);
  await registerRoutes(httpServer, app);
  await seedDatabase();
  runSeedMigration().catch(e => console.error("[seed] Migration failed:", e.message));
  (async () => {
    try {
      const { seedDataSourceBrain } = await import("./data-source-brain/seeder");
      await seedDataSourceBrain();
    } catch (e: any) {
      console.error("[DataSourceBrain] Seed-on-startup failed:", e.message);
    }
  })();
  try { startTelegramBot(); } catch (e: any) { console.log("[Telegram] Bot startup skipped:", e.message); }

  // Sentry's Express error handler captures errors before our serializer
  // runs. No-op if SENTRY_DSN is unset.
  if (sentryEnabled) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Central error handler — uses HttpError + serialises consistently. See
  // server/error-middleware.ts. Route handlers should throw HttpError
  // (badRequest / notFound / etc.) instead of catching + res.status() inline.
  const { errorMiddleware } = await import("./error-middleware");
  app.use(errorMiddleware);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Total deadline before SIGKILL-equivalent self-exit. Must fit inside
  // ECS task stopTimeout (default 30s, configurable to 120s). SOFT_DRAIN
  // is the window we give in-flight SSE handlers to finish naturally
  // before we force-end them and close the MPP channel.
  const SHUTDOWN_DRAIN_MS = 30_000;
  const SOFT_DRAIN_MS = 25_000;
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    const { markShuttingDown, getInFlightSseCount, notifyShutdownToInFlightSse } =
      await import("./shutdown");
    markShuttingDown();

    const startCount = getInFlightSseCount();
    log(
      `[shutdown] ${signal} — ${startCount} in-flight SSE; soft drain ${SOFT_DRAIN_MS}ms, hard ${SHUTDOWN_DRAIN_MS}ms`,
    );

    const { markMppShuttingDown, closeChannel } = await import("./mpp-client");
    markMppShuttingDown();

    const forceTimer = setTimeout(() => {
      logger.error(
        { inflightSse: getInFlightSseCount() },
        "[shutdown] drain timeout — forcing exit",
      );
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    forceTimer.unref();

    // Refuse new connections; callback fires once every socket has
    // actually closed. We don't await it directly — we poll the SSE
    // count below and force-end anything that's still streaming.
    httpServer.close();

    // Soft drain: wait for in-flight SSE handlers to finish on their own.
    const pollDeadline = Date.now() + SOFT_DRAIN_MS;
    while (getInFlightSseCount() > 0 && Date.now() < pollDeadline) {
      await new Promise((r) => setTimeout(r, 250));
    }

    // Anything still streaming gets a graceful "shutdown" event + res.end()
    // so the client knows the response was truncated by the server, not
    // a network blip.
    if (getInFlightSseCount() > 0) {
      notifyShutdownToInFlightSse(`server shutting down (${signal})`);
    }

    try {
      await closeChannel();
    } catch (e: any) {
      logger.error({ err: e }, "[shutdown] closeChannel error");
    }
    if (sentryEnabled) {
      await Sentry.flush(2000).catch(() => {});
    }
    clearTimeout(forceTimer);
    log(`[shutdown] clean exit (drained ${startCount} SSE)`);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Catch-all for async errors that escape route handlers and background
  // tasks. Report to Sentry, log, then exit so the orchestrator can restart
  // us with clean state — continuing on a poisoned process is worse.
  process.on("unhandledRejection", async (reason) => {
    logger.fatal({ err: reason }, "unhandledRejection");
    if (sentryEnabled) {
      Sentry.captureException(reason);
      await Sentry.flush(2000).catch(() => {});
    }
    process.exit(1);
  });
  process.on("uncaughtException", async (err) => {
    logger.fatal({ err }, "uncaughtException");
    if (sentryEnabled) {
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => {});
    }
    process.exit(1);
  });
})();
