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
export type ShapedChartType = "line" | "bar" | "area" | "composed";

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

1. CHART FORM: chartType ("line" | "bar" | "area" | "composed"), smoothing ("none" | "7dma" | "30dma"), axisLayout ("single" | "dual").
   - Prefer "area" or "line" for continuous % / ratio / currency over time.
   - Apply 7dma when CV ≥ 0.25 and length ≥ 21. Apply 30dma when CV ≥ 0.5 and length ≥ 90. Otherwise "none".
   - Use "dual" axis only when two series have very different scales/units.

2. ANNOTATIONS: 0–3 callout points worth surfacing (peak, trough, regime change, large single-day spike). Each annotation MUST reference an exact { date, value } from the provided stats (use min/max/last) and name the series it belongs to. Skip if nothing is meaningfully callout-worthy.

3. PROSE: A SHORT (≤ 110 words) paragraph that:
   - Leads with the headline number (peak %, latest value, average, etc.) using the EXACT formatted values from stats.
   - Calls out a specific spike or regime change with its date when one exists in stats.
   - Cites at least one structural insight from the research context when provided (e.g. "RWA perps charge tighter fee rates" → explains why fee share lags volume share).
   - Uses **bold** for emphasis on key numbers. No headers, no bullet lists.

Return ONLY valid JSON matching this exact schema (no prose outside the JSON, no markdown code fences):
{
  "chartType": "line" | "bar" | "area" | "composed",
  "smoothing": "none" | "7dma" | "30dma",
  "axisLayout": "single" | "dual",
  "annotations": [{"date": "YYYY-MM-DD", "value": <number>, "label": "<≤60 chars>", "series": "<dataKey>"}],
  "prose": "<paragraph>"
}`;

const FALLBACK_SHAPED = (input: ShaperInput, source: "fallback" | "brain"): ShapedChart => {
  // Mimic the prior hardcoded summary so we never regress.
  const primary = input.stats.series[0];
  const fmtVal = (v: number) => FMT(v, input.recipe.format);
  const ticker = (input.ticker || input.protocol).toUpperCase();
  const trend = primary?.trend === "rising" ? "rising" : primary?.trend === "falling" ? "declining" : "flat";
  const latestStr = primary?.last ? fmtVal(primary.last.value) : "—";
  const firstStr = primary?.first ? fmtVal(primary.first.value) : "—";
  const proseParts = [
    `**${ticker}** ${input.recipe.displayLabel}: **${latestStr}** (${trend} from ${firstStr} over the window).`,
  ];
  if (input.stats.series.length > 1 && input.stats.series[1]?.last) {
    proseParts.push(`${input.stats.series[1].label}: **${fmtVal(input.stats.series[1].last.value)}**.`);
  }
  return {
    chartType: input.recipe.chartType,
    smoothing: "none",
    axisLayout: input.stats.series.length > 1 ? "dual" : "single",
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
  if (!["line", "bar", "area", "composed"].includes(chartType)) return null;
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
