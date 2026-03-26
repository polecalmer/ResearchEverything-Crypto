/**
 * Eval Scoring
 * 
 * The val_bpb equivalent for the chart agent. Compares agent-generated data
 * against ground truth from reference sources.
 * 
 * Score components:
 * - Magnitude: Is the latest value within tolerance of reference? (40% weight)
 * - Trend: Does the direction match? (20% weight)
 * - Shape: MAPE across overlapping time periods (40% weight)
 */

export interface ScoreResult {
  total: number;                  // 0-1 composite score
  magnitudeScore: number;         // 0 or 1
  magnitudeRatio: number | null;  // agent / reference
  trendScore: number;             // 0 or 1
  agentTrend: "up" | "down" | "flat" | null;
  referenceTrend: "up" | "down" | "flat" | null;
  shapeScore: number;             // 0-1
  mape: number | null;            // mean absolute percentage error
  reason: string;
}

export interface EvalCaseResult {
  caseId: string;
  score: ScoreResult;
  executionSuccess: boolean;
  sanityPassed: boolean;
  dataSource: string | null;
  sqlUsed: string | null;
  errorMessage: string | null;
  errorCategory: "agent" | "infrastructure" | null;  // null = success
  latencyMs: number;
  llmCalls: number;
}

interface DataPoint {
  date: number;
  value: number;
}

/**
 * Compute trend direction from a time series.
 * Uses linear regression slope normalized by mean.
 */
function computeTrend(data: DataPoint[]): "up" | "down" | "flat" {
  if (data.length < 3) return "flat";

  // Use last 30 points or all if fewer
  const recent = data.slice(-30);
  const n = recent.length;
  const mean = recent.reduce((s, d) => s + d.value, 0) / n;

  if (mean === 0) return "flat";

  // Simple linear regression
  let sumXY = 0, sumX = 0, sumY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumXY += i * recent[i].value;
    sumX += i;
    sumY += recent[i].value;
    sumX2 += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const normalizedSlope = slope / mean;

  // Threshold: ±5% slope relative to mean counts as flat
  if (normalizedSlope > 0.05) return "up";
  if (normalizedSlope < -0.05) return "down";
  return "flat";
}

/**
 * Align two time series by finding overlapping date ranges.
 * Matches by nearest date within a tolerance window.
 */
function alignTimeSeries(
  agent: DataPoint[],
  reference: DataPoint[],
  toleranceSec: number = 86400 * 2, // 2 day tolerance
): { agentValue: number; referenceValue: number }[] {
  const aligned: { agentValue: number; referenceValue: number }[] = [];

  for (const agentPoint of agent) {
    // Find nearest reference point
    let nearest: DataPoint | null = null;
    let nearestDist = Infinity;

    for (const refPoint of reference) {
      const dist = Math.abs(agentPoint.date - refPoint.date);
      if (dist < nearestDist) {
        nearest = refPoint;
        nearestDist = dist;
      }
    }

    if (nearest && nearestDist <= toleranceSec) {
      aligned.push({
        agentValue: agentPoint.value,
        referenceValue: nearest.value,
      });
    }
  }

  return aligned;
}

/**
 * Mean Absolute Percentage Error across aligned points.
 */
function computeMAPE(aligned: { agentValue: number; referenceValue: number }[]): number {
  if (aligned.length === 0) return 100;

  const errors = aligned
    .filter(p => p.referenceValue !== 0)
    .map(p => Math.abs(p.agentValue - p.referenceValue) / Math.abs(p.referenceValue));

  if (errors.length === 0) return 100;
  return (errors.reduce((s, e) => s + e, 0) / errors.length) * 100;
}

/**
 * Normalize agent chart data into { date, value }[] format.
 * Handles different xAxis/yAxis configurations.
 */
export function normalizeAgentData(data: any[], chartConfig: any): DataPoint[] {
  if (!data || data.length === 0) return [];

  const xKey = chartConfig?.xAxis?.dataKey || "date";
  const yAxes = chartConfig?.yAxes || [];
  const yKey = yAxes[0]?.dataKey;

  if (!yKey) {
    // Try to find a numeric column that isn't the date
    const cols = Object.keys(data[0] || {});
    const numericCol = cols.find(c => c !== xKey && typeof data[0][c] === "number");
    if (!numericCol) return [];
    return data
      .map(d => ({ date: normalizeDate(d[xKey]), value: d[numericCol] }))
      .filter(d => !isNaN(d.date) && !isNaN(d.value));
  }

  return data
    .map(d => ({ date: normalizeDate(d[xKey]), value: d[yKey] }))
    .filter(d => !isNaN(d.date) && !isNaN(d.value) && d.value !== 0);
}

