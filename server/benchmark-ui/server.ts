/**
 * Benchmark Analytics UI — standalone Express server on :5002.
 *
 * Reads directly from the same Postgres the main app uses; no write paths.
 * Launch: npm run benchmark:ui  (or via .claude/launch.json "Benchmark UI").
 */
import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  benchmarkRuns,
  benchmarkCaseResults,
  benchmarkCases,
  benchmarkQualityRuns,
  benchmarkQualityResults,
  benchmarkQualityCases,
} from "@shared/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BENCHMARK_UI_PORT || 5002);

const app = express();

app.get("/api/runs", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(benchmarkRuns)
      .orderBy(desc(benchmarkRuns.createdAt))
      .limit(50);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.get("/api/runs/:id", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.id, req.params.id));
    if (!run) return res.status(404).json({ error: "run not found" });
    res.json(run);
  } catch (e) {
    next(e);
  }
});

// Per-run aggregate breakdowns: accuracy by protocol category, difficulty,
// metric type, data source. Returned in a single response so the client
// renders the overview with one round trip.
app.get("/api/runs/:id/breakdown", async (req, res, next) => {
  try {
    const { id } = req.params;
    const [run] = await db
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.id, id));
    if (!run) return res.status(404).json({ error: "run not found" });

    const byCategory = await db.execute(sql`
      SELECT COALESCE(c.protocol_category, 'Unknown') AS label,
             COUNT(*)::int AS total,
             SUM(CASE WHEN r.score >= 0.5 THEN 1 ELSE 0 END)::int AS passed,
             AVG(r.score)::float AS avg_score
      FROM benchmark_case_results r
      LEFT JOIN benchmark_cases c ON c.id = r.case_id
      WHERE r.run_id = ${id}
      GROUP BY COALESCE(c.protocol_category, 'Unknown')
      ORDER BY total DESC
    `);

    const byDifficulty = await db.execute(sql`
      SELECT COALESCE(c.difficulty, 'unknown') AS label,
             COUNT(*)::int AS total,
             SUM(CASE WHEN r.score >= 0.5 THEN 1 ELSE 0 END)::int AS passed,
             AVG(r.score)::float AS avg_score
      FROM benchmark_case_results r
      LEFT JOIN benchmark_cases c ON c.id = r.case_id
      WHERE r.run_id = ${id}
      GROUP BY COALESCE(c.difficulty, 'unknown')
      ORDER BY total DESC
    `);

    const byMetric = await db.execute(sql`
      SELECT COALESCE(c.metric_type, 'unknown') AS label,
             COUNT(*)::int AS total,
             SUM(CASE WHEN r.score >= 0.5 THEN 1 ELSE 0 END)::int AS passed,
             AVG(r.score)::float AS avg_score
      FROM benchmark_case_results r
      LEFT JOIN benchmark_cases c ON c.id = r.case_id
      WHERE r.run_id = ${id}
      GROUP BY COALESCE(c.metric_type, 'unknown')
      ORDER BY total DESC
      LIMIT 15
    `);

    const bySource = await db.execute(sql`
      SELECT COALESCE(r.data_source, 'unknown') AS label,
             COUNT(*)::int AS total,
             SUM(CASE WHEN r.score >= 0.5 THEN 1 ELSE 0 END)::int AS passed,
             AVG(r.score)::float AS avg_score
      FROM benchmark_case_results r
      WHERE r.run_id = ${id}
      GROUP BY COALESCE(r.data_source, 'unknown')
      ORDER BY total DESC
    `);

    const latency = await db.execute(sql`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_ms) AS p90,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) AS p99,
        AVG(latency_ms)::float AS avg,
        MAX(latency_ms)::int AS max,
        SUM(latency_ms)::bigint AS total
      FROM benchmark_case_results
      WHERE run_id = ${id} AND latency_ms IS NOT NULL
    `);

    res.json({
      run,
      byCategory: byCategory.rows,
      byDifficulty: byDifficulty.rows,
      byMetric: byMetric.rows,
      bySource: bySource.rows,
      latency: latency.rows?.[0] || null,
    });
  } catch (e) {
    next(e);
  }
});

