import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { enrichmentPaywall, nextStepsPaywall, deepResearchPaywall } from "../mpp";
import {
  startEnrichmentSession, advanceEnrichmentSession,
  startNextStepsSession, advanceNextStepsSession,
  startDeepResearchSession, completeDeepResearchSession,
  buildAnthropicRequest, DEEP_RESEARCH_SYSTEM,
  MARKUP_MULTIPLIER,
} from "../enrichment";
import { callAnthropicServerHeavy, isServerMppReady } from "../mpp-client";
import { trackEvent } from "../usage-tracker";

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

export function registerEnrichmentRoutes(app: Express) {
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
        let totalMppCost = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let anyCostSourceVoucher = false;
        try {
          console.log(`[DeepResearch] Phase 1/3: Gathering research for ${company.name}`);
          const phase1Result = await callAnthropicServerHeavy(anthropicRequest);
          const phase1Notes = phase1Result.text;
          totalMppCost = phase1Result.mppCost;
          totalInput = phase1Result.usage.input_tokens;
          totalOutput = phase1Result.usage.output_tokens;
          anyCostSourceVoucher = phase1Result.costSource === "voucher_estimate";
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
}
