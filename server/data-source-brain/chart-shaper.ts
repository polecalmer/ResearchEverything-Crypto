/**
 * Chart Shaper — the brain-driven step that decides chart form, annotations,
 * and prose for a computed chart. Runs AFTER `computeDerivedChart` and
 * BEFORE `buildChartResponse` in the deterministic chart pipeline.
 *
 * Inputs: recipe metadata, computed rows, deterministic series stats,
 * the user's question, and (optional) research-brain facts about the
 * protocol(s) involved. Output: a `ShapedChart` describing chartType,
 * smoothing, axis layout, callout annotations, and a prose paragraph.
 *
 * If the LLM call fails or returns invalid JSON, we fall back to the
 * recipe's hand-coded defaults so the chart still renders. Never throws.
 */

import { callAnthropicServer } from "../mpp-client";
import { MODELS } from "../constants";
import { consult } from "./db";
import type { ChartSeriesStats } from "./series-stats";
import type { DerivedMetricRecipe } from "./derived-metrics";

export type Smoothing = "none" | "7dma" | "30dma";
export type AxisLayout = "single" | "dual";
export type ShapedChartType = "line" | "bar" | "area" | "composed" | "pie" | "stacked";

export interface ChartAnnotation {
  /** ISO date matching a row in the (post-smoothing) series. */
  date: string;
  /** Numeric value of the annotated point on `series` at `date`. */
  value: number;
  /** ≤ 60 char inline label rendered next to the marker. */
  label: string;
  /** Which yAxis dataKey this annotation is anchored to. */
  series: string;
}

export interface ShapedChart {
  chartType: ShapedChartType;
  smoothing: Smoothing;
  axisLayout: AxisLayout;
  annotations: ChartAnnotation[];
  prose: string;
  /** Where the prose came from — useful for the [ChartShaper] log line. */
  proseSource: "brain" | "fallback";
}

export interface ShaperInput {
  recipe: DerivedMetricRecipe;
  rows: any[];
  yAxes: Array<{ dataKey: string; label: string }>;
  stats: ChartSeriesStats;
  userQuestion: string;
  ticker: string;
  protocol: string;
  denominator?: { protocol: string; metric: string };
  /** Optional research-brain facts injected as interpretation context. */
  contextFacts?: string[];
}

/** Default cutoff for `assertChartFreshness` — series whose last data point
 *  is older than this many days are refused at chart finalization. The
 *  Venice incident (Apr 2026) rendered an Oct 2023 chart because nothing
 *  in the pipeline checked the data tail before drawing pixels. */
export const CHART_FRESHNESS_THRESHOLD_DAYS = 60;

/** Thrown by `assertChartFreshness` when a chart's tail is too stale to
 *  render. Carries the metric/protocol/source so the caller can build a
 *  user-visible error pointing at the actual offending dimension. */
export class ChartFreshnessError extends Error {
  readonly code = "CHART_FRESHNESS";
  readonly metricLabel: string;
  readonly protocol: string;
  readonly source?: string;
  readonly latestDate: string | null;
  readonly ageDays: number | null;
  readonly thresholdDays: number;
  constructor(
    message: string,
    info: {
      metricLabel: string;
      protocol: string;
      source?: string;
      latestDate: string | null;
      ageDays: number | null;
      thresholdDays: number;
    },
  ) {
    super(message);
    this.name = "ChartFreshnessError";
    this.metricLabel = info.metricLabel;
    this.protocol = info.protocol;
    this.source = info.source;
    this.latestDate = info.latestDate;
    this.ageDays = info.ageDays;
    this.thresholdDays = info.thresholdDays;
  }
}

/** Refuse to render a chart whose last data point is older than
 *  `thresholdDays` days. Runs at chart finalization (just before
 *  `buildChartResponse` shapes the artifact). The Venice case — a chart
 *  rendered on 2026-04-25 with last point 2023-10 — slipped through
 *  because every upstream check (slug resolver, fetch, sanity, shaper)
 *  treated stale data as valid. This is the single freshness gate. */
