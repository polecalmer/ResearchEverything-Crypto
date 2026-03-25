/**
 * Cross-Source Validation
 * 
 * Compares agent-generated chart data against reference sources (DeFiLlama, CoinGecko)
 * to detect plausible-but-wrong results that pass basic sanity checks.
 * 
 * This is NOT a user-facing feature. It runs post-execution to gate what enters
 * the proven_queries bank and what gets flagged for the eval loop.
 */

import * as defillama from "../defillama-client";

export interface CrossValidationResult {
  status: "validated" | "warning" | "likely_wrong" | "no_reference";
  ratio: number | null;         // agent_value / reference_value
  referenceValue: number | null;
  agentValue: number | null;
  referenceSource: string | null;
  detail: string;
}

/**
 * Fetch a reference value from DeFiLlama for a given protocol + metric.
 * Returns the most recent data point value, or null if the metric isn't available.
 */
async function getReferenceValue(
  protocol: string,
  metricType: string,
  slug?: string,
): Promise<{ value: number; source: string } | null> {
  const resolvedSlug = slug || await defillama.resolveSlug(protocol).catch(() => null);
  if (!resolvedSlug) return null;

  try {
    switch (metricType) {
      case "tvl": {
        const tvlData = await defillama.getProtocolTvl(resolvedSlug);
        if (tvlData.length === 0) return null;
        const latest = tvlData[tvlData.length - 1];
        return { value: latest.totalLiquidityUSD, source: "defillama_tvl" };
      }

      case "revenue": {
        const rev = await defillama.getProtocolRevenue(resolvedSlug);
        // Use 7d average as reference (more stable than 24h)
        if (rev.total7d) return { value: rev.total7d / 7, source: "defillama_revenue_daily_avg" };
        if (rev.dailyRevenue.length > 0) {
          const last7 = rev.dailyRevenue.slice(-7);
          const avg = last7.reduce((s, d) => s + d.revenue, 0) / last7.length;
          return { value: avg, source: "defillama_revenue_daily_avg" };
        }
        return null;
      }

      case "fees": {
        const fees = await defillama.getProtocolFees(resolvedSlug);
        if (fees.total7d) return { value: fees.total7d / 7, source: "defillama_fees_daily_avg" };
        if (fees.dailyFees.length > 0) {
          const last7 = fees.dailyFees.slice(-7);
          const avg = last7.reduce((s, d) => s + d.fees, 0) / last7.length;
          return { value: avg, source: "defillama_fees_daily_avg" };
        }
        return null;
      }

      case "dex_volume":
      case "volume": {
        try {
          const dexVol = await defillama.getProtocolDexVolume(resolvedSlug);
          if (dexVol.total7d) return { value: dexVol.total7d / 7, source: "defillama_dex_volume_daily_avg" };
          if (dexVol.dailyVolume.length > 0) {
            const last7 = dexVol.dailyVolume.slice(-7);
            const avg = last7.reduce((s, d) => s + d.volume, 0) / last7.length;
            return { value: avg, source: "defillama_dex_volume_daily_avg" };
          }
        } catch {
          // Try derivatives volume
          const derivVol = await defillama.getProtocolDerivativesVolume(resolvedSlug);
          if (derivVol.total7d) return { value: derivVol.total7d / 7, source: "defillama_deriv_volume_daily_avg" };
          if (derivVol.dailyVolume.length > 0) {
            const last7 = derivVol.dailyVolume.slice(-7);
            const avg = last7.reduce((s, d) => s + d.volume, 0) / last7.length;
            return { value: avg, source: "defillama_deriv_volume_daily_avg" };
          }
        }
        return null;
      }

      default:
        return null;
    }
  } catch (err: any) {
    console.warn(`[CrossValidate] Reference fetch failed for ${protocol}/${metricType}: ${err.message}`);
    return null;
  }
}

/**
 * Extract the representative value from agent chart data.
 * Uses median of the most recent 7 data points for stability.
 */
