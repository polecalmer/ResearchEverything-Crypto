import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { dataChartPaywall } from "../mpp";
import { MARKUP_MULTIPLIER } from "../enrichment";
import { runDataAgent, refreshChartData } from "../data-agent";
import { fetchTokenSnapshot } from "../allium-client";
import { trackEvent } from "../usage-tracker";
import { autoAttachMasterQueries } from "./helpers";

export function registerDataRoutes(app: Express) {
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
}