export function assertChartFreshness(
  rows: any[],
  opts: {
    metricLabel: string;
    protocol: string;
    source?: string;
    /** Override the default threshold for an unusually slow series. */
    thresholdDays?: number;
    /** Override "now" — used by tests so they don't drift across years. */
    now?: Date;
  },
): void {
  const threshold = opts.thresholdDays ?? CHART_FRESHNESS_THRESHOLD_DAYS;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ChartFreshnessError(
      `No data for ${opts.metricLabel} on ${opts.protocol}${opts.source ? ` from ${opts.source}` : ""} — try another source or confirm the slug.`,
      { metricLabel: opts.metricLabel, protocol: opts.protocol, source: opts.source, latestDate: null, ageDays: null, thresholdDays: threshold },
    );
  }
  const lastRow = rows[rows.length - 1];
  const lastDate = lastRow?.date;
  if (typeof lastDate !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(lastDate)) {
    throw new ChartFreshnessError(
      `Cannot determine freshness for ${opts.metricLabel} on ${opts.protocol} — last row has no parseable date.`,
      { metricLabel: opts.metricLabel, protocol: opts.protocol, source: opts.source, latestDate: null, ageDays: null, thresholdDays: threshold },
    );
  }
  const lastMs = Date.parse(lastDate.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(lastMs)) {
    throw new ChartFreshnessError(
      `Unparseable date "${lastDate}" on last row for ${opts.metricLabel} (${opts.protocol}).`,
      { metricLabel: opts.metricLabel, protocol: opts.protocol, source: opts.source, latestDate: lastDate, ageDays: null, thresholdDays: threshold },
    );
  }
  const nowMs = (opts.now ?? new Date()).getTime();
  const ageDays = Math.floor((nowMs - lastMs) / (24 * 3600 * 1000));
  if (ageDays > threshold) {
    throw new ChartFreshnessError(
      `No recent data for ${opts.metricLabel} on ${opts.protocol}${opts.source ? ` from ${opts.source}` : ""} — latest data point is ${lastDate} (${ageDays} days old; threshold ${threshold}d). Try another source or confirm the slug.`,
      { metricLabel: opts.metricLabel, protocol: opts.protocol, source: opts.source, latestDate: lastDate, ageDays, thresholdDays: threshold },
    );
  }
}

const FMT = (v: number, format: string): string => {
  if (!Number.isFinite(v)) return String(v);
  if (format === "ratio") return `${v.toFixed(2)}x`;
  if (format === "percent") return `${v.toFixed(2)}%`;
  if (format === "currency") {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  }
  return v.toFixed(2);
};

/** Bounded TTL cache for gatherShaperContext results. Most chart sessions
 *  ask about the same handful of protocols, so caching the brain consult
 *  output for a short window lets repeat charts skip the consult entirely
 *  and removes the 500ms timeout-fallback risk on slow consults. */
const SHAPER_CONTEXT_TTL_MS = 5 * 60 * 1000;
const SHAPER_CONTEXT_MAX_ENTRIES = 200;
const shaperContextCache = new Map<string, { facts: string[]; expiresAt: number }>();

function shaperContextCacheKey(protocol: string, denominator?: { protocol: string }): string {
  const num = (protocol || "").trim().toLowerCase();
  const den = (denominator?.protocol || "").trim().toLowerCase();
  return `${num}|${den}`;
}

/** Test-only hook to reset the in-memory shaper-context cache. */
export function __resetShaperContextCache(): void {
  shaperContextCache.clear();
}

/** Pull short interpretation hints from the data-source brain about the
 *  numerator + denominator protocols. Best-effort — returns [] on any
 *  failure so the shaper still works without context. Results are cached
 *  in-memory for SHAPER_CONTEXT_TTL_MS to skip repeat consults. */
