import type * as DefiLlamaModule from "../defillama-client";
type DefiLlamaClient = typeof DefiLlamaModule;

export type DataSourceKey =
  | "defillama.revenue"
  | "defillama.fees"
  | "defillama.tvl"
  | "defillama.dex_volume"
  | "defillama.derivatives_volume"
  | "defillama.yield_pools"
  | "coingecko.price"
  | "coingecko.market_data";

export type MetricFormat = "ratio" | "currency" | "percent" | "number";

export interface DerivedMetricRecipe {
  key: string;
  displayLabel: string;
  description: string;
  sources: DataSourceKey[];
  trailingWindowDays: number;
  chartType: "line" | "bar" | "area";
  format: MetricFormat;
  yAxes: Array<{ dataKey: string; label: string }>;
  compute: (ctx: ComputeContext) => ComputeResult[];
}

export interface ComputeContext {
  revenue: Map<string, number>;
  fees: Map<string, number>;
  tvl: Map<string, number>;
  volume: Map<string, number>;
  prices: Map<string, number>;
  mcapScale: number;
  fdvScale: number;
  hasRealFdv: boolean;
  adjMcapScale: number;
  trailingWindowDays: number;
}

export interface ComputeResult {
  date: string;
  [key: string]: number | string;
}

function trailingAvg(
  dateMap: Map<string, number>,
  sortedDates: string[],
  endIdx: number,
  windowDays: number,
): { sum: number; days: number } {
  let sum = 0;
  let days = 0;
  for (let j = Math.max(0, endIdx - windowDays + 1); j <= endIdx; j++) {
    const val = dateMap.get(sortedDates[j]);
    if (val && val > 0) {
      sum += val;
      days++;
    }
  }
  return { sum, days };
}

function rollingGrowth(
  dateMap: Map<string, number>,
  sortedDates: string[],
  idx: number,
  windowDays: number,
): number | null {
  const current = trailingAvg(dateMap, sortedDates, idx, windowDays);
  const priorIdx = idx - windowDays;
  if (priorIdx < 0 || current.days < 7) return null;
  const prior = trailingAvg(dateMap, sortedDates, priorIdx, windowDays);
  if (prior.days < 7 || prior.sum <= 0) return null;
  const currentAvg = current.sum / current.days;
  const priorAvg = prior.sum / prior.days;
  return ((currentAvg - priorAvg) / priorAvg) * 100;
}

