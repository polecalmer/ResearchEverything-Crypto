import type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
import type { OhlcvInterval } from "@shared/schema";

const REST = "https://api.hyperliquid.xyz/info";
const WS = "wss://api.hyperliquid.xyz/ws";

const INTERVAL_MAP: Record<OhlcvInterval, string> = {
  "1h": "1h",
  "1d": "1d",
};

async function postJson<T>(body: unknown): Promise<T> {
  const res = await fetch(REST, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "ResearchEverything/backtest" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hyperliquid ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const hyperliquid: ExchangeClient = {
  slug: "hyperliquid",

  async listMarkets() {
    // Hyperliquid is perp-first. metaAndAssetCtxs returns universe + 24h vol.
    type MetaResp = [
      { universe: Array<{ name: string; szDecimals: number }> },
      Array<{ funding: string; openInterest: string; prevDayPx: string; dayNtlVlm: string; markPx: string }>,
    ];
    const data = await postJson<MetaResp>({ type: "metaAndAssetCtxs" });
    const [meta, ctxs] = data;
    return meta.universe.map<NormalizedMarket>((u, i) => ({
      exchangeSlug: "hyperliquid",
      symbol: u.name,
      base: u.name,
      quote: "USD",
      type: "perp",
      status: "active",
      quoteVolume24h: ctxs[i] ? parseFloat(ctxs[i].dayNtlVlm) : null,
    }));
  },

  async fetchKlines({ symbol, interval, since, until }) {
    type Candle = { t: number; T: number; o: string; c: string; h: string; l: string; v: string; n: number };
    const data = await postJson<Candle[]>({
      type: "candleSnapshot",
      req: {
        coin: symbol,
        interval: INTERVAL_MAP[interval],
        startTime: since.getTime(),
        endTime: (until ?? new Date()).getTime(),
      },
    });
    return (data || []).map<NormalizedKline>(r => ({
      ts: new Date(r.t),
      open: parseFloat(r.o),
      high: parseFloat(r.h),
      low: parseFloat(r.l),
      close: parseFloat(r.c),
      volume: parseFloat(r.v),
      quoteVolume: null,
      trades: r.n,
    }));
  },

  wsKlineUrl() {
    return WS;
  },

  parseWsKlineMessage(raw) {
    // { channel: "candle", data: { s, i, t, T, o, c, h, l, v, n } }
    if (raw?.channel !== "candle" || !raw.data) return [];
    const d = raw.data;
    // Hyperliquid pushes the in-progress bar with each tick. Treat T (close
    // time) <= now() as confirmed-by-time at the next bar; the worker
    // dedupes on (marketId, ts).
    return [{
      symbol: d.s,
      bar: {
        ts: new Date(d.t),
        open: parseFloat(d.o),
        high: parseFloat(d.h),
        low: parseFloat(d.l),
        close: parseFloat(d.c),
        volume: parseFloat(d.v),
        quoteVolume: null,
        trades: d.n ?? null,
      },
    }];
  },
};
