import type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
import type { OhlcvInterval } from "@shared/schema";

const REST = "https://api.bybit.com";
const WS = "wss://stream.bybit.com/v5/public/spot";

const INTERVAL_MAP: Record<OhlcvInterval, string> = {
  "1h": "60",   // bybit uses minutes
  "1d": "D",
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "ResearchEverything/backtest" } });
  if (!res.ok) throw new Error(`bybit ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const bybit: ExchangeClient = {
  slug: "bybit",

  async listMarkets() {
    type InfoResp = { result: { list: Array<{ symbol: string; baseCoin: string; quoteCoin: string; status: string }> } };
    type TickResp = { result: { list: Array<{ symbol: string; turnover24h: string }> } };
    const [info, tick] = await Promise.all([
      getJson<InfoResp>(`${REST}/v5/market/instruments-info?category=spot`),
      getJson<TickResp>(`${REST}/v5/market/tickers?category=spot`),
    ]);
    const volMap = new Map(tick.result.list.map(t => [t.symbol, parseFloat(t.turnover24h)]));
    return info.result.list
      .filter(s => s.status === "Trading")
      .map<NormalizedMarket>(s => ({
        exchangeSlug: "bybit",
        symbol: s.symbol,
        base: s.baseCoin,
        quote: s.quoteCoin,
        type: "spot",
        status: "active",
        quoteVolume24h: volMap.get(s.symbol) ?? null,
      }));
  },

  async fetchKlines({ symbol, interval, since, until, limit = 1000 }) {
    const params = new URLSearchParams({
      category: "spot",
      symbol,
      interval: INTERVAL_MAP[interval],
      start: String(since.getTime()),
      limit: String(Math.min(limit, 1000)),
    });
    if (until) params.set("end", String(until.getTime()));
    type Resp = { result: { list: Array<[string, string, string, string, string, string, string]> } };
    const data = await getJson<Resp>(`${REST}/v5/market/kline?${params.toString()}`);
    // bybit returns newest-first; reverse for ascending order
    return data.result.list
      .slice()
      .reverse()
      .map<NormalizedKline>(r => ({
        ts: new Date(parseInt(r[0], 10)),
        open: parseFloat(r[1]),
        high: parseFloat(r[2]),
        low: parseFloat(r[3]),
        close: parseFloat(r[4]),
        volume: parseFloat(r[5]),
        quoteVolume: parseFloat(r[6]),
        trades: null,
      }));
  },

  wsKlineUrl() {
    return WS;   // bybit subscribes via initial JSON message; the worker handles that
  },

  parseWsKlineMessage(raw) {
    // { topic: "kline.60.BTCUSDT", data: [ { start, end, interval, open, ..., confirm } ] }
    const topic: string = raw?.topic || "";
    if (!topic.startsWith("kline.")) return [];
    const parts = topic.split(".");
    const symbol = parts[2];
    const out: Array<{ symbol: string; bar: NormalizedKline }> = [];
    for (const k of raw.data || []) {
      if (!k.confirm) continue;
      out.push({
        symbol,
        bar: {
          ts: new Date(parseInt(k.start, 10)),
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume),
          quoteVolume: parseFloat(k.turnover),
          trades: null,
        },
      });
    }
    return out;
  },
};
