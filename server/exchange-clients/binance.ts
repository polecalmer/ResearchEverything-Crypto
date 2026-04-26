import type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
import type { OhlcvInterval } from "@shared/schema";

const REST = "https://api.binance.com";
const WS = "wss://stream.binance.com:9443/stream";

const INTERVAL_MAP: Record<OhlcvInterval, string> = {
  "1h": "1h",
  "1d": "1d",
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "ResearchEverything/backtest" } });
  if (!res.ok) throw new Error(`binance ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const binance: ExchangeClient = {
  slug: "binance",

  async listMarkets() {
    type ExchangeInfo = { symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }> };
    type Ticker24 = Array<{ symbol: string; quoteVolume: string }>;
    const [info, tickers] = await Promise.all([
      getJson<ExchangeInfo>(`${REST}/api/v3/exchangeInfo`),
      getJson<Ticker24>(`${REST}/api/v3/ticker/24hr`),
    ]);
    const volMap = new Map(tickers.map(t => [t.symbol, parseFloat(t.quoteVolume)]));
    return info.symbols
      .filter(s => s.status === "TRADING")
      .map<NormalizedMarket>(s => ({
        exchangeSlug: "binance",
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset,
        type: "spot",
        status: "active",
        quoteVolume24h: volMap.get(s.symbol) ?? null,
      }));
  },

  async fetchKlines({ symbol, interval, since, until, limit = 1000 }) {
    const params = new URLSearchParams({
      symbol,
      interval: INTERVAL_MAP[interval],
      startTime: String(since.getTime()),
      limit: String(Math.min(limit, 1000)),
    });
    if (until) params.set("endTime", String(until.getTime()));
    type Kline = [number, string, string, string, string, string, number, string, number, string, string, string];
    const rows = await getJson<Kline[]>(`${REST}/api/v3/klines?${params.toString()}`);
    return rows.map<NormalizedKline>(r => ({
      ts: new Date(r[0]),
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
      quoteVolume: parseFloat(r[7]),
      trades: r[8],
    }));
  },

  wsSymbolFormat: (s) => s.toLowerCase(),

  wsKlineUrl({ symbols, interval }) {
    const streams = symbols.map(s => `${s.toLowerCase()}@kline_${INTERVAL_MAP[interval]}`).join("/");
    return `${WS}?streams=${streams}`;
  },

  parseWsKlineMessage(raw) {
    // Combined-stream payload: { stream, data: { e, s, k: {...} } }
    const k = raw?.data?.k;
    if (!k || !k.x) return [];   // x === bar closed
    const symbol = raw.data.s as string;
    return [{
      symbol,
      bar: {
        ts: new Date(k.t),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        quoteVolume: parseFloat(k.q),
        trades: k.n ?? null,
      },
    }];
  },
};