export const DERIVED_METRIC_REGISTRY: Record<string, DerivedMetricRecipe> = {
  pe_ratio: {
    key: "pe_ratio",
    displayLabel: "P/E Ratio",
    description: "Price-to-earnings ratio using MCAP, FDV, and Adjusted MCAP variants",
    sources: ["defillama.revenue", "coingecko.price", "coingecko.market_data"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "ratio",
    yAxes: [
      { dataKey: "mcap_pe", label: "MCAP P/E" },
      { dataKey: "fdv_pe", label: "FDV P/E" },
      { dataKey: "adj_mcap_pe", label: "Adj MCAP P/E" },
    ],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const price = ctx.prices.get(dateStr);
        if (!price) continue;
        const { sum, days } = trailingAvg(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        if (days < 7 || sum <= 0) continue;
        const annualizedRev = (sum / days) * 365;
        const mcapPe = (price * ctx.mcapScale) / annualizedRev;
        if (mcapPe <= 0 || mcapPe >= 100000) continue;
        const row: ComputeResult = {
          date: dateStr,
          mcap_pe: Number(mcapPe.toFixed(2)),
        };
        if (ctx.hasRealFdv && ctx.fdvScale > 0) row.fdv_pe = Number(((price * ctx.fdvScale) / annualizedRev).toFixed(2));
        row.adj_mcap_pe = Number(((price * ctx.adjMcapScale) / annualizedRev).toFixed(2));
        results.push(row);
      }
      return results;
    },
  },

  ps_ratio: {
    key: "ps_ratio",
    displayLabel: "P/S Ratio",
    description: "Price-to-sales ratio using total fees (gross revenue) instead of protocol revenue",
    sources: ["defillama.fees", "coingecko.price", "coingecko.market_data"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "ratio",
    yAxes: [
      { dataKey: "mcap_ps", label: "MCAP P/S" },
      { dataKey: "fdv_ps", label: "FDV P/S" },
    ],
    compute: (ctx) => {
      const feeDates = [...ctx.fees.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < feeDates.length; i++) {
        const dateStr = feeDates[i];
        const price = ctx.prices.get(dateStr);
        if (!price) continue;
        const { sum, days } = trailingAvg(ctx.fees, feeDates, i, ctx.trailingWindowDays);
        if (days < 7 || sum <= 0) continue;
        const annualizedFees = (sum / days) * 365;
        const mcapPs = (price * ctx.mcapScale) / annualizedFees;
        if (mcapPs <= 0 || mcapPs >= 100000) continue;
        const row: ComputeResult = {
          date: dateStr,
          mcap_ps: Number(mcapPs.toFixed(2)),
        };
        if (ctx.hasRealFdv && ctx.fdvScale > 0) row.fdv_ps = Number(((price * ctx.fdvScale) / annualizedFees).toFixed(2));
        results.push(row);
      }
      return results;
    },
  },

  take_rate: {
    key: "take_rate",
    displayLabel: "Take Rate",
    description: "Protocol revenue as percentage of trading volume — measures value capture efficiency",
    sources: ["defillama.revenue", "defillama.dex_volume"],
    trailingWindowDays: 7,
    chartType: "line",
    format: "percent",
    yAxes: [{ dataKey: "take_rate", label: "Take Rate %" }],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const rev = trailingAvg(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        const vol = trailingAvg(ctx.volume, revDates, i, ctx.trailingWindowDays);
        if (rev.days < 3 || vol.days < 3 || vol.sum <= 0) continue;
        const avgRev = rev.sum / rev.days;
        const avgVol = vol.sum / vol.days;
        const takeRate = (avgRev / avgVol) * 100;
        if (takeRate <= 0 || takeRate > 100) continue;
        results.push({ date: dateStr, take_rate: Number(takeRate.toFixed(4)) });
      }
      return results;
    },
  },

  capital_efficiency: {
    key: "capital_efficiency",
    displayLabel: "Capital Efficiency",
    description: "Annualized revenue per dollar of TVL — measures how productively capital is deployed",
    sources: ["defillama.revenue", "defillama.tvl"],
    trailingWindowDays: 7,
    chartType: "line",
    format: "percent",
    yAxes: [{ dataKey: "cap_eff", label: "Rev/TVL (Annualized %)" }],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const tvl = ctx.tvl.get(dateStr);
        if (!tvl || tvl <= 0) continue;
        const rev = trailingAvg(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        if (rev.days < 3 || rev.sum <= 0) continue;
        const annualizedRev = (rev.sum / rev.days) * 365;
        const efficiency = (annualizedRev / tvl) * 100;
        if (efficiency <= 0 || efficiency > 10000) continue;
        results.push({ date: dateStr, cap_eff: Number(efficiency.toFixed(2)) });
      }
      return results;
    },
  },

  revenue_growth: {
    key: "revenue_growth",
    displayLabel: "Revenue Growth",
    description: "30-day rolling revenue growth rate vs prior 30 days",
    sources: ["defillama.revenue"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "percent",
    yAxes: [{ dataKey: "rev_growth", label: "Revenue Growth %" }],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays * 2 - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const growth = rollingGrowth(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        if (growth === null) continue;
        if (Math.abs(growth) > 1000) continue;
        results.push({ date: dateStr, rev_growth: Number(growth.toFixed(2)) });
      }
      return results;
    },
  },

  fee_growth: {
    key: "fee_growth",
    displayLabel: "Fee Growth",
    description: "30-day rolling fee growth rate vs prior 30 days",
    sources: ["defillama.fees"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "percent",
    yAxes: [{ dataKey: "fee_growth", label: "Fee Growth %" }],
    compute: (ctx) => {
      const feeDates = [...ctx.fees.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays * 2 - 1; i < feeDates.length; i++) {
        const dateStr = feeDates[i];
        const growth = rollingGrowth(ctx.fees, feeDates, i, ctx.trailingWindowDays);
        if (growth === null) continue;
        if (Math.abs(growth) > 1000) continue;
        results.push({ date: dateStr, fee_growth: Number(growth.toFixed(2)) });
      }
      return results;
    },
  },

  volume_tvl_ratio: {
    key: "volume_tvl_ratio",
    displayLabel: "Volume/TVL Ratio",
    description: "Daily trading volume relative to TVL — measures capital velocity/utilization",
    sources: ["defillama.dex_volume", "defillama.tvl"],
    trailingWindowDays: 7,
    chartType: "line",
    format: "ratio",
    yAxes: [{ dataKey: "vol_tvl", label: "Volume/TVL" }],
    compute: (ctx) => {
      const volDates = [...ctx.volume.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < volDates.length; i++) {
        const dateStr = volDates[i];
        const tvl = ctx.tvl.get(dateStr);
        if (!tvl || tvl <= 0) continue;
        const vol = trailingAvg(ctx.volume, volDates, i, ctx.trailingWindowDays);
        if (vol.days < 3 || vol.sum <= 0) continue;
        const avgVol = vol.sum / vol.days;
        const ratio = avgVol / tvl;
        if (ratio <= 0 || ratio > 1000) continue;
        results.push({ date: dateStr, vol_tvl: Number(ratio.toFixed(4)) });
      }
      return results;
    },
  },

  fdv_tvl: {
    key: "fdv_tvl",
    displayLabel: "FDV/TVL Ratio",
    description: "Fully diluted valuation relative to total value locked — protocol premium over locked capital",
    sources: ["coingecko.price", "coingecko.market_data", "defillama.tvl"],
    trailingWindowDays: 1,
    chartType: "line",
    format: "ratio",
    yAxes: [
      { dataKey: "mcap_tvl", label: "MCAP/TVL" },
      { dataKey: "fdv_tvl", label: "FDV/TVL" },
    ],
    compute: (ctx) => {
      const tvlDates = [...ctx.tvl.keys()].sort();
      const results: ComputeResult[] = [];
      for (const dateStr of tvlDates) {
        const tvl = ctx.tvl.get(dateStr);
        const price = ctx.prices.get(dateStr);
        if (!tvl || tvl <= 0 || !price) continue;
        const mcapTvl = (price * ctx.mcapScale) / tvl;
        if (mcapTvl <= 0 || mcapTvl > 10000) continue;
        const row: ComputeResult = {
          date: dateStr,
          mcap_tvl: Number(mcapTvl.toFixed(3)),
        };
        if (ctx.hasRealFdv && ctx.fdvScale > 0) {
          row.fdv_tvl = Number(((price * ctx.fdvScale) / tvl).toFixed(3));
        }
        results.push(row);
      }
      return results;
    },
  },
};

