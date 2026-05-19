/**
 * Direct CoinGecko price-history client.
 *
 * Why this exists separately from defillama-client: DeFiLlama's
 * `coins.llama.fi/chart/coingecko:<id>` route proxies CoinGecko under
 * the hood, but adds latency + a cache layer we don't control, and
 * strips metadata (market cap, volume, supply) we sometimes need. For
 * the user-facing chart pipeline we want the fastest, freshest data —
 * CoinGecko direct — with DeFiLlama as a graceful fallback when:
 *   - CoinGecko rate-limits (429)
 *   - CoinGecko 404s the coin id but DeFiLlama has it
 *   - CoinGecko is otherwise unreachable
 *
 * The router in server/price-history.ts orchestrates the priority.
 * This client is the primary path.
 *
 * Auth: free tier works without a key (with strict rate limits). For
 * higher throughput set COINGECKO_API_KEY (Demo or Pro). Pro keys go
 * to `pro-api.coingecko.com`; Demo / unauth go to `api.coingecko.com`.
 */

import { getRequestSignal } from "./request-context";
import { wrapInCircuit } from "./circuit-breaker";

const CG_PRO_KEY = process.env.COINGECKO_API_KEY?.trim() || "";
const CG_BASE = CG_PRO_KEY
  ? "https://pro-api.coingecko.com/api/v3"
  : "https://api.coingecko.com/api/v3";

if (CG_PRO_KEY) {
  console.log("[CoinGecko] Pro API key detected — routing through pro-api.coingecko.com");
}

export interface CoinPriceHistory {
  /** Same shape as defillama-client's CoinPriceHistory for drop-in compatibility. */
  prices: { date: number; price: number }[];
  symbol: string;
}

export class CoinGeckoRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoinGeckoRateLimitError";
  }
}

export class CoinGeckoNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoinGeckoNotFoundError";
  }
}

async function fetchCgRaw(url: string): Promise<any> {
  const signal = getRequestSignal();
  signal?.throwIfAborted();
  const headers: Record<string, string> = { accept: "application/json" };
  if (CG_PRO_KEY) headers["x-cg-pro-api-key"] = CG_PRO_KEY;
  const res = await fetch(url, { signal, headers });
  if (res.status === 429) {
    throw new CoinGeckoRateLimitError(`CoinGecko rate limited (${res.status})`);
  }
  if (res.status === 404) {
    throw new CoinGeckoNotFoundError(`CoinGecko coin id not found (${res.status})`);
  }
  if (!res.ok) throw new Error(`CoinGecko API error (${res.status}): ${url}`);
  return res.json();
}

const fetchCg = wrapInCircuit("coingecko", fetchCgRaw);

/**
 * Fetch daily price history for a CoinGecko coin id (e.g. "bitcoin",
 * "hyperliquid", "octra"). Returns the same shape as
 * defillama-client's `getCoinPriceHistory` so callers can swap
 * transparently.
 *
 * Source-side hygiene: drops NaN, null, negative, and zero prices.
 * Mirrors the filter in defillama-client.ts — bad data points (LP
 * imbalances, pool migrations) shouldn't enter the chart pipeline.
 *
 * Throws CoinGeckoRateLimitError on 429 and CoinGeckoNotFoundError on
 * 404 so the router in price-history.ts can decide how to fall back.
 */
export async function getCoinPriceHistory(
  coinId: string,
  daysBack: number = 90,
): Promise<CoinPriceHistory> {
  if (!coinId || typeof coinId !== "string") {
    return { prices: [], symbol: coinId || "" };
  }

  // CoinGecko's /coins/{id}/market_chart returns prices in [ms, price]
  // pairs with `days=N` meaning "last N days". Free-tier resolution is:
  //   1 day  → minutely
  //   2-90   → hourly
  //   91+    → daily
  // We always want daily for chart pipelines; CoinGecko picks daily
  // automatically when days > 90. For shorter windows we'd get hourly,
  // which is too dense for a 90-day chart — cap interval at "daily"
  // explicitly via `interval=daily` when supported.
  const interval = daysBack >= 2 ? "&interval=daily" : "";
  const url = `${CG_BASE}/coins/${encodeURIComponent(coinId.toLowerCase())}/market_chart?vs_currency=usd&days=${daysBack}${interval}`;

  let data: any;
  try {
    data = await fetchCg(url);
  } catch (err) {
    // Re-throw classified errors so the router can react; other errors
    // bubble up as generic API failures.
    throw err;
  }

  const rawPrices: any[] = Array.isArray(data?.prices) ? data.prices : [];

  // Hygiene filter mirroring defillama-client.ts — drop NaN, null,
  // negative, zero. CoinGecko response is [[ts_ms, price], ...].
  const clean = rawPrices.filter((p) => {
    const v = Array.isArray(p) ? p[1] : null;
    return typeof v === "number" && Number.isFinite(v) && v > 0;
  });

  return {
    prices: clean.map((p: any[]) => ({
      // Normalize to seconds-since-epoch (the same unit defillama-client
      // returns) so downstream charts don't need to branch.
      date: Math.floor(p[0] / 1000),
      price: p[1],
    })),
    symbol: coinId,
  };
}

/**
 * Fetch the current price for a CoinGecko id. Companion to
 * getCoinPriceHistory for tools that just want the latest tick.
 */
export async function getCurrentPrice(coinId: string): Promise<number | null> {
  if (!coinId) return null;
  try {
    const data = await fetchCg(
      `${CG_BASE}/simple/price?ids=${encodeURIComponent(coinId.toLowerCase())}&vs_currencies=usd`,
    );
    const price = data?.[coinId.toLowerCase()]?.usd;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}
