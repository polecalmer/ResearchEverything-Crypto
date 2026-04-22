/**
 * Series-stats utility — pure functions over computed chart data.
 *
 * Inputs are the rows produced by `computeDerivedChart` (`{ date, <metric>: number, ... }`)
 * plus the recipe's `yAxes` mapping. Output is a deterministic stats summary
 * the chart shaper can feed to the LLM so prose and annotation choices use
 * real numbers from the data, not hand-coded heuristics.
 *
 * No I/O, no LLM, no side effects.
 */

import type { ComputeResult } from "./derived-metrics";

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesStats {
  /** yAxis dataKey this stat block describes. */
  dataKey: string;
  /** Human label for the series (from yAxes[i].label). */
  label: string;
  /** Number of finite data points (excludes NaN/null/undefined). */
  length: number;
  first: SeriesPoint | null;
  last: SeriesPoint | null;
  min: SeriesPoint | null;
  max: SeriesPoint | null;
  mean: number;
  median: number;
  stdev: number;
  /** Coefficient of variation (stdev / |mean|). High = noisy.  */
  cv: number;
  /** Trend direction over the full window: "rising" | "falling" | "flat". */
  trend: "rising" | "falling" | "flat";
  /** % change from first to last point (null when first is 0). */
  pctChange: number | null;
  /** Recommended smoothing window for this series (heuristic only — the
   *  shaper LLM is free to override). */
  recommendedSmoothing: "none" | "7dma" | "30dma";
}

export interface CrossSeriesStats {
  /** Pearson correlation of the two yAxes when paired by date (-1..1). */
  correlation: number | null;
  /** "a > b" / "b > a" / "mixed" — true when one series is consistently
   *  greater than the other across ≥ 80% of dates. */
  persistentGap: { dominant: string; followers: string; coverage: number } | null;
}

export interface ChartSeriesStats {
  /** Per-series stats in the same order as the input yAxes. */
  series: SeriesStats[];
  /** Pairwise stats when there are ≥ 2 series; otherwise null. */
  cross: CrossSeriesStats | null;
}

const finite = (v: any): v is number =>
  typeof v === "number" && Number.isFinite(v);

function computeSeriesStats(
  rows: ComputeResult[],
  axis: { dataKey: string; label: string },
): SeriesStats {
  const points: SeriesPoint[] = [];
  for (const row of rows) {
    const v = (row as any)[axis.dataKey];
    if (finite(v)) points.push({ date: String(row.date), value: v });
  }
  if (points.length === 0) {
    return {
      dataKey: axis.dataKey,
      label: axis.label,
      length: 0,
      first: null,
      last: null,
      min: null,
      max: null,
      mean: 0,
      median: 0,
      stdev: 0,
      cv: 0,
      trend: "flat",
      pctChange: null,
      recommendedSmoothing: "none",
    };
  }

  let min = points[0];
  let max = points[0];
  let sum = 0;
  for (const p of points) {
    if (p.value < min.value) min = p;
    if (p.value > max.value) max = p;
    sum += p.value;
  }
  const mean = sum / points.length;
  const sorted = [...points.map((p) => p.value)].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  let varSum = 0;
  for (const p of points) varSum += (p.value - mean) ** 2;
  const stdev = Math.sqrt(varSum / points.length);
  const cv = mean === 0 ? 0 : stdev / Math.abs(mean);

  const first = points[0];
  const last = points[points.length - 1];
  const pctChange = first.value === 0 ? null : ((last.value - first.value) / Math.abs(first.value)) * 100;
  // Trend: compare first-quartile mean to last-quartile mean to dampen
  // single-day noise dominating direction.
  const q = Math.max(1, Math.floor(points.length / 4));
  const earlyMean = points.slice(0, q).reduce((s, p) => s + p.value, 0) / q;
  const lateMean = points.slice(-q).reduce((s, p) => s + p.value, 0) / q;
  const trendThreshold = Math.abs(mean) * 0.05; // 5% of mean magnitude
  const trend: SeriesStats["trend"] =
    lateMean - earlyMean > trendThreshold
      ? "rising"
      : earlyMean - lateMean > trendThreshold
        ? "falling"
        : "flat";

  // Smoothing recommendation: enough points to smooth meaningfully AND noisy.
  let recommendedSmoothing: SeriesStats["recommendedSmoothing"] = "none";
  if (points.length >= 21 && cv >= 0.25) recommendedSmoothing = "7dma";
  if (points.length >= 90 && cv >= 0.5) recommendedSmoothing = "30dma";

  return {
    dataKey: axis.dataKey,
    label: axis.label,
    length: points.length,
    first,
    last,
    min,
    max,
    mean,
    median,
    stdev,
    cv,
    trend,
    pctChange,
    recommendedSmoothing,
  };
}

