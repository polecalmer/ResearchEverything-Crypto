import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { callAnthropicServer, isServerMppReady } from "./mpp-client";
import { callOpenRouter } from "./openrouter-mpp-client";
import { generateTelegramLinkCode } from "./telegram";
import { registerBillingRoutes } from "./routes/billing-routes";
import { registerEnrichmentRoutes } from "./routes/enrichment-routes";
import { registerCompanyRoutes } from "./routes/company-routes";
import { registerTokenRoutes } from "./routes/token-routes";
import { registerDataRoutes } from "./routes/data-routes";
import { registerAdminRoutes } from "./routes/admin-routes";
import { registerResearchRoutes } from "./routes/research-routes";
import { registerSecurityAuditRoutes } from "./routes/security-audit-routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/ai/proxy", requireAuth, async (req, res) => {
    try {
      if (!isServerMppReady()) {
        return res.status(503).json({ message: "AI service not configured — server wallet not set" });
      }
      const { model, max_tokens, system, messages, tools } = req.body;
      if (!model || !max_tokens || !messages) {
        return res.status(400).json({ message: "Invalid request: model, max_tokens, and messages required" });
      }
      const result = await callAnthropicServer({ model, max_tokens, system, messages, tools });
      res.json(result);
    } catch (error: any) {
      console.error("[AI Proxy] Error:", error.message);
      res.status(502).json({ message: error.message || "AI call failed" });
    }
  });

  // TEMP smoke test for OpenRouter-via-MPP. Remove after validating.
  // Fire-and-poll: POST starts the call, returns a jobId. GET reads the result.
  const smokeJobs = new Map<string, any>();
  app.post("/api/__smoke/openrouter", async (req, res) => {
    if (!isServerMppReady()) {
      return res.status(503).json({ message: "MPP not configured" });
    }
    const model = (req.body?.model as string) || "moonshotai/kimi-k2";
    const prompt = (req.body?.prompt as string) || "Say hello in exactly 5 words.";
    const maxTokens = (req.body?.max_tokens as number) || 64;
    const tools = req.body?.tools as any[] | undefined;
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();
    smokeJobs.set(jobId, { status: "running", startedAt: t0, model, prompt });
    // Fire, don't await. Client will poll GET /api/__smoke/openrouter/:jobId.
    (async () => {
      try {
        const result = await callOpenRouter({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          ...(tools ? { tools, tool_choice: req.body?.tool_choice ?? "auto" } : {}),
        });
        smokeJobs.set(jobId, {
          status: "done",
          model,
          elapsedMs: Date.now() - t0,
          text: result.text,
          toolCalls: result.toolCalls,
          usage: result.usage,
          mppCost: result.mppCost,
          costSource: result.costSource,
          finishReason: result.finishReason,
        });
      } catch (e: any) {
        console.error("[Smoke/OpenRouter]", e?.message);
        smokeJobs.set(jobId, { status: "error", error: e?.message, elapsedMs: Date.now() - t0 });
      }
    })();
    res.json({ ok: true, jobId });
  });
  app.get("/api/__smoke/openrouter/:jobId", (req, res) => {
    const job = smokeJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ status: "not_found" });
    res.json(job);
  });

  // TEMP: verify methodology retrieval for an arbitrary query.
  app.post("/api/__smoke/brain-retrieve", async (req, res) => {
    try {
      const query = (req.body?.query as string) || "Break down Jupiter's revenue streams and compare to peers";
      const { retrieveRelevantContext, formatRetrievedContext } = await import("./brain-retrieval");
      const ctx = await retrieveRelevantContext(query, { entities: {}, relationships: [], knowledge: [], contradictions: [], preferences: {}, meta: null } as any);
      res.json({
        ok: true,
        summary: ctx.retrievalSummary,
        methodologyCount: ctx.methodology?.length || 0,
        methodology: ctx.methodology,
        formattedPreview: formatRetrievedContext(ctx).slice(0, 2000),
      });
    } catch (e: any) {
      console.error("[SmokeRetrieve]", e?.message);
      res.status(500).json({ ok: false, message: e?.message, stack: e?.stack?.slice(0, 400) });
    }
  });

  // TEMP: seed the peer-comparison methodology rule into system_learnings.
  // Idempotent — skips if an identical (scope, scopeKey, ruleType) already exists.
  app.post("/api/__smoke/seed-peer-rule", async (_req, res) => {
    try {
      const { systemLearnings } = await import("@shared/schema");
      const { db: dbImport } = await import("./db");
      const { eq, and } = await import("drizzle-orm");
      const scope = "global";
      const scopeKey = "peer_comparison_tables";
      const ruleType = "synthesis_discipline";
      const ruleText =
        "When building a peer/competitor comparison table with multiple entities, every numeric cell for each non-primary entity MUST come from its own fetch (proven_queries, dune, defillama, coingecko). Do not fill peer rows from training knowledge. If a fetch is not attempted or fails, mark the cell [unverified] or leave blank. For valuation multiples (P/E, P/S), always split into Circ MCAP / Adj MCAP / FDV columns — never a single ambiguous MCAP column.";
      const existing = await dbImport.select().from(systemLearnings).where(
        and(
          eq(systemLearnings.scope, scope),
          eq(systemLearnings.scopeKey, scopeKey),
          eq(systemLearnings.ruleType, ruleType),
        ),
      );
      if (existing.length > 0) {
        return res.json({ ok: true, action: "skipped_exists", id: existing[0].id });
      }
      const [row] = await dbImport.insert(systemLearnings).values({
        scope,
        scopeKey,
        ruleType,
        ruleText,
        confidence: 95,
        source: "user_feedback",
        triggeredBy: "jupiter_session_peer_benchmark_hallucination_2026-04-24",
      }).returning();
      res.json({ ok: true, action: "inserted", id: row.id });
    } catch (e: any) {
      console.error("[SeedPeerRule]", e?.message);
      res.status(500).json({ ok: false, message: e?.message });
    }
  });

  app.post("/api/telegram/link-code", requireAuth, async (req, res) => {
    const code = generateTelegramLinkCode(req.user!.id);
    res.json({ code, expiresIn: "10 minutes" });
  });

  registerBillingRoutes(app);
  registerEnrichmentRoutes(app);
  registerCompanyRoutes(app);
  registerTokenRoutes(app);
  registerDataRoutes(app);
  registerAdminRoutes(app);
  registerResearchRoutes(app);
  registerSecurityAuditRoutes(app);

  return httpServer;
}
