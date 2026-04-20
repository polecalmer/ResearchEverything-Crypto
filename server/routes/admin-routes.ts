import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { getChannelStats } from "../mpp-client";
import { checkCostAlert } from "../cost-alert";
import { getWalletInfo, closeAllChannels, requestCloseChannel, withdrawChannel, getOnChainCostReport } from "../wallet-manager";
import { analyzeFailurePatterns } from "../data-agent";
import { trackEvent } from "../usage-tracker";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerAdminRoutes(app: Express) {
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
      SELECT u.id, u.username, u.email, u.wallet_address, u.credits, NULL as created_at,
             COUNT(DISTINCT c.id) as company_count,
             COUNT(DISTINCT ue.id) as event_count
      FROM users u
      LEFT JOIN companies c ON c.user_id = u.id
      LEFT JOIN usage_events ue ON ue.user_id = u.id
      GROUP BY u.id, u.username, u.email, u.wallet_address, u.credits
      ORDER BY u.username
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

  app.post("/api/admin/benchmark/seed", requireAuth, async (req, res) => {
    const isAdmin = await storage.checkIsAdmin(req.user!.id);
    if (!isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const { seedBenchmark } = await import("../benchmark/seed");
      const protocolLimit = parseInt(req.query.protocolLimit as string) || 100;
      const dryRun = req.query.dryRun === "true";
      const result = await seedBenchmark({ protocolLimit, dryRun });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

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
      const { runBenchmark } = await import("../benchmark/runner");

      const runPromise = runBenchmark({ subset, dryRun, difficulty, verbose: true });

      runPromise.then(result => {
        activeBenchmarkRunId = null;
        console.log(`[Benchmark] Run ${result.run.id} complete: ${(result.run.overallAccuracy * 100).toFixed(1)}% accuracy, ${result.improvements.length} improvements`);
      }).catch(err => {
        activeBenchmarkRunId = null;
        console.error(`[Benchmark] Run failed:`, err.message);
      });

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

  app.get("/api/admin/data-source-brain/stats", requireAuth, async (req, res) => {
    try {
      const isAdmin = await storage.checkIsAdmin(req.user!.id);
      if (!isAdmin) return res.status(403).json({ message: "Admin only" });
      const { getStats } = await import("../data-source-brain/db");
      const stats = await getStats();
      res.json(stats);
    } catch (e: any) {
      console.error("[data-source-brain] stats failed:", e);
      res.status(500).json({ message: e.message || "Failed to load brain stats" });
    }
  });

  app.post("/api/admin/data-source-brain/reseed", requireAuth, async (req, res) => {
    try {
      const isAdmin = await storage.checkIsAdmin(req.user!.id);
      if (!isAdmin) return res.status(403).json({ message: "Admin only" });
      const { seedDataSourceBrain } = await import("../data-source-brain/seeder");
      const result = await seedDataSourceBrain({ force: true });
      res.json(result);
    } catch (e: any) {
      console.error("[data-source-brain] reseed failed:", e);
      res.status(500).json({ message: e.message || "Failed to reseed brain" });
    }
  });

  app.post("/api/admin/brain/backfill-embeddings", requireAuth, async (req, res) => {
    try {
      const isAdmin = await storage.checkIsAdmin(req.user!.id);
      if (!isAdmin) return res.status(403).json({ message: "Admin only" });
      const { backfillBrainEmbeddings } = await import("../brain-embedding-sync");
      const brains = await db.execute(sql`SELECT user_id, entities, knowledge FROM research_brains`);
      const rows: any[] = (brains as any).rows ?? brains;
      let totalFacts = 0, totalEntities = 0;
      for (const row of rows) {
        const result = await backfillBrainEmbeddings(row.user_id, {
          entities: row.entities || {},
          knowledge: row.knowledge || [],
        });
        totalFacts += result.facts;
        totalEntities += result.entities;
      }
      res.json({ message: "Backfill complete", users: rows.length, totalFacts, totalEntities });
    } catch (e: any) {
      console.error("[brain/backfill] failed:", e);
      res.status(500).json({ message: e.message || "Failed to backfill brain embeddings" });
    }
  });
}