// Per-run results, with optional failed-only filter. Joins case metadata
// (protocol, query, category) so the client can render a rich failure
// table without a second fetch.
app.get("/api/runs/:id/results", async (req, res, next) => {
  try {
    const { id } = req.params;
    const failedOnly = req.query.failed === "1";
    const limit = Math.min(Number(req.query.limit) || 500, 2000);

    const baseQuery = failedOnly
      ? db
          .select()
          .from(benchmarkCaseResults)
          .where(
            and(
              eq(benchmarkCaseResults.runId, id),
              sql`${benchmarkCaseResults.score} < 0.5`,
            ),
          )
          .orderBy(asc(benchmarkCaseResults.score))
          .limit(limit)
      : db
          .select()
          .from(benchmarkCaseResults)
          .where(eq(benchmarkCaseResults.runId, id))
          .orderBy(asc(benchmarkCaseResults.score))
          .limit(limit);

    const results = await baseQuery;
    const caseIds = Array.from(new Set(results.map((r) => r.caseId)));
    const cases = caseIds.length
      ? await db
          .select()
          .from(benchmarkCases)
          .where(inArray(benchmarkCases.id, caseIds))
      : [];
    const caseMap = new Map(cases.map((c) => [c.id, c]));

    res.json(
      results.map((r) => ({
        ...r,
        case: caseMap.get(r.caseId) || null,
      })),
    );
  } catch (e) {
    next(e);
  }
});

// Common failure signatures — groups failed cases by a normalized error
// bucket so recurring issues surface at the top.
app.get("/api/runs/:id/failure-buckets", async (req, res, next) => {
  try {
    const { id } = req.params;
    const rows = await db.execute(sql`
      SELECT
        CASE
          WHEN error_message IS NULL THEN 'no error message'
          WHEN error_message ILIKE '%timeout%' THEN 'timeout'
          WHEN error_message ILIKE '%wallet%has only%' THEN 'wallet underfunded'
          WHEN error_message ILIKE '%rate limit%' OR error_message ILIKE '%429%' THEN 'rate limited'
          WHEN error_message ILIKE '%not found%' OR error_message ILIKE '%404%' THEN 'not found'
          WHEN error_message ILIKE '%sanity%' THEN 'sanity failed'
          WHEN error_message ILIKE '%insufficient data%' THEN 'insufficient data'
          WHEN error_message ILIKE '%parse%' OR error_message ILIKE '%json%' THEN 'parse error'
          WHEN error_message ILIKE '%auth%' OR error_message ILIKE '%401%' THEN 'auth failure'
          ELSE 'other'
        END AS bucket,
        COUNT(*)::int AS count,
        AVG(score)::float AS avg_score
      FROM benchmark_case_results
      WHERE run_id = ${id} AND score < 0.5
      GROUP BY 1
      ORDER BY count DESC
    `);
    res.json(rows.rows);
  } catch (e) {
    next(e);
  }
});

// History chart — small payload, one row per run.
app.get("/api/history", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: benchmarkRuns.id,
        configVersion: benchmarkRuns.configVersion,
        totalCases: benchmarkRuns.totalCases,
        passedCases: benchmarkRuns.passedCases,
        failedCases: benchmarkRuns.failedCases,
        overallAccuracy: benchmarkRuns.overallAccuracy,
        totalCostUsd: benchmarkRuns.totalCostUsd,
        totalLatencyMs: benchmarkRuns.totalLatencyMs,
        status: benchmarkRuns.status,
        createdAt: benchmarkRuns.createdAt,
      })
      .from(benchmarkRuns)
      .orderBy(asc(benchmarkRuns.createdAt))
      .limit(100);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// ─────────── Quality runs (LLM-judged benchmark) ───────────

