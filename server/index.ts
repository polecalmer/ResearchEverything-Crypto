import "dotenv/config";
// Sentry must be imported before anything it instruments (http, express, pg).
import { Sentry, sentryEnabled } from "./sentry";
import express, { type Request, Response, NextFunction } from "express";
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

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
  }
  next();
});

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

  const SHUTDOWN_DRAIN_MS = 15_000;
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[shutdown] ${signal} received — draining for up to ${SHUTDOWN_DRAIN_MS}ms`);

    const { markMppShuttingDown, closeChannel } = await import("./mpp-client");
    markMppShuttingDown();

    const forceTimer = setTimeout(() => {
      console.error(`[shutdown] drain timeout — forcing exit`);
      process.exit(1);
    }, SHUTDOWN_DRAIN_MS);
    forceTimer.unref();

    httpServer.close(async () => {
      try {
        await closeChannel();
      } catch (e: any) {
        console.error(`[shutdown] closeChannel error: ${e.message}`);
      }
      if (sentryEnabled) {
        await Sentry.flush(2000).catch(() => {});
      }
      clearTimeout(forceTimer);
      log(`[shutdown] clean exit`);
      process.exit(0);
    });
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
