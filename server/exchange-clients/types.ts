import type { ExchangeSlug, OhlcvInterval } from "@shared/schema";

export interface NormalizedKline {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number | null;
  trades: number | null;
}

export interface NormalizedMarket {
  exchangeSlug: ExchangeSlug;
  symbol: string;
  base: string;
  quote: string;
  type: "spot" | "perp";
  status: "active" | "delisted";
  quoteVolume24h: number | null;
}

export interface ExchangeClient {
  slug: ExchangeSlug;
  listMarkets(): Promise<NormalizedMarket[]>;
  fetchKlines(args: {
    symbol: string;
    interval: OhlcvInterval;
    since: Date;
    until?: Date;
    limit?: number;
  }): Promise<NormalizedKline[]>;
  /** Symbol-format used by the exchange's WebSocket kline stream. */
  wsSymbolFormat?: (symbol: string) => string;
  /** WebSocket URL for kline streams. The worker subscribes externally. */
  wsKlineUrl?(args: { symbols: string[]; interval: OhlcvInterval }): string;
  /** Parse a raw WS message into normalized klines. Returns the closed bar
   *  (and any ones the message bundles); ignores in-progress bars. */
  parseWsKlineMessage?(raw: any): Array<{ symbol: string; bar: NormalizedKline }>;
}

export const INTERVAL_MS: Record<OhlcvInterval, number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};
