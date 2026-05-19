/**
 * Brain-grounded chart validator. Runs at chart-emission time on every
 * artifact:chart the agent (or recipe pipeline) is about to ship.
 *
 * Three tiers, cheapest first:
 *   Tier 1 (symbolic, ~0ms, $0)
 *     - empty / all-zero / raw-token-amount sanity (delegates to
 *       checkChartDataSanity-equivalent in series-stats land)
 *     - assertChartFreshness — tail date age vs. CHART_TAIL_MAX_DAYS (chart
 *       mode is stricter than the 60d default the recipe path uses for slug
 *       resolution)
 *     - cadence vs. range — "weekly over 12 months" should produce ~52 points
 *     - narrative-number cross-check — every $X / $YB / $ZM in prose must
 *       fall within ANY yAxis's [min*0.75 .. max*1.33] band, OR within ±25%
 *       of that yAxis's last value
 *
 *   Tier 2 (data-source brain consult, ~30-100ms, $0)
 *     - source-coverage check via consult() against data_source_facts —
 *       reject if the brain has high-confidence "no data here" for the
 *       claimed (source, entity)
 *     - recipe-transform sanity when a DerivedMetricRecipe is in scope:
 *       transforms claiming ma:30 should yield series with low cv;
 *       transforms claiming annualize should produce magnitudes ≈ 365× raw
 *
 *   Tier 3 (KG-brain referee, Haiku 4.5, ~$0.001-$0.005, ~1-2s)
 *     - hybrid-retrieve verified facts about the chart's entities (last 30d)
 *     - small structured-JSON referee call: do prose claims agree with brain
 *       facts AND with the chart's own stats, accounting for metric identity
 *       ("LTM revenue" vs "30D MA ARR" describe different things)
 *     - returns confidence: high|medium|low; "low" passes the chart through
 *       (no grounding to compare against, don't false-positive)
 *
 * On rejection the agent retries once with the issues' modelHints injected;
 * on second rejection the chart still ships, but a visible artifact:callout
 * warning is prepended (see chart-validator-retry.ts caller).
 *
 * The validator does NOT mutate the artifact. It only reports a verdict.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { computeChartStats, type ChartSeriesStats, type SeriesStats } from "./data-source-brain/series-stats";
import { inferYAxisPolicy, type YAxisPolicy } from "./chart-axis-policy";
import {
  assertChartFreshness,
  ChartFreshnessError,
  CHART_FRESHNESS_THRESHOLD_DAYS,
} from "./data-source-brain/chart-shaper";
import { consult } from "./data-source-brain/db";
import { lookupDerivedMetric, type DerivedMetricRecipe } from "./data-source-brain/derived-metrics";
import { retrieveRelevantContext } from "./brain-retrieval";
import { callAnthropicRaw } from "./mpp-client";
import { MODELS } from "./constants";
import type { BrainGraph, BrainFact } from "./session-research-agent";

// ─── Types ────────────────────────────────────────────────────────────────

export type ValidationKind =
  | "all_zero"
  | "raw_token_amounts"
  | "stale_tail"
  | "cadence_mismatch"
  | "narrative_number_unsupported"
  | "source_coverage_gap"
  | "recipe_definition_mismatch"
  | "brain_contradiction"
  | "internal_inconsistency"
  | "fabricated_data_admission"
  | "outlier_crush";

export interface ValidationIssue {
  kind: ValidationKind;
  tier: 1 | 2 | 3;
  message: string;
  modelHint: string;
  evidence: Record<string, unknown>;
}

export interface ChartValidationVerdict {
  ok: boolean;
  confidence: "high" | "medium" | "low";
  issues: ValidationIssue[];
  durationMs: number;
  costUsd: number;
  groundedFacts: BrainFact[];
  seriesStats: ChartSeriesStats | null;
}

export interface ChartValidationInput {
  // The chart artifact about to ship. We accept `any` here because the
  // server's ResearchArtifact and the client's Artifact diverge slightly in
  // optional fields and we don't want a coupling. We only read documented
  // properties: title, source, data, chartConfig.yAxes.
  artifact: any;
  /** Surrounding prose (the agent's full final text minus other artifacts is fine). */
  narrative: string;
  /** The user's original request. Drives cadence/range expectations. */
  userMessage: string;
  /** Recipe when this is a runChartPipeline emission; null on the agent path. */
  recipe?: DerivedMetricRecipe | null;
  /** Entities the chart claims to be about (extracted from yAxes/title/userMessage). */
  resolvedEntities: string[];
  /** Brain graph for KG-fact retrieval. Pass the same object the agent received. */
  brain?: BrainGraph | null;
  userId: string;
  /** Override "now" for tests. */
  now?: Date;
  /** Skip Tier 3 — used on retry to avoid double Haiku spend. */
  skipReferee?: boolean;
}

// ─── Tunables ─────────────────────────────────────────────────────────────

/** Chart-mode requires a recent tail. The 60d default the slug resolver uses
 *  is too lenient for "show me HYPE price last 30 days" kind of asks. */
const CHART_TAIL_MAX_DAYS = 7;
/** Tier 1 narrative-number band: a claim is OK if within [min*A .. max*B]. */
const NARRATIVE_RANGE_LOWER = 0.75;
const NARRATIVE_RANGE_UPPER = 1.33;
/** Or within ±N of that yAxis's last value. */
const NARRATIVE_TAIL_TOLERANCE = 0.25;
/** Don't flag claims smaller than this — likely counts/years/IDs, not metrics. */
const MIN_CLAIM_MAGNITUDE = 1_000;

const REFEREE_MODEL =
  process.env.CHART_VALIDATOR_REFEREE_MODEL || MODELS.HAIKU;
const VALIDATOR_DISABLED =
  process.env.CHART_VALIDATOR_DISABLED === "1";
const VALIDATOR_LOG_ONLY =
  process.env.CHART_VALIDATOR_LOG_ONLY === "1";

// ─── Public API ───────────────────────────────────────────────────────────

export async function validateChartArtifact(
  input: ChartValidationInput,
): Promise<ChartValidationVerdict> {
  const t0 = Date.now();

  if (VALIDATOR_DISABLED) {
    return {
      ok: true,
      confidence: "low",
      issues: [],
      durationMs: 0,
      costUsd: 0,
      groundedFacts: [],
      seriesStats: null,
    };
  }

  const rows: any[] = Array.isArray(input.artifact?.data) ? input.artifact.data : [];
  const yAxes: Array<{ dataKey: string; label: string }> =
    (input.artifact?.chartConfig?.yAxes || []).map((y: any) => ({
      dataKey: String(y?.dataKey || ""),
      label: String(y?.label || y?.dataKey || ""),
    }));

  let stats: ChartSeriesStats | null = null;
  if (rows.length > 0 && yAxes.length > 0) {
    try {
      stats = computeChartStats(rows, yAxes);
    } catch (err: any) {
      console.warn(`[ChartValidator] computeChartStats failed: ${err.message}`);
    }
  }

  const issues: ValidationIssue[] = [];

  // ─── Axis policy auto-correction ─────────────────────────────────────
  // INTENTIONAL EXCEPTION to the "validator does not mutate artifact"
  // rule: silent auto-correction is the agreed UX for wide-range Y-axis
  // pathology (the SERV outlier-crush bug). The mutation happens BEFORE
  // Tier 1 so the validator gates on what the user will actually see.
  // Belt-and-suspenders: if Layer 2 misses something, Tier 1's
  // outlier_crush check (below) catches it as a regression.
  applyAxisPolicy(input.artifact, stats);

  // ─── Tier 1 ──────────────────────────────────────────────────────────
  issues.push(...runTier1(input, rows, yAxes, stats));
  if (issues.length > 0) {
    const verdict = finalize(input, issues, stats, [], t0, 0);
    await logVerdict(input, verdict).catch(() => {});
    return verdict;
  }

  // ─── Tier 2 ──────────────────────────────────────────────────────────
  const t2Issues = await runTier2(input, stats).catch((err) => {
    console.warn(`[ChartValidator] Tier 2 errored (passing): ${err.message}`);
    return [] as ValidationIssue[];
  });
  issues.push(...t2Issues);
  if (issues.length > 0) {
    const verdict = finalize(input, issues, stats, [], t0, 0);
    await logVerdict(input, verdict).catch(() => {});
    return verdict;
  }

  // ─── Tier 3 ──────────────────────────────────────────────────────────
  if (input.skipReferee) {
    const verdict = finalize(input, issues, stats, [], t0, 0);
    await logVerdict(input, verdict).catch(() => {});
    return verdict;
  }

  let groundedFacts: BrainFact[] = [];
  let refereeIssues: ValidationIssue[] = [];
  let refereeCost = 0;
  let refereeConfidence: ChartValidationVerdict["confidence"] = "low";

  try {
    const t3 = await runTier3(input, rows, yAxes, stats);
    groundedFacts = t3.groundedFacts;
    refereeIssues = t3.issues;
    refereeCost = t3.costUsd;
    refereeConfidence = t3.confidence;
  } catch (err: any) {
    // Referee failure is non-fatal — pass the chart through with low
    // confidence. Logging is enough; we don't want a Haiku timeout to gate
    // every chart emission.
    console.warn(`[ChartValidator] Tier 3 errored (passing): ${err.message}`);
  }
  issues.push(...refereeIssues);

  const verdict: ChartValidationVerdict = {
    ok: issues.length === 0,
    confidence: refereeConfidence,
    issues,
    durationMs: Date.now() - t0,
    costUsd: refereeCost,
    groundedFacts,
    seriesStats: stats,
  };
  await logVerdict(input, verdict).catch(() => {});
  return verdict;
}