export async function gatherShaperContext(
  protocol: string,
  denominator?: { protocol: string },
): Promise<string[]> {
  const cacheKey = shaperContextCacheKey(protocol, denominator);
  const now = Date.now();
  const cached = shaperContextCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    // Refresh LRU recency by re-inserting.
    shaperContextCache.delete(cacheKey);
    shaperContextCache.set(cacheKey, cached);
    return cached.facts;
  }
  if (cached) shaperContextCache.delete(cacheKey);

  const queries = [
    `${protocol} structural facts protocol type fee model`,
  ];
  if (denominator?.protocol && denominator.protocol !== protocol) {
    queries.push(`${denominator.protocol} structural facts protocol type fee model`);
  }
  const out: string[] = [];
  for (const q of queries) {
    try {
      const hits = await consult({ query: q, topK: 2, minSimilarity: 0.45 });
      for (const h of hits) {
        const c = h.fact.content.trim();
        // Skip user-pref records — those are routing prefs, not interpretation.
        if (c.toLowerCase().includes("userpref:")) continue;
        if (c.length > 0) out.push(c.slice(0, 240));
      }
    } catch {
      /* swallow */
    }
  }
  // Dedupe while preserving order; cap at 4 facts to keep prompt tight.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of out) {
    if (!seen.has(c)) {
      seen.add(c);
      unique.push(c);
    }
  }
  const facts = unique.slice(0, 4);

  // Bound cache size by evicting oldest entries (Map preserves insertion order).
  while (shaperContextCache.size >= SHAPER_CONTEXT_MAX_ENTRIES) {
    const oldestKey = shaperContextCache.keys().next().value;
    if (oldestKey === undefined) break;
    shaperContextCache.delete(oldestKey);
  }
  shaperContextCache.set(cacheKey, { facts, expiresAt: Date.now() + SHAPER_CONTEXT_TTL_MS });
  return facts;
}

/** Compress per-series stats into a JSON block the LLM can reason over. */
function statsForPrompt(stats: ChartSeriesStats, format: string) {
  return {
    series: stats.series.map((s) => ({
      key: s.dataKey,
      label: s.label,
      length: s.length,
      first: s.first ? { date: s.first.date, value: Number(s.first.value.toFixed(4)), formatted: FMT(s.first.value, format) } : null,
      last: s.last ? { date: s.last.date, value: Number(s.last.value.toFixed(4)), formatted: FMT(s.last.value, format) } : null,
      min: s.min ? { date: s.min.date, value: Number(s.min.value.toFixed(4)), formatted: FMT(s.min.value, format) } : null,
      max: s.max ? { date: s.max.date, value: Number(s.max.value.toFixed(4)), formatted: FMT(s.max.value, format) } : null,
      mean: Number(s.mean.toFixed(4)),
      meanFormatted: FMT(s.mean, format),
      median: Number(s.median.toFixed(4)),
      cv: Number(s.cv.toFixed(3)),
      trend: s.trend,
      pctChange: s.pctChange == null ? null : Number(s.pctChange.toFixed(1)),
      recommendedSmoothing: s.recommendedSmoothing,
    })),
    cross: stats.cross
      ? {
          correlation: stats.cross.correlation == null ? null : Number(stats.cross.correlation.toFixed(2)),
          persistentGap: stats.cross.persistentGap
            ? {
                dominant: stats.cross.persistentGap.dominant,
                followers: stats.cross.persistentGap.followers,
                coverage: Number(stats.cross.persistentGap.coverage.toFixed(2)),
              }
            : null,
        }
      : null,
  };
}

