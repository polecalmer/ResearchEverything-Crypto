import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, insertTokenProfileSchema, insertDuneQuerySchema, insertMasterDuneQuerySchema, PIPELINE_STAGES } from "@shared/schema";
import { z } from "zod";
import {
  startEnrichmentSession, advanceEnrichmentSession,
  startNextStepsSession, advanceNextStepsSession,
  startDeepResearchSession, completeDeepResearchSession,
  buildAnthropicRequest, DEEP_RESEARCH_SYSTEM,
  getEstimatedEnrichmentCost, getLastEnrichmentCost,
  MARKUP_MULTIPLIER,
} from "./enrichment";
import { requireAuth } from "./auth";
import { enrichmentPaywall, nextStepsPaywall, deepResearchPaywall, tokenIntelPaywall, duneQueryPaywall, tokenSnapshotPaywall, dataChartPaywall } from "./mpp";
import { runDataAgent, refreshChartData, DATA_CHART_CHARGE } from "./data-agent";
import { fetchTokenSnapshot } from "./allium-client";
import { executeDuneQuery, getLatestDuneResults, isDuneConfigured } from "./dune-client";
import { runTokenAnalysis } from "./token-agent";
import { callAnthropicServer, callAnthropicServerHeavy, isServerMppReady } from "./mpp-client";
import { generateTelegramLinkCode } from "./telegram";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { db } from "./db";
import { sql } from "drizzle-orm";

const DUNE_CHART_COLORS = ["#4ade80", "#2dd4bf", "#38bdf8", "#818cf8", "#a78bfa", "#f472b6", "#fb923c", "#facc15"];

function buildDuneChartConfig(columns: string[], rows: any[], vizType?: string | null): any {
  if (!columns.length || !rows.length) {
    return { columns, _chartType: "table" };
  }

  const dateCol = columns.find(c => /date|time|day|week|month|block_time|period/i.test(c));
  const stringCols = columns.filter(c => c !== dateCol && rows[0] && typeof rows[0][c] === "string");
  const numCols = columns.filter(c => c !== dateCol && !stringCols.includes(c) && rows[0] && typeof rows[0][c] === "number");

  if (!dateCol || numCols.length === 0) {
    return { columns, _chartType: "table" };
  }

  const isCurrency = (col: string) => /usd|price|fee|revenue|volume|amount|cost|tvl|value|earnings|profit/i.test(col);
  const isBarMetric = (col: string) => /volume|count|users|txn|transaction|trade|swap|deposit|withdraw|mint|burn|liquidat|revenue|fee/i.test(col);
  const isGrowth = (col: string) => /growth|pct|percent|ratio|change|rate|apy|apr/i.test(col);

  const primaryCol = numCols.find(c => !isGrowth(c) && !c.startsWith("prev_")) || numCols[0];
  const fmt = isGrowth(primaryCol) ? "percent" : isCurrency(primaryCol) ? "currency" : "number";

  let chartType: string;
  if (vizType === "bar") chartType = "bar";
  else if (vizType === "area") chartType = "area";
  else if (vizType === "line") chartType = "line";
  else if (isBarMetric(primaryCol)) chartType = "bar";
  else chartType = "line";

  return {
    autoDetect: true,
    _chartType: chartType,
    xAxis: { dataKey: dateCol, label: dateCol.replace(/_/g, " "), type: "date" },
    yAxes: [{
      dataKey: primaryCol,
      label: primaryCol.replace(/_/g, " "),
      color: DUNE_CHART_COLORS[0],
      yAxisId: "left",
      format: fmt,
    }],
  };
}

const updateCompanySchema = insertCompanySchema.partial().extend({
  pipelineStage: z.enum(PIPELINE_STAGES).optional(),
  tags: z.array(z.string()).optional(),
  excitementScore: z.number().int().min(1).max(10).nullable().optional(),
  excitementReason: z.string().max(500).nullable().optional(),
});

const enrichRequestSchema = z.object({
  input: z.string().min(1, "Some input is required — a URL, company name, tweet link, founder profile, or any relevant text"),
});

const stepRequestSchema = z.object({
  sessionId: z.string().min(1),
  responseText: z.string().min(1),
  responseUsage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }).optional(),
  mppCost: z.number().optional(),
});