/** Best-effort persist verdict to chart_validations. Never throws. */
async function logVerdict(
  input: ChartValidationInput,
  verdict: ChartValidationVerdict,
): Promise<void> {
  try {
    const t1 = verdict.issues.filter((i) => i.tier === 1);
    const t2 = verdict.issues.filter((i) => i.tier === 2);
    const t3 = verdict.issues.filter((i) => i.tier === 3);
    await db.execute(sql`
      INSERT INTO chart_validations (
        user_id, chart_title, ok, shipped, confidence,
        retry_count, referee_model,
        tier1_issues, tier2_issues, tier3_issues,
        grounded_fact_count, duration_ms, cost_usd, series_stats
      ) VALUES (
        ${input.userId}, ${String(input.artifact?.title || "")},
        ${verdict.ok}, ${VALIDATOR_LOG_ONLY ? true : verdict.ok},
        ${verdict.confidence},
        0, ${REFEREE_MODEL},
        ${JSON.stringify(t1)}::jsonb, ${JSON.stringify(t2)}::jsonb, ${JSON.stringify(t3)}::jsonb,
        ${verdict.groundedFacts.length}, ${verdict.durationMs}, ${verdict.costUsd},
        ${verdict.seriesStats ? JSON.stringify(verdict.seriesStats) : null}::jsonb
      )
    `);
  } catch (err: any) {
    console.warn(`[ChartValidator] logVerdict failed: ${err.message}`);
  }
}

function finalize(
  _input: ChartValidationInput,
  issues: ValidationIssue[],
  stats: ChartSeriesStats | null,
  groundedFacts: BrainFact[],
  t0: number,
  costUsd: number,
): ChartValidationVerdict {
  return {
    ok: issues.length === 0,
    confidence: issues.length === 0 ? "medium" : "high",
    issues,
    durationMs: Date.now() - t0,
    costUsd,
    groundedFacts,
    seriesStats: stats,
  };
}

// ─── Axis policy auto-correction ─────────────────────────────────────────
//
// Documented exception to the no-mutation rule. Mutates each yAxis to
// add a `scale` (and possibly `domain`) hint derived purely from the
// series stats, so the renderer can switch to a log axis when the data
// has the wide-range pattern that crushes a linear chart (the SERV
// outlier-crush case, where a single $4 point dominated 199 $0.02
// points). The agent NEVER has to think about this — the server makes
// the right call based on what's actually in the data array.
//
// Note: this mutates the *parsed* artifact. Callers that need the
// change to land in the user-visible response text MUST also call
// applyAxisPolicyToText() (below) to splice the updated yAxes back
// into the artifact code fence. runChartValidationPass does both.
//
// Idempotent: if the artifact already has a scale set, we leave it
// alone (agent gets to override). Logs the auto-application for
// telemetry on how often it fires in production.
function applyAxisPolicy(artifact: any, stats: ChartSeriesStats | null): void {
  if (!artifact?.chartConfig?.yAxes || !Array.isArray(artifact.chartConfig.yAxes)) return;
  if (!stats || !stats.series || stats.series.length === 0) return;

  for (let i = 0; i < artifact.chartConfig.yAxes.length; i++) {
    const yAxis = artifact.chartConfig.yAxes[i];
    if (!yAxis) continue;

    // Agent-provided scale wins. The auto-correct is a fallback when the
    // agent didn't specify (the common case).
    if (yAxis.scale === "linear" || yAxis.scale === "log") continue;

    const seriesStat = stats.series[i];
    if (!seriesStat || seriesStat.length === 0) continue;

    // We need the raw values, not the stat summary, to compute p99 and
    // run the policy logic. Re-derive from the artifact data rows.
    const rows: any[] = Array.isArray(artifact?.data) ? artifact.data : [];
    const values: number[] = [];
    for (const row of rows) {
      const v = (row as any)[yAxis.dataKey];
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) continue;

    const policy: YAxisPolicy = inferYAxisPolicy(values, yAxis.format);
    if (policy.scale !== "linear") {
      yAxis.scale = policy.scale;
      if (policy.domain) yAxis.domain = policy.domain;
      console.log(
        `[chart-axis-policy] auto-applied scale=${policy.scale} to yAxis "${yAxis.dataKey}" — ${policy.reasoning}`,
      );
    }
  }
}

/**
 * Splice axis-policy changes back into the user-facing response text.
 *
 * `applyAxisPolicy` mutates the parsed chart object, but the response
 * the agent loop streams to the user is a string with the chart JSON
 * inside ```artifact:chart``` fences. We need to re-serialize the
 * fence so the new `scale`/`domain` actually reaches the client.
 *
 * Returns the (possibly-rewritten) text. If no axes have a `scale`
 * set, returns the input unchanged (zero allocation in the common
 * case where the policy didn't fire).
 */
export function applyAxisPolicyToText(text: string, chart: any): string {
  const yAxes = chart?.chartConfig?.yAxes;
  if (!Array.isArray(yAxes) || yAxes.length === 0) return text;

  // Only fire if at least one yAxis carries scale or domain — the
  // common no-op case (linear, auto-fit) should skip the rewrite.
  const hasOverride = yAxes.some((y: any) => y?.scale === "log" || y?.domain);
  if (!hasOverride) return text;

  const re = /(```artifact:chart\s*\n)([\s\S]*?)(```)/;
  const match = text.match(re);
  if (!match) return text;

  let json: any;
  try {
    json = JSON.parse(match[2].trim());
  } catch {
    return text;
  }

  // Merge scale/domain into the JSON's yAxes by index. Preserve other
  // agent-provided fields (label, format, chartType, etc.).
  if (!Array.isArray(json.yAxes)) return text;
  for (let i = 0; i < json.yAxes.length && i < yAxes.length; i++) {
    const src = yAxes[i];
    if (!src) continue;
    if (src.scale === "log" || src.scale === "linear") json.yAxes[i].scale = src.scale;
    if (src.domain) json.yAxes[i].domain = src.domain;
  }

  const newFence = `${match[1]}${JSON.stringify(json, null, 2)}\n${match[3]}`;
  return text.replace(re, newFence);
}