/** Normalize various date formats to unix timestamp (seconds) */
function normalizeDate(val: any): number {
  if (typeof val === "number") {
    // Already a timestamp — might be seconds or milliseconds
    if (val > 1e12) return val / 1000; // milliseconds
    if (val > 1e9) return val;         // seconds
    return NaN;
  }
  if (typeof val === "string") {
    const ts = new Date(val).getTime() / 1000;
    return isNaN(ts) ? NaN : ts;
  }
  return NaN;
}

/**
 * Score agent output against reference data.
 * This is the core loss function for the autoresearch loop.
 */
// ═══════════════════════════════════════════════════════════════
// COMPOUND SCORING — for multi-metric and derived metric cases
// ═══════════════════════════════════════════════════════════════

export interface CompoundScoreResult {
  total: number;                  // 0-1 composite score
  completenessScore: number;      // fraction of required metrics produced
  subMetricScores: {
    metricType: string;
    score: ScoreResult;
    matched: boolean;
  }[];
  missingMetrics: string[];
  reason: string;
}

/** Keyword map for matching agent chart outputs to reference sub-metrics */
const METRIC_KEYWORDS: Record<string, string[]> = {
  tvl: ["tvl", "total_value_locked", "totalLiquidityUSD", "liquidity", "tvl_usd"],
  revenue: ["revenue", "daily_revenue", "weekly_revenue", "monthly_revenue", "protocol_revenue", "earnings"],
  fees: ["fees", "daily_fees", "weekly_fees", "total_fees", "fee"],
  price: ["price", "token_price", "avg_price", "close", "usd_price"],
  pe_ratio: ["pe_ratio", "p_e_ratio", "pe", "price_to_earnings", "price_earnings"],
  mcap: ["mcap", "market_cap", "market_capitalization", "fdv", "approx_mcap"],
  volume: ["volume", "daily_volume", "weekly_volume", "amount_usd", "trade_volume"],
  arr: ["arr", "annualized", "annualized_revenue", "annualized_fees"],
  usde_supply: ["usde_supply", "supply", "total_supply", "circulating_supply"],
};

/**
 * Match an agent chart plan to a sub-metric type using title + yAxis keywords.
 * Returns the best-matching metric type, or null if no match.
 */
function matchPlanToMetric(plan: any, availableMetrics: string[]): string | null {
  const title = (plan.title || "").toLowerCase();
  const yKeys = (plan.chartConfig?.yAxes || []).map((y: any) => (y.dataKey || "").toLowerCase());
  const yLabels = (plan.chartConfig?.yAxes || []).map((y: any) => (y.label || "").toLowerCase());
  const allText = [title, ...yKeys, ...yLabels].join(" ");

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const metric of availableMetrics) {
    const keywords = METRIC_KEYWORDS[metric] || [metric];
    let matchScore = 0;
    for (const kw of keywords) {
      if (allText.includes(kw)) matchScore++;
    }
    if (matchScore > bestScore) {
      bestScore = matchScore;
      bestMatch = metric;
    }
  }

  return bestMatch;
}

/**
 * Score a compound query result — multiple agent charts scored against
 * multiple reference datasets.
 */
export function scoreCompoundResult(
  agentPlans: any[],
  agentDataSets: { planIndex: number; data: DataPoint[] }[],
  referenceDataSets: { metricType: string; data: DataPoint[] }[],
  tolerance: number = 0.30,
): CompoundScoreResult {
  const requiredMetrics = referenceDataSets.map(r => r.metricType);
  const matched: Map<string, { planIndex: number; data: DataPoint[] }> = new Map();
  const remainingMetrics = new Set(requiredMetrics);
  const remainingPlans = new Set(agentDataSets.map(d => d.planIndex));

  // Greedy match: for each reference metric, find the best-matching agent chart
  for (const refDS of referenceDataSets) {
    let bestPlanIdx: number | null = null;
    let bestScore = -1;

    for (const agentDS of agentDataSets) {
      if (!remainingPlans.has(agentDS.planIndex)) continue;
      // Try keyword match first
      const plan = agentPlans[agentDS.planIndex];
      const matchedMetric = matchPlanToMetric(plan, [refDS.metricType]);
      if (matchedMetric) {
        // Score it to see if the data actually matches
        const testScore = scoreResult(agentDS.data, refDS.data, tolerance);
        if (testScore.total > bestScore) {
          bestScore = testScore.total;
          bestPlanIdx = agentDS.planIndex;
        }
      }
    }

    // If keyword match failed, try scoring all remaining plans against this reference
    if (bestPlanIdx === null) {
      for (const agentDS of agentDataSets) {
        if (!remainingPlans.has(agentDS.planIndex)) continue;
        if (agentDS.data.length === 0) continue;
        const testScore = scoreResult(agentDS.data, refDS.data, tolerance);
        if (testScore.total > bestScore) {
          bestScore = testScore.total;
          bestPlanIdx = agentDS.planIndex;
        }
      }
    }

    if (bestPlanIdx !== null && bestScore > 0) {
      const agentDS = agentDataSets.find(d => d.planIndex === bestPlanIdx)!;
      matched.set(refDS.metricType, agentDS);
      remainingMetrics.delete(refDS.metricType);
      remainingPlans.delete(bestPlanIdx);
    }
  }

  // Score each matched pair
  const subMetricScores: CompoundScoreResult["subMetricScores"] = [];
  for (const refDS of referenceDataSets) {
    const agentDS = matched.get(refDS.metricType);
    if (agentDS) {
      const score = scoreResult(agentDS.data, refDS.data, tolerance);
      subMetricScores.push({ metricType: refDS.metricType, score, matched: true });
    } else {
      subMetricScores.push({
        metricType: refDS.metricType,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: "Missing — agent did not produce this metric" },
        matched: false,
      });
    }
  }

  const completenessScore = (requiredMetrics.length - remainingMetrics.size) / requiredMetrics.length;
  const avgSubScore = subMetricScores.reduce((s, m) => s + m.score.total, 0) / requiredMetrics.length;
  const total = completenessScore * 0.3 + avgSubScore * 0.7;

  const missingMetrics = Array.from(remainingMetrics);
  const subReasons = subMetricScores.map(s =>
    `${s.metricType}: ${s.matched ? `${(s.score.total * 100).toFixed(0)}%` : "MISSING"}`
  );
  const reason = `Completeness: ${(completenessScore * 100).toFixed(0)}% (${requiredMetrics.length - missingMetrics.length}/${requiredMetrics.length}) | ${subReasons.join(", ")}`;

  return { total, completenessScore, subMetricScores, missingMetrics, reason };
}

