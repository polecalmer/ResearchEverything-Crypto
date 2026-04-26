/**
 * One-shot OHLCV backfill across binance, bybit, coinbase, hyperliquid.
 *
 * Walks each exchange's market list, picks the top-N markets by 24h quote
 * volume (plus an explicit allowlist), then pulls 2y of daily and 2y of
 * hourly bars in batches. Idempotent and resumable: each market resumes from
 * its existing max(ts) in the OHLCV table.
 *
 * Usage:
 *   tsx scripts/seed-ohlcv.ts                           # default: top-50 per exchange, 2y, 1d+1h
 *   tsx scripts/seed-ohlcv.ts --exchanges binance,bybit
 *   tsx scripts/seed-ohlcv.ts --top 100 --days 730
 *   tsx scripts/seed-ohlcv.ts --intervals 1d           # daily only
 *   tsx scripts/seed-ohlcv.ts --symbols BTC,ETH,SOL    # specific bases only
 */
import "dotenv/config";
import pLimit from "p-limit";
import { EXCHANGE_CLIENTS } from "../server/exchange-clients";
import { backtestStorage } from "../server/backtest-storage";
import { EXCHANGES, OHLCV_INTERVALS, type ExchangeSlug, type OhlcvInterval } from "@shared/schema";
import type { Market } from "@shared/schema";

interface CliArgs {
  exchanges: ExchangeSlug[];
  intervals: OhlcvInterval[];
  topN: number;
  days: number;
  symbols?: string[];        // base-asset filter (e.g. BTC, ETH)
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const exchanges = (get("--exchanges")?.split(",") as ExchangeSlug[] | undefined)
    ?.filter(e => EXCHANGES.includes(e)) ?? [...EXCHANGES];
  const intervals = (get("--intervals")?.split(",") as OhlcvInterval[] | undefined)
    ?.filter(i => OHLCV_INTERVALS.includes(i)) ?? [...OHLCV_INTERVALS];
  const topN = parseInt(get("--top") ?? "50", 10);
  const days = parseInt(get("--days") ?? "730", 10);
  const symbols = get("--symbols")?.split(",").map(s => s.trim().toUpperCase());
  return { exchanges, intervals, topN, days, symbols };
}

const INTERVAL_MS: Record<OhlcvInterval, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

// Bars fetchable per request, exchange-aware. We use the smaller of (limit,
// our internal chunk size) to stay polite.
const PER_REQUEST_LIMIT: Record<ExchangeSlug, number> = {
  binance: 1000,
  bybit: 1000,
  coinbase: 300,
  hyperliquid: 5000,
};

async function seedMarket(
  market: Market,
  interval: OhlcvInterval,
  earliestStart: Date,
) {
  const slug = market.exchangeSlug as ExchangeSlug;
  const client = EXCHANGE_CLIENTS[slug];
  const latest = await backtestStorage.getLatestBarTs(market.id, interval);
  let cursor = latest ? new Date(latest.getTime() + INTERVAL_MS[interval]) : earliestStart;
  const now = new Date();
  let totalInserted = 0;

  while (cursor.getTime() < now.getTime()) {
    let bars;
    try {
      bars = await client.fetchKlines({
        symbol: market.symbol,
        interval,
        since: cursor,
        until: now,
        limit: PER_REQUEST_LIMIT[slug],
      });
    } catch (err: any) {
      console.error(`[seed-ohlcv] ${slug}/${market.symbol}/${interval} fetch failed: ${err.message}`);
      break;
    }
    if (!bars || bars.length === 0) break;

    const filtered = bars.filter(b => b.ts.getTime() >= cursor.getTime());
    if (filtered.length === 0) break;

    const inserted = await backtestStorage.upsertKlines(market.id, interval, filtered);
    totalInserted += inserted;

    const lastTs = filtered[filtered.length - 1].ts;
    const nextCursor = new Date(lastTs.getTime() + INTERVAL_MS[interval]);
    if (nextCursor.getTime() <= cursor.getTime()) break;   // safety
    cursor = nextCursor;

    // Be polite — exchanges throttle aggressive backfill
    await new Promise(r => setTimeout(r, 150));
  }

  return totalInserted;
}

async function seedExchange(slug: ExchangeSlug, args: CliArgs, earliestStart: Date) {
  const client = EXCHANGE_CLIENTS[slug];
  console.log(`[seed-ohlcv] ${slug}: registering exchange + listing markets…`);
  await backtestStorage.upsertExchange(slug, slug);
  const allMarkets = await client.listMarkets();
  console.log(`[seed-ohlcv] ${slug}: ${allMarkets.length} markets fetched`);

  // Filter: stable quotes only (USDT/USDC/USD), then top-N by quote volume,
  // optionally narrowed to user-specified bases.
  let filtered = allMarkets.filter(m => ["USDT", "USDC", "USD"].includes(m.quote));
  if (args.symbols) {
    filtered = filtered.filter(m => args.symbols!.includes(m.base.toUpperCase()));
  }
  filtered.sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0));
  const universe = filtered.slice(0, args.topN);
  console.log(`[seed-ohlcv] ${slug}: seeding ${universe.length} markets`);

  await backtestStorage.upsertMarkets(universe);
  const persisted = await backtestStorage.listMarketsForExchange(slug);
  const universeSet = new Set(universe.map(m => m.symbol));
  const targets = persisted.filter(m => universeSet.has(m.symbol));

  const limit = pLimit(2);     // conservative — most exchanges throttle hard
  let exchangeInserted = 0;

  for (const interval of args.intervals) {
    console.log(`[seed-ohlcv] ${slug}/${interval}: backfilling ${targets.length} markets`);
    const results = await Promise.all(targets.map(m => limit(async () => {
      try {
        const n = await seedMarket(m, interval, earliestStart);
        if (n > 0) console.log(`[seed-ohlcv]   ${slug}/${m.symbol}/${interval}: +${n} bars`);
        return n;
      } catch (err: any) {
        console.error(`[seed-ohlcv]   ${slug}/${m.symbol}/${interval}: ${err.message}`);
        return 0;
      }
    })));
    const n = results.reduce((a, b) => a + b, 0);
    exchangeInserted += n;
    console.log(`[seed-ohlcv] ${slug}/${interval}: total +${n} bars`);
  }

  return exchangeInserted;
}

async function main() {
  const args = parseArgs();
  const earliestStart = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  console.log(`[seed-ohlcv] config:`, {
    exchanges: args.exchanges,
    intervals: args.intervals,
    topN: args.topN,
    days: args.days,
    earliestStart: earliestStart.toISOString(),
    symbolsFilter: args.symbols ?? "(none — top-N by volume)",
  });

  let total = 0;
  for (const slug of args.exchanges) {
    try {
      const n = await seedExchange(slug, args, earliestStart);
      total += n;
    } catch (err: any) {
      console.error(`[seed-ohlcv] ${slug} failed:`, err.message);
    }
  }

  console.log(`[seed-ohlcv] DONE — ${total} bars inserted across all exchanges`);
  process.exit(0);
}

main().catch(err => {
  console.error("[seed-ohlcv] fatal:", err);
  process.exit(1);
});