// ─── Tier 1: symbolic checks over the chart's own data + prose ────────────

function runTier1(
  input: ChartValidationInput,
  rows: any[],
  yAxes: Array<{ dataKey: string; label: string }>,
  stats: ChartSeriesStats | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1a. Empty / no data
  if (rows.length === 0 || yAxes.length === 0) {
    issues.push({
      kind: "all_zero",
      tier: 1,
      message: "Chart has no data rows or no yAxes.",
      modelHint:
        "Your chart artifact had no usable data. Re-fetch the underlying series and rebuild — do not ship a chart with an empty data array.",
      evidence: { rowCount: rows.length, yAxisCount: yAxes.length },
    });
    return issues;
  }

  // 1b. Per-series sanity (all-zero, raw token amounts) using stats
  if (stats) {
    for (const s of stats.series) {
      if (s.length === 0) {
        issues.push({
          kind: "all_zero",
          tier: 1,
          message: `Series "${s.label}" has no numeric values.`,
          modelHint: `Series "${s.label}" has no values. Either fetch real data or remove this yAxis from the chart.`,
          evidence: { series: s.label, dataKey: s.dataKey },
        });
      } else if (s.max && s.min && s.max.value === 0 && s.min.value === 0) {
        issues.push({
          kind: "all_zero",
          tier: 1,
          message: `Series "${s.label}" is all zeros.`,
          modelHint: `Series "${s.label}" is entirely zero — that's not real data. Try a different source or confirm the protocol slug, then re-emit.`,
          evidence: { series: s.label },
        });
      } else if (s.max && Math.abs(s.max.value) > 1e15) {
        issues.push({
          kind: "raw_token_amounts",
          tier: 1,
          message: `Series "${s.label}" looks like raw token amounts (max=${s.max.value.toExponential(2)}).`,
          modelHint: `Series "${s.label}" values are unrealistically large (>1e15) — you're probably plotting raw on-chain amounts without dividing by the token's decimals. Convert to human units (e.g. divide by 1e18 for ETH).`,
          evidence: { series: s.label, max: s.max.value },
        });
      } else if (
        s.max && s.median &&
        s.median > 0 && s.max.value > 0 &&
        s.max.value / s.median >= 50
      ) {
        // Outlier-crush regression guard. applyAxisPolicy() should have
        // mutated this yAxis to scale="log" before Tier 1 runs. If we
        // get here with neither scale=log NOR scale=linear (explicitly
        // chosen by the agent), Layer 2 didn't fire. Surface it so the
        // chart still ships with a visible warning callout, and we have
        // telemetry on the regression.
        const yAxisCfg = (input.artifact?.chartConfig?.yAxes || [])[stats.series.indexOf(s)];
        const hasLogScale = yAxisCfg?.scale === "log";
        const ratio = (s.max.value / s.median).toFixed(1);
        if (!hasLogScale) {
          issues.push({
            kind: "outlier_crush",
            tier: 1,
            message: `Series "${s.label}" has max=${s.max.value.toPrecision(3)} vs median=${s.median.toPrecision(3)} (${ratio}× range). Linear Y-axis will crush most data points.`,
            modelHint: `Series "${s.label}" has max/median = ${ratio}× — a linear Y-axis will render the rest of the data as a flat line. Set \`scale: "log"\` on this yAxis, or remove the outlier point(s) if they're known-bad data.`,
            evidence: { series: s.label, max: s.max.value, median: s.median, maxOverMedian: s.max.value / s.median },
          });
        }
      }
    }
  }

  // 1c. Tail freshness — cadence-aware threshold.
  // Monthly data's last point is naturally 25-30 days old (last completed
  // month). Weekly is 7-10 days. Daily should be ~1-2 days. The default
  // CHART_TAIL_MAX_DAYS (7d) was tuned for daily charts and false-flagged
  // every monthly/weekly emission. We detect the cadence from the user's
  // intent and the data's row spacing, then pick the right threshold.
  try {
    // assertChartFreshness reads the date from `lastRow.date`. For
    // agent-emitted charts whose xAxis is `day`, `week`, `month`, etc.,
    // map the tail row's xAxis-named date field onto `date` so the gate
    // inspects the right column. Without this, every Dune-shaped chart
    // that didn't hand-rename to "date" tripped a false-positive
    // "no parseable date" rejection (sUSDe APY incident).
    const xAxisKey: string | undefined = input.artifact?.chartConfig?.xAxis?.dataKey;
    const rowsForFreshness = xAxisKey && xAxisKey !== "date"
      ? rows.map((r) => ({ ...r, date: r[xAxisKey] }))
      : rows;
    const cadence = inferCadence(input.userMessage, rowsForFreshness);
    const thresholdDays =
      cadence === "monthly" ? 45 :
      cadence === "weekly" ? 14 :
      CHART_TAIL_MAX_DAYS; // daily / unknown
    assertChartFreshness(rowsForFreshness, {
      metricLabel: yAxes[0]?.label || "metric",
      protocol: input.resolvedEntities[0] || "protocol",
      source: input.artifact?.source,
      thresholdDays,
      now: input.now,
    });
  } catch (err) {
    if (err instanceof ChartFreshnessError) {
      issues.push({
        kind: "stale_tail",
        tier: 1,
        message: err.message,
        modelHint: `Your chart's last data point is ${err.latestDate ?? "missing"} — that's ${err.ageDays ?? "?"} days old. Refetch fresher data, or if the source genuinely has no recent data, switch sources or refuse the chart with a brief explanation. Do NOT ship a stale chart.`,
        evidence: { latestDate: err.latestDate, ageDays: err.ageDays, threshold: err.thresholdDays },
      });
    }
  }

  // 1d. Cadence vs. requested cadence (point-spacing-based)
  const cadenceIssue = checkCadence(
    input.userMessage,
    rows,
    input.artifact?.chartConfig?.xAxis?.dataKey,
  );
  if (cadenceIssue) issues.push(cadenceIssue);

  // 1e. Narrative numbers vs. series stats
  if (stats) {
    issues.push(...checkNarrativeNumbers(input.narrative, stats, yAxes));
  }

  // 1f. Honesty check: prose admissions of fabricated/reconstructed data.
  // The agent sometimes writes a chart whose data array isn't real (the
  // post-processing tool failed, or the underlying source returned only a
  // few points and the agent interpolated to fill a longer series). The
  // narrative often admits this in plain language ("reconstructed",
  // "smoothed", "interpolated", "directionally correct"). The chart still
  // looks like real data to the user. Flag these — if the agent had to
  // reconstruct, the chart shouldn't ship without a visible warning.
  const fabIssue = checkFabricationAdmission(input.narrative);
  if (fabIssue) issues.push(fabIssue);

  return issues;
}

/** Scan prose for self-admissions that the chart's data was fabricated,
 *  reconstructed, interpolated, or otherwise not produced by the actual
 *  data source the chart claims. Caught text like:
 *    "intermediate points reconstructed at ~10-day intervals"
 *    "directionally-correct trajectory ... rendered from"
 *    "smoothed", "interpolated to fill the gap"
 *    "post-processing step failed"
 *  These are honest acknowledgements but the chart should not have
 *  shipped without a visible warning. The validator surfaces it as a
 *  Tier 1 issue so the retry / warning-callout flow kicks in. */
