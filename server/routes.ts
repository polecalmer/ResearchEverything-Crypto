import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, PIPELINE_STAGES } from "@shared/schema";
import { z } from "zod";
import { enrichFromInput, enrichFromInputWithProgress, generateNextSteps } from "./enrichment";
import { isAuthenticated } from "./replit_integrations/auth";

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

function getUserId(req: any): string {
  return req.user?.claims?.sub;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/enrich", isAuthenticated, async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      const enriched = await enrichFromInput(parsed.data.input);
      res.json(enriched);
    } catch (error: any) {
      console.error("Enrichment error:", error);
      res.status(500).json({ message: "AI enrichment failed", error: error.message });
    }
  });

  app.post("/api/enrich/stream", isAuthenticated, async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
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

  app.post("/api/companies/enrich-and-create", isAuthenticated, async (req, res) => {
    try {
      const parsed = enrichAndCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      const { input, pipelineStage } = parsed.data;
      const userId = getUserId(req);

      const enriched = await enrichFromInput(input);

      const isUrl = input.startsWith("http://") || input.startsWith("https://");

      const company = await storage.createCompany({
        name: enriched.name || "Unknown Company",
        oneLiner: enriched.oneLiner || "AI-enriched company",
        description: enriched.description || "",
        sector: enriched.sector || "",
        businessModel: enriched.businessModel || "",
        stage: enriched.stage || "",
        fundingHistory: enriched.fundingHistory || "",
        competitiveLandscape: enriched.competitiveLandscape || "",
        sourceUrl: isUrl ? input : "",
        websiteUrl: enriched.websiteUrl || "",
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

  app.get("/api/companies", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const companies = await storage.getCompanies(userId);
    res.json(companies);
  });

  app.get("/api/companies/:id/next-steps", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const company = await storage.getCompany(req.params.id, userId);
      if (!company) {
        return res.status(404).json({ message: "Company not found" });
      }
      const companyFounders = await storage.getFoundersByCompany(req.params.id);
      const companyNotes = await storage.getNotesByCompany(req.params.id);

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
        founders: companyFounders.map((f) => ({
          name: f.name,
          role: f.role,
          linkedinUrl: f.linkedinUrl,
          twitterUrl: f.twitterUrl,
          githubUrl: f.githubUrl,
          personalUrl: f.personalUrl,
          priorCompanies: f.priorCompanies,
        })),
        notes: companyNotes.map((n) => ({
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

  app.get("/api/companies/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.post("/api/companies", isAuthenticated, async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const userId = getUserId(req);
    const company = await storage.createCompany({ ...parsed.data, userId } as any);
    res.status(201).json(company);
  });

  app.patch("/api/companies/:id", isAuthenticated, async (req, res) => {
    const parsed = updateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const userId = getUserId(req);
    const company = await storage.updateCompany(req.params.id, parsed.data, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.delete("/api/companies/:id", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    await storage.deleteCompany(req.params.id, userId);
    res.status(204).end();
  });

  app.get("/api/companies/:id/founders", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const foundersList = await storage.getFoundersByCompany(req.params.id);
    res.json(foundersList);
  });

  app.post("/api/companies/:id/founders", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
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

  app.get("/api/companies/:id/notes", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const company = await storage.getCompany(req.params.id, userId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    const notesList = await storage.getNotesByCompany(req.params.id);
    res.json(notesList);
  });

  app.post("/api/companies/:id/notes", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
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

  app.delete("/api/notes/:id", isAuthenticated, async (req, res) => {
    await storage.deleteNote(req.params.id);
    res.status(204).end();
  });

  return httpServer;
}
