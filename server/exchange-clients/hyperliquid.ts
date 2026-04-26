import type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
import type { OhlcvInterval } from "@shared/schema";

/**
 * Hyperliquid market data, fetched via Hydromancer.
 *
 * Hydromancer wraps the native Hyperliquid /info endpoint and adds:
 *   - 1-second candles (not available natively)
 *   - >5,000 historical bars per request
 *   - dedicated WS stream (wss://api.hydromancer.xyz/ws) with seq/cursor framing
 *
 * Auth: Bearer token (REST) / token query param (WS) — same key for both.
 * Reach out to data@hydromancer.xyz to provision.
 */

const REST = "https://api.hydromancer.xyz/info";
const WS = "wss://api.hydromancer.xyz/ws";
const WS_TESTNET = "wss://api-testnet.hydromancer.xyz/ws";

const INTERVAL_MAP: Record<OhlcvInterval, string> = {
  "1h": "1h",
  "1d": "1d",
};

function apiKey(): string | null {
  return process.env.HYDROMANCER_API_KEY || null;
}

async function postJson<T>(body: unknown): Promise<T> {
  const key = apiKey();
  if (!key) throw new Error("HYDROMANCER_API_KEY not set");
  const res = await fetch(REST, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "User-Agent": "ResearchEverything/backtest",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`hydromancer ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const hyperliquid: ExchangeClient = {
  slug: "hyperliquid",

  async listMarkets() {
    // metaAndAssetCtxs is proxied by Hydromancer; same response shape as native.
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

  async fetchKlines({ symbol, interval, since, until, limit }) {
    // Hydromancer's candleSnapshot accepts up to 5000 bars per request and
    // adds richer fields (q = quoteVolume, x = closed-flag) that the native HL
    // info endpoint omits. Field shape matches the WS bar schema.
    type Candle = {
      s?: string; i?: string;
      t: number; T?: number;
      o: string; c: string; h: string; l: string;
      v: string; q?: string; n?: number; x?: boolean;
    };
    const data = await postJson<Candle[]>({
      type: "candleSnapshot",
      req: {
        coin: symbol,
        interval: INTERVAL_MAP[interval],
        startTime: since.getTime(),
        endTime: (until ?? new Date()).getTime(),
        limit: Math.min(limit ?? 5000, 5000),
      },
    });
    return (data || []).map<NormalizedKline>(r => ({
      ts: new Date(r.t),
      open: parseFloat(r.o),
      high: parseFloat(r.h),
      low: parseFloat(r.l),
      close: parseFloat(r.c),
      volume: parseFloat(r.v),
      quoteVolume: r.q ? parseFloat(r.q) : null,
      trades: r.n ?? null,
    }));
  },

  wsKlineUrl() {
    const key = apiKey();
    if (!key) throw new Error("HYDROMANCER_API_KEY not set");
    const base = process.env.HYDROMANCER_TESTNET === "1" ? WS_TESTNET : WS;
    return `${base}?token=${encodeURIComponent(key)}`;
  },

  parseWsKlineMessage(raw) {
    // Hydromancer WS frame: { type, seq, cursor, data: { s,i,t,T,o,h,l,c,v,q,n,x } }
    // 'allCandles' channel uses the same shape but with data: [...]
    if (raw?.type === "candle" && raw.data) {
      const d = raw.data;
      return [{
        symbol: d.s,
        bar: {
          ts: new Date(d.t),
          open: parseFloat(d.o),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
          close: parseFloat(d.c),
          volume: parseFloat(d.v),
          quoteVolume: d.q ? parseFloat(d.q) : null,
          trades: d.n ?? null,
        },
      }];
    }
    if (raw?.type === "allCandles" && Array.isArray(raw.data)) {
      return raw.data.map((d: any) => ({
        symbol: d.s,
        bar: {
          ts: new Date(d.t),
          open: parseFloat(d.o),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
          close: parseFloat(d.c),
          volume: parseFloat(d.v),
          quoteVolume: d.q ? parseFloat(d.q) : null,
          trades: d.n ?? null,
        },
      }));
    }
    return [];
  },
};
