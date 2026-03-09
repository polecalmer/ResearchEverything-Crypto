import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, PIPELINE_STAGES } from "@shared/schema";
import { z } from "zod";
import { enrichFromInput, enrichFromInputWithProgress, generateNextSteps, generateDeepResearch } from "./enrichment";
import { requireAuth } from "./auth";
import { getUncachableStripeClient, getStripePublishableKey } from "./stripeClient";
import { db } from "./db";
import { sql } from "drizzle-orm";

const updateCompanySchema = insertCompanySchema.partial().extend({
  pipelineStage: z.enum(PIPELINE_STAGES).optional(),
  tags: z.array(z.string()).optional(),
});

const enrichRequestSchema = z.object({
  input: z.string().min(1, "Some input is required — a URL, company name, tweet link, founder profile, or any relevant text"),
});

const enrichAndCreateSchema = z.object({
  input: z.string().min(1, "Some input is required — a URL, company name, tweet link, founder profile, or any relevant text"),
  pipelineStage: z.enum(PIPELINE_STAGES).optional().default("discovered"),
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

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
          pr.recurring->>'interval' as recurring_interval,
          pr.type as price_type
        FROM stripe.products p
        JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        WHERE p.active = true
        ORDER BY pr.unit_amount ASC
      `);
      res.json(result.rows);
    } catch (error: any) {
      console.error("Error fetching credit products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.get("/api/subscription", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(401).json({ message: "User not found" });

    let cancelAtPeriodEnd = false;
    if (user.subscriptionId && user.subscriptionStatus === "active") {
      try {
        const stripe = await getUncachableStripeClient();
        const sub = await stripe.subscriptions.retrieve(user.subscriptionId);
        cancelAtPeriodEnd = sub.cancel_at_period_end;
      } catch {}
    }

    res.json({
      subscriptionStatus: user.subscriptionStatus,
      subscriptionId: user.subscriptionId,
      subscriptionPeriodEnd: user.subscriptionPeriodEnd,
      cancelAtPeriodEnd,
    });
  });

  app.post("/api/credits/checkout", requireAuth, async (req, res) => {
    try {
      const { priceId, mode } = req.body;
      if (!priceId) {
        return res.status(400).json({ message: "priceId is required" });
      }

      const stripe = await getUncachableStripeClient();
      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(401).json({ message: "User not found" });

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

  app.post("/api/enrich", requireAuth, async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const userId = req.user!.id;
      const deducted = await storage.deductCredit(userId);
      if (!deducted) {
        return res.status(402).json({ message: "Insufficient credits. Please purchase more credits to continue." });
      }

      const enriched = await enrichFromInput(parsed.data.input);
      res.json(enriched);
    } catch (error: any) {
      console.error("Enrichment error:", error);
      res.status(500).json({ message: "AI enrichment failed", error: error.message });
    }
  });

  app.post("/api/enrich/stream", requireAuth, async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }

      const userId = req.user!.id;
      const deducted = await storage.deductCredit(userId);
      if (!deducted) {
        return res.status(402).json({ message: "Insufficient credits. Please purchase more credits to continue." });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const enriched = await enrichFromInputWithProgress(parsed.data.input, sendEvent);
      sendEvent({ type: "complete", data: enriched });
      res.end();
    } catch (error: any) {
      console.error("Enrichment stream error:", error);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ message: "AI enrichment failed", error: error.message });
      }
    }
  });

  app.post("/api/companies/enrich-and-create", requireAuth, async (req, res) => {
    try {
      const parsed = enrichAndCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      const { input, pipelineStage } = parsed.data;
      const userId = req.user!.id;

      const deducted = await storage.deductCredit(userId);
      if (!deducted) {
        return res.status(402).json({ message: "Insufficient credits. Please purchase more credits to continue." });
      }

      const enriched = await enrichFromInput(input);

      const isUrl = input.startsWith("http://") || input.startsWith("https://");

      let websiteUrl = enriched.websiteUrl || "";
      if (!websiteUrl && isUrl) {
        try {
          const hostname = new URL(input).hostname.replace("www.", "").toLowerCase();
          const socialDomains = [
            "twitter.com", "x.com", "linkedin.com", "github.com",
            "facebook.com", "instagram.com", "tiktok.com", "youtube.com",
            "reddit.com", "medium.com", "substack.com",
            "producthunt.com", "crunchbase.com", "pitchbook.com",
          ];
          if (!socialDomains.some(d => hostname.includes(d))) {
            websiteUrl = input;
          }
        } catch {}
      }

      const company = await storage.createCompany({
        name: enriched.name || "Unknown Company",
        oneLiner: enriched.oneLiner || "AI-enriched company",
        description: enriched.description || "",
        sector: enriched.sector || "",
        subSector: enriched.subSector || "",
        businessModel: enriched.businessModel || "",
        stage: enriched.stage || "",
        fundingHistory: enriched.fundingHistory || "",
        competitiveLandscape: enriched.competitiveLandscape || "",
        sourceUrl: isUrl ? input : "",
        websiteUrl,
        githubUrl: enriched.githubUrl || "",
        twitterUrl: enriched.twitterUrl || "",
        linkedinUrl: enriched.linkedinUrl || "",
        pipelineStage: pipelineStage,
        tags: enriched.tags || [],
        userId,
      } as any);

      if (enriched.founders && enriched.founders.length > 0) {
        for (const founder of enriched.founders) {
          if (founder.name) {
            await storage.createFounder({
              companyId: company.id,
              name: founder.name,
              role: founder.role || "",
              bio: founder.bio || "",
              linkedinUrl: founder.linkedinUrl || "",
              twitterUrl: founder.twitterUrl || "",
              githubUrl: founder.githubUrl || "",
              personalUrl: founder.personalUrl || "",
              priorCompanies: founder.priorCompanies || "",
            });
          }
        }
      }

      res.status(201).json(company);
    } catch (error: any) {
      console.error("Enrich-and-create error:", error);
      res.status(500).json({ message: "Failed to create enriched company", error: error.message });
    }
  });

  app.get("/api/companies", requireAuth, async (req, res) => {
    const userId = req.user!.id;
    const companies = await storage.getCompanies(userId);
    res.json(companies);
  });

  app.get("/api/companies/:id/next-steps", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const founders = await storage.getFoundersByCompany(req.params.id);
      const notes = await storage.getNotesByCompany(req.params.id);

      const steps = await generateNextSteps({
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

      res.json(steps);
    } catch (error: any) {
      console.error("Next steps generation error:", error);
      res.status(500).json({ message: "Failed to generate next steps", error: error.message });
    }
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
    res.status(201).json(company);
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
    await storage.deleteNote(req.params.id);
    res.status(204).end();
  });

  app.get("/api/companies/:id/reports", requireAuth, async (req, res) => {
    const reports = await storage.getReportsByCompany(req.params.id, req.user!.id);
    res.json(reports);
  });

  app.post("/api/companies/:id/reports/generate", requireAuth, async (req, res) => {
    try {
      const company = await storage.getCompany(req.params.id, req.user!.id);
      if (!company) return res.status(404).json({ message: "Company not found" });

      const founders = await storage.getFoundersByCompany(company.id);
      const notes = await storage.getNotesByCompany(company.id);

      const report = await storage.createReport({
        companyId: company.id,
        userId: req.user!.id,
        title: `${company.name} — Deep Research Report`,
        content: "",
        status: "generating",
      });

      res.json({ reportId: report.id, status: "generating" });

      generateDeepResearch(
        company,
        founders,
        notes,
        (stage, detail) => {
          console.log(`[DeepResearch] ${company.name}: ${stage} — ${detail}`);
        },
        company.deletedReportCount || 0,
      ).then(async (content) => {
        await storage.updateReport(report.id, { content, status: "complete" });
        console.log(`[DeepResearch] Report complete for ${company.name} (${report.id})`);
      }).catch(async (error) => {
        console.error(`[DeepResearch] Failed for ${company.name}:`, error);
        await storage.updateReport(report.id, {
          content: `# Report Generation Failed\n\nAn error occurred while generating the deep research report.\n\nError: ${error.message}`,
          status: "failed",
        });
      });
    } catch (error: any) {
      console.error("Report generation error:", error);
      res.status(500).json({ message: "Failed to start report generation" });
    }
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

  return httpServer;
}