function computeCrossStats(
  rows: ComputeResult[],
  axes: Array<{ dataKey: string; label: string }>,
): CrossSeriesStats | null {
  if (axes.length < 2) return null;
  const a = axes[0];
  const b = axes[1];

  const paired: Array<{ a: number; b: number }> = [];
  for (const row of rows) {
    const av = (row as any)[a.dataKey];
    const bv = (row as any)[b.dataKey];
    if (finite(av) && finite(bv)) paired.push({ a: av, b: bv });
  }
  if (paired.length < 3) return { correlation: null, persistentGap: null };

  const meanA = paired.reduce((s, p) => s + p.a, 0) / paired.length;
  const meanB = paired.reduce((s, p) => s + p.b, 0) / paired.length;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (const p of paired) {
    const da = p.a - meanA;
    const db = p.b - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const correlation =
    denA === 0 || denB === 0 ? null : num / Math.sqrt(denA * denB);

  let aWins = 0;
  let bWins = 0;
  for (const p of paired) {
    if (p.a > p.b) aWins++;
    else if (p.b > p.a) bWins++;
  }
  const total = paired.length;
  let persistentGap: CrossSeriesStats["persistentGap"] = null;
  if (aWins / total >= 0.8) {
    persistentGap = { dominant: a.label || a.dataKey, followers: b.label || b.dataKey, coverage: aWins / total };
  } else if (bWins / total >= 0.8) {
    persistentGap = { dominant: b.label || b.dataKey, followers: a.label || a.dataKey, coverage: bWins / total };
  }

  return { correlation, persistentGap };
}

export function computeChartStats(
  rows: ComputeResult[],
  yAxes: Array<{ dataKey: string; label: string }>,
): ChartSeriesStats {
  const series = yAxes.map((a) => computeSeriesStats(rows, a));
  const cross = computeCrossStats(rows, yAxes);
  return { series, cross };
}

/** Apply a trailing simple moving average to each yAxis series in place,
 *  returning a NEW row array so the caller's data isn't mutated. The
 *  smoothed value replaces the raw value under the same dataKey so the
 *  client can render the smoothed series without renderer changes.
 *  Edge dates (where the trailing window isn't fully populated) keep the
 *  partial-window mean so the chart starts at the first date. */
export function applySmoothing(
  rows: ComputeResult[],
  yAxisDataKeys: string[],
  windowDays: number,
): ComputeResult[] {
  if (windowDays <= 1 || rows.length === 0) return rows;
  const out = rows.map((r) => ({ ...r }));
  for (const key of yAxisDataKeys) {
    for (let i = 0; i < out.length; i++) {
      const start = Math.max(0, i - windowDays + 1);
      let sum = 0;
      let count = 0;
      for (let j = start; j <= i; j++) {
        const v = (rows[j] as any)[key];
        if (finite(v)) {
          sum += v;
          count++;
        }
      }
      // When the trailing window has no finite values, preserve the original
      // cell verbatim — fabricating a 0 here would draw artificial drops on
      // sparse series and trick downstream sanity checks into accepting
      // missing data as real zeros.
      if (count > 0) {
        (out[i] as any)[key] = sum / count;
      } else {
        (out[i] as any)[key] = (rows[i] as any)[key];
      }
    }
  }
  return out;
}
