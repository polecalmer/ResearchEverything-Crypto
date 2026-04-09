import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, insertTokenProfileSchema, insertDuneQuerySchema, insertMasterDuneQuerySchema, PIPELINE_STAGES, type Company, type FinancialModel } from "@shared/schema";
import type { Request } from "express";

interface ValidatedModelRequest extends Request {
  _validatedCompany: Company;
  _validatedPrompt: string;
  _validatedModel?: FinancialModel;
}
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
import { enrichmentPaywall, nextStepsPaywall, deepResearchPaywall, tokenIntelPaywall, duneQueryPaywall, tokenSnapshotPaywall, dataChartPaywall, reportEditPaywall, modellingPaywall } from "./mpp";
import { runDataAgent, refreshChartData, DATA_CHART_CHARGE, analyzeFailurePatterns } from "./data-agent";
import { fetchTokenSnapshot } from "./allium-client";
import { executeDuneQuery, getLatestDuneResults, isDuneConfigured } from "./dune-client";
import { runTokenAnalysis } from "./token-agent";
import { callAnthropicServer, callAnthropicServerHeavy, isServerMppReady, getChannelStats } from "./mpp-client";
import { generateTelegramLinkCode } from "./telegram";
import { getWalletInfo, closeAllChannels, withdrawAllChannels, requestCloseChannel, withdrawChannel } from "./wallet-manager";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { db, pool } from "./db";
import { sql, eq } from "drizzle-orm";
import { financialModels } from "@shared/schema";
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

  (async () => {
    try {
      const stuck = await db.select({ id: financialModels.id, content: financialModels.content })
        .from(financialModels)
        .where(eq(financialModels.status, "generating"));
      for (const m of stuck) {
        const hasContent = m.content && m.content !== "{}" && m.content.length > 10;
        await db.update(financialModels)
          .set({ status: hasContent ? "complete" : "error", title: hasContent ? undefined : "Generation Interrupted", updatedAt: new Date() })
          .where(eq(financialModels.id, m.id));
      }
      if (stuck.length > 0) console.log(`[Startup] Recovered ${stuck.length} stuck model(s)`);
    } catch (err) {
      console.error("[Startup] Model recovery failed:", err);
    }
  })();

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

  // ─── IN-REPORT AI EDITING ─────────────────────────────────────────────

  const reportEditSchema = z.object({
    selectedText: z.string().min(1, "Selected text is required").max(10000, "Selected text is too long"),
    userInsight: z.string().min(1, "Your insight or instruction is required").max(2000, "Insight is too long (max 2000 characters)"),
    sectionStartIndex: z.number().int().min(0).optional(),
  });

  app.post("/api/reports/:id/edit-section/validate", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const report = await storage.getReport(req.params.id);
      if (!report) return res.status(404).json({ message: "Report not found" });
      if (report.userId !== userId) {
        const isAdmin = await storage.checkIsAdmin(userId);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized to edit this report" });
      }
      if (report.status !== "complete") return res.status(400).json({ message: "Cannot edit a report that is still generating" });

      const parsed = reportEditSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

      const { selectedText, sectionStartIndex } = parsed.data;
      let matchIndex = -1;
      if (typeof sectionStartIndex === "number" && sectionStartIndex >= 0) {
        const candidateSlice = report.content.substring(sectionStartIndex, sectionStartIndex + selectedText.length);
        if (candidateSlice === selectedText) matchIndex = sectionStartIndex;
      }
      if (matchIndex === -1) matchIndex = report.content.indexOf(selectedText);
      if (matchIndex === -1) return res.status(400).json({ message: "Selected text not found in report. The report may have changed." });
      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });

      res.json({ valid: true });
    } catch (error: any) {
      res.status(500).json({ message: "Validation failed", error: error.message });
    }
  });

  app.post("/api/reports/:id/edit-section", requireAuth, reportEditPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const report = await storage.getReport(req.params.id);
      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }
      if (report.userId !== userId) {
        const isAdmin = await storage.checkIsAdmin(userId);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized to edit this report" });
      }
      if (report.status !== "complete") {
        return res.status(400).json({ message: "Cannot edit a report that is still generating" });
      }

      const parsed = reportEditSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const { selectedText, userInsight, sectionStartIndex } = parsed.data;

      let matchIndex = -1;
      if (typeof sectionStartIndex === "number" && sectionStartIndex >= 0) {
        const candidateSlice = report.content.substring(sectionStartIndex, sectionStartIndex + selectedText.length);
        if (candidateSlice === selectedText) {
          matchIndex = sectionStartIndex;
        }
      }
      if (matchIndex === -1) {
        matchIndex = report.content.indexOf(selectedText);
      }
      if (matchIndex === -1) {
        return res.status(400).json({ message: "Selected text not found in report. The report may have changed." });
      }

      if (!isServerMppReady()) {
        return res.status(503).json({ message: "AI service not configured" });
      }

      const surroundingContext = (() => {
        const contextRadius = 1500;
        const start = Math.max(0, matchIndex - contextRadius);
        const end = Math.min(report.content.length, matchIndex + selectedText.length + contextRadius);
        return report.content.substring(start, end);
      })();

      const systemPrompt = `You are an expert investment research analyst. The user has highlighted a section of an existing research report and wants you to rewrite ONLY that section based on their additional insight or correction.

Rules:
- Rewrite ONLY the highlighted section. Do not add headers, introductions, or conclusions that weren't in the original.
- Maintain the same markdown formatting style (headers, bullet points, tables, bold, etc.) as the original.
- Integrate the user's insight naturally into the analysis — don't just append it.
- Keep the same level of depth and analytical rigor as the surrounding content.
- If the user provides a factual correction, update the analysis to reflect it.
- If the user provides new context, weave it into the existing analysis.
- Return ONLY the rewritten section text — nothing else. No preamble, no "Here's the updated section:", just the content.`;

      const userMessage = `## Surrounding Context (for reference only — do NOT rewrite this)
${surroundingContext}

## Section to Rewrite
${selectedText}

## User's Insight / Instruction
${userInsight}

Rewrite the "Section to Rewrite" above, incorporating the user's insight. Return ONLY the rewritten section.`;

      const result = await callAnthropicServerHeavy({
        model: "claude-opus-4-6",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      const rewrittenSection = result.text.trim();
      const updatedContent = report.content.substring(0, matchIndex) + rewrittenSection + report.content.substring(matchIndex + selectedText.length);

      await storage.updateReport(report.id, { content: updatedContent });

      try {
        await storage.logTransaction({
          userId,
          type: "report_edit",
          description: `AI report edit: ${report.title}`,
          amount: "0.5000",
          apiCost: result.mppCost.toFixed(4),
          companyName: report.title,
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
        });
      } catch (err) {
        console.error("[Transaction] Failed to log report-edit:", err);
      }

      trackEvent(userId, "report_section_edited", {
        reportId: report.id,
        selectedLength: selectedText.length,
        rewrittenLength: rewrittenSection.length,
      });

      res.json({
        rewrittenSection,
        updatedContent,
      });
    } catch (error: any) {
      console.error("Report edit error:", error.message);
      res.status(500).json({ message: "Failed to edit report section", error: error.message });
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

  app.post("/api/companies/:id/charts/refresh-all", requireAuth, async (req, res) => {
    try {
      const allCharts = await storage.getDashboardChartsByCompany(req.params.id, req.user!.id);
      const refreshable = allCharts.filter(c => c.status === "completed" || c.status === "failed");
      if (refreshable.length === 0) return res.json({ refreshed: 0, total: 0, charts: [] });

      const results = await Promise.allSettled(
        refreshable.map(c => refreshChartData(c.id))
      );
      const allResults = results
        .filter(r => r.status === "fulfilled")
        .map(r => (r as any).value);
      const succeeded = allResults.filter(c => c.status === "completed");
      res.json({ refreshed: succeeded.length, total: refreshable.length, charts: allResults });
    } catch (e: any) {
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

  app.get("/api/charts/:id", requireAuth, async (req, res) => {
    try {
      const chart = await storage.getDashboardChart(req.params.id);
      if (!chart) return res.status(404).json({ message: "Chart not found" });
      if (chart.userId !== req.user!.id) {
        const isAdmin = await storage.checkIsAdmin(req.user!.id);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized" });
      }
      res.json(chart);
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
             MIN(created_at) as first_signup
      FROM users WHERE created_at IS NOT NULL
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

  app.post("/api/admin/wallet/withdraw-all", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const result = await withdrawAllChannels();
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

  // ─── FINANCIAL MODELLING ──────────────────────────────────────────────
  const modelPromptSchema = z.object({
    prompt: z.string().min(5, "Describe what you want to model").max(5000),
  });

  app.get("/api/companies/:id/models", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const models = await storage.getFinancialModelsByCompany(req.params.id, userId);
      res.json(models);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/companies/:id/models/validate", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const parsed = modelPromptSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });

      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });

      res.json({ valid: true });
    } catch (error: any) {
      res.status(500).json({ message: "Validation failed", error: error.message });
    }
  });

  async function buildModellingContext(company: Company, userId: string) {
    const [chartsData, tokenProfile, tokenAnalysesData] = await Promise.all([
      storage.getDashboardChartsByCompany(company.id, userId),
      storage.getTokenProfile(company.id),
      storage.getTokenAnalysesByCompany(company.id, userId),
    ]);

    const MAX_ROWS_PER_DATASET = 200;
    const MAX_TOTAL_DATA_CHARS = 50000;

    let totalDataChars = 0;
    const liveDatasets: string[] = [];

    const completedCharts = chartsData.filter(c => c.status === "complete" && c.data);
    for (const chart of completedCharts) {
      if (totalDataChars >= MAX_TOTAL_DATA_CHARS) break;
      try {
        const rawData = JSON.parse(chart.data!);
        const rows = Array.isArray(rawData) ? rawData.slice(0, MAX_ROWS_PER_DATASET) : rawData;
        const source = chart.dataSource || "unknown";
        const dataStr = JSON.stringify(rows);
        const budgetLeft = MAX_TOTAL_DATA_CHARS - totalDataChars;
        const truncatedData = dataStr.length > budgetLeft ? dataStr.substring(0, budgetLeft) + "...(truncated)" : dataStr;
        totalDataChars += truncatedData.length;

        const configInfo = chart.dataSourceConfig
          ? (() => { try { const c = JSON.parse(chart.dataSourceConfig); return c.queryId ? ` (Dune #${c.queryId})` : c.sql ? " (Dune SQL)" : c.protocol ? ` (${c.protocol})` : ""; } catch { return ""; } })()
          : "";

        liveDatasets.push(`### ${chart.title} [source: ${source}${configInfo}]\nType: ${chart.chartType || "table"}\nData (${Array.isArray(rawData) ? rawData.length : "N/A"} rows, showing up to ${MAX_ROWS_PER_DATASET}):\n${truncatedData}`);
      } catch {
        liveDatasets.push(`### ${chart.title} [source: ${chart.dataSource || "unknown"}]\n[parse error — data unavailable]`);
      }
    }

    let tokenSnapshotText = "";
    if (tokenProfile?.contractAddress && tokenProfile?.chain) {
      try {
        const { snapshot } = await fetchTokenSnapshot(tokenProfile.contractAddress, tokenProfile.chain, tokenProfile.tokenTicker || company.tokenTicker || "TOKEN");
        const fields: string[] = [];
        if (snapshot.price !== null) fields.push(`Price: $${snapshot.price}`);
        if (snapshot.marketCap !== null) fields.push(`Market Cap: $${Number(snapshot.marketCap).toLocaleString()}`);
        if (snapshot.fdv !== null) fields.push(`FDV: $${Number(snapshot.fdv).toLocaleString()}`);
        if (snapshot.volume24h !== null) fields.push(`24h Volume: $${Number(snapshot.volume24h).toLocaleString()}`);
        if (snapshot.priceChange24h !== null) fields.push(`24h Change: ${snapshot.priceChange24h}%`);
        if (snapshot.holderCount !== null) fields.push(`Holders: ${Number(snapshot.holderCount).toLocaleString()}`);
        if (snapshot.circulatingSupply !== null) fields.push(`Circulating Supply: ${Number(snapshot.circulatingSupply).toLocaleString()}`);
        if (snapshot.totalSupply !== null) fields.push(`Total Supply: ${Number(snapshot.totalSupply).toLocaleString()}`);
        if (fields.length > 0) {
          tokenSnapshotText = `### Live Token Data (${snapshot.source}, fetched ${snapshot.fetchedAt})\n${fields.join("\n")}`;
        }
      } catch (err) {
        console.warn("[Modelling] Token snapshot fetch failed, continuing without:", err);
      }
    }

    const tokenAnalysisSummary = tokenAnalysesData
      .filter(t => t.status === "complete")
      .slice(0, 2)
      .map(t => {
        const duneContext = t.duneData ? `\nDune data used: ${t.duneData.substring(0, 3000)}` : "";
        return `${t.content.substring(0, 4000)}${duneContext}`;
      })
      .join("\n\n---\n\n");

    const companyContext = [
      `Company: ${company.name}`,
      company.oneLiner ? `One-liner: ${company.oneLiner}` : "",
      company.sector ? `Sector: ${company.sector}` : "",
      company.subSector ? `Sub-sector: ${company.subSector}` : "",
      company.businessModel ? `Business model: ${company.businessModel}` : "",
      company.stage ? `Stage: ${company.stage}` : "",
      company.description ? `Description: ${company.description}` : "",
      company.fundingHistory ? `Funding: ${company.fundingHistory}` : "",
      company.competitiveLandscape ? `Competitive landscape: ${company.competitiveLandscape}` : "",
      company.hasLiquidToken ? `Token: ${company.tokenTicker || "Yes"} on ${company.tokenChain || "unknown chain"}` : "",
      company.liquidTokenAnalysis ? `Token analysis: ${company.liquidTokenAnalysis.substring(0, 2000)}` : "",
      tokenProfile ? `Token contract: ${tokenProfile.contractAddress} on ${tokenProfile.chain} (${tokenProfile.tokenTicker || "unknown"})` : "",
    ].filter(Boolean).join("\n");

    return {
      companyContext,
      liveDatasets: liveDatasets.join("\n\n"),
      tokenSnapshotText,
      tokenAnalysisSummary,
    };
  }

  const MODELLING_SYSTEM_PROMPT = `You are a quantitative analyst and financial modeller working for a VC firm called Research Everything. You build sophisticated financial models for crypto/DeFi protocols and companies.

Your task: Given a user's modelling request and company context, produce a structured financial model.

OUTPUT FORMAT — You must return a JSON object with this exact structure:
{
  "title": "Title Case Model Name",
  "assumptions": [
    { "label": "Revenue Growth Rate", "value": "30%", "basis": "Based on H2 2025 trend" },
    { "label": "Take Rate", "value": "0.05%", "basis": "Current protocol fee structure" }
  ],
  "sections": [
    {
      "heading": "Section Name",
      "type": "table",
      "columns": ["Year", "Revenue", "Costs", "Net Income"],
      "rows": [
        ["2025", "$12M", "$8M", "$4M"],
        ["2026", "$18M", "$10M", "$8M"]
      ],
      "note": "Optional analytical note about this section"
    },
    {
      "heading": "Key Metrics",
      "type": "metrics",
      "items": [
        { "label": "Implied Valuation", "value": "$450M", "detail": "At 25x forward revenue" },
        { "label": "IRR (3Y)", "value": "42%", "detail": "Based on base case projections" }
      ]
    },
    {
      "heading": "Scenario Analysis",
      "type": "scenarios",
      "scenarios": [
        { "name": "Bull", "probability": "25%", "outcome": "$800M valuation", "keyDrivers": "50% growth, margin expansion" },
        { "name": "Base", "probability": "50%", "outcome": "$450M valuation", "keyDrivers": "30% growth, stable margins" },
        { "name": "Bear", "probability": "25%", "outcome": "$200M valuation", "keyDrivers": "10% growth, compression" }
      ]
    },
    {
      "heading": "Revenue Projection",
      "type": "chart",
      "chartType": "bar",
      "data": [
        { "label": "2024", "value": 12000000 },
        { "label": "2025E", "value": 18000000 },
        { "label": "2026E", "value": 27000000 }
      ],
      "valueFormat": "currency",
      "color": "#3b6fd4"
    },
    {
      "heading": "Analysis",
      "type": "text",
      "content": "Markdown text with analytical commentary..."
    }
  ],
  "methodology": "Brief description of approach used"
}

SECTION TYPES:
- "table": Rows and columns for projections, comparables, sensitivity matrices.
- "metrics": Key output figures displayed as cards (valuation, IRR, multiples).
- "scenarios": Bull/base/bear scenario analysis with probability weighting.
- "chart": Simple bar/line visualization. Provide data array with { label, value } pairs, chartType ("bar" or "line"), valueFormat ("currency"/"percent"/"number"), and color hex.
- "text": Analytical commentary and methodology notes.

MODELLING CAPABILITIES:
- DCF (Discounted Cash Flow) with protocol-specific revenue drivers
- Comparable analysis (protocol multiples — P/E, P/S, P/TVL, EV/Revenue)
- Token valuation (fully diluted value, circulating supply dynamics, emission schedule impact)
- Scenario analysis (bull/base/bear with probability weighting)
- Unit economics (cost per user, LTV/CAC for protocols, fee-per-transaction)
- Revenue projections (run-rate analysis, growth extrapolation)
- Sensitivity analysis (key variable impact on valuation)
- Market sizing (TAM/SAM/SOM for protocol verticals)

RULES:
1. CRITICAL: You are provided with LIVE DATABASE DATA from Dune Analytics, DeFiLlama, CoinGecko, Allium, and StonksOnChain. Use this ACTUAL data for all calculations — these are real on-chain metrics, not estimates.
2. When live token market data is provided (price, market cap, FDV, volume, supply), use these exact figures as your starting point.
3. When dashboard data is provided, extract real numbers (TVL, revenue, fees, volume, user counts) and build your model FROM these actuals.
4. Never invent or estimate a metric that exists in the provided data. If data shows TVL of $50M, use $50M — not a round number.
5. When you don't have specific data, state assumptions clearly and explain basis.
6. All financial figures should use proper formatting ($1.2M, 30%, 25x).
7. Include at least one table section with projections.
8. Always include a scenario analysis section.
9. Be quantitative and specific — avoid vague language.
10. For crypto/DeFi: use protocol-native metrics (TVL, volume, fees, active addresses) as revenue drivers.
11. Include at least one "chart" section with visualizable data derived from the real data.
12. Return ONLY the JSON object. No markdown wrapping, no \`\`\`json fences, just the raw JSON.`;

  function buildModelUserMessage(contextData: Awaited<ReturnType<typeof buildModellingContext>>, prompt: string, priorModel?: string) {
    const parts = [
      "## Company Context",
      contextData.companyContext,
    ];
    if (contextData.tokenSnapshotText) parts.push(`\n## Live Token Market Data\n${contextData.tokenSnapshotText}`);
    if (contextData.liveDatasets) parts.push(`\n## Live Database Data (Dune / DeFiLlama / On-Chain)\nIMPORTANT: Use this real data for all calculations. Do NOT invent numbers when data is available here.\n\n${contextData.liveDatasets}`);
    if (contextData.tokenAnalysisSummary) parts.push(`\n## Token Intelligence Analysis\n${contextData.tokenAnalysisSummary}`);
    if (priorModel) parts.push(`\n## Previous Model Output (iterate on this)\n${priorModel}`);
    parts.push(`\n## Modelling Request\n${prompt}`);
    return parts.filter(Boolean).join("\n");
  }

  const preValidateModel: RequestHandler = async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      const parsed = modelPromptSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });
      (req as ValidatedModelRequest)._validatedCompany = company;
      (req as ValidatedModelRequest)._validatedPrompt = parsed.data.prompt;
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Validation failed";
      res.status(500).json({ message });
    }
  };

  app.post("/api/companies/:id/models", requireAuth, preValidateModel, modellingPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = (req as ValidatedModelRequest)._validatedCompany;
      const prompt = (req as ValidatedModelRequest)._validatedPrompt;

      const contextData = await buildModellingContext(company, userId);
      const userMessage = buildModelUserMessage(contextData, prompt);

      const model = await storage.createFinancialModel({
        companyId: company.id,
        userId,
        title: "Generating...",
        prompt,
        content: "{}",
        status: "generating",
      });

      res.json({ id: model.id, status: "generating" });

      (async () => {
        try {
          const result = await callAnthropicServerHeavy({
            model: "claude-opus-4-6",
            max_tokens: 16000,
            system: MODELLING_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMessage }],
          });

          let modelData: any;
          try {
            const cleaned = result.text.replace(/^[\s\n]*```(?:json)?\s*/, "").replace(/```[\s\n]*$/, "").trim();
            modelData = JSON.parse(cleaned);
          } catch (parseErr) {
            console.error("[Modelling] JSON parse failed, response length:", result.text.length, "first 200 chars:", result.text.substring(0, 200));
            await storage.updateFinancialModel(model.id, {
              content: result.text,
              status: "error",
              title: "Parse Error",
            });
            return;
          }

          const hasValidStructure = modelData &&
            typeof modelData.title === "string" &&
            Array.isArray(modelData.sections) &&
            modelData.sections.length > 0;

          if (!hasValidStructure) {
            await storage.updateFinancialModel(model.id, {
              content: JSON.stringify(modelData),
              status: "error",
              title: "Invalid Model Structure",
            });
            return;
          }

          const conversationHistory = JSON.stringify([
            { role: "user", content: prompt },
            { role: "assistant", content: modelData.title },
          ]);

          await storage.updateFinancialModel(model.id, {
            content: JSON.stringify(modelData),
            assumptions: JSON.stringify(modelData.assumptions || []),
            conversationHistory,
            status: "complete",
            title: modelData.title,
          });

          try {
            await storage.logTransaction({
              userId,
              type: "financial_model",
              description: `AI model: ${modelData.title || prompt.substring(0, 50)}`,
              amount: "0.5000",
              apiCost: result.mppCost.toFixed(4),
              companyName: company.name,
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
            });
          } catch (err) {
            console.error("[Transaction] Failed to log financial_model:", err);
          }

          trackEvent(userId, "financial_model_generated", {
            modelId: model.id,
            companyId: company.id,
            promptLength: prompt.length,
          });
        } catch (err: any) {
          console.error("[Modelling] Generation failed:", err.message);
          await storage.updateFinancialModel(model.id, {
            status: "error",
            title: "Generation Failed",
            content: JSON.stringify({ error: err.message }),
          });
        }
      })();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  const preValidateIterate: RequestHandler = async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const existingModel = await storage.getFinancialModel(req.params.id);
      if (!existingModel) return res.status(404).json({ message: "Model not found" });
      if (existingModel.userId !== userId) {
        const isAdmin = await storage.checkIsAdmin(userId);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized" });
      }
      if (existingModel.status !== "complete" && existingModel.status !== "error") return res.status(400).json({ message: "Cannot iterate on a model that is not complete" });
      const parsed = modelPromptSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });
      const company = await storage.getCompany(existingModel.companyId, existingModel.userId);
      if (!company) return res.status(404).json({ message: "Company not found" });
      (req as ValidatedModelRequest)._validatedModel = existingModel;
      (req as ValidatedModelRequest)._validatedCompany = company;
      (req as ValidatedModelRequest)._validatedPrompt = parsed.data.prompt;
      next();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Validation failed";
      res.status(500).json({ message });
    }
  };

  app.post("/api/models/:id/iterate", requireAuth, preValidateIterate, modellingPaywall, async (req, res) => {
    try {
      const userId = req.user!.id;
      const existingModel = (req as ValidatedModelRequest)._validatedModel!;
      const company = (req as ValidatedModelRequest)._validatedCompany;
      const iteratePrompt = (req as ValidatedModelRequest)._validatedPrompt;

      const savedState = {
        content: existingModel.content,
        assumptions: existingModel.assumptions,
        conversationHistory: existingModel.conversationHistory,
        title: existingModel.title,
        status: existingModel.status,
      };

      await storage.updateFinancialModel(existingModel.id, { status: "generating" });
      res.json({ id: existingModel.id, status: "generating" });

      (async () => {
        try {
          const contextData = await buildModellingContext(company, userId);
          const userMessage = buildModelUserMessage(contextData, iteratePrompt, existingModel.content);

          let priorHistory: Array<{ role: string; content: string }> = [];
          if (existingModel.conversationHistory) {
            try { priorHistory = JSON.parse(existingModel.conversationHistory); } catch { /* use empty */ }
          }

          const messages = [
            ...priorHistory.map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: userMessage },
          ];

          const result = await callAnthropicServerHeavy({
            model: "claude-opus-4-6",
            max_tokens: 16000,
            system: MODELLING_SYSTEM_PROMPT,
            messages,
          });

          let modelData: Record<string, unknown>;
          try {
            const cleaned = result.text.replace(/^[\s\n]*```(?:json)?\s*/, "").replace(/```[\s\n]*$/, "").trim();
            modelData = JSON.parse(cleaned);
          } catch (parseErr) {
            console.error("[Modelling] Iterate JSON parse failed, response length:", result.text.length, "stop_reason:", (result as any).stop_reason || "unknown");
            await storage.updateFinancialModel(existingModel.id, {
              ...savedState,
              status: "error",
              errorMessage: "AI returned malformed output — the response was too large or got truncated. Try a simpler edit.",
            });
            return;
          }

          const hasValidStructure = modelData &&
            typeof modelData.title === "string" &&
            Array.isArray(modelData.sections) &&
            (modelData.sections as unknown[]).length > 0;

          if (!hasValidStructure) {
            console.error("[Modelling] Iterate produced invalid structure — missing title or sections");
            await storage.updateFinancialModel(existingModel.id, {
              ...savedState,
              status: "error",
              errorMessage: "AI produced an incomplete model structure. Try rephrasing your edit.",
            });
            return;
          }

          const updatedHistory = [
            ...priorHistory,
            { role: "user", content: iteratePrompt },
            { role: "assistant", content: modelData.title as string },
          ];

          await storage.updateFinancialModel(existingModel.id, {
            content: JSON.stringify(modelData),
            assumptions: JSON.stringify(modelData.assumptions || []),
            conversationHistory: JSON.stringify(updatedHistory),
            status: "complete",
            title: modelData.title as string,
            errorMessage: null,
          });

          try {
            await storage.logTransaction({
              userId,
              type: "financial_model_iterate",
              description: `AI model iteration: ${modelData.title}`,
              amount: "0.5000",
              apiCost: result.mppCost.toFixed(4),
              companyName: company.name,
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens,
            });
          } catch (logErr) {
            console.error("[Transaction] Failed to log model iterate:", logErr);
          }

          trackEvent(userId, "financial_model_iterated", {
            modelId: existingModel.id,
            iterationCount: updatedHistory.filter(h => h.role === "user").length,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          console.error("[Modelling] Iteration failed:", errMsg);
          const is524 = errMsg.includes("524") || errMsg.includes("timeout") || errMsg.includes("Gateway");
          await storage.updateFinancialModel(existingModel.id, {
            ...savedState,
            status: "error",
            errorMessage: is524
              ? "AI request timed out — the prompt may be too large. Try with fewer data sources or a shorter description."
              : `Iteration failed: ${errMsg.slice(0, 200)}`,
          });
        }
      })();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Server error";
      res.status(500).json({ message });
    }
  });

  app.post("/api/models/:id/iterate/validate", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const model = await storage.getFinancialModel(req.params.id);
      if (!model) return res.status(404).json({ message: "Model not found" });
      if (model.userId !== userId) {
        const isAdmin = await storage.checkIsAdmin(userId);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized" });
      }
      if (model.status !== "complete" && model.status !== "error") return res.status(400).json({ message: "Model is not in a complete state" });
      const parsed = modelPromptSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      if (!isServerMppReady()) return res.status(503).json({ message: "AI service not configured" });
      res.json({ valid: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Validation failed";
      res.status(500).json({ message });
    }
  });

  app.get("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const model = await storage.getFinancialModel(req.params.id);
      if (!model) return res.status(404).json({ message: "Model not found" });
      if (model.userId !== req.user!.id) {
        const isAdmin = await storage.checkIsAdmin(req.user!.id);
        if (!isAdmin) return res.status(403).json({ message: "Not authorized" });
      }
      res.json(model);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/models/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteFinancialModel(req.params.id, req.user!.id);
      if (!deleted) return res.status(404).json({ message: "Model not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── MASTER REPORTS ─────────────────────────────────────────────────────

  app.get("/api/master-reports", requireAuth, async (req, res) => {
    try {
      const reports = await storage.getMasterReports(req.user!.id);
      res.json(reports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/master-reports", requireAuth, async (req, res) => {
    try {
      const { title } = req.body;
      if (!title || typeof title !== "string") return res.status(400).json({ message: "title is required" });
      const report = await storage.createMasterReport({ userId: req.user!.id, title: title.trim() });
      res.json(report);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/master-reports/:id", requireAuth, async (req, res) => {
    try {
      const report = await storage.getMasterReport(req.params.id, req.user!.id);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const blocks = await storage.getMasterReportBlocks(report.id);
      res.json({ ...report, blocks });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/master-reports/:id", requireAuth, async (req, res) => {
    try {
      const { title } = req.body;
      const updated = await storage.updateMasterReport(req.params.id, req.user!.id, { title });
      if (!updated) return res.status(404).json({ message: "Report not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/master-reports/:id", requireAuth, async (req, res) => {
    try {
      const deleted = await storage.deleteMasterReport(req.params.id, req.user!.id);
      if (!deleted) return res.status(404).json({ message: "Report not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/master-reports/:id/blocks", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const report = await storage.getMasterReport(req.params.id, userId);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const { blockType, content, referenceId, displayOrder } = req.body;
      const validTypes = ["text", "chart", "report-section", "model", "table"];
      if (!blockType || !validTypes.includes(blockType)) return res.status(400).json({ message: "Invalid blockType" });
      if (referenceId) {
        if (blockType === "report-section") {
          const ref = await storage.getReport(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced report not found or not owned" });
        } else if (blockType === "model") {
          const ref = await storage.getFinancialModel(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced model not found or not owned" });
        } else if (blockType === "chart") {
          const ref = await storage.getDashboardChart(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced chart not found or not owned" });
        }
      }
      const existingBlocks = await storage.getMasterReportBlocks(report.id);
      const maxOrder = existingBlocks.length > 0 ? Math.max(...existingBlocks.map(b => b.displayOrder)) : -1;
      const block = await storage.addMasterReportBlock({
        masterReportId: report.id,
        blockType,
        content: content || null,
        referenceId: referenceId || null,
        displayOrder: displayOrder ?? (maxOrder + 1),
      });
      res.json(block);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/master-reports/:id/blocks/:blockId", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const report = await storage.getMasterReport(req.params.id, userId);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const { content, displayOrder, blockType, referenceId } = req.body;
      if (blockType) {
        const validTypes = ["text", "chart", "report-section", "model", "table"];
        if (!validTypes.includes(blockType)) return res.status(400).json({ message: "Invalid blockType" });
      }
      if (referenceId) {
        const effectiveType = blockType || (await storage.getMasterReportBlocks(report.id)).find(b => b.id === req.params.blockId)?.blockType;
        if (effectiveType === "report-section") {
          const ref = await storage.getReport(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced report not found or not owned" });
        } else if (effectiveType === "model") {
          const ref = await storage.getFinancialModel(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced model not found or not owned" });
        } else if (effectiveType === "chart") {
          const ref = await storage.getDashboardChart(referenceId);
          if (!ref || ref.userId !== userId) return res.status(400).json({ message: "Referenced chart not found or not owned" });
        }
      }
      const updated = await storage.updateMasterReportBlock(req.params.blockId, report.id, { content, displayOrder, blockType, referenceId });
      if (!updated) return res.status(404).json({ message: "Block not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/master-reports/:id/blocks/:blockId", requireAuth, async (req, res) => {
    try {
      const report = await storage.getMasterReport(req.params.id, req.user!.id);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const deleted = await storage.deleteMasterReportBlock(req.params.blockId, report.id);
      if (!deleted) return res.status(404).json({ message: "Block not found" });
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/master-reports/:id/reorder", requireAuth, async (req, res) => {
    try {
      const report = await storage.getMasterReport(req.params.id, req.user!.id);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const { blockIds } = req.body;
      if (!Array.isArray(blockIds)) return res.status(400).json({ message: "blockIds array required" });
      await storage.reorderMasterReportBlocks(report.id, blockIds);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/master-reports/:id/export", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const report = await storage.getMasterReport(req.params.id, userId);
      if (!report) return res.status(404).json({ message: "Report not found" });
      const blocks = await storage.getMasterReportBlocks(report.id);

      let markdown = `# ${report.title}\n\n`;
      for (const block of blocks) {
        if (block.blockType === "text") {
          markdown += `${block.content || ""}\n\n`;
        } else if (block.blockType === "report-section" && block.referenceId) {
          const ref = await storage.getReport(block.referenceId);
          if (ref && ref.userId === userId) {
            markdown += `## ${ref.title}\n\n${ref.content}\n\n`;
          }
        } else if (block.blockType === "model" && block.referenceId) {
          const model = await storage.getFinancialModel(block.referenceId);
          if (model && model.userId === userId) {
            markdown += `## Model: ${model.title}\n\n${model.content}\n\n`;
          }
        } else if (block.blockType === "chart" && block.referenceId) {
          const chart = await storage.getDashboardChart(block.referenceId);
          if (chart && chart.userId === userId) {
            markdown += `## Chart: ${chart.title}\n\n_[Chart data embedded from dashboard]_\n\n`;
          }
        } else if (block.blockType === "table") {
          markdown += `${block.content || ""}\n\n`;
        }
      }

      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", `attachment; filename="${report.title.replace(/[^a-zA-Z0-9 ]/g, '')}.md"`);
      res.send(markdown);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/admin/sql", async (req, res) => {
    const { query } = req.body;
    if (!query || typeof query !== "string") return res.status(400).json({ message: "query is required" });
    try {
      const result = await pool.query(query);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify({ rows: result.rows, rowCount: result.rowCount, fields: result.fields?.map((f: any) => f.name) }));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