export function lookupDerivedMetric(metricKey: string): DerivedMetricRecipe | undefined {
  return DERIVED_METRIC_REGISTRY[metricKey];
}

export function listDerivedMetrics(): string[] {
  return Object.keys(DERIVED_METRIC_REGISTRY);
}

export async function fetchSourceData(
  source: DataSourceKey,
  protocol: string,
  defillama: DefiLlamaClient,
  resolvers: {
    resolveCoinGeckoId: (slug: string) => string | undefined;
    getRevenueSlugs: (slug: string) => string[];
  },
): Promise<Map<string, number>> {
  const slug = await defillama.resolveSlug(protocol);
  const dateMap = new Map<string, number>();

  switch (source) {
    case "defillama.revenue": {
      const revSlugs = resolvers.getRevenueSlugs(slug);
      for (const rs of revSlugs) {
        try {
          const revData = await defillama.getProtocolRevenue(rs);
          const parsed = (revData.dailyRevenue || [])
            .filter((d: any) => (d.revenue || d.value || 0) > 0);
          if (parsed.length > dateMap.size) {
            dateMap.clear();
            for (const d of parsed) {
              dateMap.set(new Date(d.date * 1000).toISOString().substring(0, 10), d.revenue || d.value || 0);
            }
            break;
          }
        } catch (e: any) {
          console.log(`[DerivedMetrics] Revenue fetch failed for '${rs}': ${e.message}`);
        }
      }
      break;
    }
    case "defillama.fees": {
      try {
        const feesData = await defillama.getProtocolFees(slug);
        for (const d of (feesData.dailyFees || [])) {
          if (d.fees > 0) dateMap.set(new Date(d.date * 1000).toISOString().substring(0, 10), d.fees);
        }
      } catch (e: any) {
        console.log(`[DerivedMetrics] Fees fetch failed for '${slug}': ${e.message}`);
      }
      break;
    }
    case "defillama.tvl": {
      try {
        const tvlData = await defillama.getProtocolTvl(slug);
        for (const d of tvlData) {
          if (d.totalLiquidityUSD > 0) {
            dateMap.set(new Date(d.date * 1000).toISOString().substring(0, 10), d.totalLiquidityUSD);
          }
        }
      } catch (e: any) {
        console.log(`[DerivedMetrics] TVL fetch failed for '${slug}': ${e.message}`);
      }
      break;
    }
    case "defillama.dex_volume": {
      try {
        const volData = await defillama.getProtocolDexVolume(slug);
        for (const d of (volData.dailyVolume || volData.totalDataChart || [])) {
          const vol = d.volume || d.dailyVolume || d[1];
          if (vol > 0) dateMap.set(new Date((d.date || d[0]) * 1000).toISOString().substring(0, 10), vol);
        }
      } catch (e: any) {
        console.log(`[DerivedMetrics] DEX volume fetch failed for '${slug}': ${e.message}`);
      }
      break;
    }
    case "defillama.derivatives_volume": {
      try {
        const volData = await defillama.getProtocolDerivativesVolume(slug);
        for (const d of (volData.dailyVolume || volData.totalDataChart || [])) {
          const vol = d.volume || d.dailyVolume || d[1];
          if (vol > 0) dateMap.set(new Date((d.date || d[0]) * 1000).toISOString().substring(0, 10), vol);
        }
      } catch (e: any) {
        console.log(`[DerivedMetrics] Derivatives volume fetch failed for '${slug}': ${e.message}`);
      }
      break;
    }
    case "coingecko.price": {
      const coinId = resolvers.resolveCoinGeckoId(slug) || resolvers.resolveCoinGeckoId(protocol);
      if (!coinId) break;
      try {
        const priceData = await defillama.getCoinPriceHistory(coinId, 400);
        for (const p of priceData.prices) {
          dateMap.set(new Date(p.date * 1000).toISOString().substring(0, 10), p.price);
        }
      } catch (e: any) {
        console.log(`[DerivedMetrics] Price history fetch failed for '${coinId}': ${e.message}`);
      }
      break;
    }
    case "coingecko.market_data":
      break;
    default:
      break;
  }

  return dateMap;
}