function checkFabricationAdmission(narrative: string): ValidationIssue | null {
  if (!narrative) return null;
  const text = narrative.toLowerCase();
  const PATTERNS: Array<{ rx: RegExp; tag: string }> = [
    { rx: /\breconstructed\b/, tag: "reconstructed" },
    { rx: /\binterpolat(ed|ion)\b/, tag: "interpolated" },
    { rx: /\bdirectionally[- ]?correct\b/, tag: "directionally-correct (admits not exact)" },
    { rx: /\b(post[- ]?processing|tool execution)\s+(?:step\s+)?(?:failed|errored|hit an error)\b/, tag: "post-processing failed" },
    { rx: /\bfabricated\b/, tag: "fabricated" },
    { rx: /\bestimated (?:intermediate|in[- ]?between|the missing)\b/, tag: "estimated intermediate points" },
    { rx: /\b(synthesized|approximated|filled in|filled the gap)\b/, tag: "synthesized/approximated/filled" },
    { rx: /\bshape (?:as|is) accurate (?:and )?(?:the )?day[- ]?level granularity (?:as )?smoothed\b/, tag: "shape-accurate-but-granularity-smoothed admission" },
  ];
  const matched: string[] = [];
  for (const { rx, tag } of PATTERNS) {
    if (rx.test(text)) matched.push(tag);
  }
  if (matched.length === 0) return null;
  return {
    kind: "fabricated_data_admission",
    tier: 1,
    message: `Narrative admits the chart data is not real: ${matched.join(", ")}. The chart should not ship without a visible warning.`,
    modelHint: `Your prose acknowledges the data was reconstructed/interpolated/smoothed/synthesized (${matched.join(", ")}). Either: (1) re-fetch the actual underlying data and re-emit, or (2) reduce the chart to ONLY the real data points you have (a shorter range, fewer points), and rewrite the prose to drop the reconstruction language. Do NOT ship a chart whose data array isn't faithfully sourced.`,
    evidence: { matchedTags: matched },
  };
}

/** Verify the chart's actual point spacing matches the cadence the user
 *  asked for. Counts are wrong as a metric — a protocol that's only been
 *  live 169 days legitimately ships 169 daily points when asked for "12
 *  months daily", and we'd be over-flagging if we checked "expected 365
 *  vs actual 169". The right invariant: median gap between consecutive
 *  date rows should match the requested cadence. Daily intent + 7-day
 *  gaps = real cadence_mismatch (the sUSDe APY incident). Daily intent +
 *  1-day gaps over a shorter window = legitimately less history,
 *  not a validator concern. */
function checkCadence(userMessage: string, rows: any[], xAxisKey: string | undefined): ValidationIssue | null {
  const m = userMessage.toLowerCase();
  let cadence: "daily" | "weekly" | "monthly" | null = null;
  if (/\bdaily\b|\bday-by-day\b/.test(m)) cadence = "daily";
  else if (/\bweekly\b|\bweek-?over-?week\b/.test(m)) cadence = "weekly";
  else if (/\bmonthly\b|\bmonth-?over-?month\b/.test(m)) cadence = "monthly";
  if (!cadence) return null;

  // Need at least 3 dated rows to estimate spacing reliably.
  const dateField = xAxisKey || "date";
  const dateValues: number[] = [];
  for (const row of rows) {
    const v = row?.[dateField];
    if (typeof v !== "string") continue;
    const t = Date.parse(v.slice(0, 10));
    if (Number.isFinite(t)) dateValues.push(t);
  }
  if (dateValues.length < 3) return null;
  dateValues.sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < dateValues.length; i++) {
    gaps.push((dateValues[i] - dateValues[i - 1]) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];

  // Bucket the median gap to detected cadence, with generous tolerance
  // so a daily series that occasionally skips a weekend or holiday
  // doesn't trip "weekly".
  const detected: "daily" | "weekly" | "monthly" =
    medianGap >= 20 ? "monthly" : medianGap >= 4 ? "weekly" : "daily";

  if (detected === cadence) return null;

  // Expected row count for the chart's date range at the requested cadence.
  // Anchored to the actual date span of the chart so the model sees the
  // concrete target rather than a generic "~daily" instruction.
  const spanDays = (dateValues[dateValues.length - 1] - dateValues[0]) / 86400000;
  const expectedRows = cadence === "daily"
    ? Math.round(spanDays) + 1
    : cadence === "weekly"
    ? Math.round(spanDays / 7) + 1
    : Math.round(spanDays / 30) + 1;

  return {
    kind: "cadence_mismatch",
    tier: 1,
    message: `Cadence mismatch: user asked for ${cadence} but chart's median point spacing is ~${medianGap.toFixed(1)} days (looks ${detected}).`,
    // Aggressive retry hint: tell the agent EXACTLY what to do. Previous
    // version ("Re-emit with one row per day") was vague enough that the
    // agent would re-emit the same decimated array with cosmetic edits.
    // The new hint names the bug (decimation), the cause (sampleData /
    // every-Nth-day pattern), and the target row count.
    modelHint: `CADENCE FAILURE — Your chart was DECIMATED. The data array has only ${rows.length} rows spanning ${Math.round(spanDays)} days, which is one row every ${medianGap.toFixed(1)} days. The user asked for ${cadence}. Required action: call execute_code AGAIN to produce the FULL ${cadence} series — your output array MUST have ~${expectedRows} rows (one per ${cadence === "daily" ? "day" : cadence === "weekly" ? "week" : "month"}). Do NOT sample/decimate inside the code (no \`every Nth\`, no \`step = data.length / 40\`, no \`sampleData(merged, 40)\`). If your code is using \`Math.ceil(data.length / N)\` for step size: REMOVE THAT — the chart renderer handles its own visual sampling and your job is to ship the full series.`,
    evidence: { requested: cadence, detected, medianGapDays: medianGap, pointCount: rows.length, spanDays: Math.round(spanDays), expectedRows },
  };
}

/** Infer cadence from user prompt, falling back to data row spacing when
 *  the prompt is silent. Used by the cadence-aware staleness threshold:
 *  monthly charts can be 25-45 days "fresh" on their last point; weekly,
 *  7-14; daily, 1-7. Without inference we'd false-flag every non-daily
 *  chart against a 7-day threshold. */
function inferCadence(userMessage: string, rows: any[]): "daily" | "weekly" | "monthly" | null {
  const m = (userMessage || "").toLowerCase();
  if (/\bdaily\b|\bday-by-day\b/.test(m)) return "daily";
  if (/\bweekly\b|\bweek-?over-?week\b/.test(m)) return "weekly";
  if (/\bmonthly\b|\bmonth-?over-?month\b/.test(m)) return "monthly";
  // No explicit cadence in the prompt — measure the gap between the last
  // two date rows. > 25 days → monthly. 4-14 days → weekly. else daily.
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const a = rows[rows.length - 2]?.date;
  const b = rows[rows.length - 1]?.date;
  if (typeof a !== "string" || typeof b !== "string") return null;
  const ta = Date.parse(a.slice(0, 10));
  const tb = Date.parse(b.slice(0, 10));
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  const gap = Math.abs(tb - ta) / 86400000;
  if (gap >= 25) return "monthly";
  if (gap >= 4) return "weekly";
  return "daily";
}

/** Pull "$X", "$YB", "$ZM", "1.2 billion" claims from prose and check each
 *  against the chart's series ranges. Skip pcts and small-magnitude numbers
 *  (years, counts, IDs). False positives are bounded by:
 *    - generous +/-25% tolerance around series.last
 *    - generous [min*0.75 .. max*1.33] band around the series range
 *    - require a $ prefix or B/M/K/billion/million suffix
 *    - skip values < 1000
 *    - normalize series stats by yAxis-label scale (e.g. label "TVL ($B)"
 *      means data values are billions; multiply by 1e9 before comparing
 *      to absolute prose claims like "$10.9B" → 1.09e+10)
 */
