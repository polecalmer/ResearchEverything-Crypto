/**
 * Y-axis policy inference for chart artifacts.
 *
 * Purpose: when a series has a wide dynamic range (token discovery
 * arcs, illiquid early-stage prices, anomalous spikes), a linear Y-axis
 * crushes most of the data into a flat line. This module computes the
 * right axis policy ("linear" vs "log", plus optional explicit domain)
 * from the data alone — no LLM, no I/O.
 *
 * Triggering case: "SERV Price — Last 200 Days" rendered as a flat
 * line at $0 because one print near $4 dominated the auto-scale while
 * the median was $0.02 (max/median = 200×). The user saw 199 illegible
 * points pinned to the bottom of the axis.
 *
 * Policy (in priority order):
 *   1. Negative or zero values present → force "linear"
 *      (log scale can't represent ≤0; protects PnL series).
 *   2. max/median ≥ 50 AND all values > 0 → "log"
 *      (the SERV case lands here).
 *   3. max/p99 ≥ 5 AND values > 0 → "log"
 *      (single outlier hypothesis; log still cleaner than linear).
 *   4. Default → "linear".
 *
 * The caller decides whether to MUTATE an artifact or just RECOMMEND.
 * This module returns the recommendation; the validator wires it in.
 */

export type YAxisScale = "linear" | "log";

export interface YAxisPolicy {
  scale: YAxisScale;
  /** Optional explicit domain. When omitted, the renderer should pass
   *  ["auto", "auto"] to Recharts so the chart auto-fits. Reserved for
   *  future "clip to p99" mode; not used by the default policy today. */
  domain?: [number | "auto", number | "auto"];
  /** Short, human-readable explanation of why this policy was chosen.
   *  Stored on the artifact's evidence so we have telemetry on how often
   *  each branch fires in production. */
  reasoning: string;
}

/** Configurable thresholds (defaults match the documented heuristics). */
export interface YAxisPolicyOptions {
  /** Trigger log scale when max/median ≥ this. Default 50. */
  maxOverMedianTrigger?: number;
  /** Trigger log scale when max/p99 ≥ this (single-outlier case). Default 5. */
  maxOverP99Trigger?: number;
}

const DEFAULT_OPTS: Required<YAxisPolicyOptions> = {
  maxOverMedianTrigger: 50,
  maxOverP99Trigger: 5,
};

/** Numeric percentile of a finite-only array. Caller filters NaN beforehand. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Infer the Y-axis policy for a single series.
 *
 * `values` should be the raw numeric data points (any non-finite entries
 * are filtered locally before stats). `format` is informational; the
 * policy does not currently branch on it but the param is kept so the
 * signature is stable when we add per-format heuristics (e.g. percent
 * series should never go log, regardless of range).
 */
export function inferYAxisPolicy(
  values: ReadonlyArray<number | null | undefined>,
  format?: string,
  opts: YAxisPolicyOptions = {},
): YAxisPolicy {
  const { maxOverMedianTrigger, maxOverP99Trigger } = { ...DEFAULT_OPTS, ...opts };

  // Filter to finite numbers — defensive even if caller already did so.
  const finite: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) finite.push(v);
  }

  if (finite.length === 0) {
    return { scale: "linear", reasoning: "no finite values" };
  }

  // Percent series should never go log — small percentages with one
  // 100% reading is normal, not pathology.
  if (format === "percent" || format === "basisPoints") {
    return { scale: "linear", reasoning: `format=${format} (forced linear)` };
  }

  // Branch 1: any non-positive value disqualifies log scale.
  let min = finite[0];
  let max = finite[0];
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min <= 0) {
    return {
      scale: "linear",
      reasoning: min < 0
        ? `contains negative values (min=${min})`
        : `contains zero values (cannot use log)`,
    };
  }

  // All positive — safe to compute log-scale heuristics.
  const sorted = [...finite].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p99 = percentile(sorted, 0.99);

  // Guard against degenerate stats (median = 0 already covered by min<=0).
  if (median > 0 && max / median >= maxOverMedianTrigger) {
    return {
      scale: "log",
      reasoning: `max/median=${(max / median).toFixed(1)} ≥ ${maxOverMedianTrigger} (wide range)`,
    };
  }

  if (p99 > 0 && max / p99 >= maxOverP99Trigger) {
    return {
      scale: "log",
      reasoning: `max/p99=${(max / p99).toFixed(1)} ≥ ${maxOverP99Trigger} (single outlier)`,
    };
  }

  return {
    scale: "linear",
    reasoning: `max/median=${(max / median).toFixed(1)} within linear range`,
  };
}

/**
 * End-to-end enforcement: scan a response text for chart artifact code
 * fences, compute stats from each chart's data, infer the axis policy,
 * and re-serialize the fence with `scale`/`domain` set when needed.
 *
 * This is the standalone version of the chart-validator's
 * applyAxisPolicy + applyAxisPolicyToText pair, packaged so that paths
 * which DON'T run the full chart validator (deep-mode agent emissions,
 * parallel-branch chart drops) still get the SERV outlier-crush fix.
 *
 * Idempotent. If a yAxis already has `scale` set (agent-provided),
 * we leave it alone. If no chart fence is present, returns input
 * unchanged. Malformed JSON is tolerated — we skip that fence.
 *
 * Logs each auto-application so we have telemetry on coverage of the
 * deep-mode chart path (which previously bypassed the policy entirely).
 */
export function enforceChartAxisPolicy(text: string): string {
  if (!text || typeof text !== "string") return text;
  // Cheap pre-check — avoid the regex allocation on the common no-chart
  // path (every deep-mode response runs through this).
  if (!text.includes("```artifact:chart")) return text;

  const fenceRe = /(```artifact:chart\s*\n)([\s\S]*?)(```)/g;
  let result = text;
  let match: RegExpExecArray | null;
  // Collect mutations then apply in a second pass so the regex offsets
  // don't shift during iteration.
  const replacements: Array<{ original: string; replacement: string }> = [];

  while ((match = fenceRe.exec(text)) !== null) {
    const fullFence = match[0];
    let json: any;
    try {
      json = JSON.parse(match[2].trim());
    } catch {
      continue; // skip malformed
    }
    if (!Array.isArray(json.yAxes) || json.yAxes.length === 0) continue;
    const rows: any[] = Array.isArray(json.data) ? json.data : [];
    if (rows.length === 0) continue;

    let mutated = false;
    for (const yAxis of json.yAxes) {
      if (!yAxis?.dataKey) continue;
      // Respect agent-provided scale.
      if (yAxis.scale === "linear" || yAxis.scale === "log") continue;
      const values: number[] = [];
      for (const row of rows) {
        const v = row?.[yAxis.dataKey];
        if (typeof v === "number" && Number.isFinite(v)) values.push(v);
      }
      if (values.length === 0) continue;

      const policy = inferYAxisPolicy(values, yAxis.format);
      if (policy.scale !== "linear") {
        yAxis.scale = policy.scale;
        if (policy.domain) yAxis.domain = policy.domain;
        mutated = true;
        console.log(
          `[chart-axis-policy] auto-applied scale=${policy.scale} to yAxis "${yAxis.dataKey}" — ${policy.reasoning}`,
        );
      }
    }

    if (mutated) {
      const newFence = `${match[1]}${JSON.stringify(json, null, 2)}\n${match[3]}`;
      replacements.push({ original: fullFence, replacement: newFence });
    }
  }

  for (const { original, replacement } of replacements) {
    result = result.replace(original, replacement);
  }
  return result;
}
