import type { Express } from "express";
import { storage } from "../storage";
import { insertTokenProfileSchema, insertDuneQuerySchema, insertMasterDuneQuerySchema } from "@shared/schema";
import { requireAuth } from "../auth";
import { tokenIntelPaywall, duneQueryPaywall, tokenSnapshotPaywall } from "../mpp";
import { MARKUP_MULTIPLIER } from "../enrichment";
import { fetchTokenSnapshot } from "../allium-client";
import { executeDuneQuery, getLatestDuneResults, isDuneConfigured } from "../dune-client";
import { runTokenAnalysis } from "../token-agent";
import { isServerMppReady } from "../mpp-client";
import { trackEvent } from "../usage-tracker";
import { autoAttachMasterQueries, buildDuneChartConfig } from "./helpers";

export function registerTokenRoutes(app: Express) {
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
}
