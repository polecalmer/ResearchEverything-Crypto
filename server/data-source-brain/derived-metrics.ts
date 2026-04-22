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
  | "coingecko.market_data"
  | "stonksonchain.deployer_fees"
  | "stonksonchain.deployer_volume"
  | "stonksonchain.hip3_total_fees"
  | "stonksonchain.hip3_total_volume";

export type MetricFormat = "ratio" | "currency" | "percent" | "number";

export interface DerivedMetricRecipe {
  key: string;
  displayLabel: string;
  description: string;
  /** AUTHORITATIVE: which data sources feed this recipe's compute(). */
  sources: DataSourceKey[];
  trailingWindowDays: number;
  /** PRESENTATION FALLBACK ONLY. The Chart Shaper (server/data-source-brain/
   *  chart-shaper.ts) decides chartType per-request from real series stats
   *  and brain context; this value is used solely as the fallback when the
   *  shaper LLM call fails or returns invalid output. Do not rely on this
   *  to drive the rendered form. */
  chartType: "line" | "bar" | "area";
  format: MetricFormat;
  /** AUTHORITATIVE for the data shape (dataKey order + labels). The Chart
   *  Shaper does NOT change yAxes — it only decides smoothing, axisLayout
   *  (single vs dual rendering), annotations, and prose around them. */
  yAxes: Array<{ dataKey: string; label: string }>;
  compute: (ctx: ComputeContext) => ComputeResult[];
  /** True when the recipe needs a denominator series from a different protocol
   * (e.g. "share of Hyperliquid total volume"). The pipeline resolves and
   * fetches the denominator and injects it as ctx.denominatorMap. */
  requiresDenominator?: boolean;
  /** Which numerator source the share recipe reads. Used to pick the matching
   * denominator source when fetching from another protocol. */
  numeratorSource?: "volume" | "fees" | "revenue";
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
  /** Denominator series (date → value) from a different protocol, used by
   * share/ratio recipes. Empty Map when not applicable. */
  denominatorMap: Map<string, number>;
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

  ma_arr: {
    key: "ma_arr",
    displayLabel: "30D MA Annualized Run-Rate Revenue",
    description: "30-day moving average of daily revenue, annualized (×365). Smooths daily noise into a run-rate.",
    sources: ["defillama.revenue"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "currency",
    yAxes: [{ dataKey: "arr", label: "Annualized Run-Rate Revenue" }],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const { sum, days } = trailingAvg(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        if (days < 7 || sum <= 0) continue;
        const annualizedRev = (sum / days) * 365;
        results.push({ date: dateStr, arr: Number(annualizedRev.toFixed(0)) });
      }
      return results;
    },
  },

  ma_revenue: {
    key: "ma_revenue",
    displayLabel: "30D MA Daily Revenue",
    description: "30-day trailing average of daily protocol revenue (no annualization).",
    sources: ["defillama.revenue"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "currency",
    yAxes: [{ dataKey: "ma_revenue", label: "30D MA Revenue" }],
    compute: (ctx) => {
      const revDates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < revDates.length; i++) {
        const dateStr = revDates[i];
        const { sum, days } = trailingAvg(ctx.revenue, revDates, i, ctx.trailingWindowDays);
        if (days < 7 || sum <= 0) continue;
        results.push({ date: dateStr, ma_revenue: Number((sum / days).toFixed(0)) });
      }
      return results;
    },
  },

  ma_fees: {
    key: "ma_fees",
    displayLabel: "30D MA Daily Fees",
    description: "30-day trailing average of daily total fees.",
    sources: ["defillama.fees"],
    trailingWindowDays: 30,
    chartType: "line",
    format: "currency",
    yAxes: [{ dataKey: "ma_fees", label: "30D MA Fees" }],
    compute: (ctx) => {
      const feeDates = [...ctx.fees.keys()].sort();
      const results: ComputeResult[] = [];
      for (let i = ctx.trailingWindowDays - 1; i < feeDates.length; i++) {
        const dateStr = feeDates[i];
        const { sum, days } = trailingAvg(ctx.fees, feeDates, i, ctx.trailingWindowDays);
        if (days < 7 || sum <= 0) continue;
        results.push({ date: dateStr, ma_fees: Number((sum / days).toFixed(0)) });
      }
      return results;
    },
  },

