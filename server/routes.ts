import type { Express } from "express";
import { createServer, type Server } from "http";
import crypto from "crypto";
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
import { runDataAgent, refreshChartData, DATA_CHART_CHARGE, analyzeFailurePatterns } from "./data-agent";
import { fetchTokenSnapshot } from "./allium-client";
import { executeDuneQuery, getLatestDuneResults, isDuneConfigured } from "./dune-client";
import { runTokenAnalysis } from "./token-agent";
import { callAnthropicServer, callAnthropicServerHeavy, isServerMppReady, getChannelStats } from "./mpp-client";
import { generateTelegramLinkCode } from "./telegram";
import { checkCostAlert } from "./cost-alert";
import { getWalletInfo, closeAllChannels, requestCloseChannel, withdrawChannel, getOnChainCostReport } from "./wallet-manager";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { trackEvent } from "./usage-tracker";

function buildDuneChartConfig(columns: string[], rows: any[]): any {
  return { columns, _chartType: "table" };
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
      trackEvent(req.user!.id, "enrichment_started", { input: parsed.data.input.slice(0, 200) });
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

      trackEvent(userId, "deep_research_started", { companyId: company.id, companyName: company.name });
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
          let anyCostSourceVoucher = phase1Result.costSource === "voucher_estimate";
          console.log(`[DeepResearch] Phase 1 complete. Cost: $${phase1Result.mppCost.toFixed(6)}`);

          console.log(`[DeepResearch] Phase 2/3: Competitive & risk research for ${company.name}`);
          const phase2Result = await callAnthropicServerHeavy(phase2Request);
          const phase2Notes = phase2Result.text;
          totalMppCost += phase2Result.mppCost;
          totalInput += phase2Result.usage.input_tokens;
          totalOutput += phase2Result.usage.output_tokens;
          if (phase2Result.costSource === "voucher_estimate") anyCostSourceVoucher = true;
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
          if (phase3Result.costSource === "voucher_estimate") anyCostSourceVoucher = true;
          const deepResearchCostBasis = anyCostSourceVoucher ? "voucher_estimate" : "receipt";
          console.log(`[DeepResearch] Phase 3 complete. Cost: $${phase3Result.mppCost.toFixed(6)} [${deepResearchCostBasis}]`);

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
              costBasis: deepResearchCostBasis,
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
                costBasis: anyCostSourceVoucher ? "voucher_estimate" : "receipt",
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
    trackEvent(userId, "company_created", { companyId: company.id, companyName: company.name });

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

          const finalChartConfig = buildDuneChartConfig(columns, rows);

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

      trackEvent(userId, "token_analysis_started", { companyId: company.id, companyName: company.name, tokenTicker: tokenProfile.tokenTicker });
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

      trackEvent(req.user!.id, "data_chart_generated", { companyId: company.id, companyName: company.name, prompt: prompt.slice(0, 200) });

      const tokenProfile = await storage.getTokenProfile(company.id);

      await autoAttachMasterQueries(company);
      const duneQueries = await storage.getDuneQueries(company.id);
      const allMasterQueries = await storage.getMasterDuneQueries();

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
        masterDuneQueries: allMasterQueries,
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

  app.post("/api/companies/:id/charts/refresh-failed", requireAuth, async (req, res) => {
    try {
      const allCharts = await storage.getDashboardChartsByCompany(req.params.id, req.user!.id);
      const failed = allCharts.filter(c => c.status === "failed");
      if (failed.length === 0) return res.json({ refreshed: 0, charts: [] });

      const results = await Promise.allSettled(
        failed.map(c => refreshChartData(c.id))
      );
      const allResults = results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as any).value);
      const succeeded = allResults.filter(c => c.status === "completed");
      res.json({ refreshed: succeeded.length, total: failed.length, charts: allResults });
    } catch (e: any) {
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

  app.patch("/api/charts/:id", requireAuth, async (req, res) => {
    try {
      const chart = await storage.getDashboardChart(req.params.id);
      if (!chart) return res.status(404).json({ message: "Chart not found" });
      if (chart.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });

      const { chartType, chartConfig, title } = req.body;
      const updates: any = {};
      if (chartType) updates.chartType = chartType;
      if (chartConfig) updates.chartConfig = typeof chartConfig === "string" ? chartConfig : JSON.stringify(chartConfig);
      if (title) updates.title = title;

      const updated = await storage.updateDashboardChart(req.params.id, updates);
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

  app.post("/api/companies/:id/charts/reorder", requireAuth, async (req, res) => {
    try {
      const { orderedIds } = req.body as { orderedIds: string[] };
      if (!Array.isArray(orderedIds)) return res.status(400).json({ message: "orderedIds required" });
      await Promise.all(orderedIds.map((chartId, i) =>
        storage.updateDashboardChart(chartId, { sortOrder: i })
      ));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── ADMIN ─────────────────────────────────────────────────────────────

  app.post("/api/track", requireAuth, async (req, res) => {
    const { event, metadata } = req.body;
    if (!event || typeof event !== "string") return res.status(400).json({ message: "event required" });
    const allowed = ["page_view", "login", "session_start", "company_viewed", "token_intel_viewed", "data_tab_viewed", "report_viewed"];
    if (!allowed.includes(event)) return res.status(400).json({ message: "Invalid event" });
    trackEvent(req.user!.id, event, metadata || {});
    res.json({ ok: true });
  });

  app.get("/api/admin/analytics", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });

    const userStatsResult = await db.execute(sql`
      SELECT COUNT(*) as total_users,
             COUNT(CASE WHEN wallet_address IS NOT NULL THEN 1 END) as users_with_wallets,
             NULL as first_signup
      FROM users
    `);

    const txStatsResult = await db.execute(sql`
      SELECT COUNT(*) as total_transactions,
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_revenue,
             COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as total_api_cost,
             COALESCE(AVG(CAST(amount AS NUMERIC)), 0) as avg_transaction,
             COUNT(DISTINCT user_id) as paying_users
      FROM transactions
    `);

    const txByTypeResult = await db.execute(sql`
      SELECT type, COUNT(*) as count,
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as revenue,
             COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as cost,
             COALESCE(SUM(input_tokens), 0) as total_input_tokens,
             COALESCE(SUM(output_tokens), 0) as total_output_tokens
      FROM transactions GROUP BY type ORDER BY count DESC
    `);

    const companyStatsResult = await db.execute(sql`
      SELECT COUNT(*) as total_companies,
             COUNT(DISTINCT user_id) as users_with_companies
      FROM companies
    `);

    const reportStatsResult = await db.execute(sql`
      SELECT COUNT(*) as total_reports,
             COUNT(CASE WHEN status = 'complete' THEN 1 END) as completed_reports
      FROM reports
    `);

    const dailyActivityResult = await db.execute(sql`
      SELECT DATE(created_at) as day, COUNT(*) as transactions, 
             COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as revenue
      FROM transactions
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at) ORDER BY day DESC
    `);

    const stageDistResult = await db.execute(sql`
      SELECT pipeline_stage, COUNT(*) as count
      FROM companies GROUP BY pipeline_stage ORDER BY count DESC
    `);

    const eventCountsResult = await db.execute(sql`
      SELECT event, COUNT(*) as count,
             COUNT(DISTINCT user_id) as unique_users
      FROM usage_events
      GROUP BY event ORDER BY count DESC
    `);

    const recentEventsResult = await db.execute(sql`
      SELECT ue.event, ue.metadata, ue.created_at,
             u.username, u.email
      FROM usage_events ue
      LEFT JOIN users u ON u.id = ue.user_id
      ORDER BY ue.created_at DESC
      LIMIT 50
    `);

    const dailyEventsResult = await db.execute(sql`
      SELECT DATE(created_at) as day, event, COUNT(*) as count
      FROM usage_events
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at), event
      ORDER BY day DESC
    `);

    const userListResult = await db.execute(sql`
      SELECT u.id, u.username, u.email, u.wallet_address, u.credits, u.created_at,
             COUNT(DISTINCT c.id) as company_count,
             COUNT(DISTINCT ue.id) as event_count
      FROM users u
      LEFT JOIN companies c ON c.user_id = u.id
      LEFT JOIN usage_events ue ON ue.user_id = u.id
      GROUP BY u.id, u.username, u.email, u.wallet_address, u.credits, u.created_at
      ORDER BY u.created_at DESC
    `);

    res.json({
      users: userStatsResult.rows[0],
      transactions: txStatsResult.rows[0],
      transactionsByType: txByTypeResult.rows,
      companies: companyStatsResult.rows[0],
      reports: reportStatsResult.rows[0],
      dailyActivity: dailyActivityResult.rows,
      stageDistribution: stageDistResult.rows,
      eventCounts: eventCountsResult.rows,
      recentEvents: recentEventsResult.rows,
      dailyEvents: dailyEventsResult.rows,
      userList: userListResult.rows,
      mppChannel: getChannelStats(),
    });
  });

  app.get("/api/admin/wallet", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const info = await getWalletInfo();
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/cost-report", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const report = await getOnChainCostReport();
      const txSummary = await db.execute(sql`
        SELECT 
          type,
          COUNT(*) as count,
          COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as logged_cost,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          MIN(created_at) as first_tx,
          MAX(created_at) as last_tx
        FROM transactions 
        WHERE status = 'success'
        GROUP BY type
        ORDER BY logged_cost DESC
      `);
      const totalTokens = await db.execute(sql`
        SELECT 
          COALESCE(SUM(input_tokens), 0) as total_input,
          COALESCE(SUM(output_tokens), 0) as total_output,
          COUNT(*) as total_txns
        FROM transactions WHERE status = 'success'
      `);
      const sessionBreakdown = await db.execute(sql`
        SELECT 
          t.id,
          t.type,
          t.description,
          t.company_name,
          CAST(t.api_cost AS NUMERIC) as api_cost,
          CAST(t.amount AS NUMERIC) as amount,
          COALESCE(t.input_tokens, 0) as input_tokens,
          COALESCE(t.output_tokens, 0) as output_tokens,
          t.created_at,
          u.username
        FROM transactions t
        LEFT JOIN users u ON t.user_id = u.id
        WHERE t.status = 'success'
        ORDER BY t.created_at DESC
        LIMIT 100
      `);
      const dailyCosts = await db.execute(sql`
        SELECT 
          DATE(created_at) as day,
          COUNT(*) as tx_count,
          COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as daily_cost,
          COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as daily_charged,
          COALESCE(SUM(input_tokens), 0) as daily_input_tokens,
          COALESCE(SUM(output_tokens), 0) as daily_output_tokens
        FROM transactions
        WHERE status = 'success' AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `);
      const weeklyCosts = await db.execute(sql`
        SELECT 
          DATE_TRUNC('week', created_at)::date as week_start,
          COUNT(*) as tx_count,
          COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as weekly_cost,
          COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as weekly_charged,
          COALESCE(SUM(input_tokens), 0) as weekly_input_tokens,
          COALESCE(SUM(output_tokens), 0) as weekly_output_tokens
        FROM transactions
        WHERE status = 'success' AND created_at >= NOW() - INTERVAL '12 weeks'
        GROUP BY DATE_TRUNC('week', created_at)
        ORDER BY week_start ASC
      `);
      const alertStatus = await checkCostAlert();

      res.json({
        onChain: report,
        transactionBreakdown: txSummary.rows,
        tokenUsage: totalTokens.rows[0],
        sessionBreakdown: sessionBreakdown.rows,
        dailyCosts: dailyCosts.rows,
        weeklyCosts: weeklyCosts.rows,
        costAlert: alertStatus,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/cost-alert-settings", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      let settings = await storage.getCostAlertSettings();
      if (!settings) {
        settings = await storage.upsertCostAlertSettings({ dailyThreshold: 5.0, enabled: true, telegramEnabled: false });
      }
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/admin/cost-alert-settings", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { dailyThreshold, enabled, telegramEnabled } = req.body;
      if (typeof dailyThreshold !== "number" || dailyThreshold < 0) {
        return res.status(400).json({ message: "dailyThreshold must be a non-negative number" });
      }
      const settings = await storage.upsertCostAlertSettings({
        dailyThreshold,
        enabled: enabled !== false,
        telegramEnabled: telegramEnabled === true,
      });
      res.json(settings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/reconciliation", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const onChain = await getOnChainCostReport();

      const summaryResult = await db.execute(sql`
        SELECT 
          COUNT(*) as total_transactions,
          COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as total_logged_cost,
          COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_charged,
          COUNT(CASE WHEN cost_basis = 'receipt' THEN 1 END) as receipt_count,
          COUNT(CASE WHEN cost_basis = 'voucher_estimate' THEN 1 END) as voucher_count,
          COUNT(CASE WHEN cost_basis IS NULL THEN 1 END) as unknown_count,
          COALESCE(SUM(CASE WHEN cost_basis = 'receipt' THEN CAST(api_cost AS NUMERIC) ELSE 0 END), 0) as receipt_cost,
          COALESCE(SUM(CASE WHEN cost_basis = 'voucher_estimate' THEN CAST(api_cost AS NUMERIC) ELSE 0 END), 0) as voucher_cost,
          COALESCE(SUM(CASE WHEN cost_basis IS NULL THEN CAST(api_cost AS NUMERIC) ELSE 0 END), 0) as unknown_cost
        FROM transactions WHERE status = 'success'
      `);

      const byTypeResult = await db.execute(sql`
        SELECT 
          type,
          COUNT(*) as count,
          COALESCE(SUM(CAST(api_cost AS NUMERIC)), 0) as logged_cost,
          COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as charged,
          COUNT(CASE WHEN cost_basis = 'receipt' THEN 1 END) as receipt_count,
          COUNT(CASE WHEN cost_basis = 'voucher_estimate' THEN 1 END) as voucher_count,
          COUNT(CASE WHEN cost_basis IS NULL THEN 1 END) as unknown_count
        FROM transactions WHERE status = 'success'
        GROUP BY type ORDER BY logged_cost DESC
      `);

      const recentTxResult = await db.execute(sql`
        SELECT id, type, description, amount, api_cost, cost_basis, company_name, created_at
        FROM transactions 
        WHERE status = 'success'
        ORDER BY created_at DESC
        LIMIT 100
      `);

      const summary = summaryResult.rows[0];
      const totalLoggedCost = Number(summary?.total_logged_cost || 0);
      const onChainNetCost = onChain.netCost;
      const discrepancy = totalLoggedCost - onChainNetCost;
      const discrepancyPct = onChainNetCost > 0 ? (discrepancy / onChainNetCost) * 100 : 0;

      res.json({
        summary: {
          totalTransactions: Number(summary?.total_transactions || 0),
          totalLoggedCost,
          totalCharged: Number(summary?.total_charged || 0),
          receiptCount: Number(summary?.receipt_count || 0),
          voucherCount: Number(summary?.voucher_count || 0),
          unknownCount: Number(summary?.unknown_count || 0),
          receiptCost: Number(summary?.receipt_cost || 0),
          voucherCost: Number(summary?.voucher_cost || 0),
          unknownCost: Number(summary?.unknown_cost || 0),
        },
        onChain: {
          netCost: onChainNetCost,
          totalFunded: onChain.totalFunded,
          currentBalance: onChain.currentBalance,
          protocolFees: onChain.protocolFees,
          escrowLocked: onChain.escrowLocked,
        },
        discrepancy,
        discrepancyPct,
        byType: byTypeResult.rows,
        recentTransactions: recentTxResult.rows,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/reconciliation/flag", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { action } = req.body;
      if (action === "flag_legacy") {
        const result = await db.execute(sql`
          UPDATE transactions 
          SET cost_basis = 'voucher_estimate' 
          WHERE cost_basis IS NULL AND api_cost IS NOT NULL AND CAST(api_cost AS NUMERIC) > 0
          RETURNING id
        `);
        res.json({ flagged: result.rows.length });
      } else {
        res.status(400).json({ message: "Unknown action" });
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/wallet/close-all", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const result = await closeAllChannels();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/wallet/channel/:channelId/close", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const result = await requestCloseChannel(req.params.channelId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/wallet/channel/:channelId/withdraw", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const result = await withdrawChannel(req.params.channelId);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/learnings", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const learnings = await storage.getAllActiveLearnings();
      res.json(learnings);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/learnings", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const learning = await storage.saveLearning({
        scope: req.body.scope || "global",
        scopeKey: req.body.scopeKey || "global",
        ruleType: req.body.ruleType,
        ruleText: req.body.ruleText,
        source: "manual",
        triggeredBy: "admin",
      });
      res.json(learning);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/learnings/:id", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      await storage.deactivateLearning(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/learnings/analyze", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const result = await analyzeFailurePatterns();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // BENCHMARK / AUTORESEARCH ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/admin/benchmark/seed", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { seedBenchmark } = await import("./benchmark/seed");
      const protocolLimit = parseInt(req.query.protocolLimit as string) || 100;
      const dryRun = req.query.dryRun === "true";
      const result = await seedBenchmark({ protocolLimit, dryRun });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Track active benchmark runs so we don't allow concurrent runs
  let activeBenchmarkRunId: string | null = null;

  app.post("/api/admin/benchmark/run", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });

    if (activeBenchmarkRunId) {
      return res.status(409).json({
        message: "Benchmark already in progress",
        runId: activeBenchmarkRunId,
      });
    }

    const subset = parseInt(req.query.subset as string) || undefined;
    const dryRun = req.query.dryRun === "true";
    const difficulty = req.query.difficulty as string || undefined;

    try {
      const { runBenchmark } = await import("./benchmark/runner");

      // Fire async — return immediately so the request doesn't timeout
      const runPromise = runBenchmark({ subset, dryRun, difficulty, verbose: true });

      // Capture run ID as soon as DB row is created
      runPromise.then(result => {
        activeBenchmarkRunId = null;
        console.log(`[Benchmark] Run ${result.run.id} complete: ${(result.run.overallAccuracy * 100).toFixed(1)}% accuracy, ${result.improvements.length} improvements`);
      }).catch(err => {
        activeBenchmarkRunId = null;
        console.error(`[Benchmark] Run failed:`, err.message);
      });

      // Wait briefly for the run record to be created so we can return the ID
      await new Promise(r => setTimeout(r, 2000));
      const latest = await storage.getLatestBenchmarkRun();
      if (latest && latest.status === "running") {
        activeBenchmarkRunId = latest.id;
      }

      res.json({
        status: "started",
        runId: activeBenchmarkRunId || "pending",
        config: { subset, dryRun, difficulty },
      });
    } catch (e: any) {
      activeBenchmarkRunId = null;
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/benchmark/status", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const latest = await storage.getLatestBenchmarkRun();
      const history = await storage.getBenchmarkRunHistory(10);
      const caseCount = await storage.getBenchmarkCaseCount();

      // If a run is active, get partial progress
      let activeProgress = null;
      if (activeBenchmarkRunId) {
        const activeResults = await storage.getBenchmarkCaseResultsByRun(activeBenchmarkRunId);
        const runRecord = history.find(r => r.id === activeBenchmarkRunId);
        activeProgress = {
          runId: activeBenchmarkRunId,
          completedCases: activeResults.length,
          totalCases: runRecord?.totalCases || "unknown",
          currentAccuracy: activeResults.length > 0
            ? (activeResults.filter(r => r.score >= 0.5).length / activeResults.length * 100).toFixed(1) + "%"
            : "pending",
        };
      }

      res.json({
        benchmarkCases: caseCount,
        activeRun: activeProgress,
        latestCompletedRun: latest ? {
          id: latest.id,
          configVersion: latest.configVersion,
          accuracy: (latest.overallAccuracy * 100).toFixed(1) + "%",
          passed: latest.passedCases,
          failed: latest.failedCases,
          total: latest.totalCases,
          improvements: latest.improvementsApplied,
          completedAt: latest.createdAt,
        } : null,
        runHistory: history.map(r => ({
          id: r.id,
          version: r.configVersion,
          accuracy: (r.overallAccuracy * 100).toFixed(1) + "%",
          cases: r.totalCases,
          status: r.status,
          date: r.createdAt,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/benchmark/failures/:runId", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const failures = await storage.getFailedCaseResultsByRun(req.params.runId);
      res.json({
        count: failures.length,
        failures: failures.map(f => ({
          caseId: f.caseId,
          protocol: f.benchmarkCase?.protocol,
          metricType: f.benchmarkCase?.metricType,
          query: f.benchmarkCase?.naturalLanguageQuery,
          score: f.score,
          magnitudeRatio: f.magnitudeRatio,
          trendMatch: f.trendMatch,
          mape: f.mape,
          dataSource: f.dataSource,
          error: f.errorMessage,
          sql: f.sqlUsed?.substring(0, 300),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/benchmark/observability", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const days = parseInt(req.query.days as string) || 30;
      const [failurePatterns, retryDiffs] = await Promise.all([
        storage.getFailurePatterns(days),
        storage.getRetryDiffs(days),
      ]);
      res.json({
        period: `${days} days`,
        failurePatterns: failurePatterns.slice(0, 20),
        retryDiffCount: retryDiffs.length,
        retryDiffs: retryDiffs.slice(0, 10).map(d => ({
          protocol: d.failed.protocol,
          metricType: d.failed.metricType,
          failedSql: d.failed.sqlQuery?.substring(0, 200),
          fixedSql: d.fixed.sqlQuery?.substring(0, 200),
          errorType: d.failed.errorType,
          errorMessage: d.failed.errorMessage,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ═══════════════════════════════════════════════════
  // Session Research
  // ═══════════════════════════════════════════════════

  app.get("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getConversations(req.user!.id, "research");
      res.json(sessions);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/brain/graph", requireAuth, async (req, res) => {
    try {
      const brainRecord = await storage.getResearchBrain(req.user!.id);
      if (!brainRecord) {
        return res.json({
          entities: {},
          relationships: [],
          knowledge: [],
          contradictions: [],
          preferences: {},
          meta: { totalSessions: 0, lastActive: null, topEntities: [] },
        });
      }
      res.json({
        entities: brainRecord.entities || {},
        relationships: brainRecord.relationships || [],
        knowledge: brainRecord.knowledge || [],
        contradictions: brainRecord.contradictions || [],
        preferences: brainRecord.preferences || {},
        meta: brainRecord.meta || { totalSessions: 0, lastActive: null, topEntities: [] },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/brain/preferences", requireAuth, async (req, res) => {
    try {
      const { preferences } = req.body;
      if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return res.status(400).json({ message: "preferences must be an object" });
      }

      const validKeys = new Set(["data_sources", "research_style", "analysis_lens", "custom_instructions"]);
      const cleaned: Record<string, string[]> = {};

      for (const [key, val] of Object.entries(preferences)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        if (!validKeys.has(key)) continue;
        if (!Array.isArray(val)) continue;
        const items = (val as any[])
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .map(v => v.trim().slice(0, 1000))
          .slice(0, 50);
        if (items.length > 0) cleaned[key] = items;
      }

      await storage.upsertResearchBrain(req.user!.id, { preferences: cleaned });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/sessions", requireAuth, async (req, res) => {
    try {
      const session = await storage.createConversation({
        userId: req.user!.id,
        title: req.body.title || "New Research Session",
        type: "research",
      });
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      const msgs = await storage.getMessages(session.id);
      res.json(msgs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/research/sessions/:id/messages", requireAuth, async (req, res) => {
    let keepalive: ReturnType<typeof setInterval> | null = null;
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }

      const { message } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ message: "Message is required" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();

      keepalive = setInterval(() => {
        res.write(": keepalive\n\n");
      }, 15000);

      const sendEvent = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      await storage.createMessage({
        conversationId: session.id,
        role: "user",
        content: message,
      });

      const history = await storage.getMessages(session.id);
      const historyForAgent = history.map(m => ({ role: m.role, content: m.content }));

      const brainRecord = await storage.getResearchBrain(req.user!.id);
      const brain = brainRecord ? {
        entities: (brainRecord.entities || {}) as Record<string, any>,
        knowledge: (brainRecord.knowledge || []) as any[],
        preferences: (brainRecord.preferences || {}) as Record<string, any>,
        relationships: (brainRecord.relationships || []) as any[],
        contradictions: (brainRecord.contradictions || []) as any[],
        meta: (brainRecord.meta || { totalSessions: 0, lastActive: new Date().toISOString().slice(0, 10), topEntities: [] }) as any,
      } : null;

      const { runSessionResearchAgent, parseArtifacts } = await import("./session-research-agent");
      const result = await runSessionResearchAgent(message, historyForAgent.slice(0, -1), brain, (step) => {
        sendEvent("step", step);
      });

      const artifacts = parseArtifacts(result.content);
      const assistantMsg = await storage.createMessage({
        conversationId: session.id,
        role: "assistant",
        content: result.content,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      });

      if (history.length <= 2) {
        const titleSnippet = message.slice(0, 60) + (message.length > 60 ? "..." : "");
        await storage.updateConversationTitle(session.id, titleSnippet);
      }

      if (result.brainUpdates) {
        try {
          const existing = brainRecord || { entities: {}, knowledge: [], preferences: {}, relationships: [], contradictions: [], meta: { totalSessions: 0, lastActive: "", topEntities: [] } };
          const today = new Date().toISOString().slice(0, 10);

          const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf"]);
          const mergedEntities = { ...(existing.entities as any || {}) };
          for (const [name, data] of Object.entries(result.brainUpdates.entities || {})) {
            if (FORBIDDEN_KEYS.has(name) || typeof name !== "string" || name.length > 100) continue;
            const prev = mergedEntities[name];
            if (prev) {
              mergedEntities[name] = {
                ...prev,
                ...data,
                researchCount: (prev.researchCount || 0) + 1,
                lastResearched: today,
                tags: [...new Set([...(prev.tags || []), ...(data.tags || [])])],
                competitors: [...new Set([...(prev.competitors || []), ...(data.competitors || [])])],
                chains: [...new Set([...(prev.chains || []), ...(data.chains || [])])],
              };
            } else {
              mergedEntities[name] = { ...data, researchCount: 1, lastResearched: today };
            }
          }

          const existingFacts = (existing.knowledge as any[] || []);
          const newContradictions = [...(existing.contradictions as any[] || [])];

          const newFacts = (result.brainUpdates.facts || []).reduce((acc: any[], f: any) => {
            const exactDupe = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.fact === f.fact
            );
            if (exactDupe) return acc;

            const id = `fact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const existingFact = existingFacts.find((ef: any) =>
              ef.topic === f.topic && ef.entities?.some((e: string) => f.entities?.includes(e)) && ef.confidence !== "stale"
            );
            if (existingFact && existingFact.fact !== f.fact) {
              newContradictions.push({
                factIdOld: existingFact.id,
                factIdNew: id,
                summary: `${f.topic}: was "${existingFact.fact}" → now "${f.fact}"`,
                date: today,
              });
              existingFact.confidence = "stale";
              existingFact.supersedes = id;
            }
            acc.push({ ...f, id, date: today });
            return acc;
          }, []);

          const mergedKnowledge = [...existingFacts, ...newFacts].slice(-200);

          const existingRels = (existing.relationships as any[] || []);
          const newRels = (result.brainUpdates.relationships || []).filter((nr: any) =>
            !existingRels.some((er: any) => er.from === nr.from && er.to === nr.to && er.type === nr.type)
          ).map((r: any) => ({ ...r, date: today }));
          const mergedRelationships = [...existingRels, ...newRels].slice(-100);

          const entityCounts = Object.entries(mergedEntities)
            .map(([name, e]: [string, any]) => ({ name, count: e.researchCount || 0 }))
            .sort((a, b) => b.count - a.count);
          const topEntities = entityCounts.slice(0, 5).map(e => e.name);

          const mergedMeta = {
            totalSessions: ((existing.meta as any)?.totalSessions || 0) + 1,
            lastActive: today,
            topEntities,
          };

          await storage.upsertResearchBrain(req.user!.id, {
            entities: mergedEntities,
            knowledge: mergedKnowledge,
            preferences: { ...(existing.preferences as any || {}), ...(result.brainUpdates.preferences || {}) },
            relationships: mergedRelationships,
            contradictions: newContradictions.slice(-50),
            meta: mergedMeta,
          });
          console.log(`[SessionResearch] Brain merged: ${Object.keys(mergedEntities).length} entities, ${mergedKnowledge.length} facts, ${mergedRelationships.length} rels, ${newContradictions.length} contradictions`);
        } catch (brainErr: any) {
          console.warn("[SessionResearch] Brain update failed:", brainErr.message);
        }
      }

      await storage.logTransaction({
        userId: req.user!.id,
        type: "session_research",
        description: `Research: "${message.slice(0, 80)}"`,
        amount: result.mppCost.toFixed(4),
        apiCost: result.mppCost.toFixed(4),
        costBasis: result.costBasis,
      });

      clearInterval(keepalive);

      sendEvent("done", {
        message: assistantMsg,
        artifacts,
        mppCost: result.mppCost,
        toolCalls: result.toolCalls,
      });

      res.end();
    } catch (e: any) {
      if (keepalive) clearInterval(keepalive);
      console.error("[SessionResearch] Error:", e.message);
      if (!res.headersSent) {
        res.status(500).json({ message: e.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    }
  });

  app.post("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      if (session.shareToken) {
        return res.json({ shareToken: session.shareToken });
      }
      const token = crypto.randomBytes(16).toString("hex");
      await storage.setConversationShareToken(id, token);
      res.json({ shareToken: token });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id/share", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.setConversationShareToken(id, null);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shared/research/:token", async (req, res) => {
    try {
      const { token } = req.params;
      const session = await storage.getConversationByShareToken(token);
      if (!session) return res.status(404).json({ message: "Shared session not found" });
      const msgs = await storage.getMessages(session.id);
      const user = session.userId ? await storage.getUser(session.userId) : null;
      res.json({
        title: session.title,
        createdAt: session.createdAt,
        author: user?.username || "Anonymous",
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          artifacts: m.artifacts,
          createdAt: m.createdAt,
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/research/sessions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid session ID" });
      const session = await storage.getConversation(id);
      if (!session || session.userId !== req.user!.id) {
        return res.status(404).json({ message: "Session not found" });
      }
      await storage.deleteConversation(session.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