export async function fetchMarketData(
  protocol: string,
  defillama: DefiLlamaClient,
  resolveCoinGeckoId: (slug: string) => string | undefined,
): Promise<{ mcapScale: number; fdvScale: number; hasRealFdv: boolean; adjMcapScale: number; coinId: string | null }> {
  const slug = await defillama.resolveSlug(protocol);
  const coinId = resolveCoinGeckoId(slug) || resolveCoinGeckoId(protocol) || null;
  if (!coinId) return { mcapScale: 0, fdvScale: 0, hasRealFdv: false, adjMcapScale: 0, coinId: null };

  try {
    const cgData = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    ).then(r => r.json());

    const mcap = cgData?.market_data?.market_cap?.usd || 0;
    const fdv = cgData?.market_data?.fully_diluted_valuation?.usd || 0;
    const currentPrice = cgData?.market_data?.current_price?.usd || 0;
    const circulatingSupply = cgData?.market_data?.circulating_supply || 0;
    const totalSupply = cgData?.market_data?.total_supply || 0;

    if (!mcap || !currentPrice) return { mcapScale: 0, fdvScale: 0, hasRealFdv: false, adjMcapScale: 0, coinId };

    const hasRealFdv = fdv > 0;
    const mcapScale = mcap / currentPrice;
    const fdvScale = fdv > 0 ? fdv / currentPrice : totalSupply > 0 ? totalSupply : mcapScale;
    const adjMcapScale = circulatingSupply > 0 ? circulatingSupply * 0.85 : mcapScale * 0.85;

    return { mcapScale, fdvScale, hasRealFdv, adjMcapScale, coinId };
  } catch {
    return { mcapScale: 0, fdvScale: 0, hasRealFdv: false, adjMcapScale: 0, coinId };
  }
}