  share_volume: {
    key: "share_volume",
    displayLabel: "Share of Volume",
    description: "Daily trading volume of the numerator protocol as a percentage of a denominator protocol's daily volume.",
    sources: ["defillama.dex_volume"],
    trailingWindowDays: 1,
    chartType: "area",
    format: "percent",
    yAxes: [{ dataKey: "share_pct", label: "Share %" }],
    requiresDenominator: true,
    numeratorSource: "volume",
    compute: (ctx) => {
      if (ctx.denominatorMap.size === 0) return [];
      const dates = [...ctx.volume.keys()].sort();
      const results: ComputeResult[] = [];
      for (const dateStr of dates) {
        const num = ctx.volume.get(dateStr);
        const den = ctx.denominatorMap.get(dateStr);
        if (!num || !den || den <= 0) continue;
        const pct = (num / den) * 100;
        if (pct < 0 || pct > 100) continue;
        results.push({ date: dateStr, share_pct: Number(pct.toFixed(3)) });
      }
      return results;
    },
  },

  share_fees: {
    key: "share_fees",
    displayLabel: "Share of Fees",
    description: "Daily fees of the numerator protocol as a percentage of a denominator protocol's daily fees.",
    sources: ["defillama.fees"],
    trailingWindowDays: 1,
    chartType: "area",
    format: "percent",
    yAxes: [{ dataKey: "share_pct", label: "Share %" }],
    requiresDenominator: true,
    numeratorSource: "fees",
    compute: (ctx) => {
      if (ctx.denominatorMap.size === 0) return [];
      const dates = [...ctx.fees.keys()].sort();
      const results: ComputeResult[] = [];
      for (const dateStr of dates) {
        const num = ctx.fees.get(dateStr);
        const den = ctx.denominatorMap.get(dateStr);
        if (!num || !den || den <= 0) continue;
        const pct = (num / den) * 100;
        if (pct < 0 || pct > 100) continue;
        results.push({ date: dateStr, share_pct: Number(pct.toFixed(3)) });
      }
      return results;
    },
  },