const SHAPER_SYSTEM = `You are a chart presentation expert. Given a computed time-series, deterministic series stats, and (optional) research context, decide:

1. CHART FORM: chartType ("line" | "bar" | "area" | "composed" | "pie" | "stacked"), smoothing ("none" | "7dma" | "30dma"), axisLayout ("single" | "dual").

   CHART TYPE BY METRIC INTENT — match the visualization to what the data IS, not just the time axis:
   - **bar** — for DISCRETE BUCKETED KPIs that are summed within each bucket (monthly revenue, weekly volume, daily fees, periodic burns, periodic buybacks). Bars correctly imply "amount accrued in this period" and are how analysts read these metrics. Default to bar when the data has been aggregated to weekly/monthly buckets.
   - **line** — for CONTINUOUS metrics where each point is a snapshot/state, NOT a sum (TVL trajectory, P/E ratio over time, take-rate over time, price, APY, MCAP/FDV, supply, holder count). Lines correctly imply "value at this moment."
   - **area** — for CUMULATIVE running totals (cumulative buybacks, cumulative inflows, market cap progression as a single series).
   - **composed** — only when you have TWO series that legitimately need different chart types (e.g. revenue bars + price line) AND the units differ enough to require it. Otherwise pick a single chartType.
   - **pie** — for SNAPSHOT MARKET SHARE / breakdown of a whole into parts at a single point in time. Each slice is a category; the whole sums to ~100% (or a meaningful total). Examples: "current market share of perp DEXes", "TVL split across L2s today", "revenue mix across business lines". Pick pie ONLY when the data is a categorical breakdown at a moment, not a time-series. 3-10 categories ideal; merge tiny categories into "Other" if needed.
   - **stacked** — for MARKET SHARE / COMPOSITION OVER TIME (rendered as stacked bars). Each x-axis bucket sums to a meaningful whole; series stack to show how shares evolve. Examples: "DEX volume share over 90 days", "stablecoin supply composition over 12 months", "lending TVL by protocol over time". Pick stacked when shares-over-time is the question and the bucketed total is meaningful in absolute terms too.

   AXIS LAYOUT:
   - "single" — same metric / same units across all series (TVL of three protocols; revenue of one protocol).
   - "dual" — different units AND different magnitudes (price in $ + revenue in $M; ratio + dollar amount; share % + dollar amount).

   SMOOTHING:
   - Apply 7dma when CV ≥ 0.25 and length ≥ 21. Apply 30dma when CV ≥ 0.5 and length ≥ 90. Otherwise "none".
   - Smoothing is for line/area only — never apply to bar.

2. ANNOTATIONS: 0–3 callout points worth surfacing (peak, trough, regime change, large single-day spike). Each annotation MUST reference an exact { date, value } from the provided stats (use min/max/last) and name the series it belongs to. Skip if nothing is meaningfully callout-worthy.

3. PROSE: A SHORT (≤ 110 words) paragraph that:
   - Leads with the headline number (peak %, latest value, average, etc.) using the EXACT formatted values from stats.
   - Calls out a specific spike or regime change with its date when one exists in stats.
   - Cites at least one structural insight from the research context when provided (e.g. "RWA perps charge tighter fee rates" → explains why fee share lags volume share).
   - Uses **bold** for emphasis on key numbers. No headers, no bullet lists.

Return ONLY valid JSON matching this exact schema (no prose outside the JSON, no markdown code fences):
{
  "chartType": "line" | "bar" | "area" | "composed" | "pie" | "stacked",
  "smoothing": "none" | "7dma" | "30dma",
  "axisLayout": "single" | "dual",
  "annotations": [{"date": "YYYY-MM-DD", "value": <number>, "label": "<≤60 chars>", "series": "<dataKey>"}],
  "prose": "<paragraph>"
}`;

const FALLBACK_SHAPED = (input: ShaperInput, source: "fallback" | "brain"): ShapedChart => {
  // Mimic the prior hardcoded summary so we never regress.
  const primary = input.stats.series[0];
  const fmtVal = (v: number) => FMT(v, input.recipe.format);
  const rawName = input.ticker || input.protocol;
  // Don't shout brand names — preserve any mixed-case the user typed (e.g.
  // "TradeXYZ"); for lower-only protocol slugs from the extractor, just
  // capitalize the first letter so prose reads "Tradexyz" rather than "TRADEXYZ".
  const ticker = rawName === rawName.toLowerCase()
    ? rawName.charAt(0).toUpperCase() + rawName.slice(1)
    : rawName;
  const trend = primary?.trend === "rising" ? "rising" : primary?.trend === "falling" ? "declining" : "flat";
  const latestStr = primary?.last ? fmtVal(primary.last.value) : "—";
  const firstStr = primary?.first ? fmtVal(primary.first.value) : "—";
  const proseParts = [
    `**${ticker}** ${input.recipe.displayLabel}: **${latestStr}** (${trend} from ${firstStr} over the window).`,
  ];
  if (input.stats.series.length > 1 && input.stats.series[1]?.last) {
    proseParts.push(`${input.stats.series[1].label}: **${fmtVal(input.stats.series[1].last.value)}**.`);
  }
  // Smoothing: trust the per-series recommendation from series-stats (it
  // already encodes the same CV + length heuristic the shaper prompt uses).
  // Fall back to "none" only if no recommendation is available.
  const smoothing: Smoothing = (primary?.recommendedSmoothing as Smoothing) || "none";

  // Axis layout: only split onto a dual axis when two series genuinely
  // live on different scales. Same-unit series (all ratios, or all
  // dollar-denominated in the same order of magnitude) share one axis,
  // otherwise we render a wall of bars against a tiny line.
  const axisLayout: AxisLayout = (() => {
    if (input.stats.series.length < 2) return "single";
    const magnitudes = input.stats.series
      .map(s => Math.abs(s.mean))
      .filter(m => Number.isFinite(m) && m > 0);
    if (magnitudes.length < 2) return "single";
    const ratio = Math.max(...magnitudes) / Math.min(...magnitudes);
    return ratio >= 10 ? "dual" : "single";
  })();

  return {
    chartType: input.recipe.chartType,
    smoothing,
    axisLayout,
    annotations: [],
    prose: proseParts.join(" "),
    proseSource: source,
  };
};