app.get("/api/quality-runs", async (_req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(benchmarkQualityRuns)
      .orderBy(desc(benchmarkQualityRuns.createdAt))
      .limit(50);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

app.get("/api/quality-runs/:id", async (req, res, next) => {
  try {
    const [run] = await db
      .select()
      .from(benchmarkQualityRuns)
      .where(eq(benchmarkQualityRuns.id, req.params.id));
    if (!run) return res.status(404).json({ error: "run not found" });

    const byDimension = await db.execute(sql`
      SELECT dimension AS label,
             COUNT(*)::int AS total,
             SUM(CASE WHEN verdict = 'pass' THEN 1 ELSE 0 END)::int AS passed,
             AVG(score)::float AS avg_score
      FROM benchmark_quality_results
      WHERE run_id = ${req.params.id}
      GROUP BY dimension
      ORDER BY total DESC
    `);

    const byVerdict = await db.execute(sql`
      SELECT verdict AS label,
             COUNT(*)::int AS total,
             AVG(score)::float AS avg_score
      FROM benchmark_quality_results
      WHERE run_id = ${req.params.id}
      GROUP BY verdict
      ORDER BY total DESC
    `);

    res.json({
      run,
      byDimension: byDimension.rows,
      byVerdict: byVerdict.rows,
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/quality-runs/:id/results", async (req, res, next) => {
  try {
    const results = await db
      .select()
      .from(benchmarkQualityResults)
      .where(eq(benchmarkQualityResults.runId, req.params.id))
      .orderBy(asc(benchmarkQualityResults.score));

    const caseIds = Array.from(new Set(results.map(r => r.caseId)));
    const cases = caseIds.length
      ? await db.select().from(benchmarkQualityCases).where(inArray(benchmarkQualityCases.id, caseIds))
      : [];
    const caseMap = new Map(cases.map(c => [c.id, c]));

    res.json(
      results.map(r => ({
        ...r,
        case: caseMap.get(r.caseId) || null,
      })),
    );
  } catch (e) {
    next(e);
  }
});

// ─────────── Criterion misses for a quality run ───────────
//
// Returns the criterion-failure leaderboard for a single run: which criteria
// (by id + description) were missed across how many cases, with the example
// result IDs so users can drill into the failures.

app.get("/api/quality-runs/:id/criterion-misses", async (req, res, next) => {
  try {
    const { id } = req.params;
    const rows = await db.execute(sql`
      SELECT
        criterion_id,
        COUNT(*)::int                          AS fail_count,
        AVG(r.score)::float                    AS avg_case_score,
        array_agg(r.id)                        AS example_result_ids,
        array_agg(DISTINCT r.dimension)        AS dimensions,
        (
          SELECT cr->>'description'
          FROM benchmark_quality_cases c2,
               jsonb_array_elements(c2.criteria) cr
          WHERE cr->>'id' = criterion_id
          LIMIT 1
        )                                      AS description
      FROM benchmark_quality_results r,
           unnest(r.failed_criteria_ids) AS criterion_id
      WHERE r.run_id = ${id}
      GROUP BY criterion_id
      ORDER BY fail_count DESC, avg_case_score ASC
    `);
    res.json(rows.rows);
  } catch (e) {
    next(e);
  }
});

// ─────────── Cost analytics (cross-run, quality benchmark only) ───────────
//
// Built so we can answer: are runs getting cheaper for the same prompts as
// the system gets smarter? `byPrompt` returns each case's per-run cost
// trajectory, sorted by largest cost movement so the biggest movers surface.

app.get("/api/cost-analytics", async (_req, res, next) => {
  try {
    const [totalsRows, runsRows, byDimensionRows, byPromptRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(cost_usd), 0)::float       AS total_cost,
          COUNT(*)::int                           AS total_cases,
          AVG(cost_usd)::float                    AS avg_cost,
          COUNT(DISTINCT case_id)::int            AS unique_prompts,
          COUNT(DISTINCT run_id)::int             AS total_runs
        FROM benchmark_quality_results
        WHERE cost_usd IS NOT NULL
      `),
      db.execute(sql`
        SELECT
          qr.id                                  AS run_id,
          qr.created_at                          AS created_at,
          qr.total_cost_usd::float               AS total_cost_usd,
          qr.scored_cases                        AS scored_cases,
          qr.average_score::float                AS average_score,
          qr.status                              AS status,
          qr.notes                               AS notes,
          CASE WHEN qr.scored_cases > 0
               THEN qr.total_cost_usd::float / qr.scored_cases
               ELSE NULL END                     AS avg_cost_per_case
        FROM benchmark_quality_runs qr
        ORDER BY qr.created_at ASC
      `),
      db.execute(sql`
        SELECT
          dimension                              AS label,
          COUNT(*)::int                          AS total_cases,
          SUM(cost_usd)::float                   AS total_cost,
          AVG(cost_usd)::float                   AS avg_cost
        FROM benchmark_quality_results
        WHERE cost_usd IS NOT NULL
        GROUP BY dimension
        ORDER BY total_cost DESC
      `),
      db.execute(sql`
        SELECT
          c.id                                   AS case_id,
          c.prompt                               AS prompt,
          c.dimension                            AS dimension,
          c.tags                                 AS tags,
          COUNT(r.id)::int                       AS run_count,
          AVG(r.cost_usd)::float                 AS avg_cost,
          MIN(r.cost_usd)::float                 AS min_cost,
          MAX(r.cost_usd)::float                 AS max_cost,
          json_agg(
            json_build_object(
              'runId',     r.run_id,
              'createdAt', qr.created_at,
              'costUsd',   r.cost_usd,
              'score',     r.score,
              'verdict',   r.verdict
            ) ORDER BY qr.created_at ASC
          )                                      AS runs
        FROM benchmark_quality_results r
        JOIN benchmark_quality_cases c  ON c.id  = r.case_id
        JOIN benchmark_quality_runs   qr ON qr.id = r.run_id
        WHERE r.cost_usd IS NOT NULL
        GROUP BY c.id, c.prompt, c.dimension, c.tags
        ORDER BY run_count DESC, avg_cost DESC
      `),
    ]);

    res.json({
      totals: totalsRows.rows[0] || { total_cost: 0, total_cases: 0, avg_cost: null, unique_prompts: 0, total_runs: 0 },
      runs: runsRows.rows,
      byDimension: byDimensionRows.rows,
      byPrompt: byPromptRows.rows,
    });
  } catch (e) {
    next(e);
  }
});

// ─────────── Latency analytics (cross-run, quality benchmark only) ───────────
//
// Same shape as cost-analytics but for latency_ms. Adds run-level p50/p90/p99
// percentiles since tail latency carries different signal than the mean.

app.get("/api/latency-analytics", async (_req, res, next) => {
  try {
    const [totalsRows, runsRows, byDimensionRows, byPromptRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(latency_ms), 0)::bigint                                   AS total_ms,
          COUNT(*)::int                                                          AS total_cases,
          AVG(latency_ms)::float                                                 AS avg_ms,
          PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY latency_ms)::float        AS p50_ms,
          PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY latency_ms)::float        AS p90_ms,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::float        AS p99_ms,
          COUNT(DISTINCT case_id)::int                                           AS unique_prompts,
          COUNT(DISTINCT run_id)::int                                            AS total_runs
        FROM benchmark_quality_results
        WHERE latency_ms IS NOT NULL
      `),
      db.execute(sql`
        SELECT
          qr.id                                                                  AS run_id,
          qr.created_at                                                          AS created_at,
          qr.total_latency_ms                                                    AS total_latency_ms,
          qr.scored_cases                                                        AS scored_cases,
          qr.status                                                              AS status,
          qr.notes                                                               AS notes,
          CASE WHEN qr.scored_cases > 0
               THEN qr.total_latency_ms::float / qr.scored_cases
               ELSE NULL END                                                     AS avg_latency_per_case,
          (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY r2.latency_ms)::float
             FROM benchmark_quality_results r2 WHERE r2.run_id = qr.id AND r2.latency_ms IS NOT NULL) AS p50_ms,
          (SELECT PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY r2.latency_ms)::float
             FROM benchmark_quality_results r2 WHERE r2.run_id = qr.id AND r2.latency_ms IS NOT NULL) AS p90_ms
        FROM benchmark_quality_runs qr
        ORDER BY qr.created_at ASC
      `),
      db.execute(sql`
        SELECT
          dimension                                                              AS label,
          COUNT(*)::int                                                          AS total_cases,
          SUM(latency_ms)::bigint                                                AS total_ms,
          AVG(latency_ms)::float                                                 AS avg_ms,
          PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_ms)::float         AS p90_ms
        FROM benchmark_quality_results
        WHERE latency_ms IS NOT NULL
        GROUP BY dimension
        ORDER BY total_ms DESC
      `),
      db.execute(sql`
        SELECT
          c.id                                                                   AS case_id,
          c.prompt                                                               AS prompt,
          c.dimension                                                            AS dimension,
          c.tags                                                                 AS tags,
          COUNT(r.id)::int                                                       AS run_count,
          AVG(r.latency_ms)::float                                               AS avg_ms,
          MIN(r.latency_ms)::int                                                 AS min_ms,
          MAX(r.latency_ms)::int                                                 AS max_ms,
          json_agg(
            json_build_object(
              'runId',     r.run_id,
              'createdAt', qr.created_at,
              'latencyMs', r.latency_ms,
              'score',     r.score,
              'verdict',   r.verdict
            ) ORDER BY qr.created_at ASC
          )                                                                      AS runs
        FROM benchmark_quality_results r
        JOIN benchmark_quality_cases c  ON c.id  = r.case_id
        JOIN benchmark_quality_runs   qr ON qr.id = r.run_id
        WHERE r.latency_ms IS NOT NULL
        GROUP BY c.id, c.prompt, c.dimension, c.tags
        ORDER BY run_count DESC, avg_ms DESC
      `),
    ]);

    res.json({
      totals: totalsRows.rows[0] || {
        total_ms: 0, total_cases: 0, avg_ms: null,
        p50_ms: null, p90_ms: null, p99_ms: null,
        unique_prompts: 0, total_runs: 0,
      },
      runs: runsRows.rows,
      byDimension: byDimensionRows.rows,
      byPrompt: byPromptRows.rows,
    });
  } catch (e) {
    next(e);
  }
});

// ─────────── Outputs (full agent responses for browsing) ───────────
//
// Returns every result row joined to its case + run, ordered by run recency.
// All filtering is client-side — the dataset is small enough today that one
// payload + in-browser filter beats a paginated server. Revisit if N grows.

app.get("/api/quality-outputs", async (_req, res, next) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        r.id            AS result_id,
        r.run_id        AS run_id,
        qr.created_at   AS run_created_at,
        qr.notes        AS run_notes,
        r.case_id       AS case_id,
        c.prompt        AS prompt,
        c.dimension     AS dimension,
        c.tags          AS tags,
        r.score         AS score,
        r.verdict       AS verdict,
        r.critique      AS critique,
        r.response_text AS response_text,
        length(r.response_text) AS response_chars,
        r.cost_usd      AS cost_usd,
        r.latency_ms    AS latency_ms,
        r.execution_success AS execution_success,
        r.error_message AS error_message,
        r.criteria_scores      AS criteria_scores,
        r.failed_criteria_ids  AS failed_criteria_ids,
        r.follow_up_prompt     AS follow_up_prompt,
        r.follow_up_response   AS follow_up_response,
        r.follow_up_cost       AS follow_up_cost,
        r.follow_up_latency_ms AS follow_up_latency_ms,
        length(r.follow_up_response) AS follow_up_chars,
        r.created_at    AS created_at
      FROM benchmark_quality_results r
      JOIN benchmark_quality_cases c  ON c.id  = r.case_id
      JOIN benchmark_quality_runs   qr ON qr.id = r.run_id
      ORDER BY qr.created_at DESC, r.created_at DESC
    `);
    res.json(rows.rows);
  } catch (e) {
    next(e);
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use(
  (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[BenchmarkUI]", err);
    res.status(500).json({ error: err?.message || "internal error" });
  },
);

app.listen(PORT, () => {
  console.log(`[BenchmarkUI] http://localhost:${PORT}`);
});
