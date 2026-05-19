/**
 * Price-history router — CoinGecko primary, DeFiLlama fallback.
 *
 * Replaces the previous "always DeFiLlama" path that was actually
 * proxying CoinGecko through DeFiLlama's coins API. Going direct to
 * CoinGecko gets us:
 *   - Lower latency (no proxy hop)
 *   - Fresher data (no DeFiLlama cache layer)
 *   - Cleaner errors (429 vs cached-stale)
 *
 * DeFiLlama remains as a fallback for:
 *   - CoinGecko 429 (rate limit)
 *   - CoinGecko 404 (coin id mismatch — DeFiLlama sometimes has slugs
 *     CoinGecko doesn't, especially for new launches)
 *   - CoinGecko outage
 *
 * Same return shape (`CoinPriceHistory`) as both underlying clients, so
 * callers don't need to know which source served the response. The
 * router logs which source fired for telemetry.
 */

import * as coingecko from "./coingecko-client";
import * as defillama from "./defillama-client";
import { logger } from "./logger";

export interface CoinPriceHistory {
  prices: { date: number; price: number }[];
  symbol: string;
  /** Which source served this response. Useful for debugging and
   *  telemetry; downstream callers can ignore. */
  source?: "coingecko" | "defillama" | "none";
}

/**
 * Fetch daily price history with automatic source selection.
 *
 * @param coinId  CoinGecko coin id (e.g. "bitcoin", "hyperliquid"). The
 *                same id usually works against DeFiLlama's `coingecko:`
 *                prefixed route, so a single id covers both sources.
 * @param daysBack Window length in days. Defaults to 90.
 */
export async function getCoinPriceHistory(
  coinId: string,
  daysBack: number = 90,
): Promise<CoinPriceHistory> {
  if (!coinId || typeof coinId !== "string") {
    return { prices: [], symbol: coinId || "", source: "none" };
  }

  // 1) Try CoinGecko direct (primary).
  try {
    const t0 = Date.now();
    const result = await coingecko.getCoinPriceHistory(coinId, daysBack);
    if (result.prices.length > 0) {
      logger.debug?.(
        { source: "coingecko", coinId, points: result.prices.length, durationMs: Date.now() - t0 },
        "price-history hit (coingecko)",
      );
      return { ...result, source: "coingecko" };
    }
    // Zero rows from CoinGecko isn't an error per se, but it's also not
    // a useful result. Fall through to DeFiLlama.
    logger.debug?.({ coinId }, "coingecko returned 0 rows — trying defillama fallback");
  } catch (err: any) {
    const isRateLimit = err?.name === "CoinGeckoRateLimitError";
    const isNotFound = err?.name === "CoinGeckoNotFoundError";
    if (isRateLimit) {
      logger.warn?.({ coinId, err: err?.message }, "coingecko rate-limited — falling back to defillama");
    } else if (isNotFound) {
      logger.debug?.({ coinId, err: err?.message }, "coingecko 404 — falling back to defillama");
    } else {
      logger.warn?.({ coinId, err: err?.message }, "coingecko errored — falling back to defillama");
    }
    // fall through
  }

  // 2) DeFiLlama fallback (which itself wraps CoinGecko under the hood,
  // but with their cache + retry layer + slug normalisation).
  try {
    const t0 = Date.now();
    const result = await defillama.getCoinPriceHistory(coinId, daysBack);
    logger.debug?.(
      { source: "defillama", coinId, points: result.prices.length, durationMs: Date.now() - t0 },
      "price-history hit (defillama fallback)",
    );
    return { ...result, source: "defillama" };
  } catch (err: any) {
    logger.warn?.({ coinId, err: err?.message }, "both coingecko and defillama failed for price history");
    return { prices: [], symbol: coinId, source: "none" };
  }
}
