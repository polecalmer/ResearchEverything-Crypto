/**
 * Persistent WebSocket worker — subscribes to kline streams from binance,
 * bybit, coinbase, hyperliquid and writes closed bars into ohlcv_1h /
 * ohlcv_1d.  Heartbeats per exchange, auto-reconnects with exponential
 * backoff.  Designed to run on a Reserved VM / dedicated machine — NOT on
 * Replit autoscale (instances spin down).
 *
 * Run:
 *   tsx workers/market-data-stream/index.ts
 *
 * Env:
 *   DATABASE_URL                — same Postgres as the API
 *   MARKET_STREAM_INTERVAL      — "1h" (default) or "1d"
 *   MARKET_STREAM_TOP_N         — how many of the seeded markets per exchange
 *                                  to subscribe to (default 50)
 *   MARKET_STREAM_EXCHANGES     — comma-separated, default all four
 *   MARKET_STREAM_WORKER_ID     — opaque tag written to market_data_health
 */
import "dotenv/config";
import WebSocket from "ws";
import { EXCHANGE_CLIENTS } from "../../server/exchange-clients";
import { backtestStorage } from "../../server/backtest/storage";
import { EXCHANGES, type ExchangeSlug, type OhlcvInterval, type Market } from "@shared/schema";

const INTERVAL = (process.env.MARKET_STREAM_INTERVAL || "1h") as OhlcvInterval;
const TOP_N = parseInt(process.env.MARKET_STREAM_TOP_N || "50", 10);
const WORKER_ID = process.env.MARKET_STREAM_WORKER_ID || `worker-${process.pid}`;
const ENABLED_EXCHANGES = (process.env.MARKET_STREAM_EXCHANGES?.split(",").filter(Boolean) as ExchangeSlug[] | undefined)
  ?? [...EXCHANGES];

interface StreamState {
  exchange: ExchangeSlug;
  markets: Market[];
  ws?: WebSocket;
  reconnectAttempts: number;
  closed: boolean;
}

const STATES: Record<ExchangeSlug, StreamState | null> = {
  binance: null, bybit: null, coinbase: null, hyperliquid: null,
};

async function loadUniverse(slug: ExchangeSlug): Promise<Market[]> {
  return backtestStorage.listMarketsForExchange(slug, { topNByVolume: TOP_N });
}

function backoffMs(attempt: number) {
  return Math.min(60_000, 1000 * 2 ** attempt + Math.floor(Math.random() * 500));
}

async function persistBar(slug: ExchangeSlug, symbol: string, bar: any) {
  const marketId = STATES[slug]?.markets.find(m => m.symbol === symbol)?.id;
  if (!marketId) return;
  await backtestStorage.upsertKlines(marketId, INTERVAL, [bar]);
  await backtestStorage.upsertHealth({
    exchangeSlug: slug,
    interval: INTERVAL,
    lastBarTs: bar.ts,
    workerId: WORKER_ID,
  });
}

function connect(slug: ExchangeSlug) {
  const state = STATES[slug];
  if (!state || state.closed) return;
  const client = EXCHANGE_CLIENTS[slug];
  if (!client.wsKlineUrl || !client.parseWsKlineMessage) {
    console.log(`[ws] ${slug}: client has no streaming support; skipping`);
    return;
  }

  const symbols = state.markets.map(m => m.symbol);
  const url = client.wsKlineUrl({ symbols, interval: INTERVAL });
  console.log(`[ws] ${slug}: connecting to ${url} (${symbols.length} symbols)`);
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.on("open", () => {
    console.log(`[ws] ${slug}: open`);
    state.reconnectAttempts = 0;

    // Bybit / hyperliquid / coinbase need an explicit subscribe frame.
    if (slug === "bybit") {
      ws.send(JSON.stringify({
        op: "subscribe",
        args: symbols.map(s => `kline.${INTERVAL === "1h" ? "60" : "D"}.${s}`),
      }));
    } else if (slug === "hyperliquid") {
      // Hydromancer's `allCandles` channel batches all symbols-with-activity
      // per block in a single subscription — far cheaper than N `candle` subs.
      // Symbols not in our universe get filtered in persistBar.
      ws.send(JSON.stringify({
        method: "subscribe",
        subscription: { type: "allCandles", interval: INTERVAL },
      }));
    } else if (slug === "coinbase") {
      ws.send(JSON.stringify({
        type: "subscribe",
        product_ids: symbols,
        channels: ["matches"],   // we'll resample matches into bars; v1: noop
      }));
    }
  });

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const bars = client.parseWsKlineMessage!(msg);
      for (const { symbol, bar } of bars) {
        await persistBar(slug, symbol, bar);
      }
    } catch (err: any) {
      // Some exchanges send pings/heartbeats that aren't JSON — ignore.
    }
  });

  ws.on("close", (code) => {
    console.warn(`[ws] ${slug}: closed (code=${code})`);
    if (state.closed) return;
    const delay = backoffMs(state.reconnectAttempts++);
    setTimeout(() => connect(slug), delay);
  });

  ws.on("error", async (err) => {
    console.error(`[ws] ${slug}: error: ${err.message}`);
    await backtestStorage.upsertHealth({
      exchangeSlug: slug,
      interval: INTERVAL,
      lastError: err.message.slice(0, 500),
      workerId: WORKER_ID,
    }).catch(() => { /* swallow */ });
  });
}

async function main() {
  console.log(`[ws] starting market-data-stream worker (${WORKER_ID})`);
  console.log(`[ws] interval=${INTERVAL}, top_n=${TOP_N}, exchanges=${ENABLED_EXCHANGES.join(",")}`);

  for (const slug of ENABLED_EXCHANGES) {
    const markets = await loadUniverse(slug);
    if (markets.length === 0) {
      console.log(`[ws] ${slug}: no seeded markets — run scripts/seed-ohlcv.ts first`);
      continue;
    }
    STATES[slug] = { exchange: slug, markets, reconnectAttempts: 0, closed: false };
    connect(slug);
  }

  process.on("SIGINT", async () => {
    console.log(`[ws] shutting down…`);
    for (const slug of ENABLED_EXCHANGES) {
      const s = STATES[slug];
      if (s) { s.closed = true; s.ws?.close(); }
    }
    setTimeout(() => process.exit(0), 1000);
  });
}

main().catch(err => {
  console.error("[ws] fatal:", err);
  process.exit(1);
});
