import { getRequestSignal } from "./request-context";

const PRO_KEY = process.env.DEFILLAMA_PRO_API_KEY?.trim() || "";
const PRO_BASE = PRO_KEY ? `https://pro-api.llama.fi/${PRO_KEY}` : "";

if (PRO_KEY) {
  console.log("[DeFiLlama] Pro API key detected — routing through pro-api.llama.fi");
} else {
  console.warn("[DeFiLlama] DEFILLAMA_PRO_API_KEY not set — falling back to free public endpoints (rate-limited).");
}

const DEFILLAMA_BASE = PRO_KEY ? `${PRO_BASE}/api` : "https://api.llama.fi";
const DEFILLAMA_COINS = PRO_KEY ? `${PRO_BASE}/coins` : "https://coins.llama.fi";
const DEFILLAMA_YIELDS = PRO_KEY ? `${PRO_BASE}/yields` : "https://yields.llama.fi";
const DEFILLAMA_STABLES = PRO_KEY ? `${PRO_BASE}/stablecoins` : "https://stablecoins.llama.fi";

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
  const signal = getRequestSignal();
  signal?.throwIfAborted();
  const res = await fetch(url, { signal });
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

export type SlugMatchType = "exact" | "naive" | "startsWith" | "contains" | "fallback";

export interface ResolveSlugResult {
  /** The slug we'll send to DeFiLlama. */
  slug: string;
  /** How we matched it. "exact" / "naive" are high confidence; "startsWith"
   *  / "contains" / "fallback" are low confidence and the caller should
   *  treat them as suspect — especially when paired with stale data. */
  matchType: SlugMatchType;
  /** The DeFiLlama protocol name for the matched slug, if known. Lets the
   *  caller phrase a "did you mean ..." message. */
  matchedName?: string;
  /** Up to 5 alternative protocols whose name or slug also contains the
   *  user's query, ranked by TVL. Useful when the match is low-confidence
   *  and we want to suggest what the user might have meant instead. */
  alternatives?: Array<{ slug: string; name: string; tvl: number }>;
}

/** Plain string return for back-compat callers. New callers should prefer
 *  `resolveSlugDetailed` when they care about match confidence. */
export async function resolveSlug(companyName: string): Promise<string> {
  return (await resolveSlugDetailed(companyName)).slug;
}

export async function resolveSlugDetailed(companyName: string): Promise<ResolveSlugResult> {
  const key = companyName.toLowerCase().trim();
  const cached = slugCache.get(key);
  // Cache only stores the slug string; we re-derive matchType cheaply by
  // re-running the protocols-list lookup (no extra HTTP calls in the hot
  // path because listProtocols itself caches).
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return await classifySlug(key, cached.slug);
  }

  const naiveSlug = key.replace(/\s+/g, "-");

  try {
    const res = await fetch(`${DEFILLAMA_BASE}/protocol/${naiveSlug}`, {
      signal: getRequestSignal(),
    });
    if (res.ok) {
      slugCache.set(key, { slug: naiveSlug, time: Date.now() });
      return await classifySlug(key, naiveSlug);
    }
  } catch {}

  try {
    const protocols = await listProtocols();
    const exact = protocols.find(
      (p: any) => p.name?.toLowerCase() === key || p.slug?.toLowerCase() === key
    );
    if (exact) {
      slugCache.set(key, { slug: exact.slug, time: Date.now() });
      return await classifySlug(key, exact.slug);
    }

    const startsWith = protocols
      .filter((p: any) =>
        p.name?.toLowerCase().startsWith(key) ||
        p.slug?.toLowerCase().startsWith(key)
      )
      .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0));
    if (startsWith.length > 0) {
      slugCache.set(key, { slug: startsWith[0].slug, time: Date.now() });
      return await classifySlug(key, startsWith[0].slug);
    }

    const contains = protocols
      .filter((p: any) =>
        p.name?.toLowerCase().includes(key) ||
        p.slug?.toLowerCase().includes(key)
      )
      .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0));
    if (contains.length > 0) {
      slugCache.set(key, { slug: contains[0].slug, time: Date.now() });
      return await classifySlug(key, contains[0].slug);
    }
  } catch {}

  slugCache.set(key, { slug: naiveSlug, time: Date.now() });
  return { slug: naiveSlug, matchType: "fallback" };
}