function extractAgentValue(data: any[], chartConfig: any): number | null {
  const yAxes = chartConfig?.yAxes || [];
  const valueKey = yAxes[0]?.dataKey;
  if (!valueKey) return null;

  const values = data
    .map(d => d[valueKey])
    .filter((v: any) => typeof v === "number" && !isNaN(v) && v !== 0);

  if (values.length === 0) return null;

  // Use median of last 7 points
  const recent = values.slice(-7);
  const sorted = [...recent].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Main validation function. Call after a chart query succeeds sanity checks
 * but before saving to proven_queries.
 */
export async function crossSourceValidate(
  protocol: string,
  metricType: string,
  data: any[],
  chartConfig: any,
  slug?: string,
): Promise<CrossValidationResult> {
  const reference = await getReferenceValue(protocol, metricType, slug);

  if (!reference) {
    return { status: "no_reference", ratio: null, referenceValue: null, agentValue: null, referenceSource: null, detail: `No reference source available for ${metricType}` };
  }

  const agentValue = extractAgentValue(data, chartConfig);
  if (!agentValue) {
    return { status: "no_reference", ratio: null, referenceValue: reference.value, agentValue: null, referenceSource: reference.source, detail: "Could not extract numeric value from agent data" };
  }

  const ratio = agentValue / reference.value;
  const detail = `Agent median: ${agentValue.toExponential(2)}, Reference (${reference.source}): ${reference.value.toExponential(2)}, Ratio: ${ratio.toFixed(3)}`;

  // Determine tolerance based on metric type
  // Revenue/fees have more variation between sources than TVL
  const tolerance = metricType === "tvl" ? 0.30 : 0.50;

  if (ratio > (1 - tolerance) && ratio < (1 + tolerance)) {
    console.log(`[CrossValidate] PASS for ${protocol}/${metricType}: ${detail}`);
    return { status: "validated", ratio, referenceValue: reference.value, agentValue, referenceSource: reference.source, detail };
  }

  if (ratio > 0.05 && ratio < 20) {
    console.warn(`[CrossValidate] WARNING for ${protocol}/${metricType}: ${detail}`);
    return { status: "warning", ratio, referenceValue: reference.value, agentValue, referenceSource: reference.source, detail };
  }

  console.warn(`[CrossValidate] LIKELY WRONG for ${protocol}/${metricType}: ${detail}`);
  return { status: "likely_wrong", ratio, referenceValue: reference.value, agentValue, referenceSource: reference.source, detail };
}

/**
 * Fetch full reference time series for benchmark evaluation.
 * Returns data in the same shape the agent produces: { date, value }[]
 */
export async function fetchReferenceTimeSeries(
  protocol: string,
  metricType: string,
  slug?: string,
): Promise<{ date: number; value: number }[] | null> {
  const resolvedSlug = slug || await defillama.resolveSlug(protocol).catch(() => null);
  if (!resolvedSlug) return null;

  try {
    switch (metricType) {
      case "tvl": {
        const data = await defillama.getProtocolTvl(resolvedSlug);
        return data.map(d => ({ date: d.date, value: d.totalLiquidityUSD }));
      }
      case "revenue": {
        const data = await defillama.getProtocolRevenue(resolvedSlug);
        return data.dailyRevenue.map(d => ({ date: d.date, value: d.revenue }));
      }
      case "fees": {
        const data = await defillama.getProtocolFees(resolvedSlug);
        return data.dailyFees.map(d => ({ date: d.date, value: d.fees }));
      }
      case "dex_volume":
      case "volume": {
        try {
          const data = await defillama.getProtocolDexVolume(resolvedSlug);
          return data.dailyVolume.map(d => ({ date: d.date, value: d.volume }));
        } catch {
          const data = await defillama.getProtocolDerivativesVolume(resolvedSlug);
          return data.dailyVolume.map(d => ({ date: d.date, value: d.volume }));
        }
      }
      default:
        return null;
    }
  } catch (err: any) {
    console.warn(`[CrossValidate] Reference time series fetch failed for ${protocol}/${metricType}: ${err.message}`);
    return null;
  }
}