function checkNarrativeNumbers(
  narrative: string,
  stats: ChartSeriesStats,
  yAxes: Array<{ dataKey: string; label: string; format?: string }>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const claims = extractCurrencyClaims(narrative);
  if (claims.length === 0 || stats.series.length === 0) return issues;

  // If no yAxis is denominated in currency, prose dollar claims can't
  // map to chart values by definition — they're contextual narrative
  // (e.g. "Meteora P/E ratio chart" with prose mentioning "$197M MCAP"
  // — the chart plots ratios, the prose cites the underlying components).
  // Skip the check entirely for ratio/percent-only charts.
  const isCurrencyAxis = (label: string, fmt?: string): boolean => {
    if (fmt && /^currency(_K|_M|_B)?$/.test(fmt)) return true;
    if (fmt === "ratio" || fmt === "percent" || fmt === "number") return false;
    return /\$|usd|\(b\)|\(m\)|\(k\)|currency|dollar/i.test(label);
  };
  const anyCurrencyAxis = yAxes.some((y) => isCurrencyAxis(y.label || "", y.format));
  if (!anyCurrencyAxis) return issues;

  // Build a label→scale map so we can normalize series stats to absolute
  // units. Without this, a chart whose data is `tvl: 10.9` (with the unit
  // $B carried in the yAxis label "TVL ($B)") is compared against a prose
  // claim of "$10.9B" → 1.09e+10. Different magnitudes by 1e9 → false flag.
  const scaleByLabel = new Map<string, number>();
  for (const y of yAxes) {
    scaleByLabel.set(y.label || y.dataKey, inferYAxisUnitScale(y.label || y.dataKey));
  }

  for (const claim of claims) {
    if (claim.value < MIN_CLAIM_MAGNITUDE) continue;
    let matched = false;
    let nearestGap = Infinity;
    let nearestSeries = "";
    for (const s of stats.series) {
      if (!s.last || !s.min || !s.max) continue;
      const scale = scaleByLabel.get(s.label) ?? 1;
      const lastVal = s.last.value * scale;
      const minVal = s.min.value * scale;
      const maxVal = s.max.value * scale;
      const lastTol = Math.abs(lastVal) * NARRATIVE_TAIL_TOLERANCE;
      if (Math.abs(claim.value - lastVal) <= lastTol) {
        matched = true;
        break;
      }
      const lo = Math.min(minVal, maxVal) * NARRATIVE_RANGE_LOWER;
      const hi = Math.max(minVal, maxVal) * NARRATIVE_RANGE_UPPER;
      if (claim.value >= lo && claim.value <= hi) {
        matched = true;
        break;
      }
      const gap = Math.min(
        Math.abs(claim.value - maxVal) / Math.max(1, Math.abs(maxVal)),
        Math.abs(claim.value - minVal) / Math.max(1, Math.abs(minVal)),
      );
      if (gap < nearestGap) {
        nearestGap = gap;
        nearestSeries = s.label;
      }
    }
    if (!matched) {
      issues.push({
        kind: "narrative_number_unsupported",
        tier: 1,
        message: `Prose claim "${claim.text}" (≈${claim.value.toExponential(2)}) is outside every yAxis's range.`,
        modelHint: `Your narrative cited "${claim.text}", but no series in the chart contains a value near it (closest series "${nearestSeries}" is off by ${(nearestGap * 100).toFixed(0)}%). Either fix the narrative to cite numbers actually present in the data, or re-emit a chart whose data supports the claim.`,
        evidence: { claim: claim.text, value: claim.value, nearestSeries, nearestGapPct: nearestGap * 100 },
      });
    }
  }
  return issues;
}

/** Infer the unit-scale multiplier embedded in a yAxis label. Charts
 *  routinely carry the unit in the label and store raw numbers in the data
 *  array (e.g. label "TVL ($B)" with `tvl: 10.9`). Maps recognized
 *  notation back to a factor we can multiply data values by to recover
 *  absolute units for comparison against prose claims.
 *
 *  Conservative — when in doubt, return 1 (no scaling) and let the prose
 *  check potentially false-positive on a borderline case rather than
 *  silently scale the wrong direction. */
export function inferYAxisUnitScale(label: string): number {
  if (!label) return 1;
  const l = label.toLowerCase();
  // Strict matches first — "$B" / "(B)" / "billions" / "bn"
  if (/\(\s*\$?\s*b\s*\)|\$b\b|\bbn\b|\bbillion(s)?\b/i.test(label)) return 1e9;
  if (/\(\s*\$?\s*m\s*\)|\$m\b|\bmm\b|\bmillion(s)?\b/i.test(label)) return 1e6;
  if (/\(\s*\$?\s*k\s*\)|\$k\b|\bthousand(s)?\b/i.test(label)) return 1e3;
  // Soft heuristics. "($)" alone → already absolute, no scaling.
  if (/\(\s*\$\s*\)/.test(label)) return 1;
  return 1;
}

interface CurrencyClaim {
  text: string;
  value: number;
}

function extractCurrencyClaims(text: string): CurrencyClaim[] {
  const out: CurrencyClaim[] = [];
  const seen = new Set<string>();

  // Compact: $1.2B, $527M, $3.4K, $42 (no suffix means at-least-thousands only when prefixed)
  const compactRe = /\$\s*([\d,]+(?:\.\d+)?)\s*([BMKbmk])?/g;
  let m: RegExpExecArray | null;
  while ((m = compactRe.exec(text)) !== null) {
    const numRaw = m[1].replace(/,/g, "");
    const num = Number(numRaw);
    if (!Number.isFinite(num)) continue;
    const suffix = (m[2] || "").toUpperCase();
    const mult =
      suffix === "B" ? 1e9 : suffix === "M" ? 1e6 : suffix === "K" ? 1e3 : 1;
    const value = num * mult;
    const key = m[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: m[0], value });
  }

  // Verbose: "1.2 billion", "527 million"
  const verboseRe = /([\d,]+(?:\.\d+)?)\s*(billion|million|thousand)\b/gi;
  while ((m = verboseRe.exec(text)) !== null) {
    const numRaw = m[1].replace(/,/g, "");
    const num = Number(numRaw);
    if (!Number.isFinite(num)) continue;
    const unit = m[2].toLowerCase();
    const mult = unit === "billion" ? 1e9 : unit === "million" ? 1e6 : 1e3;
    const value = num * mult;
    const key = m[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: m[0], value });
  }
  return out;
}

// ─── Tier 2: source-coverage + recipe-transform sanity ────────────────────

async function runTier2(
  input: ChartValidationInput,
  stats: ChartSeriesStats | null,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // 2a. Source coverage — ask the data-source brain whether the (source,
  // entity) pair is known to be empty.
  const claimedSource = inferSourceKey(input.artifact?.source);
  if (claimedSource && input.resolvedEntities.length > 0) {
    for (const entity of input.resolvedEntities.slice(0, 3)) {
      try {
        const hits = await consult({
          query: `${entity} coverage`,
          source: claimedSource,
          category: "coverage",
          topK: 3,
          minSimilarity: 0.55,
        });
        const negative = hits.find((h) => {
          const c = (h.fact.content || "").toLowerCase();
          const isStrong =
            h.fact.confidence === "verified_runtime" ||
            h.fact.confidence === "verified_doc" ||
            (h.fact.confidence === "observed_once" && (h.fact.observedCount || 0) >= 2);
          if (!isStrong) return false;
          if (!c.includes(entity.toLowerCase())) return false;
          return (
            c.includes("no data") ||
            c.includes("not tracked") ||
            c.includes("not found") ||
            c.includes("no tvl") ||
            c.includes("no fees") ||
            c.includes("no revenue") ||
            c.includes("no volume")
          );
        });
        if (negative) {
          issues.push({
            kind: "source_coverage_gap",
            tier: 2,
            message: `Data-source brain says ${claimedSource} has no data for ${entity}: "${negative.fact.content.slice(0, 100)}"`,
            modelHint: `Your chart claims source="${input.artifact?.source}" for ${entity}, but the brain has high-confidence evidence this combination has no data ("${negative.fact.content.slice(0, 120)}"). Switch sources (try Dune, CoinGecko, or another DeFiLlama endpoint) and refetch.`,
            evidence: { source: claimedSource, entity, factId: negative.fact.id },
          });
        }
      } catch (err: any) {
        // Best-effort — silent.
      }
    }
  }

  // 2b. Recipe-transform sanity — only if recipe is provided.
  if (input.recipe && stats) {
    issues.push(...checkRecipeTransforms(input.recipe, stats, input.artifact?.title || ""));
  }

  return issues;
}