  share_revenue: {
    key: "share_revenue",
    displayLabel: "Share of Revenue",
    description: "Daily revenue of the numerator protocol as a percentage of a denominator protocol's daily revenue.",
    sources: ["defillama.revenue"],
    trailingWindowDays: 1,
    chartType: "area",
    format: "percent",
    yAxes: [{ dataKey: "share_pct", label: "Share %" }],
    requiresDenominator: true,
    numeratorSource: "revenue",
    compute: (ctx) => {
      if (ctx.denominatorMap.size === 0) return [];
      const dates = [...ctx.revenue.keys()].sort();
      const results: ComputeResult[] = [];
      for (const dateStr of dates) {
        const num = ctx.revenue.get(dateStr);
        const den = ctx.denominatorMap.get(dateStr);
        if (!num || !den || den <= 0) continue;
        const pct = (num / den) * 100;
        if (pct < 0 || pct > 100) continue;
        results.push({ date: dateStr, share_pct: Number(pct.toFixed(3)) });
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
    case "stonksonchain.deployer_fees": {
      try {
        const { getDeployerFeesHistory } = await import("../stonks-client");
        const m = await getDeployerFeesHistory(protocol, 365);
        for (const [d, v] of m) dateMap.set(d, v);
      } catch (e: any) {
        console.log(`[DerivedMetrics] StonksOnChain deployer_fees fetch failed for '${protocol}': ${e.message}`);
      }
      break;
    }
    case "stonksonchain.deployer_volume": {
      try {
        const { getDeployerVolumeHistory } = await import("../stonks-client");
        const m = await getDeployerVolumeHistory(protocol, 365);
        for (const [d, v] of m) dateMap.set(d, v);
      } catch (e: any) {
        console.log(`[DerivedMetrics] StonksOnChain deployer_volume fetch failed for '${protocol}': ${e.message}`);
      }
      break;
    }
    case "stonksonchain.hip3_total_fees": {
      try {
        const { getHip3TotalFeesHistory } = await import("../stonks-client");
        const m = await getHip3TotalFeesHistory(365);
        for (const [d, v] of m) dateMap.set(d, v);
      } catch (e: any) {
        console.log(`[DerivedMetrics] StonksOnChain hip3_total_fees fetch failed: ${e.message}`);
      }
      break;
    }
    case "stonksonchain.hip3_total_volume": {
      try {
        const { getHip3TotalVolumeHistory } = await import("../stonks-client");
        const m = await getHip3TotalVolumeHistory(365);
        for (const [d, v] of m) dateMap.set(d, v);
      } catch (e: any) {
        console.log(`[DerivedMetrics] StonksOnChain hip3_total_volume fetch failed: ${e.message}`);
      }
      break;
    }
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

/** Parse a tokenized time range ("180d", "6m", "1y", "ytd", "all") to lookback days. */
export function parseTimeRangeToDays(timeRange: string | undefined | null, fallbackDays: number = 365): number {
  if (!timeRange) return fallbackDays;
  const t = timeRange.trim().toLowerCase();
  if (t === "all") return 100000;
  if (t === "ytd") {
    const now = new Date();
    const jan1 = new Date(now.getFullYear(), 0, 1);
    return Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86400000));
  }
  const m = t.match(/^(\d+)\s*([dwmy])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit === "d") return n;
    if (unit === "w") return n * 7;
    if (unit === "m") return Math.round(n * 30.44);
    if (unit === "y") return n * 365;
  }
  const justDigits = t.match(/^(\d+)$/);
  if (justDigits) return parseInt(justDigits[1], 10);
  return fallbackDays;
}

export type ComparisonSeries = "price" | "tvl" | "volume" | "fees" | "revenue";

export interface ComputeOptions {
  lookbackDays?: number;
  comparison?: ComparisonSeries[];
  /** Denominator for ratio/share recipes. The named protocol's metric series
   * is fetched and injected into the compute context as denominatorMap. */
  denominator?: { protocol: string; metric: "volume" | "fees" | "revenue" };
  /** When provided, the data-source resolver may consult user-preference
   * facts to redirect a recipe's default source to the user's preferred one
   * (e.g. stonksonchain instead of defillama for HIP-3 metrics). */
  userId?: string;
}

/** Map a DataSourceKey to the resolver's series intent so we can ask the
 *  brain which source should actually serve it. Keys with no entry are not
 *  rewritable (e.g. coingecko.market_data is a side-channel fetch). */
const SOURCE_KEY_TO_INTENT: Partial<Record<DataSourceKey, "daily_revenue" | "daily_fees" | "daily_tvl" | "daily_dex_volume" | "daily_derivatives_volume" | "price_history">> = {
  "defillama.revenue": "daily_revenue",
  "defillama.fees": "daily_fees",
  "defillama.tvl": "daily_tvl",
  "defillama.dex_volume": "daily_dex_volume",
  "defillama.derivatives_volume": "daily_derivatives_volume",
  "coingecko.price": "price_history",
};

export async function computeDerivedChart(
  recipe: DerivedMetricRecipe,
  protocol: string,
  defillama: DefiLlamaClient,
  resolvers: {
    resolveCoinGeckoId: (slug: string) => string | undefined;
    getRevenueSlugs: (slug: string) => string[];
  },
  optionsOrLookback: number | ComputeOptions = 365,
): Promise<{ data: ComputeResult[]; yAxes: Array<{ dataKey: string; label: string }>; sourcesUsed: DataSourceKey[] }> {
  const opts: ComputeOptions =
    typeof optionsOrLookback === "number" ? { lookbackDays: optionsOrLookback } : optionsOrLookback;
  const lookbackDays = opts.lookbackDays ?? 365;
  const comparison = (opts.comparison ?? []).filter(
    (c, i, a) => a.indexOf(c) === i && c !== undefined,
  ) as ComparisonSeries[];

  // Map comparison series to DataSourceKey, then merge with recipe sources.
  const COMPARISON_TO_SOURCE: Record<ComparisonSeries, DataSourceKey> = {
    price: "coingecko.price",
    tvl: "defillama.tvl",
    volume: "defillama.dex_volume",
    fees: "defillama.fees",
    revenue: "defillama.revenue",
  };
  const extraSources: DataSourceKey[] = comparison.map((c) => COMPARISON_TO_SOURCE[c]);
  const uniqueSources = [...new Set([...recipe.sources, ...extraSources])];

  // RESOLVER DISPATCH: ask the data-source brain whether each recipe source
  // should be redirected. The resolver checks user preferences and brain
  // coverage facts; if it picks a different source (e.g. stonksonchain for
  // a HIP-3 deployer's fees), we substitute that source key but keep the
  // ORIGINAL key as the storage slot so downstream `ctx.fees` / `ctx.volume`
  // wiring still works without recipe changes.
  const { resolveSeriesSource } = await import("./agent-hooks");
  const fetchPlan: Array<{ storeAs: DataSourceKey; fetchKey: DataSourceKey }> = [];
  for (const src of uniqueSources) {
    if (src === "coingecko.market_data") continue;
    const intent = SOURCE_KEY_TO_INTENT[src];
    let fetchKey: DataSourceKey = src;
    if (intent) {
      try {
        const candidates = await resolveSeriesSource(intent, protocol, { userId: opts.userId });
        const top = candidates[0];
        if (top && top.dataSourceKey && top.dataSourceKey !== src) {
          console.log(`[DerivedMetrics] Resolver substituted ${src} → ${top.dataSourceKey} for ${intent}(${protocol}) [${top.reason}]`);
          fetchKey = top.dataSourceKey as DataSourceKey;
        }
      } catch (e: any) {
        console.warn(`[DerivedMetrics] resolver dispatch failed for ${src}/${protocol}: ${e.message}`);
      }
    }
    fetchPlan.push({ storeAs: src, fetchKey });
  }

  const sourceDataPromises: Promise<{ key: DataSourceKey; data: Map<string, number> }>[] = [];
  for (const { storeAs, fetchKey } of fetchPlan) {
    sourceDataPromises.push(
      fetchSourceData(fetchKey, protocol, defillama, resolvers).then(data => ({ key: storeAs, data }))
    );
  }

  // Denominator fetch (for share/ratio recipes that need a series from a
  // different protocol). We pick the source key based on the requested
  // denominator metric, then resolve+fetch in parallel with primary sources.
  const DENOM_METRIC_TO_SOURCE: Record<"volume" | "fees" | "revenue", DataSourceKey> = {
    volume: "defillama.dex_volume",
    fees: "defillama.fees",
    revenue: "defillama.revenue",
  };
  let denominatorPromise: Promise<Map<string, number>> = Promise.resolve(new Map());
  let resolvedDenomSource: DataSourceKey | null = null;
  if (recipe.requiresDenominator) {
    if (!opts.denominator) {
      throw new Error(
        `Recipe "${recipe.key}" requires a denominator (e.g. {protocol:"hyperliquid", metric:"volume"}) but none was provided`,
      );
    }
    // Hard consistency check: a share_volume recipe MUST be paired with a
    // volume denominator, share_fees with fees, etc. Otherwise the chart
    // will silently mix incompatible series (e.g. compute volume/fees and
    // label it as "share of volume").
    if (recipe.numeratorSource && opts.denominator.metric !== recipe.numeratorSource) {
      throw new Error(
        `Recipe "${recipe.key}" expects denominator.metric="${recipe.numeratorSource}" but got "${opts.denominator.metric}" — refusing to compute a mismatched ratio`,
      );
    }
    let denomSource: DataSourceKey = DENOM_METRIC_TO_SOURCE[opts.denominator.metric];

    // APPLES-TO-APPLES guard: when the numerator was substituted to a
    // stonksonchain HIP-3 deployer source AND the denominator targets
    // hyperliquid, we MUST use the matching HIP-3 ecosystem aggregate
    // (stonksonchain.hip3_total_*) — not defillama's "hyperliquid" series,
    // which only tracks the spot/main DEX and excludes HIP-3 perp volume.
    // Mixing them produces ratios >100% (deployer notional > spot total)
    // which the share filter rejects, leaving an "insufficient data" error.
    const numeratorIsHip3Deployer = fetchPlan.some(
      (p) => p.fetchKey === "stonksonchain.deployer_volume" || p.fetchKey === "stonksonchain.deployer_fees",
    );
    const denomIsHyperliquid = opts.denominator.protocol.toLowerCase().includes("hyperliquid")
      || opts.denominator.protocol.toLowerCase() === "hl";
    if (numeratorIsHip3Deployer && denomIsHyperliquid) {
      const HIP3_AGG_FOR_METRIC: Record<"volume" | "fees" | "revenue", DataSourceKey | null> = {
        volume: "stonksonchain.hip3_total_volume",
        fees: "stonksonchain.hip3_total_fees",
        revenue: null, // no HIP-3 ecosystem revenue aggregate exposed yet
      };
      const aggKey = HIP3_AGG_FOR_METRIC[opts.denominator.metric];
      if (aggKey) {
        console.log(`[DerivedMetrics] HIP-3 numerator detected → switching denominator from ${denomSource} → ${aggKey} for apples-to-apples ratio`);
        denomSource = aggKey;
      }
    }

    const denomIntent = SOURCE_KEY_TO_INTENT[denomSource];
    if (denomIntent) {
      try {
        const candidates = await resolveSeriesSource(denomIntent, opts.denominator.protocol, { userId: opts.userId });
        const top = candidates[0];
        if (top && top.dataSourceKey && top.dataSourceKey !== denomSource) {
          // Don't let user-pref promotion clobber an explicit HIP-3
          // apples-to-apples decision above — that decision is more specific
          // than a generic "prefer source X for hyperliquid" preference.
          if (numeratorIsHip3Deployer && denomIsHyperliquid && (denomSource as string).startsWith("stonksonchain.hip3_")) {
            console.log(`[DerivedMetrics] Keeping HIP-3 aggregate denominator ${denomSource}; ignoring resolver suggestion ${top.dataSourceKey}`);
          } else {
            console.log(`[DerivedMetrics] Resolver substituted denominator ${denomSource} → ${top.dataSourceKey} for ${denomIntent}(${opts.denominator.protocol}) [${top.reason}]`);
            denomSource = top.dataSourceKey as DataSourceKey;
          }
        }
      } catch (e: any) {
        console.warn(`[DerivedMetrics] denominator resolver dispatch failed: ${e.message}`);
      }
    }
    resolvedDenomSource = denomSource;
    denominatorPromise = fetchSourceData(denomSource, opts.denominator.protocol, defillama, resolvers);
  }

  const [sourceResults, denominatorMap] = await Promise.all([
    Promise.all(sourceDataPromises),
    denominatorPromise,
  ]);
  if (recipe.requiresDenominator && denominatorMap.size === 0) {
    throw new Error(
      `Denominator series for ${opts.denominator!.protocol} (${opts.denominator!.metric}) returned no data — cannot compute ${recipe.displayLabel}`,
    );
  }
  const sourceMap: Record<string, Map<string, number>> = {};
  for (const { key, data } of sourceResults) {
    sourceMap[key] = data;
  }

  // Track the actual sources that returned data so the chart label credits
  // the right provider (e.g. stonksonchain rather than the recipe's default
  // defillama). Only count sources that returned ≥1 datapoint — we don't
  // want to label a stonksonchain attempt that returned empty.
  const sourcesUsed: DataSourceKey[] = [];
  for (let i = 0; i < fetchPlan.length; i++) {
    const { fetchKey } = fetchPlan[i];
    const data = sourceResults[i]?.data;
    if (data && data.size > 0 && !sourcesUsed.includes(fetchKey)) {
      sourcesUsed.push(fetchKey);
    }
  }
  if (recipe.requiresDenominator && denominatorMap.size > 0 && resolvedDenomSource) {
    if (!sourcesUsed.includes(resolvedDenomSource)) sourcesUsed.push(resolvedDenomSource);
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
    denominatorMap,
  };

  const allData = recipe.compute(ctx);

  // Attach comparison series. Each comparison key gets its own column on each row.
  // We only attach if the recipe doesn't already produce that column (e.g. a
  // P/E recipe already uses prices internally — no need to overlay raw price).
  const COMPARISON_COL: Record<ComparisonSeries, { dataKey: string; label: string; ctxMap: Map<string, number> }> = {
    price: { dataKey: "price", label: `${protocol.toUpperCase()} Price`, ctxMap: ctx.prices },
    tvl: { dataKey: "comp_tvl", label: "TVL", ctxMap: ctx.tvl },
    volume: { dataKey: "comp_volume", label: "Volume", ctxMap: ctx.volume },
    fees: { dataKey: "comp_fees", label: "Fees", ctxMap: ctx.fees },
    revenue: { dataKey: "comp_revenue", label: "Revenue", ctxMap: ctx.revenue },
  };
  const recipeKeys = new Set(recipe.yAxes.map((y) => y.dataKey));
  const appliedComparisons: Array<{ dataKey: string; label: string }> = [];
  for (const c of comparison) {
    const meta = COMPARISON_COL[c];
    if (!meta || recipeKeys.has(meta.dataKey)) continue;
    if (meta.ctxMap.size === 0) {
      console.log(`[DerivedMetrics] Comparison "${c}" requested but ${c} series is empty for ${protocol} — skipping overlay`);
      continue;
    }
    let attached = 0;
    for (const row of allData) {
      const v = meta.ctxMap.get(row.date as string);
      if (typeof v === "number" && !isNaN(v)) {
        row[meta.dataKey] = v;
        attached++;
      }
    }
    if (attached > 0) {
      appliedComparisons.push({ dataKey: meta.dataKey, label: meta.label });
      console.log(`[DerivedMetrics] Comparison "${c}" attached to ${attached}/${allData.length} rows`);
    }
  }

  const filtered = allData.filter(row => row.date >= cutoffStr);

  if (filtered.length < 3) {
    throw new Error(`Insufficient data for ${recipe.displayLabel}: only ${filtered.length} points`);
  }

  const baseYAxes = recipe.yAxes.filter(yAxis =>
    filtered.some(row => row[yAxis.dataKey] !== undefined)
  );
  const finalYAxes = [
    ...(baseYAxes.length > 0 ? baseYAxes : recipe.yAxes),
    ...appliedComparisons,
  ];

  return { data: filtered, yAxes: finalYAxes, sourcesUsed };
}
