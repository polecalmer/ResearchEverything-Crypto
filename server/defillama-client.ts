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

let protocolsCache: DefiLlamaProtocol[] | null = null;
let protocolsCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000;

export async function listProtocols(): Promise<DefiLlamaProtocol[]> {
  if (protocolsCache && Date.now() - protocolsCacheTime < CACHE_TTL) {
    return protocolsCache;
  }
  const data = await fetchJson(`${DEFILLAMA_BASE}/protocols`);
  protocolsCache = data;
  protocolsCacheTime = Date.now();
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

const slugCache = new Map<string, { slug: string; time: number }>();

export async function resolveSlug(companyName: string): Promise<string> {
  const key = companyName.toLowerCase();
  const cached = slugCache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.slug;
  }

  const naiveSlug = key.replace(/\s+/g, "-");

  try {
    const res = await fetch(`${DEFILLAMA_BASE}/protocol/${naiveSlug}`);
    if (res.ok) {
      slugCache.set(key, { slug: naiveSlug, time: Date.now() });
      return naiveSlug;
    }
  } catch {}

  try {
    const protocols = await listProtocols();
    const exact = protocols.find(
      (p: any) => p.name?.toLowerCase() === key || p.slug?.toLowerCase() === key
    );
    if (exact) {
      slugCache.set(key, { slug: exact.slug, time: Date.now() });
      return exact.slug;
    }

    const startsWith = protocols
      .filter((p: any) =>
        p.name?.toLowerCase().startsWith(key) ||
        p.slug?.toLowerCase().startsWith(key)
      )
      .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0));
    if (startsWith.length > 0) {
      slugCache.set(key, { slug: startsWith[0].slug, time: Date.now() });
      return startsWith[0].slug;
    }

    const contains = protocols
      .filter((p: any) =>
        p.name?.toLowerCase().includes(key) ||
        p.slug?.toLowerCase().includes(key)
      )
      .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0));
    if (contains.length > 0) {
      slugCache.set(key, { slug: contains[0].slug, time: Date.now() });
      return contains[0].slug;
    }
  } catch {}

  slugCache.set(key, { slug: naiveSlug, time: Date.now() });
  return naiveSlug;
}

export async function getProtocolTvl(slug: string): Promise<ProtocolTvlHistory[]> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/protocol/${slug}`);
  return (data.tvl || []).map((d: any) => ({
    date: d.date,
    totalLiquidityUSD: d.totalLiquidityUSD,
  }));
}

export async function getProtocolBorrowedTvl(slug: string): Promise<ProtocolTvlHistory[] | null> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/protocol/${slug}`);
  const borrowed = data.chainTvls?.["borrowed"]?.tvl;
  if (!borrowed || borrowed.length === 0) return null;
  return borrowed.map((d: any) => ({
    date: d.date,
    totalLiquidityUSD: d.totalLiquidityUSD,
  }));
}

export async function getProtocolFees(slug: string): Promise<ProtocolFees> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/summary/fees/${slug}?dataType=dailyFees`);
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

/** Revenue slug fallbacks for rebranded protocols */
const REVENUE_SLUG_FALLBACKS: Record<string, string[]> = {
  makerdao: ["makerdao", "maker", "sky"],
  maker: ["maker", "makerdao", "sky"],
  sky: ["sky", "makerdao", "maker"],
};

export async function getProtocolRevenue(slug: string): Promise<ProtocolRevenue> {
  const slugsToTry = REVENUE_SLUG_FALLBACKS[slug.toLowerCase()] || [slug];
  let lastError: Error | null = null;

  for (const trySlug of slugsToTry) {
    try {
      const data = await fetchJson(`${DEFILLAMA_BASE}/summary/fees/${trySlug}?dataType=dailyRevenue`);
      const totalData = data.totalDataChart || [];
      if (totalData.length === 0 && !data.total24h) {
        lastError = new Error(`No revenue data for "${trySlug}"`);
        continue;
      }
      if (trySlug !== slug) {
        console.log(`[DeFiLlama] Revenue: slug '${slug}' failed, used fallback '${trySlug}'`);
      }
      return {
        total24h: data.total24h ?? null,
        total7d: data.total7d ?? null,
        total30d: data.total30d ?? null,
        totalAllTime: data.totalAllTime ?? null,
        dailyRevenue: totalData.map((d: any) => ({ date: d[0], revenue: d[1] })),
      };
    } catch (e) {
      lastError = e as Error;
    }
  }

  throw lastError || new Error(`No revenue data available for protocol "${slug}" on DeFiLlama`);
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

export interface ProtocolVolume {
  total24h: number | null;
  total7d: number | null;
  totalAllTime: number | null;
  dailyVolume: { date: number; volume: number }[];
}

export async function getProtocolDexVolume(slug: string): Promise<ProtocolVolume> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/summary/dexs/${slug}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`);
  const totalData = data.totalDataChart || [];
  if (totalData.length === 0 && !data.total24h) {
    throw new Error(`No DEX volume data available for "${slug}" on DeFiLlama`);
  }
  return {
    total24h: data.total24h ?? null,
    total7d: data.total7d ?? null,
    totalAllTime: data.totalAllTime ?? null,
    dailyVolume: totalData.map((d: any) => ({ date: d[0], volume: d[1] })),
  };
}

export async function getProtocolDerivativesVolume(slug: string): Promise<ProtocolVolume> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/summary/derivatives/${slug}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true&dataType=dailyVolume`);
  const totalData = data.totalDataChart || [];
  if (totalData.length === 0 && !data.total24h) {
    throw new Error(`No derivatives volume data available for "${slug}" on DeFiLlama`);
  }
  return {
    total24h: data.total24h ?? null,
    total7d: data.total7d ?? null,
    totalAllTime: data.totalAllTime ?? null,
    dailyVolume: totalData.map((d: any) => ({ date: d[0], volume: d[1] })),
  };
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
