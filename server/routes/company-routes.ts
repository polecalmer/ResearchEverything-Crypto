import type { Express } from "express";
import { storage } from "../storage";
import { insertCompanySchema, insertFounderSchema, insertNoteSchema, PIPELINE_STAGES } from "@shared/schema";
import { z } from "zod";
import { requireAuth } from "../auth";
import { trackEvent } from "../usage-tracker";
import { autoAttachMasterQueries } from "./helpers";

const updateCompanySchema = insertCompanySchema.partial().extend({
  pipelineStage: z.enum(PIPELINE_STAGES).optional(),
  tags: z.array(z.string()).optional(),
  excitementScore: z.number().int().min(1).max(10).nullable().optional(),
  excitementReason: z.string().max(500).nullable().optional(),
});

export function registerCompanyRoutes(app: Express) {
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
    const deleted = await storage.deleteNote(req.params.id, req.user!.id);
    if (!deleted) return res.status(404).json({ message: "Note not found" });
    res.status(204).end();
  });

  app.get("/api/companies/:id/reports", requireAuth, async (req, res) => {
    const reports = await storage.getReportsByCompany(req.params.id, req.user!.id);
    res.json(reports);
  });

  app.get("/api/reports/:id", requireAuth, async (req, res) => {
    const report = await storage.getReport(req.params.id);
    if (report) {
      if (report.userId !== req.user!.id) return res.status(403).json({ message: "Not authorized" });
      return res.json({ ...report, kind: "company" });
    }
    const { researchReports } = await import("@shared/schema");
    const { db: dbImport } = await import("../db");
    const { eq, and } = await import("drizzle-orm");
    const [rr] = await dbImport.select().from(researchReports)
      .where(and(eq(researchReports.id, req.params.id), eq(researchReports.userId, req.user!.id)));
    if (!rr) return res.status(404).json({ message: "Report not found" });
    res.json({
      id: rr.id,
      userId: rr.userId,
      title: rr.title,
      content: rr.content ?? "",
      status: "completed",
      companyId: null,
      createdAt: rr.createdAt,
      kind: "research",
    });
  });

  app.delete("/api/reports/:id", requireAuth, async (req, res) => {
    const result = await storage.deleteReport(req.params.id, req.user!.id);
    if (result) {
      return res.json({ message: "Report deleted", companyId: result.companyId, kind: "company" });
    }
    const { researchReports, reportCharts } = await import("@shared/schema");
    const { db: dbImport } = await import("../db");
    const { eq, and } = await import("drizzle-orm");
    const [rr] = await dbImport.select().from(researchReports)
      .where(and(eq(researchReports.id, req.params.id), eq(researchReports.userId, req.user!.id)));
    if (!rr) return res.status(404).json({ message: "Report not found" });
    await dbImport.delete(reportCharts).where(eq(reportCharts.reportId, req.params.id));
    await dbImport.delete(researchReports).where(eq(researchReports.id, req.params.id));
    res.json({ message: "Report deleted", companyId: null, kind: "research" });
  });
}