function inferSourceKey(claimed: string | undefined | null):
  | "defillama"
  | "coingecko"
  | "dune"
  | "allium"
  | "stonksonchain"
  | null {
  if (!claimed) return null;
  const c = String(claimed).toLowerCase();
  if (c.includes("defillama")) return "defillama";
  if (c.includes("coingecko")) return "coingecko";
  if (c.includes("dune")) return "dune";
  if (c.includes("allium")) return "allium";
  if (c.includes("stonks")) return "stonksonchain";
  return null;
}

/** If the recipe transforms include ma:30, expect cv to be modest (low noise).
 *  If it includes annualize, expect magnitudes to be in an annualized range
 *  (we can't compute "raw_mean × 365" without the raw series, so we apply a
 *  weaker check: annualized ARR for a protocol shouldn't be < $1M unless the
 *  protocol is tiny). These are heuristic — the goal is to catch the model
 *  shipping unsmoothed data labeled "30D MA" or daily revenue labeled "ARR". */
function checkRecipeTransforms(
  recipe: DerivedMetricRecipe,
  stats: ChartSeriesStats,
  title: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const transforms: string[] = (recipe as any)?.transforms || [];

  if (transforms.includes("ma:30") || transforms.includes("ma:7")) {
    for (const s of stats.series) {
      // Smoothed series should have cv < 0.5 in most metric ranges. Higher
      // means the smoothing wasn't actually applied (or the underlying series
      // is so volatile that no smoothing will tame it — false-positive risk).
      if (s.cv > 0.6 && s.length >= 30) {
        issues.push({
          kind: "recipe_definition_mismatch",
          tier: 2,
          message: `Recipe specifies moving-average smoothing but series "${s.label}" has cv=${s.cv.toFixed(2)} (≥0.6) — looks unsmoothed.`,
          modelHint: `The chart title implies a moving-average transform, but series "${s.label}" looks unsmoothed (coefficient of variation = ${s.cv.toFixed(2)}). Apply the moving average via execute_code on the raw series before assembling the artifact, then re-emit.`,
          evidence: { series: s.label, cv: s.cv, transforms },
        });
      }
    }
  }

  if (/\bARR\b|annualized/i.test(title) && transforms.includes("annualize")) {
    for (const s of stats.series) {
      if (s.last && s.last.value > 0 && s.last.value < 1e5) {
        issues.push({
          kind: "recipe_definition_mismatch",
          tier: 2,
          message: `Title implies ARR/annualized but series "${s.label}" tail is ${s.last.value.toFixed(0)} — looks like daily revenue, not annualized.`,
          modelHint: `Your title says ARR / annualized, but series "${s.label}" ends at ~${s.last.value.toFixed(0)} which looks like a daily figure. Multiply by 365 (or apply your annualize transform) before plotting.`,
          evidence: { series: s.label, lastValue: s.last.value },
        });
      }
    }
  }

  return issues;
}

// ─── Tier 3: KG-brain referee via Haiku 4.5 ──────────────────────────────

