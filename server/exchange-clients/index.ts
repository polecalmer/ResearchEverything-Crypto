import type { ExchangeSlug } from "@shared/schema";
import type { ExchangeClient } from "./types";
import { binance } from "./binance";
import { bybit } from "./bybit";
import { coinbase } from "./coinbase";
import { hyperliquid } from "./hyperliquid";

export const EXCHANGE_CLIENTS: Record<ExchangeSlug, ExchangeClient> = {
  binance,
  bybit,
  coinbase,
  hyperliquid,
};

export type { ExchangeClient, NormalizedKline, NormalizedMarket } from "./types";