function tryParseShaperJSON(raw: string): any | null {
  // Strip ```json fences if the model emitted them despite the instruction.
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validateShaped(parsed: any, validKeys: Set<string>): ShapedChart | null {
  if (!parsed || typeof parsed !== "object") return null;
  const chartType = parsed.chartType;
  if (!["line", "bar", "area", "composed", "pie", "stacked"].includes(chartType)) return null;
  const smoothing = parsed.smoothing;
  if (!["none", "7dma", "30dma"].includes(smoothing)) return null;
  const axisLayout = parsed.axisLayout;
  if (!["single", "dual"].includes(axisLayout)) return null;
  const prose = typeof parsed.prose === "string" && parsed.prose.trim().length > 0 ? parsed.prose.trim() : null;
  if (!prose) return null;
  const annotationsIn = Array.isArray(parsed.annotations) ? parsed.annotations : [];
  const annotations: ChartAnnotation[] = [];
  for (const a of annotationsIn.slice(0, 3)) {
    if (!a || typeof a !== "object") continue;
    if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(a.date)) continue;
    if (!Number.isFinite(a.value)) continue;
    if (typeof a.label !== "string" || a.label.length === 0) continue;
    const series = typeof a.series === "string" ? a.series : "";
    if (!validKeys.has(series)) continue;
    annotations.push({
      date: a.date.slice(0, 10),
      value: Number(a.value),
      label: a.label.slice(0, 80),
      series,
    });
  }
  return {
    chartType,
    smoothing,
    axisLayout,
    annotations,
    prose,
    proseSource: "brain",
  };
}

export async function shapeChart(input: ShaperInput): Promise<ShapedChart> {
  const validKeys = new Set(input.yAxes.map((a) => a.dataKey));
  const compactStats = statsForPrompt(input.stats, input.recipe.format);

  const userPayload = {
    user_question: input.userQuestion,
    ticker: input.ticker,
    protocol: input.protocol,
    denominator: input.denominator || null,
    metric: {
      key: input.recipe.key,
      label: input.recipe.displayLabel,
      description: input.recipe.description,
      format: input.recipe.format,
    },
    stats: compactStats,
    research_context: input.contextFacts && input.contextFacts.length > 0 ? input.contextFacts : null,
    valid_series_keys: input.yAxes.map((a) => a.dataKey),
  };

  try {
    const response = await callAnthropicServer({
      model: MODELS.HAIKU,
      max_tokens: 700,
      system: SHAPER_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
    });
    const parsed = tryParseShaperJSON(response.text || "");
    const shaped = validateShaped(parsed, validKeys);
    if (shaped) return shaped;
    console.warn(`[ChartShaper] LLM output failed validation for ${input.recipe.key}; falling back. Raw: ${(response.text || "").slice(0, 200)}`);
    return FALLBACK_SHAPED(input, "fallback");
  } catch (err: any) {
    console.warn(`[ChartShaper] LLM call failed for ${input.recipe.key}: ${err.message}`);
    return FALLBACK_SHAPED(input, "fallback");
  }
}

export { FALLBACK_SHAPED as buildFallbackShape };
