import type { Express, Request, Response } from "express";
import { db } from "../db";
import { securityAuditRuns, securityAuditFindings } from "@shared/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { runSecurityAudit, type Phase } from "../security-audit-agent";
import AdmZip from "adm-zip";

const ALL_PHASES: Phase[] = ["recon", "prompt_extraction", "data_exfil", "cross_tenant", "output_analysis"];

async function ensureAdmin(req: Request, res: Response): Promise<string | null> {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    res.status(401).json({ message: "Auth required" });
    return null;
  }
  const isAdmin = await storage.checkIsAdmin(userId);
  if (!isAdmin) {
    res.status(403).json({ message: "Admin only" });
    return null;
  }
  return userId;
}

export function registerSecurityAuditRoutes(app: Express) {
  // Mark any orphaned "running" runs from a previous server lifetime as interrupted.
  // The background loop dies when the process restarts, so the row must not stay "running" forever.
  (async () => {
    try {
      const result = await db.update(securityAuditRuns).set({
        status: "interrupted",
        errorMessage: "Server restarted while audit was running",
        completedAt: new Date(),
      }).where(eq(securityAuditRuns.status, "running")).returning({ id: securityAuditRuns.id });
      if (result.length > 0) {
        console.log(`[security-audit] Marked ${result.length} orphan run(s) as interrupted on boot`);
      }
    } catch (err: any) {
      console.error("[security-audit] orphan recovery failed:", err?.message);
    }
  })();

  app.get("/api/admin/audits", requireAuth, async (req, res) => {
    try {
      if (!(await ensureAdmin(req, res))) return;
      const rows = await db.select().from(securityAuditRuns).orderBy(desc(securityAuditRuns.startedAt)).limit(50);
      res.json(rows);
    } catch (err: any) {
      console.error("[security-audit] list error:", err?.message);
      res.status(500).json({ message: "Failed to list audits" });
    }
  });

  app.get("/api/admin/audits/export.zip", requireAuth, async (req, res) => {
    try {
      if (!(await ensureAdmin(req, res))) return;
      const runs = await db.select().from(securityAuditRuns).orderBy(desc(securityAuditRuns.startedAt)).limit(200);
      const runIds = runs.map((r) => r.id);
      const findings = runIds.length === 0
        ? []
        : await db.select().from(securityAuditFindings).where(inArray(securityAuditFindings.runId, runIds));
      const findingsByRun: Record<string, any[]> = {};
      for (const f of findings) {
        (findingsByRun[f.runId] ||= []).push(f);
      }
      const zip = new AdmZip();
      // Aggregate index across all runs
      const index = runs.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        status: r.status,
        budgetUsd: r.budgetUsd,
        totalSpentUsd: r.totalSpentUsd,
        phasesEnabled: r.phasesEnabled,
        summary: r.summary,
        findingsCount: (findingsByRun[r.id] || []).length,
      }));
      zip.addFile("index.json", Buffer.from(JSON.stringify(index, null, 2), "utf8"));
      // One JSON per run with full findings
      for (const r of runs) {
        const ts = r.startedAt ? new Date(r.startedAt as any).toISOString().replace(/[:.]/g, "-") : "unknown";
        const name = `runs/${ts}_${r.id.slice(0, 8)}.json`;
        zip.addFile(name, Buffer.from(JSON.stringify({ run: r, findings: findingsByRun[r.id] || [] }, null, 2), "utf8"));
      }
      const buf = zip.toBuffer();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="security-audits-${Date.now()}.zip"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[security-audit] export error:", err?.message);
      res.status(500).json({ message: "Failed to export audits" });
    }
  });

  app.get("/api/admin/audits/:id", requireAuth, async (req, res) => {
    try {
      if (!(await ensureAdmin(req, res))) return;
      const runId = String(req.params.id);
      const [run] = await db.select().from(securityAuditRuns).where(eq(securityAuditRuns.id, runId));
      if (!run) return res.status(404).json({ message: "Not found" });
      const findings = await db.select().from(securityAuditFindings).where(eq(securityAuditFindings.runId, run.id)).orderBy(desc(securityAuditFindings.createdAt));
      res.json({ run, findings });
    } catch (err: any) {
      console.error("[security-audit] detail error:", err?.message);
      res.status(500).json({ message: "Failed to load audit" });
    }
  });

  app.post("/api/admin/audits", requireAuth, async (req, res) => {
    try {
      const userId = await ensureAdmin(req, res);
      if (!userId) return;

      const rawPhases = Array.isArray(req.body?.phases) ? req.body.phases : ALL_PHASES;
      const phases: Phase[] = rawPhases.filter((p: unknown): p is Phase => typeof p === "string" && ALL_PHASES.includes(p as Phase));
      if (phases.length === 0) {
        return res.status(400).json({ message: "At least one valid phase is required", validPhases: ALL_PHASES });
      }
      const budgetRaw = Number(req.body?.budgetUsd);
      if (!Number.isFinite(budgetRaw) || budgetRaw < 0.5 || budgetRaw > 25) {
        return res.status(400).json({ message: "budgetUsd must be a number between 0.5 and 25" });
      }
      const budget = budgetRaw;

      const [run] = await db.insert(securityAuditRuns).values({
        userId,
        status: "running",
        budgetUsd: String(budget),
        phasesEnabled: phases,
      }).returning();

      res.json({ runId: run.id });

      (async () => {
        let totalSpent = 0;
        const verdictCounts: Record<string, number> = { PASS: 0, PARTIAL: 0, FAIL: 0, ERROR: 0 };
        const phaseCounts: Record<string, { PASS: number; PARTIAL: number; FAIL: number; ERROR: number }> = {};
        try {
          const result = await runSecurityAudit({
            userId,
            phasesEnabled: phases,
            budgetUsd: budget,
            cb: {
              onStart: () => {},
              isHaltedByBudget: () => totalSpent >= budget,
              onFinding: async (f) => {
                totalSpent += f.costUsd;
                try {
                  await db.insert(securityAuditFindings).values({
                    runId: run.id,
                    phase: f.phase,
                    testName: f.testName,
                    severity: f.severity,
                    verdict: f.verdict,
                    promptText: f.promptText,
                    responseText: f.responseText,
                    scoreReason: f.scoreReason,
                    costUsd: String(f.costUsd),
                  });
                } catch (e: any) {
                  console.error("[security-audit] finding insert failed:", e?.message);
                }
                verdictCounts[f.verdict] = (verdictCounts[f.verdict] || 0) + 1;
                if (!phaseCounts[f.phase]) phaseCounts[f.phase] = { PASS: 0, PARTIAL: 0, FAIL: 0, ERROR: 0 };
                phaseCounts[f.phase][f.verdict] += 1;
                // Persist running spend after each finding
                try {
                  await db.update(securityAuditRuns).set({
                    totalSpentUsd: String(totalSpent),
                    summary: { verdictCounts, phaseCounts, halted: false },
                  }).where(eq(securityAuditRuns.id, run.id));
                } catch {}
              },
            },
          });
          await db.update(securityAuditRuns).set({
            status: result.halted ? "halted" : "completed",
            totalSpentUsd: String(result.totalSpent || totalSpent),
            summary: { verdictCounts, phaseCounts, halted: result.halted },
            completedAt: new Date(),
          }).where(eq(securityAuditRuns.id, run.id));
        } catch (err: any) {
          console.error("[security-audit] run failed:", err?.message, "runId:", run.id, "userId:", userId);
          try {
            await db.update(securityAuditRuns).set({
              status: "error",
              errorMessage: err?.message || "Unknown error",
              totalSpentUsd: String(totalSpent),
              summary: { verdictCounts, phaseCounts, halted: false },
              completedAt: new Date(),
            }).where(eq(securityAuditRuns.id, run.id));
          } catch {}
        }
      })().catch(() => {});
    } catch (err: any) {
      console.error("[security-audit] start error:", err?.message);
      if (!res.headersSent) res.status(500).json({ message: "Failed to start audit" });
    }
  });

  app.delete("/api/admin/audits/:id", requireAuth, async (req, res) => {
    try {
      if (!(await ensureAdmin(req, res))) return;
      const runId = String(req.params.id);
      await db.delete(securityAuditFindings).where(eq(securityAuditFindings.runId, runId));
      await db.delete(securityAuditRuns).where(eq(securityAuditRuns.id, runId));
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[security-audit] delete error:", err?.message);
      res.status(500).json({ message: "Failed to delete audit" });
    }
  });
}