async function runTier3(
  input: ChartValidationInput,
  rows: any[],
  yAxes: Array<{ dataKey: string; label: string }>,
  stats: ChartSeriesStats | null,
): Promise<{
  issues: ValidationIssue[];
  groundedFacts: BrainFact[];
  costUsd: number;
  confidence: "high" | "medium" | "low";
}> {
  if (!stats || stats.series.length === 0) {
    return { issues: [], groundedFacts: [], costUsd: 0, confidence: "low" };
  }

  // Retrieve recent verified KG facts about the chart's entities.
  const ctx = await retrieveRelevantContext(
    `${input.userMessage} ${input.resolvedEntities.join(" ")}`,
    input.brain ?? null,
    input.userId,
  );
  const now = (input.now ?? new Date()).getTime();
  const groundedFacts = ctx.facts
    .filter((f) => f.confidence === "verified")
    .filter((f) => {
      if (!f.date) return true;
      const t = Date.parse(f.date);
      if (!Number.isFinite(t)) return true;
      const ageDays = (now - t) / (24 * 3600 * 1000);
      return ageDays <= 30;
    })
    .filter((f) => {
      if (!input.resolvedEntities.length) return true;
      const ents = (f.entities || []).map((e) => e.toLowerCase());
      return input.resolvedEntities.some((e) =>
        ents.some((x) => x === e.toLowerCase() || x.includes(e.toLowerCase())),
      );
    })
    .slice(0, 12);

  if (groundedFacts.length === 0) {
    return { issues: [], groundedFacts: [], costUsd: 0, confidence: "low" };
  }

  const tail = rows.slice(-5).map((r: any) => {
    const out: Record<string, any> = { date: r.date };
    for (const y of yAxes) out[y.label || y.dataKey] = r[y.dataKey];
    return out;
  });

  const seriesSummary = stats.series.map((s) => ({
    label: s.label,
    first: s.first,
    last: s.last,
    min: s.min,
    max: s.max,
    pctChange: s.pctChange,
    trend: s.trend,
    cv: Number(s.cv.toFixed(3)),
  }));

  const numericSentences = sentencesContainingNumbers(input.narrative).slice(0, 8);
  const factsBlock = groundedFacts
    .map((f) => `  - [${f.date || "?"}] ${f.topic}: ${f.fact} (via ${f.source})`)
    .join("\n");
  const dateStr = (input.now ?? new Date()).toISOString().slice(0, 10);

  const refereePrompt = `You are a chart-quality referee. Decide whether this chart and its narrative are consistent with the verified knowledge graph and with the chart's own data.

CURRENT DATE: ${dateStr}
USER REQUEST: ${truncate(input.userMessage, 400)}

CHART:
  title: ${truncate(String(input.artifact?.title || ""), 200)}
  source: ${truncate(String(input.artifact?.source || ""), 80)}
  series: ${JSON.stringify(seriesSummary)}
  tail (last 5 rows): ${JSON.stringify(tail)}

NARRATIVE NUMERIC SENTENCES (excerpted from prose):
${numericSentences.map((s) => `  - "${truncate(s, 220)}"`).join("\n") || "  (none)"}

VERIFIED BRAIN FACTS (last 30 days, top-${groundedFacts.length} by relevance):
${factsBlock}

Return ONLY JSON in this exact shape (no other text):
{
  "ok": <bool>,
  "confidence": "high" | "medium" | "low",
  "issues": [
    {
      "kind": "narrative_number_unsupported" | "brain_contradiction" | "internal_inconsistency",
      "message": "<short human-readable>",
      "modelHint": "<actionable instruction back to the chart-writer>",
      "brainFactIds": ["<id>", ...]
    }
  ]
}

Rules:
- Reject if the narrative cites a number that contradicts a verified brain fact for the SAME metric on the SAME entity by >25%, AND the chart's own data does not support the narrative number either.
- DO NOT flag metric-identity mismatches. "LTM revenue $484M" and "30D MA ARR $734M" describe DIFFERENT metrics — they shouldn't conflict.
- DO NOT flag stylistic/qualitative claims ("cyclical", "trending up", "moderating") — only numeric ones.
- If brain facts and chart agree but prose disagrees with both, flag "internal_inconsistency".
- If brain has no relevant fact for a numeric claim, do not flag — let it pass.
- Set confidence "low" if you don't have enough grounding to judge.`;

  const resp = await callAnthropicRaw({
    model: REFEREE_MODEL,
    max_tokens: 600,
    system:
      "You are a precise validator. Output ONLY valid JSON. Never include any other text.",
    messages: [{ role: "user", content: refereePrompt }],
  });

  const costUsd = resp.mppCost || 0;
  const text = (resp.content || [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  let parsed: any = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {}
  if (!parsed || typeof parsed !== "object") {
    return { issues: [], groundedFacts, costUsd, confidence: "low" };
  }

  const confidence: "high" | "medium" | "low" =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";

  const issues: ValidationIssue[] = Array.isArray(parsed.issues)
    ? parsed.issues
        .filter((i: any) => i && typeof i.message === "string")
        .map((i: any) => ({
          kind:
            i.kind === "narrative_number_unsupported" ||
            i.kind === "brain_contradiction" ||
            i.kind === "internal_inconsistency"
              ? i.kind
              : "brain_contradiction",
          tier: 3 as const,
          message: String(i.message).slice(0, 400),
          modelHint: String(i.modelHint || i.message).slice(0, 600),
          evidence: { brainFactIds: Array.isArray(i.brainFactIds) ? i.brainFactIds.slice(0, 8) : [] },
        }))
    : [];

  // The referee can return ok:true with no issues even at low confidence.
  // Respect it — the whole point is to avoid false-positive rejections when
  // the brain doesn't have grounding.
  const ok = parsed.ok === true && issues.length === 0;
  return {
    issues: ok ? [] : issues,
    groundedFacts,
    costUsd,
    confidence,
  };
}

function sentencesContainingNumbers(narrative: string): string[] {
  if (!narrative) return [];
  const stripped = narrative.replace(/```[\s\S]*?```/g, " "); // drop code fences
  const sentences = stripped
    .split(/(?<=[.!?])\s+(?=[A-Z(\d$])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return sentences.filter((s) => /\$\s*\d|[\d,]+\s*(B|M|K|billion|million|thousand|%)/i.test(s));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

// ─── Helpers exposed for callers (retry + warning injection) ─────────────

/** Build a system-message addendum from a verdict's modelHints — used on
 *  the bounded retry to feed the agent the validator's reasons. */
export function buildRetrySystemAddendum(verdict: ChartValidationVerdict): string {
  if (verdict.issues.length === 0) return "";
  const lines = verdict.issues.map((i, idx) => `${idx + 1}. ${i.modelHint}`);
  return `\n\nCHART VALIDATOR FEEDBACK — your previous draft was rejected. Fix these and re-emit:\n${lines.join("\n")}\n\nDo NOT call any new tools. Re-emit a corrected chart artifact and a brief revised narrative using the data already in the conversation.`;
}

/** Produce a visible warning callout artifact body to inject into finalText
 *  when the second attempt also failed validation. The chart still ships,
 *  but the user sees a concrete heads-up. */
export function buildWarningCallout(verdict: ChartValidationVerdict): string {
  const top = verdict.issues
    .slice(0, 2)
    .map((i) => i.message.replace(/[\n\r]+/g, " "))
    .join(" • ");
  const text = `Validator flagged this chart and we couldn't auto-correct: ${top}. Treat the narrative with caution; the chart's data array is what was actually fetched.`;
  return [
    "```artifact:callout",
    JSON.stringify({ variant: "risk", title: "Data quality warning", text }),
    "```",
  ].join("\n");
}

/** Persist a successful chart's tail values as structured KG-brain facts so
 *  future validators can cross-check against them. One fact per yAxis. Best
 *  effort — never throws. The flywheel piece. */
export async function writeTailFacts(
  artifact: any,
  resolvedEntities: string[],
  userId: string,
): Promise<void> {
  try {
    const rows: any[] = Array.isArray(artifact?.data) ? artifact.data : [];
    const yAxes: Array<{ dataKey: string; label: string; format?: string }> =
      (artifact?.chartConfig?.yAxes || []).map((y: any) => ({
        dataKey: String(y?.dataKey || ""),
        label: String(y?.label || y?.dataKey || ""),
        format: y?.format,
      }));
    if (rows.length === 0 || yAxes.length === 0 || resolvedEntities.length === 0) return;

    const stats = computeChartStats(rows, yAxes);
    const { embed } = await import("./data-source-brain/embeddings");
    const crypto = await import("node:crypto");
    const tailDate = (rows[rows.length - 1] as any)?.date || null;

    for (const s of stats.series) {
      if (!s.last) continue;
      const entitiesArr = Array.from(
        new Set(
          [...resolvedEntities, s.dataKey]
            .filter(Boolean)
            .map((e) => String(e).toLowerCase()),
        ),
      );
      const formatted = formatValue(s.last.value, yAxes.find((y) => y.dataKey === s.dataKey)?.format);
      const fact = `${formatted} as of ${s.last.date} (n=${s.length}, pctChange=${s.pctChange?.toFixed(1) ?? "n/a"}%, trend=${s.trend})`;
      const topic = `Chart tail: ${resolvedEntities[0] || "unknown"} ${s.label}`;
      const factId =
        "tail_" +
        crypto
          .createHash("sha256")
          .update(`${userId}|${topic}|${s.last.date}`)
          .digest("hex")
          .slice(0, 16);
      const embedVec = await embed(`${topic}\n${fact}`, "document");
      const vec = `[${embedVec.join(",")}]`;
      const entitiesPgArray = `{${entitiesArr.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(",")}}`;

      await db.execute(sql`
        INSERT INTO brain_facts (user_id, fact_id, topic, fact, entities, source, date, confidence, embedding, updated_at)
        VALUES (
          ${userId}, ${factId}, ${topic}, ${fact}, ${entitiesPgArray}::text[],
          'chart-emission', ${tailDate}, 'verified', ${vec}::vector, now()
        )
        ON CONFLICT (user_id, fact_id) DO UPDATE SET
          topic = EXCLUDED.topic,
          fact = EXCLUDED.fact,
          entities = EXCLUDED.entities,
          date = EXCLUDED.date,
          embedding = EXCLUDED.embedding,
          updated_at = now()
      `);
    }
  } catch (err: any) {
    console.warn(`[ChartValidator] writeTailFacts failed: ${err.message}`);
  }
}

function formatValue(v: number, format: string | undefined): string {
  if (!Number.isFinite(v)) return String(v);
  if (format === "ratio") return `${v.toFixed(2)}x`;
  if (format === "percent") return `${v.toFixed(2)}%`;
  if (format === "currency" || format === "$") {
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(2)}`;
  }
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(2);
}

/** Outcome of `runChartValidationPass` — the caller wires in cost tracking. */
export interface ChartValidationPassResult {
  finalText: string;
  retryCost: number;
  retryInputTokens: number;
  retryOutputTokens: number;
  retried: boolean;
  warningInjected: boolean;
  verdicts: ChartValidationVerdict[];
}

export interface ChartValidationPassInput {
  finalText: string;
  parseArtifacts: (text: string) => any[];
  userMessage: string;
  brain: BrainGraph | null;
  userId: string;
  recipe?: DerivedMetricRecipe | null;
  /** Caller-owned retry: re-runs the model with `systemAddendum` added to
   *  the system prompt and the prior assistant text injected into the
   *  conversation. Should return ONLY the model's new text content (no
   *  tool use). Errors are caught — pass-through to warning injection. */
  retryFn: (systemAddendum: string, priorFinalText: string) => Promise<{
    text: string;
    cost: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  now?: Date;
}

/**
 * One-stop validator pass for a finalText that may contain chart artifacts.
 *
 * Flow per chart artifact:
 *   1. validateChartArtifact (full T1+T2+T3)
 *   2. if reject: retryFn(addendum, finalText) → re-validate (T1+T2 only)
 *   3. if still reject: prepend a visible artifact:callout warning
 *   4. on success (any pass): writeTailFacts (best effort)
 *
 * Returns a possibly-mutated finalText plus retry-cost telemetry.
 *
 * Non-chart artifacts pass through untouched. If the caller is fully
 * disabling the validator via env, this is a no-op.
 */
export async function runChartValidationPass(
  input: ChartValidationPassInput,
): Promise<ChartValidationPassResult> {
  const result: ChartValidationPassResult = {
    finalText: input.finalText,
    retryCost: 0,
    retryInputTokens: 0,
    retryOutputTokens: 0,
    retried: false,
    warningInjected: false,
    verdicts: [],
  };

  if (VALIDATOR_DISABLED) return result;

  let workingText = input.finalText;
  let artifacts = input.parseArtifacts(workingText);
  // We only validate the FIRST chart artifact. In practice chart-mode
  // emits exactly one; for multi-chart responses (rare), the first one
  // dominates the failure modes the validator targets.
  let chart = artifacts.find((a) => a?.type === "chart");
  if (!chart) return result;

  const resolvedEntities = extractEntitiesFromArtifact(chart, input.userMessage);
  const narrative = stripArtifactCodeFences(workingText);

  const verdict = await validateChartArtifact({
    artifact: chart,
    narrative,
    userMessage: input.userMessage,
    recipe: input.recipe ?? null,
    resolvedEntities,
    brain: input.brain,
    userId: input.userId,
    now: input.now,
  });
  result.verdicts.push(verdict);

  // Splice any axis-policy auto-corrections (scale="log", etc.) from
  // the validator's mutated parsed chart back into the response text
  // so the user-facing artifact JSON carries the new scale. No-op when
  // the policy didn't fire.
  workingText = applyAxisPolicyToText(workingText, chart);
  result.finalText = workingText;

  // Log-only mode: surface verdict but do NOT alter behavior.
  if (VALIDATOR_LOG_ONLY) {
    if (verdict.ok) {
      await writeTailFacts(chart, resolvedEntities, input.userId).catch(() => {});
    }
    return result;
  }

  if (verdict.ok) {
    await writeTailFacts(chart, resolvedEntities, input.userId).catch(() => {});
    return result;
  }

  // Reject path. One bounded retry.
  console.log(
    `[ChartValidator] reject (${verdict.issues.length} issues) — retrying once. Top: ${verdict.issues[0]?.message?.slice(0, 120)}`,
  );
  result.retried = true;
  const addendum = buildRetrySystemAddendum(verdict);
  try {
    const retry = await input.retryFn(addendum, workingText);
    result.retryCost = retry.cost;
    result.retryInputTokens = retry.inputTokens;
    result.retryOutputTokens = retry.outputTokens;

    if (retry.text.trim().length > 100) {
      workingText = retry.text;
      const retryArtifacts = input.parseArtifacts(workingText);
      const retryChart = retryArtifacts.find((a) => a?.type === "chart");
      if (retryChart) {
        const retryEntities = extractEntitiesFromArtifact(retryChart, input.userMessage);
        const retryVerdict = await validateChartArtifact({
          artifact: retryChart,
          narrative: stripArtifactCodeFences(workingText),
          userMessage: input.userMessage,
          recipe: input.recipe ?? null,
          resolvedEntities: retryEntities,
          brain: input.brain,
          userId: input.userId,
          now: input.now,
          skipReferee: true,
        });
        result.verdicts.push(retryVerdict);
        if (retryVerdict.ok) {
          await writeTailFacts(retryChart, retryEntities, input.userId).catch(() => {});
          result.finalText = workingText;
          return result;
        }
        console.log(
          `[ChartValidator] retry rejected (${retryVerdict.issues.length} issues) — injecting warning`,
        );
        workingText = buildWarningCallout(retryVerdict) + "\n\n" + workingText;
        result.warningInjected = true;
      } else {
        // Retry produced no chart at all — that's a regression worse than the
        // original. Keep the original text + warning.
        console.warn(
          `[ChartValidator] retry returned no chart artifact — keeping original + warning`,
        );
        workingText = buildWarningCallout(verdict) + "\n\n" + input.finalText;
        result.warningInjected = true;
      }
    } else {
      console.warn(
        `[ChartValidator] retry returned empty text — keeping original + warning`,
      );
      workingText = buildWarningCallout(verdict) + "\n\n" + input.finalText;
      result.warningInjected = true;
    }
  } catch (err: any) {
    console.warn(`[ChartValidator] retry threw: ${err.message} — injecting warning`);
    workingText = buildWarningCallout(verdict) + "\n\n" + input.finalText;
    result.warningInjected = true;
  }

  result.finalText = workingText;
  return result;
}

/** Strip ```artifact:*``` code fences so the narrative-number scan only
 *  reads prose, not artifact JSON (which legitimately contains numbers). */
function stripArtifactCodeFences(text: string): string {
  return text.replace(/```artifact:[a-z_]+\s*\n[\s\S]*?```/g, " ");
}

/**
 * Validate a recipe-pipeline chart response in place. The recipe path is
 * deterministic — there's no clean retry — so this:
 *   - runs the validator (T1+T2+T3) on the first chart artifact
 *   - on reject, prepends a visible warning callout to response.content
 *   - on pass, writes tail facts to the KG brain (the flywheel piece)
 *
 * Returns the (possibly mutated) response. Best-effort; failures are
 * swallowed since the recipe pipeline already has its own safety gates
 * (assertChartFreshness, checkChartDataSanity, slug-resolver staleness).
 *
 * Pass `recipe` when known so Tier 2 transform sanity can fire.
 */
export async function validateRecipeChartResponse<
  R extends { content: string; artifacts: any[] },
>(
  response: R,
  ctx: {
    userMessage: string;
    userId: string;
    brain: BrainGraph | null;
    recipe?: DerivedMetricRecipe | null;
    now?: Date;
  },
): Promise<R> {
  if (VALIDATOR_DISABLED) return response;
  try {
    const chart = (response.artifacts || []).find((a: any) => a?.type === "chart");
    if (!chart) return response;

    const resolvedEntities = extractEntitiesFromArtifact(chart, ctx.userMessage);
    const verdict = await validateChartArtifact({
      artifact: chart,
      narrative: stripArtifactCodeFences(response.content || ""),
      userMessage: ctx.userMessage,
      recipe: ctx.recipe ?? null,
      resolvedEntities,
      brain: ctx.brain,
      userId: ctx.userId,
      now: ctx.now,
    });

    if (VALIDATOR_LOG_ONLY) {
      if (verdict.ok) {
        await writeTailFacts(chart, resolvedEntities, ctx.userId).catch(() => {});
      }
      return response;
    }

    if (verdict.ok) {
      await writeTailFacts(chart, resolvedEntities, ctx.userId).catch(() => {});
      return response;
    }

    console.log(
      `[ChartValidator] recipe-path reject (${verdict.issues.length} issues) — injecting warning. Top: ${verdict.issues[0]?.message?.slice(0, 120)}`,
    );
    return {
      ...response,
      content: buildWarningCallout(verdict) + "\n\n" + (response.content || ""),
    };
  } catch (err: any) {
    console.warn(`[ChartValidator] validateRecipeChartResponse threw: ${err.message}`);
    return response;
  }
}

/** Extract entity candidates from a chart artifact when the agent path
 *  doesn't carry an explicit recipe.protocol. Pulls from yAxes labels,
 *  dataKeys, and the artifact title. Tokens shorter than 2 chars and pure
 *  numerics are dropped. */
export function extractEntitiesFromArtifact(
  artifact: any,
  userMessage: string,
): string[] {
  const out = new Set<string>();
  const push = (s: any) => {
    if (typeof s !== "string") return;
    for (const tok of s.split(/[^A-Za-z0-9]+/)) {
      const t = tok.trim();
      if (t.length < 2) continue;
      if (/^\d+$/.test(t)) continue;
      out.add(t);
    }
  };
  push(artifact?.title);
  for (const y of artifact?.chartConfig?.yAxes || []) {
    push(y?.label);
    push(y?.dataKey);
  }
  // Pull obvious capitalized tokens from the user message — protocol/ticker
  // names typically appear in the request.
  const upperRe = /\b[A-Z][A-Za-z0-9]{1,15}\b/g;
  let m: RegExpExecArray | null;
  while ((m = upperRe.exec(userMessage)) !== null) out.add(m[0]);
  return Array.from(out);
}
