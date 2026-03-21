const DEFILLAMA_BASE = "https://api.llama.fi";
const DEFILLAMA_COINS = "https://coins.llama.fi";

export interface DefiLlamaProtocol {
  name: string;
  slug: string;
  tvl: number;
  chainTvls: Record<string, number>;
  mcap?: number;
  fdv?: number;
  change_1d?: number;
  change_7d?: number;
  change_1m?: number;
}

export interface ProtocolTvlHistory {
  date: number;
  totalLiquidityUSD: number;
}

export interface ProtocolFees {
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  totalAllTime: number | null;
  dailyFees: { date: number; fees: number }[];
}

export interface ProtocolRevenue {
  total24h: number | null;
  total7d: number | null;
  total30d: number | null;
  totalAllTime: number | null;
  dailyRevenue: { date: number; revenue: number }[];
}

export interface CoinPriceHistory {
  prices: { date: number; price: number }[];
  symbol: string;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DeFiLlama API error (${res.status}): ${url}`);
  return res.json();
}

export async function listProtocols(): Promise<DefiLlamaProtocol[]> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/protocols`);
  return data;
}

export async function findProtocol(name: string): Promise<DefiLlamaProtocol | null> {
  const protocols = await listProtocols();
  const lower = name.toLowerCase();
  return protocols.find(
    (p: any) =>
      p.name?.toLowerCase() === lower ||
      p.slug?.toLowerCase() === lower ||
      p.symbol?.toLowerCase() === lower
  ) || null;
}

export async function getProtocolTvl(slug: string): Promise<ProtocolTvlHistory[]> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/protocol/${slug}`);
  return (data.tvl || []).map((d: any) => ({
    date: d.date,
    totalLiquidityUSD: d.totalLiquidityUSD,
  }));
}

export async function getProtocolFees(slug: string): Promise<ProtocolFees> {
  const data = await fetchJson(`https://fees.llama.fi/summary/fees/${slug}?dataType=dailyFees`);
  const totalData = data.totalDataChart || [];
  if (totalData.length === 0 && !data.total24h) {
    throw new Error(`No fee data available for protocol "${slug}" on DeFiLlama`);
  }
  return {
    total24h: data.total24h ?? null,
    total7d: data.total7d ?? null,
    total30d: data.total30d ?? null,
    totalAllTime: data.totalAllTime ?? null,
    dailyFees: totalData.map((d: any) => ({ date: d[0], fees: d[1] })),
  };
}

export async function getProtocolRevenue(slug: string): Promise<ProtocolRevenue> {
  const data = await fetchJson(`https://fees.llama.fi/summary/fees/${slug}?dataType=dailyRevenue`);
  const totalData = data.totalDataChart || [];
  if (totalData.length === 0 && !data.total24h) {
    throw new Error(`No revenue data available for protocol "${slug}" on DeFiLlama`);
  }
  return {
    total24h: data.total24h ?? null,
    total7d: data.total7d ?? null,
    total30d: data.total30d ?? null,
    totalAllTime: data.totalAllTime ?? null,
    dailyRevenue: totalData.map((d: any) => ({ date: d[0], revenue: d[1] })),
  };
}

export async function getCoinPriceHistory(
  coinId: string,
  daysBack: number = 90
): Promise<CoinPriceHistory> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - daysBack * 86400;
  const searchPeriod = `${start}`;

  try {
    const data = await fetchJson(
      `${DEFILLAMA_COINS}/chart/coingecko:${coinId}?start=${searchPeriod}&span=${daysBack}&period=1d`
    );
    const coins = data.coins || {};
    const key = Object.keys(coins)[0];
    if (!key) return { prices: [], symbol: coinId };

    return {
      prices: (coins[key].prices || []).map((p: any) => ({
        date: p.timestamp,
        price: p.price,
      })),
      symbol: coinId,
    };
  } catch {
    return { prices: [], symbol: coinId };
  }
}

export async function getCurrentPrice(coinId: string): Promise<number | null> {
  try {
    const data = await fetchJson(
      `${DEFILLAMA_COINS}/prices/current/coingecko:${coinId}`
    );
    const coins = data.coins || {};
    const key = Object.keys(coins)[0];
    return key ? coins[key].price : null;
  } catch {
    return null;
  }
}

export async function getProtocolSummary(slug: string): Promise<{
  tvl: ProtocolTvlHistory[];
  fees: ProtocolFees;
  revenue: ProtocolRevenue;
}> {
  const [tvl, fees, revenue] = await Promise.all([
    getProtocolTvl(slug),
    getProtocolFees(slug),
    getProtocolRevenue(slug),
  ]);
  return { tvl, fees, revenue };
}