export async function computeDerivedChart(
  recipe: DerivedMetricRecipe,
  protocol: string,
  defillama: DefiLlamaClient,
  resolvers: {
    resolveCoinGeckoId: (slug: string) => string | undefined;
    getRevenueSlugs: (slug: string) => string[];
  },
  lookbackDays: number = 365,
): Promise<{ data: ComputeResult[]; yAxes: Array<{ dataKey: string; label: string }> }> {
  const sourceDataPromises: Promise<{ key: DataSourceKey; data: Map<string, number> }>[] = [];
  const uniqueSources = [...new Set(recipe.sources)];

  for (const src of uniqueSources) {
    if (src === "coingecko.market_data") continue;
    sourceDataPromises.push(
      fetchSourceData(src, protocol, defillama, resolvers).then(data => ({ key: src, data }))
    );
  }

  const sourceResults = await Promise.all(sourceDataPromises);
  const sourceMap: Record<string, Map<string, number>> = {};
  for (const { key, data } of sourceResults) {
    sourceMap[key] = data;
  }

  let marketData = { mcapScale: 0, fdvScale: 0, hasRealFdv: false, adjMcapScale: 0 };
  if (uniqueSources.includes("coingecko.market_data") || uniqueSources.includes("coingecko.price")) {
    const md = await fetchMarketData(protocol, defillama, resolvers.resolveCoinGeckoId);
    marketData = md;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().substring(0, 10);

  const ctx: ComputeContext = {
    revenue: sourceMap["defillama.revenue"] || new Map(),
    fees: sourceMap["defillama.fees"] || new Map(),
    tvl: sourceMap["defillama.tvl"] || new Map(),
    volume: sourceMap["defillama.dex_volume"] || sourceMap["defillama.derivatives_volume"] || new Map(),
    prices: sourceMap["coingecko.price"] || new Map(),
    mcapScale: marketData.mcapScale,
    fdvScale: marketData.fdvScale,
    hasRealFdv: marketData.hasRealFdv,
    adjMcapScale: marketData.adjMcapScale,
    trailingWindowDays: recipe.trailingWindowDays,
  };

  const allData = recipe.compute(ctx);
  const filtered = allData.filter(row => row.date >= cutoffStr);

  if (filtered.length < 3) {
    throw new Error(`Insufficient data for ${recipe.displayLabel}: only ${filtered.length} points`);
  }

  const actualYAxes = recipe.yAxes.filter(yAxis =>
    filtered.some(row => row[yAxis.dataKey] !== undefined)
  );

  return { data: filtered, yAxes: actualYAxes.length > 0 ? actualYAxes : recipe.yAxes };
}