/** Re-derive how the cached slug matched the user's query and surface
 *  alternatives. Only consults the in-memory protocols cache (no network). */
async function classifySlug(query: string, slug: string): Promise<ResolveSlugResult> {
  let matchType: SlugMatchType = "naive";
  let matchedName: string | undefined;
  let alternatives: Array<{ slug: string; name: string; tvl: number }> | undefined;
  try {
    const protocols = await listProtocols();
    const matched = protocols.find((p: any) => p.slug?.toLowerCase() === slug.toLowerCase());
    matchedName = matched?.name;
    const matchedNameLc = matched?.name?.toLowerCase() || "";
    const matchedSlugLc = matched?.slug?.toLowerCase() || "";
    if (matchedNameLc === query || matchedSlugLc === query) {
      matchType = "exact";
    } else if (matchedNameLc.startsWith(query) || matchedSlugLc.startsWith(query)) {
      matchType = "startsWith";
    } else if (matchedNameLc.includes(query) || matchedSlugLc.includes(query)) {
      matchType = "contains";
    } else if (slug === query.replace(/\s+/g, "-")) {
      matchType = "naive";
    } else {
      matchType = "fallback";
    }
    // Alternatives: any other protocol whose name/slug shares the query
    // tokens, ranked by TVL. Excludes the matched slug itself.
    const queryTokens = query.split(/\s+/).filter((t) => t.length >= 3);
    if (queryTokens.length > 0) {
      const candidates = protocols
        .filter((p: any) => {
          if (p.slug?.toLowerCase() === slug.toLowerCase()) return false;
          const blob = `${p.name || ""} ${p.slug || ""}`.toLowerCase();
          return queryTokens.some((t) => blob.includes(t));
        })
        .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
        .slice(0, 5)
        .map((p: any) => ({ slug: p.slug, name: p.name, tvl: p.tvl || 0 }));
      if (candidates.length > 0) alternatives = candidates;
    }
  } catch {
    /* swallow — return whatever we have */
  }
  return { slug, matchType, matchedName, alternatives };
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

export async function getYieldPools(protocol?: string): Promise<any[]> {
  const data = await fetchJson(`${DEFILLAMA_YIELDS}/pools`);
  let pools = data.data || [];
  if (protocol) {
    const lower = protocol.toLowerCase();
    pools = pools.filter((p: any) => p.project?.toLowerCase().includes(lower));
  }
  return pools.slice(0, 50).map((p: any) => ({
    pool: p.pool,
    chain: p.chain,
    project: p.project,
    symbol: p.symbol,
    tvlUsd: p.tvlUsd,
    apy: p.apy,
    apyBase: p.apyBase,
    apyReward: p.apyReward,
    stablecoin: p.stablecoin,
  }));
}

export async function getStablecoins(): Promise<any[]> {
  const data = await fetchJson(`${DEFILLAMA_STABLES}/stablecoins?includePrices=true`);
  const pegged = data.peggedAssets || [];
  return pegged.slice(0, 30).map((s: any) => ({
    name: s.name,
    symbol: s.symbol,
    circulating: s.circulating?.peggedUSD,
    price: s.price,
    chains: s.chains?.slice(0, 5),
  }));
}

export async function getChainTvls(): Promise<any[]> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/v2/chains`);
  return (data || []).slice(0, 50).map((c: any) => ({
    name: c.name,
    tvl: c.tvl,
    tokenSymbol: c.tokenSymbol,
    gecko_id: c.gecko_id,
  }));
}

export async function getChainTvlHistory(chain: string): Promise<any[]> {
  const data = await fetchJson(`${DEFILLAMA_BASE}/v2/historicalChainTvl/${chain}`);
  return (data || []).map((d: any) => ({
    date: d.date,
    tvl: d.tvl,
  }));
}
