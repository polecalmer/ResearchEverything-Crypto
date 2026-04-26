import type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
import type { OhlcvInterval } from "@shared/schema";

const REST = "https://api.exchange.coinbase.com";
const WS = "wss://ws-feed.exchange.coinbase.com";

// Coinbase granularity is in seconds. Max 300 candles per request.
const GRANULARITY: Record<OhlcvInterval, number> = {
  "1h": 3600,
  "1d": 86400,
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "ResearchEverything/backtest" } });
  if (!res.ok) throw new Error(`coinbase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const coinbase: ExchangeClient = {
  slug: "coinbase",

  async listMarkets() {
    type Product = { id: string; base_currency: string; quote_currency: string; status: string; volume_24h?: string };
    const products = await getJson<Product[]>(`${REST}/products`);
    type Stats = { volume?: string };
    return products
      .filter(p => p.status === "online")
      .map<NormalizedMarket>(p => ({
        exchangeSlug: "coinbase",
        symbol: p.id,
        base: p.base_currency,
        quote: p.quote_currency,
        type: "spot",
        status: "active",
        quoteVolume24h: null,
      }));
  },

  async fetchKlines({ symbol, interval, since, until, limit = 300 }) {
    const start = since.toISOString();
    const end = (until ?? new Date(since.getTime() + GRANULARITY[interval] * 1000 * Math.min(limit, 300))).toISOString();
    const url = `${REST}/products/${symbol}/candles?granularity=${GRANULARITY[interval]}&start=${start}&end=${end}`;
    type Candle = [number, number, number, number, number, number]; // [time, low, high, open, close, volume]
    const rows = await getJson<Candle[]>(url);
    // coinbase returns newest-first; reverse for ascending
    return rows
      .slice()
      .reverse()
      .map<NormalizedKline>(r => ({
        ts: new Date(r[0] * 1000),
        open: r[3],
        high: r[2],
        low: r[1],
        close: r[4],
        volume: r[5],
        quoteVolume: null,
        trades: null,
      }));
  },

  wsKlineUrl() {
    return WS;   // worker sends a subscribe frame
  },

  parseWsKlineMessage(raw) {
    // Coinbase doesn't push kline-closed events natively for arbitrary intervals;
    // the worker reconstructs hourly bars from the matches/ticker channel. Left
    // as a passthrough — the worker calls fetchKlines on a short interval as a
    // fallback when streaming isn't viable for a given exchange.
    return [];
  },
};