async function autoAttachMasterQueries(company: { id: string; name: string; tokenTicker?: string | null; tokenChain?: string | null }) {
  const existing = await storage.getDuneQueries(company.id);
  const existingQueryIds = new Set(existing.map(q => q.queryId));
  const allMaster = await storage.getMasterDuneQueries();

  const companyNameLower = company.name.toLowerCase();
  const ticker = company.tokenTicker?.toLowerCase();
  const chain = company.tokenChain?.toLowerCase();

  let attachCount = 0;
  for (const mq of allMaster) {
    if (existingQueryIds.has(mq.queryId)) continue;
    const tags = (mq.protocolTags || []).map(t => t.toLowerCase());
    const chains = (mq.chainTags || []).map(t => t.toLowerCase());

    const tagMatch = tags.some(t => companyNameLower.includes(t) || (ticker && t === ticker));
    const chainMatch = chain && chains.includes(chain);

    if (tagMatch || chainMatch) {
      await storage.addDuneQuery({
        companyId: company.id,
        queryId: mq.queryId,
        label: mq.label,
        visualizationType: mq.visualizationType,
        displayOrder: existing.length + attachCount,
        masterQueryId: mq.id,
      });
      attachCount++;
    }
  }
  if (attachCount > 0) {
    console.log(`[Auto] Attached ${attachCount} master Dune queries to ${company.name}`);
  }
}

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

  app.post("/api/telegram/link-code", requireAuth, async (req, res) => {
    const code = generateTelegramLinkCode(req.user!.id);
    res.json({ code, expiresIn: "10 minutes" });
  });

  app.get("/api/enrichment/pricing", (_req, res) => {
    const estimated = getEstimatedEnrichmentCost();
    const lastCost = getLastEnrichmentCost();
    res.json({
      model: "cost-plus",
      markupMultiplier: MARKUP_MULTIPLIER,
      estimatedCost: estimated.toFixed(2),
      lastEnrichment: lastCost ? {
        apiCost: lastCost.apiCost.toFixed(4),
        totalCharge: lastCost.totalCharge.toFixed(4),
      } : null,
      currency: "USDC",
      recipient: "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d",
    });
  });

  app.get("/api/transactions", requireAuth, async (req, res) => {
    try {
      const txs = await storage.getTransactions(req.user!.id);
      res.json(txs);
    } catch (error: any) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/credits", requireAuth, async (req, res) => {
    const credits = await storage.getUserCredits(req.user!.id);
    res.json({ credits });
  });

  app.get("/api/credits/products", requireAuth, async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.type as price_type,
          pr.recurring_interval,
          pr.recurring_interval_count
        FROM stripe_products p
        JOIN stripe_prices pr ON pr.product_id = p.id
        WHERE p.active = true AND pr.active = true
        ORDER BY pr.unit_amount ASC
      `);
      const rows = result.rows || result;
      const products = rows.map((row: any) => ({
        productId: row.product_id,
        name: row.product_name,
        description: row.product_description,
        metadata: row.product_metadata,
        priceId: row.price_id,
        unitAmount: row.unit_amount,
        currency: row.currency,
        priceType: row.price_type,
        recurringInterval: row.recurring_interval,
        recurringIntervalCount: row.recurring_interval_count,
      }));
      res.json(products);
    } catch (error: any) {
      console.error("Error fetching credit products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/credits/checkout", requireAuth, async (req, res) => {
    try {
      const { priceId, mode } = req.body;
      if (!priceId) return res.status(400).json({ message: "priceId required" });

      const stripe = await getUncachableStripeClient();
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { userId: user.id, username: user.username },
        });
        await storage.updateStripeCustomerId(user.id, customer.id);
        customerId = customer.id;
      }

      const price = await stripe.prices.retrieve(priceId);
      const isRecurring = price.type === "recurring";
      const isSubscription = isRecurring;

      if (mode === "subscription" && !isRecurring) {
        return res.status(400).json({ message: "This price does not support subscriptions" });
      }
      if (mode === "payment" && isRecurring) {
        return res.status(400).json({ message: "This price requires a subscription" });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: isSubscription ? "subscription" : "payment",
        success_url: `${baseUrl}/credits?checkout=success`,
        cancel_url: `${baseUrl}/credits?checkout=cancelled`,
        metadata: { userId: user.id },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/subscription/cancel", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user || !user.subscriptionId) {
        return res.status(400).json({ message: "No active subscription" });
      }

      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.subscriptionId, {
        cancel_at_period_end: true,
      });

      res.json({ message: "Subscription will cancel at end of billing period" });
    } catch (error: any) {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  // ─── ENRICHMENT ORCHESTRATION (Session-based) ───────────────────────────

  app.post("/api/enrich/prepare", requireAuth, enrichmentPaywall, async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sessionId, anthropicRequest, progress } = await startEnrichmentSession(parsed.data.input, req.user!.id);
      res.json({ sessionId, anthropicRequest, progress });
    } catch (error: any) {
      console.error("Enrichment prepare error:", error);
      res.status(500).json({ message: "Failed to prepare enrichment", error: error.message });
    }
  });

  app.post("/api/enrich/step", requireAuth, async (req, res) => {
    try {
      const parsed = stepRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { sessionId, responseText, responseUsage, mppCost } = parsed.data;
      const result = await advanceEnrichmentSession(sessionId, req.user!.id, responseText, responseUsage, mppCost);

      if (result.result) {
        try {
          await storage.logTransaction({
            userId: req.user!.id,
            type: "enrichment",
            description: result.result.enriched.name ? `AI research: ${result.result.enriched.name}` : "AI deal research",
            amount: result.result.totalCharge.toFixed(4),
            apiCost: result.result.apiCost.toFixed(4),
            companyName: result.result.enriched.name || undefined,
            inputTokens: result.result.tokenUsage.inputTokens,
            outputTokens: result.result.tokenUsage.outputTokens,
            status: "success",
          });
        } catch (err) {
          console.error("[Transaction] Failed to log:", err);
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("Enrichment step error:", error);
      res.status(500).json({ message: "Enrichment step failed", error: error.message });
    }
  });

  // ─── NEXT STEPS ORCHESTRATION ───────────────────────────────────────────

  app.post("/api/companies/:id/next-steps/prepare", requireAuth, nextStepsPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const founders = await storage.getFoundersByCompany(req.params.id);
      const notes = await storage.getNotesByCompany(req.params.id);

      const { sessionId, anthropicRequest } = startNextStepsSession({
        userId,
        companyId: req.params.id,
        company: {
          name: company.name,
          oneLiner: company.oneLiner,
          description: company.description,
          sector: company.sector,
          businessModel: company.businessModel,
          stage: company.stage,
          fundingHistory: company.fundingHistory,
          competitiveLandscape: company.competitiveLandscape,
          sourceUrl: company.sourceUrl,
          websiteUrl: company.websiteUrl,
          githubUrl: company.githubUrl,
          twitterUrl: company.twitterUrl,
          linkedinUrl: company.linkedinUrl,
          pipelineStage: company.pipelineStage,
          tags: company.tags,
        },
        founders: founders.map((f) => ({
          name: f.name,
          role: f.role,
          linkedinUrl: f.linkedinUrl,
          twitterUrl: f.twitterUrl,
          githubUrl: f.githubUrl,
          personalUrl: f.personalUrl,
          priorCompanies: f.priorCompanies,
        })),
        notes: notes.map((n) => ({
          content: n.content,
          createdAt: n.createdAt,
        })),
      });

      res.json({ sessionId, anthropicRequest });
    } catch (error: any) {
      console.error("Next steps prepare error:", error);
      res.status(500).json({ message: "Failed to prepare next steps", error: error.message });
    }
  });

  app.post("/api/companies/:id/next-steps/step", requireAuth, async (req, res) => {
    try {
      const parsed = stepRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      const { sessionId, responseText, responseUsage, mppCost } = parsed.data;
      const result = advanceNextStepsSession(sessionId, userId, responseText, responseUsage, mppCost);

      if (result.result && company) {
        try {
          await storage.logTransaction({
            userId,
            type: "next_steps",
            description: `AI next steps: ${company.name}`,
            amount: result.result.totalCharge.toFixed(4),
            apiCost: result.result.apiCost.toFixed(4),
            companyName: company.name,
            inputTokens: result.result.inputTokens,
            outputTokens: result.result.outputTokens,
          });
        } catch (err) {
          console.error("[Transaction] Failed to log next-steps:", err);
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("Next steps step error:", error);
      res.status(500).json({ message: "Next steps step failed", error: error.message });
    }
  });

  // ─── DEEP RESEARCH ORCHESTRATION ────────────────────────────────────────

  app.post("/api/companies/:id/reports/prepare", requireAuth, deepResearchPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }

      if (!isServerMppReady()) {
        return res.status(503).json({ message: "AI service not configured" });
      }

      const founders = await storage.getFoundersByCompany(company.id);
      const notes = await storage.getNotesByCompany(company.id);

      const report = await storage.createReport({
        companyId: company.id,
        userId,
        title: `${company.name} — Deep Research Report`,
        content: "",
        status: "generating",
      });

      const { sessionId, anthropicRequest, phase2Request, userMessage } = startDeepResearchSession(
        userId,
        company.id,
        report.id,
        company,
        founders,
        notes,
        company.deletedReportCount || 0,
      );

      res.json({ reportId: report.id });

      (async () => {
        try {
          console.log(`[DeepResearch] Phase 1/3: Gathering research for ${company.name}`);
          const phase1Result = await callAnthropicServerHeavy(anthropicRequest);
          const phase1Notes = phase1Result.text;
          let totalMppCost = phase1Result.mppCost;
          let totalInput = phase1Result.usage.input_tokens;
          let totalOutput = phase1Result.usage.output_tokens;
          console.log(`[DeepResearch] Phase 1 complete. Cost: $${phase1Result.mppCost.toFixed(6)}`);

          console.log(`[DeepResearch] Phase 2/3: Competitive & risk research for ${company.name}`);
          const phase2Result = await callAnthropicServerHeavy(phase2Request);
          const phase2Notes = phase2Result.text;
          totalMppCost += phase2Result.mppCost;
          totalInput += phase2Result.usage.input_tokens;
          totalOutput += phase2Result.usage.output_tokens;
          console.log(`[DeepResearch] Phase 2 complete. Cost: $${phase2Result.mppCost.toFixed(6)}`);

          const synthesisRequest = buildAnthropicRequest(
            DEEP_RESEARCH_SYSTEM,
            `You have completed two research phases on "${company.name}". Now synthesize ALL research into the final Markdown report following the exact report structure specified in your system instructions.\n\nORIGINAL CONTEXT:\n${userMessage}\n\nPHASE 1 RESEARCH NOTES:\n${phase1Notes}\n\nPHASE 2 RESEARCH NOTES:\n${phase2Notes}\n\nProduce the FINAL complete Markdown research report now. Use ALL the research gathered above. Do NOT search again — just write the report.`,
            false, 16000,
          );

          console.log(`[DeepResearch] Phase 3/3: Synthesizing final report for ${company.name}`);
          const phase3Result = await callAnthropicServerHeavy(synthesisRequest);
          totalMppCost += phase3Result.mppCost;
          totalInput += phase3Result.usage.input_tokens;
          totalOutput += phase3Result.usage.output_tokens;
          console.log(`[DeepResearch] Phase 3 complete. Cost: $${phase3Result.mppCost.toFixed(6)}`);

          const result = completeDeepResearchSession(
            sessionId, userId, phase3Result.text,
            { input_tokens: totalInput, output_tokens: totalOutput },
            totalMppCost,
          );

          await storage.updateReport(report.id, { content: result.content, status: "complete" });
          console.log(`[DeepResearch] Report complete for ${company.name} (${report.id}). Total MPP cost: $${result.apiCost.toFixed(6)}`);

          try {
            await storage.logTransaction({
              userId,
              type: "deep_research",
              description: `Deep research: ${company.name}`,
              amount: result.totalCharge.toFixed(4),
              apiCost: result.apiCost.toFixed(4),
              companyName: company.name,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            });
          } catch (err) {
            console.error("[Transaction] Failed to log deep-research:", err);
          }
        } catch (error: any) {
          console.error(`[DeepResearch] Background AI call failed for ${company.name}:`, error.message);
          await storage.updateReport(report.id, {
            content: `# Report Generation Failed\n\nError: ${error.message}\n\nPlease try generating again.`,
            status: "failed",
          }).catch(() => {});
          if (typeof totalMppCost === "number" && totalMppCost > 0) {
            try {
              await storage.logTransaction({
                userId,
                type: "deep_research",
                description: `Deep research FAILED (partial): ${company.name}`,
                amount: (totalMppCost * MARKUP_MULTIPLIER).toFixed(4),
                apiCost: totalMppCost.toFixed(4),
                companyName: company.name,
                inputTokens: totalInput || 0,
                outputTokens: totalOutput || 0,
              });
            } catch {}
          }
        }
      })();
    } catch (error: any) {
      console.error("Report prepare error:", error);
      res.status(500).json({ message: "Failed to prepare report generation", error: error.message });
    }
  });

  // ─── COMPANY CRUD ──────────────────────────────────────────────────────

  app.get("/api/companies", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const companies = await storage.getCompanies(userId);
    res.json(companies);
  });

  app.get("/api/companies/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.post("/api/companies", requireAuth, async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const userId = req.user!.id;
    const company = await storage.createCompany({ ...parsed.data, userId } as any);

    if (company.hasLiquidToken && company.tokenTicker) {
      try {
        await storage.upsertTokenProfile({
          companyId: company.id,
          contractAddress: company.tokenContractAddress || "",
          chain: company.tokenChain || "unknown",
          tokenTicker: company.tokenTicker,
        });
        console.log(`[Auto] Created token profile for ${company.name} (${company.tokenTicker})`);
        autoAttachMasterQueries(company).catch(err => console.warn(`[Auto] Failed to auto-attach queries:`, err));
      } catch (err) {
        console.warn(`[Auto] Failed to auto-create token profile:`, err);
      }
    }

    res.status(201).json(company);
  });

  app.post("/api/companies/:id/ensure-token-profile", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      if (!company.hasLiquidToken || !company.tokenTicker) {
        return res.status(400).json({ message: "Company does not have liquid token data" });
      }

      const existing = await storage.getTokenProfile(company.id);
      if (existing) return res.json(existing);

      const profile = await storage.upsertTokenProfile({
        companyId: company.id,
        contractAddress: company.tokenContractAddress || "",
        chain: company.tokenChain || "unknown",
        tokenTicker: company.tokenTicker,
      });
      console.log(`[Auto] Retroactively created token profile for ${company.name} (${company.tokenTicker})`);
      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to ensure token profile" });
    }
  });

  app.patch("/api/companies/:id", requireAuth, async (req, res) => {
    const parsed = updateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const userId = req.user!.id;
    const company = await storage.updateCompany(req.params.id, parsed.data, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.delete("/api/companies/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    await storage.deleteCompany(req.params.id, userId);
    res.status(204).end();
  });

  // ─── FOUNDERS ──────────────────────────────────────────────────────────

  app.get("/api/companies/:id/founders", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const foundersList = await storage.getFoundersByCompany(req.params.id);
    res.json(foundersList);
  });

  app.post("/api/companies/:id/founders", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const parsed = insertFounderSchema.safeParse({
      ...req.body,
      companyId: req.params.id,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const founder = await storage.createFounder(parsed.data);
    res.status(201).json(founder);
  });

  // ─── NOTES ─────────────────────────────────────────────────────────────

  app.get("/api/companies/:id/notes", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const notesList = await storage.getNotesByCompany(req.params.id);
    res.json(notesList);
  });

  app.post("/api/companies/:id/notes", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const parsed = insertNoteSchema.safeParse({
      ...req.body,
      companyId: req.params.id,
    });
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const note = await storage.createNote(parsed.data);
    res.status(201).json(note);
  });

  app.delete("/api/notes/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteNote(req.params.id, req.user!.id);
    if (!deleted) return res.status(404).json({ message: "Note not found" });
    res.status(204).end();
  });

  // ─── REPORTS ───────────────────────────────────────────────────────────

  app.get("/api/companies/:id/reports", requireAuth, async (req, res) => {
    const reports = await storage.getReportsByCompany(req.params.id, req.user!.id);
    res.json(reports);
  });

  app.get("/api/reports/:id", requireAuth, async (req, res) => {
    const report = await storage.getReport(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
    res.json(report);
  });

  app.delete("/api/reports/:id", requireAuth, async (req, res) => {
    const result = await storage.deleteReport(req.params.id, req.user!.id);
    if (!result) return res.status(404).json({ message: "Report not found" });
    res.json({ message: "Report deleted", companyId: result.companyId });
  });

  // ─── TOKEN INTELLIGENCE ──────────────────────────────────────────────

  app.get("/api/companies/:id/token-profile", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const profile = await storage.getTokenProfile(req.params.id);
    res.json(profile || null);
  });

  app.put("/api/companies/:id/token-profile", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const parsed = insertTokenProfileSchema.safeParse({ ...req.body, companyId: req.params.id });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const profile = await storage.upsertTokenProfile(parsed.data);
    res.json(profile);
  });

  app.delete("/api/companies/:id/token-profile", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    await storage.deleteTokenProfile(req.params.id);
    res.status(204).end();
  });

  app.get("/api/master-dune-queries", requireAuth, async (req, res) => {
    try {
      const { protocol, chain, category } = req.query;
      if (protocol || chain || category) {
        const results = await storage.searchMasterDuneQueries(
          protocol as string | undefined,
          chain as string | undefined,
          category as string | undefined
        );
        return res.json(results);
      }
      const queries = await storage.getMasterDuneQueries();
      res.json(queries);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch master queries" });
    }
  });

  app.post("/api/master-dune-queries", requireAuth, async (req, res) => {
    try {
      const parsed = insertMasterDuneQuerySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      const query = await storage.upsertMasterDuneQuery(parsed.data);
      res.status(201).json(query);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to save master query" });
    }
  });

  app.post("/api/master-dune-queries/sync", requireAuth, async (req, res) => {
    try {
      const { queries, fromExternal } = req.body;

      if (fromExternal) {
        const externalRes = await fetch("https://dune-data-copier.replit.app/api/queries");
        if (!externalRes.ok) throw new Error(`External API returned ${externalRes.status}`);
        const externalData: any[] = await externalRes.json();

        const results = [];
        for (const eq of externalData) {
          if (eq.isArchived) continue;

          const nameLower = eq.name?.toLowerCase() || "";
          const descLower = eq.description?.toLowerCase() || "";
          const combinedText = `${nameLower} ${descLower}`;
          const externalTags: string[] = eq.tags || [];

          const protocolTags: string[] = [...externalTags];
          const chainTags: string[] = [];
          let category = "general";

          const protocolPatterns: [RegExp, string][] = [
            [/\bhyperliquid\b|^hl[_\s]|[_\s]hl[_\s]|[_\s]hl$/i, "hyperliquid"],
            [/\buniswap\b/i, "uniswap"],
            [/\baave\b/i, "aave"],
            [/\blido\b/i, "lido"],
            [/\bmaker\b|\bsky\b|\bdai\b/i, "maker"],
            [/\bcurve\b/i, "curve"],
            [/\bcompound\b/i, "compound"],
            [/\barbitrum\b|\barb\b/i, "arbitrum"],
            [/\boptimism\b|\bop\b/i, "optimism"],
            [/\bjupiter\b|\bjup\b/i, "jupiter"],
            [/\bjito\b/i, "jito"],
            [/\braydium\b/i, "raydium"],
            [/\blighter\b/i, "lighter"],
            [/\bpump\b/i, "pump"],
            [/\b1inch\b/i, "1inch"],
          ];

          for (const [pattern, tag] of protocolPatterns) {
            if (pattern.test(combinedText) && !protocolTags.includes(tag)) {
              protocolTags.push(tag);
            }
          }

          if (/\bsol[_\s]|solana/i.test(combinedText)) chainTags.push("solana");
          if (/\beth[_\s]|ethereum/i.test(combinedText)) chainTags.push("ethereum");
          if (/\bbase[_\s]/i.test(combinedText)) chainTags.push("base");
          if (/\bavax|avalanche/i.test(combinedText)) chainTags.push("avalanche");

          if (/revenue|fee|pnl|earnings/i.test(combinedText)) category = "revenue";
          else if (/volume|vol[_\s]|trade/i.test(combinedText)) category = "trading";
          else if (/tvl|liquidity|pool/i.test(combinedText)) category = "tvl";
          else if (/user|active|dau|mau|address/i.test(combinedText)) category = "users";
          else if (/price|market|cap/i.test(combinedText)) category = "market";
          else if (/flow|transfer|bridge/i.test(combinedText)) category = "flows";
          else if (/supply|mint|burn|stablecoin/i.test(combinedText)) category = "supply";

          const vizType = /chart|line|area|trend|daily|weekly|monthly/i.test(nameLower) ? "line" :
                         /bar|distribution|tier/i.test(nameLower) ? "bar" : "table";

          const saved = await storage.upsertMasterDuneQuery({
            queryId: eq.id,
            label: eq.name,
            description: eq.description || null,
            category,
            protocolTags,
            chainTags,
            visualizationType: vizType,
            sourceUrl: `https://dune.com/queries/${eq.id}`,
            isActive: !eq.isPrivate,
          });
          results.push(saved);
        }
        return res.json({ synced: results.length, total: externalData.length });
      }

      if (!Array.isArray(queries)) return res.status(400).json({ message: "Expected { queries: [...] } or { fromExternal: true }" });
      const results = [];
      for (const q of queries) {
        const parsed = insertMasterDuneQuerySchema.safeParse(q);
        if (parsed.success) {
          const saved = await storage.upsertMasterDuneQuery(parsed.data);
          results.push(saved);
        }
      }
      res.json({ synced: results.length, queries: results });
    } catch (error: any) {
      console.error("[MasterSync] Error:", error.message);
      res.status(500).json({ message: error.message || "Sync failed" });
    }
  });

  app.delete("/api/master-dune-queries/:id", requireAuth, async (req, res) => {
    const deleted = await storage.deleteMasterDuneQuery(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Query not found" });
    res.status(204).end();
  });

  app.post("/api/companies/:id/auto-attach-dune-queries", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const existing = await storage.getDuneQueries(req.params.id);
      const existingQueryIds = new Set(existing.map(q => q.queryId));

      const allMaster = await storage.getMasterDuneQueries();
      const matched: typeof allMaster = [];

      const companyNameLower = company.name.toLowerCase();
      const ticker = company.tokenTicker?.toLowerCase();
      const chain = company.tokenChain?.toLowerCase();

      for (const mq of allMaster) {
        if (existingQueryIds.has(mq.queryId)) continue;

        const tags = (mq.protocolTags || []).map(t => t.toLowerCase());
        const chains = (mq.chainTags || []).map(t => t.toLowerCase());

        if (tags.some(t => companyNameLower.includes(t) || (ticker && t === ticker))) {
          matched.push(mq);
        } else if (chain && chains.includes(chain)) {
          matched.push(mq);
        }
      }

      const attached = [];
      for (const mq of matched) {
        const added = await storage.addDuneQuery({
          companyId: req.params.id,
          queryId: mq.queryId,
          label: mq.label,
          visualizationType: mq.visualizationType,
          displayOrder: existing.length + attached.length,
          masterQueryId: mq.id,
        });
        attached.push(added);
      }

      res.json({ attached: attached.length, queries: attached, matchedFrom: matched.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Auto-attach failed" });
    }
  });

  app.get("/api/companies/:id/dune-queries", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const queries = await storage.getDuneQueries(req.params.id);
    res.json(queries);
  });

  app.post("/api/companies/:id/dune-queries", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const parsed = insertDuneQuerySchema.safeParse({ ...req.body, companyId: req.params.id });
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    const query = await storage.addDuneQuery(parsed.data);

    const chart = await storage.createDashboardChart({
      companyId: req.params.id,
      userId,
      title: query.label,
      description: `Dune query #${query.queryId}`,
      chartType: "line",
      dataSource: "dune",
      dataSourceConfig: JSON.stringify({ queryId: query.queryId }),
      chartConfig: JSON.stringify({ autoDetect: true }),
      data: null,
      status: "pending",
      errorMessage: null,
    });

    if (isDuneConfigured()) {
      (async () => {
        try {
          const result = await getLatestDuneResults(query.queryId);
          const columns = result.columns || [];
          const rows = result.rows || [];

          const finalChartConfig = buildDuneChartConfig(columns, rows, query.visualizationType);

          await storage.updateDashboardChart(chart.id, {
            chartType: finalChartConfig._chartType || "line",
            chartConfig: JSON.stringify(finalChartConfig),
            data: JSON.stringify(rows),
            status: rows.length > 0 ? "completed" : "failed",
            errorMessage: rows.length > 0 ? null : "Query returned no data",
          });
          console.log(`[Auto] Created dashboard chart for Dune query #${query.queryId} (${rows.length} rows)`);
        } catch (err: any) {
          await storage.updateDashboardChart(chart.id, {
            status: "failed",
            errorMessage: err.message || "Failed to fetch Dune data",
          });
          console.warn(`[Auto] Failed to populate chart for Dune #${query.queryId}:`, err.message);
        }
      })();
    }

    res.status(201).json(query);
  });

  app.delete("/api/dune-queries/:id", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const queryRecord = await storage.getDuneQueryWithCompany(req.params.id);
    if (!queryRecord) return res.status(404).json({ message: "Query not found" });
    const company = await storage.getCompany(queryRecord.companyId, userId);
    if (!company) return res.status(404).json({ message: "Query not found" });
    const deleted = await storage.removeDuneQuery(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Query not found" });
    res.status(204).end();
  });

  app.post("/api/dune-queries/:id/execute", requireAuth, duneQueryPaywall, async (req, res) => {
    try {
      if (!isDuneConfigured()) return res.status(503).json({ message: "Dune API key not configured" });
      const userId = req.user!.id;
      const queryRecord = await storage.getDuneQueryWithCompany(req.params.id);
      if (!queryRecord) return res.status(404).json({ message: "Query not found" });
      const company = await storage.getCompany(queryRecord.companyId, userId);
      if (!company) return res.status(404).json({ message: "Query not found" });
      const result = await getLatestDuneResults(queryRecord.query.queryId);

      await storage.logTransaction({
        userId,
        type: "dune_query",
        amount: "0.05",
        description: `Dune query: ${queryRecord.query.label} (${queryRecord.query.queryId})`,
        companyName: company.name,
        apiCost: "0.00",
      }).catch(err => console.error("[Dune] Failed to log transaction:", err));

      res.json(result);
    } catch (error: any) {
      console.error("Dune query error:", error.message);
      res.status(500).json({ message: error.message || "Dune query failed" });
    }
  });

  app.post("/api/dune-queries/:id/refresh", requireAuth, duneQueryPaywall, async (req, res) => {
    try {
      if (!isDuneConfigured()) return res.status(503).json({ message: "Dune API key not configured" });
      const userId = req.user!.id;
      const queryRecord = await storage.getDuneQueryWithCompany(req.params.id);
      if (!queryRecord) return res.status(404).json({ message: "Query not found" });
      const company = await storage.getCompany(queryRecord.companyId, userId);
      if (!company) return res.status(404).json({ message: "Query not found" });
      const result = await executeDuneQuery(queryRecord.query.queryId);

      await storage.logTransaction({
        userId,
        type: "dune_refresh",
        amount: "0.05",
        description: `Dune refresh: ${queryRecord.query.label} (${queryRecord.query.queryId})`,
        companyName: company.name,
        apiCost: "0.00",
      }).catch(err => console.error("[Dune] Failed to log transaction:", err));

      res.json(result);
    } catch (error: any) {
      console.error("Dune refresh error:", error.message);
      res.status(500).json({ message: error.message || "Dune query refresh failed" });
    }
  });

  app.get("/api/companies/:id/token-analyses", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) return res.status(404).json({ message: "Company not found" });
    const analyses = await storage.getTokenAnalysesByCompany(req.params.id, userId);
    res.json(analyses);
  });

  app.get("/api/token-analyses/:id", requireAuth, async (req, res) => {
    const analysis = await storage.getTokenAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ message: "Analysis not found" });
    if (analysis.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
    res.json(analysis);
  });

  app.delete("/api/token-analyses/:id", requireAuth, async (req, res) => {
    const analysis = await storage.getTokenAnalysis(req.params.id);
    if (!analysis) return res.status(404).json({ message: "Analysis not found" });
    if (analysis.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
    await storage.deleteTokenAnalysis(req.params.id);
    res.json({ success: true });
  });

  app.post("/api/companies/:id/token-snapshot", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const tokenProfile = await storage.getTokenProfile(req.params.id);
      if (!tokenProfile) return res.status(400).json({ message: "No token profile attached to this company" });

      const { snapshot, mppCost } = await fetchTokenSnapshot(
        tokenProfile.contractAddress,
        tokenProfile.chain,
        tokenProfile.tokenTicker || "UNKNOWN"
      );

      await storage.logTransaction({
        userId,
        type: "token_snapshot",
        amount: (mppCost * MARKUP_MULTIPLIER).toFixed(4),
        description: `Token snapshot for ${tokenProfile.tokenTicker || tokenProfile.contractAddress.slice(0, 10)}`,
        apiCost: mppCost.toFixed(6),
        companyName: company.name,
      });

      res.json(snapshot);
    } catch (error: any) {
      console.error("Token snapshot error:", error);
      res.status(500).json({ message: error.message || "Failed to fetch token snapshot" });
    }
  });

  app.post("/api/companies/:id/token-analyses/generate", requireAuth, tokenIntelPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const tokenProfile = await storage.getTokenProfile(req.params.id);
      if (!tokenProfile) return res.status(400).json({ message: "No token profile attached to this company" });

      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });

      const duneQueryConfigs = await storage.getDuneQueries(req.params.id);

      const analysis = await storage.createTokenAnalysis({
        companyId: company.id,
        userId,
        content: "",
        status: "generating",
      });

      res.json({ analysisId: analysis.id });

      runTokenAnalysis(analysis.id, userId, company, tokenProfile, duneQueryConfigs);
    } catch (error: any) {
      console.error("Token analysis error:", error);
      res.status(500).json({ message: "Failed to start token analysis" });
    }
  });

  app.get("/api/dune/status", requireAuth, (_req, res) => {
    res.json({ configured: isDuneConfigured() });
  });

  // ─── DASHBOARD CHARTS ──────────────────────────────────────────────────

  app.get("/api/companies/:id/charts", requireAuth, async (req, res) => {
    try {
      const charts = await storage.getDashboardChartsByCompany(req.params.id, req.user!.id);
      res.json(charts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/companies/:id/charts/generate", requireAuth, dataChartPaywall, async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "Prompt is required" });
      }

      const company = await storage.getCompany(req.params.id, req.user!.id);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const tokenProfile = await storage.getTokenProfile(company.id);
      const duneQueries = await storage.getDuneQueries(company.id);

      let tokenSnapshot = null;
      if (tokenProfile) {
        try {
          const { snapshot } = await fetchTokenSnapshot(
            tokenProfile.contractAddress || "",
            tokenProfile.chain || "ethereum",
            tokenProfile.tokenTicker || ""
          );
          tokenSnapshot = snapshot;
        } catch {}
      }

      const result = await runDataAgent({
        companyId: company.id,
        companyName: company.name,
        userId: req.user!.id,
        userPrompt: prompt,
        tokenProfile,
        savedDuneQueries: duneQueries,
        tokenSnapshot,
      });

      await storage.logTransaction({
        userId: req.user!.id,
        type: "data_chart",
        description: `Chart generation: "${prompt.substring(0, 100)}"`,
        amount: (result.totalCost * MARKUP_MULTIPLIER).toFixed(4),
        apiCost: result.totalCost.toFixed(4),
        companyName: company.name,
      });

      res.json({ charts: result.charts });
    } catch (e: any) {
      console.error("[Data Agent] Error:", e.message);
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/charts/:id/refresh", requireAuth, async (req, res) => {
    try {
      const chart = await storage.getDashboardChart(req.params.id);
      if (!chart) return res.status(404).json({ message: "Chart not found" });
      if (chart.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });

      const updated = await refreshChartData(req.params.id);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/charts/:id", requireAuth, async (req, res) => {
    try {
      const chart = await storage.getDashboardChart(req.params.id);
      if (!chart) return res.status(404).json({ message: "Chart not found" });
      if (chart.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });

      await storage.deleteDashboardChart(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── ADMIN ─────────────────────────────────────────────────────────────

  app.get("/api/admin/analytics", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });

    const [userStats] = await db.execute(sql`
      SELECT COUNT(*) as total_users,
             COUNT(CASE WHEN wallet_address IS NOT NULL THEN 1 END) as users_with_wallets,
             MIN(created_at) as first_signup
      FROM users WHERE created_at IS NOT NULL
    `);

    const [txStats] = await db.execute(sql`
      SELECT COUNT(*) as total_transactions,
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_revenue,
             COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as total_api_cost,
             COALESCE(AVG(CAST(amount AS NUMERIC)), 0) as avg_transaction,
             COUNT(DISTINCT user_id) as paying_users
      FROM transactions
    `);

    const txByType = await db.execute(sql`
      SELECT type, COUNT(*) as count,
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as revenue,
             COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as cost,
             COALESCE(SUM(input_tokens), 0) as total_input_tokens,
             COALESCE(SUM(output_tokens), 0) as total_output_tokens
      FROM transactions GROUP BY type ORDER BY count DESC
    `);

    const [companyStats] = await db.execute(sql`
      SELECT COUNT(*) as total_companies,
             COUNT(DISTINCT user_id) as users_with_companies
      FROM companies
    `);

    const [reportStats] = await db.execute(sql`
      SELECT COUNT(*) as total_reports,
             COUNT(CASE WHEN status = 'complete' THEN 1 END) as completed_reports
      FROM reports
    `);

    const dailyActivity = await db.execute(sql`
      SELECT DATE(created_at) as day, COUNT(*) as transactions, 
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as revenue
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY day DESC
    `);

    const stageDistribution = await db.execute(sql`
      SELECT pipeline_stage, COUNT(*) as count
      FROM companies GROUP BY pipeline_stage ORDER BY count DESC
    `);

    res.json({
      users: userStats,
      transactions: txStats,
      transactionsByType: txByType.rows || txByType,
      companies: companyStats,
      reports: reportStats,
      dailyActivity: dailyActivity.rows || dailyActivity,
      stageDistribution: stageDistribution.rows || stageDistribution,
    });
  });

  return httpServer;
}
