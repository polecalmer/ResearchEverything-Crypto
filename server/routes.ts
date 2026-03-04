import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, PIPELINE_STAGES } from "@shared/schema";
import { z } from "zod";
import { enrichCompanyFromUrl, enrichCompanyFromName } from "./enrichment";

const updateCompanySchema = insertCompanySchema.partial().extend({
  pipelineStage: z.enum(PIPELINE_STAGES).optional(),
  tags: z.array(z.string()).optional(),
});

const enrichRequestSchema = z.object({
  url: z.string().url().optional(),
  name: z.string().min(1).optional(),
}).refine((data) => data.url || data.name, {
  message: "URL or company name is required",
});

const enrichAndCreateSchema = z.object({
  url: z.string().url().optional(),
  name: z.string().min(1).optional(),
  pipelineStage: z.enum(PIPELINE_STAGES).optional().default("discovered"),
}).refine((data) => data.url || data.name, {
  message: "URL or company name is required",
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/enrich", async (req, res) => {
    try {
      const parsed = enrichRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      const { url, name } = parsed.data;
      const enriched = url
        ? await enrichCompanyFromUrl(url)
        : await enrichCompanyFromName(name!);
      res.json(enriched);
    } catch (error: any) {
      console.error("Enrichment error:", error);
      res.status(500).json({ message: "AI enrichment failed", error: error.message });
    }
  });

  app.post("/api/companies/enrich-and-create", async (req, res) => {
    try {
      const parsed = enrichAndCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
      }
      const { url, name: inputName, pipelineStage } = parsed.data;

      const enriched = url
        ? await enrichCompanyFromUrl(url)
        : await enrichCompanyFromName(inputName!);

      const company = await storage.createCompany({
        name: enriched.name || inputName || "Unknown Company",
        oneLiner: enriched.oneLiner || "AI-enriched company",
        description: enriched.description || "",
        sector: enriched.sector || "",
        businessModel: enriched.businessModel || "",
        stage: enriched.stage || "",
        fundingHistory: enriched.fundingHistory || "",
        competitiveLandscape: enriched.competitiveLandscape || "",
        sourceUrl: url || "",
        pipelineStage: pipelineStage,
        tags: enriched.tags || [],
      });

      if (enriched.founders && enriched.founders.length > 0) {
        for (const founder of enriched.founders) {
          if (founder.name) {
            await storage.createFounder({
              companyId: company.id,
              name: founder.name,
              role: founder.role || "",
              bio: founder.bio || "",
              linkedinUrl: founder.linkedinUrl || "",
              twitterUrl: "",
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

  app.get("/api/companies", async (_req, res) => {
    const companies = await storage.getCompanies();
    res.json(companies);
  });

  app.get("/api/companies/:id", async (req, res) => {
    const company = await storage.getCompany(req.params.id);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.post("/api/companies", async (req, res) => {
    const parsed = insertCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const company = await storage.createCompany(parsed.data);
    res.status(201).json(company);
  });

  app.patch("/api/companies/:id", async (req, res) => {
    const parsed = updateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
    }
    const company = await storage.updateCompany(req.params.id, parsed.data);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
    }
    res.json(company);
  });

  app.delete("/api/companies/:id", async (req, res) => {
    await storage.deleteCompany(req.params.id);
    res.status(204).end();
  });

  app.get("/api/companies/:id/founders", async (req, res) => {
    const foundersList = await storage.getFoundersByCompany(req.params.id);
    res.json(foundersList);
  });

  app.post("/api/companies/:id/founders", async (req, res) => {
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

  app.get("/api/companies/:id/notes", async (req, res) => {
    const notesList = await storage.getNotesByCompany(req.params.id);
    res.json(notesList);
  });

  app.post("/api/companies/:id/notes", async (req, res) => {
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

  app.delete("/api/notes/:id", async (req, res) => {
    await storage.deleteNote(req.params.id);
    res.status(204).end();
  });

  return httpServer;
}
