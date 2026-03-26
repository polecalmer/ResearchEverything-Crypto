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
 * Fetch reference data for a derived metric (e.g. P/E ratio).
 * P/E = market_cap / annualized_revenue
 *
 * Revenue from DeFiLlama, price from CoinGecko (via DeFiLlama coins API).
 * We compute weekly P/E: trailing 30d revenue annualized × price-implied mcap.
 */
export async function fetchDerivedReference(
  protocol: string,
  metricType: string,
  slug?: string,
  coinId?: string,
): Promise<{ date: number; value: number }[] | null> {
  if (metricType !== "pe_ratio" || !coinId) return null;

  // Canonical CoinGecko ID mapping — price + mcap must come from SAME token
  const COIN_MAP: Record<string, string> = {
    ethena: "ethena", aave: "aave", uniswap: "uniswap",
    "lido-dao": "lido-dao", lido: "lido-dao", morpho: "morpho",
    makerdao: "sky", maker: "sky", sky: "sky",
  };
  const resolvedCoinId = COIN_MAP[coinId.toLowerCase()] || COIN_MAP[slug?.toLowerCase() || ""] || coinId;

  // Revenue slug fallbacks (same as executePeRatio)
  const REVENUE_SLUGS: Record<string, string[]> = {
    makerdao: ["makerdao", "maker", "sky"],
    maker: ["maker", "makerdao", "sky"],
  };
  const resolvedSlug = slug || await defillama.resolveSlug(protocol).catch(() => null);
  if (!resolvedSlug) return null;
  const revSlugs = REVENUE_SLUGS[resolvedSlug.toLowerCase()] || [resolvedSlug];

  try {
    // Fetch revenue from DeFiLlama (with slug fallbacks)
    let dailyRev: { date: number; revenue: number }[] = [];
    for (const rs of revSlugs) {
      try {
        const revData = await defillama.getProtocolRevenue(rs);
        const parsed = (revData.dailyRevenue || [])
          .map((d: any) => ({ date: d.date, revenue: d.revenue || d.value || 0 }))
          .filter((d: any) => d.revenue > 0);
        if (parsed.length > dailyRev.length) {
          dailyRev = parsed;
          break;
        }
      } catch {}
    }
    if (dailyRev.length < 30) return null;
    dailyRev.sort((a, b) => a.date - b.date);

    // Fetch price history from DeFiLlama coins API (same token as mcap)
    const priceData = await defillama.getCoinPriceHistory(resolvedCoinId, 365);
    if (!priceData.prices.length) return null;

    // Fetch current mcap from CoinGecko simple/price (same token)
    const cgData: any = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${resolvedCoinId}&vs_currencies=usd&include_market_cap=true`
    ).then(r => r.json()).catch(() => ({}));
    const cgEntry = cgData[resolvedCoinId];
    if (!cgEntry?.usd_market_cap || cgEntry.usd_market_cap <= 0 || !cgEntry.usd || cgEntry.usd <= 0) return null;

    // mcapScaleFactor = mcap / price (constant supply assumption)
    const mcapScale = cgEntry.usd_market_cap / cgEntry.usd;

    // Compute rolling 30d annualized revenue
    const rolling: Map<number, number> = new Map();
    for (let i = 29; i < dailyRev.length; i++) {
      let sum30d = 0;
      for (let j = i - 29; j <= i; j++) {
        sum30d += dailyRev[j].revenue;
      }
      // Annualize: (30-day sum / 30) × 365
      rolling.set(dailyRev[i].date, (sum30d / 30) * 365);
    }

    // Build P/E time series: for each price point, find nearest rolling revenue
    const rollingDates = Array.from(rolling.keys());
    const result: { date: number; value: number }[] = [];

    for (const pp of priceData.prices) {
      const nearest = findNearestDate(pp.date, rollingDates, 86400 * 4);
      if (nearest === null) continue;
      const annualRev = rolling.get(nearest);
      if (!annualRev || annualRev <= 0) continue;

      const mcap = pp.price * mcapScale;
      const pe = mcap / annualRev;

      if (pe > 0 && pe < 100000) {
        result.push({ date: pp.date, value: pe });
      }
    }

    console.log(`[CrossValidate] Derived P/E reference for ${protocol}: ${result.length} points, coinId=${resolvedCoinId}, mcapScale=${mcapScale.toFixed(0)}`);
    return result.length > 5 ? result : null;
  } catch (err: any) {
    console.warn(`[CrossValidate] Derived reference fetch failed for ${protocol}/${metricType}: ${err.message}`);
    return null;
  }
}

function findNearestDate(target: number, dates: number[], maxDist: number): number | null {
  let nearest: number | null = null;
  let minDist = Infinity;
  for (const d of dates) {
    const dist = Math.abs(target - d);
    if (dist < minDist) {
      minDist = dist;
      nearest = d;
    }
  }
  return minDist <= maxDist ? nearest : null;
}

/**
 * Fetch multiple reference time series for compound financial statements.
 * Returns array of { metricType, data } for each available metric.
 */
export async function fetchCompoundReference(
  protocol: string,
  slug?: string,
  metrics: string[] = ["revenue", "fees", "tvl"],
): Promise<{ metricType: string; data: { date: number; value: number }[] }[]> {
  const results: { metricType: string; data: { date: number; value: number }[] }[] = [];

  for (const metric of metrics) {
    try {
      const data = await fetchReferenceTimeSeries(protocol, metric, slug);
      if (data && data.length > 0) {
        results.push({ metricType: metric, data });
      }
    } catch (err: any) {
      console.warn(`[CrossValidate] Compound reference fetch failed for ${protocol}/${metric}: ${err.message}`);
    }
  }

  return results;
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
      case "price": {
        // For price reference, extract coinId from slug or use the slug directly
        const coinId = resolvedSlug;
        const priceData = await defillama.getCoinPriceHistory(coinId, 365);
        return priceData.prices.map(p => ({ date: p.date, value: p.price }));
      }
      default:
        return null;
    }
  } catch (err: any) {
    console.warn(`[CrossValidate] Reference time series fetch failed for ${protocol}/${metricType}: ${err.message}`);
    return null;
  }
}