// ═══════════════════════════════════════════════════════════════
// SINGLE-METRIC SCORING
// ═══════════════════════════════════════════════════════════════

export function scoreResult(
  agentData: DataPoint[],
  referenceData: DataPoint[],
  tolerance: number = 0.20,
): ScoreResult {
  // Edge case: no agent data
  if (agentData.length === 0) {
    return {
      total: 0,
      magnitudeScore: 0,
      magnitudeRatio: null,
      trendScore: 0,
      agentTrend: null,
      referenceTrend: null,
      shapeScore: 0,
      mape: null,
      reason: "No agent data",
    };
  }

  // Edge case: no reference data
  if (referenceData.length === 0) {
    return {
      total: 0,
      magnitudeScore: 0,
      magnitudeRatio: null,
      trendScore: 0,
      agentTrend: null,
      referenceTrend: null,
      shapeScore: 0,
      mape: null,
      reason: "No reference data",
    };
  }

  // 1. Magnitude check — latest agent value vs latest reference value
  const latestAgent = agentData[agentData.length - 1].value;
  const latestRef = referenceData[referenceData.length - 1].value;
  const magnitudeRatio = latestRef !== 0 ? latestAgent / latestRef : null;
  const magnitudeScore = magnitudeRatio !== null &&
    magnitudeRatio > (1 - tolerance) &&
    magnitudeRatio < (1 + tolerance) ? 1 : 0;

  // 2. Trend check
  const agentTrend = computeTrend(agentData);
  const referenceTrend = computeTrend(referenceData);
  const trendScore = agentTrend === referenceTrend ? 1 : 0;

  // 3. Shape check — MAPE across overlapping periods
  // Use wider tolerance for date matching if agent uses weekly and reference uses daily
  const agentInterval = agentData.length > 1
    ? (agentData[agentData.length - 1].date - agentData[0].date) / (agentData.length - 1)
    : 86400;
  const matchTolerance = Math.max(86400 * 2, agentInterval * 1.5);

  const aligned = alignTimeSeries(agentData, referenceData, matchTolerance);
  const mape = aligned.length >= 3 ? computeMAPE(aligned) : null;
  // 0% MAPE = 1.0, 100% MAPE = 0.0, capped
  const shapeScore = mape !== null ? Math.max(0, 1 - (mape / 100)) : 0;

  const total = (magnitudeScore * 0.4) + (trendScore * 0.2) + (shapeScore * 0.4);

  const reason = [
    `Magnitude: ${magnitudeScore ? "PASS" : "FAIL"} (ratio: ${magnitudeRatio?.toFixed(3) || "N/A"}, tolerance: ±${(tolerance * 100).toFixed(0)}%)`,
    `Trend: ${trendScore ? "PASS" : "FAIL"} (agent: ${agentTrend}, ref: ${referenceTrend})`,
    `Shape: ${shapeScore.toFixed(2)} (MAPE: ${mape?.toFixed(1) || "N/A"}%, aligned points: ${aligned.length})`,
  ].join(" | ");

  return {
    total,
    magnitudeScore,
    magnitudeRatio,
    trendScore,
    agentTrend,
    referenceTrend,
    shapeScore,
    mape,
    reason,
  };
}
