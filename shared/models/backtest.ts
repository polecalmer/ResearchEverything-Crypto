import { sql } from "drizzle-orm";
import {
  pgTable, text, varchar, timestamp, integer, jsonb, boolean,
  doublePrecision, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// BACKTESTING — OHLCV warehouse + strategy/run history
// ═══════════════════════════════════════════════════════════════
//
// Lives in its own file so the backtest module's schema can move
// independently of shared/schema.ts. Re-exported from shared/schema.ts
// for backwards compatibility.

export const EXCHANGES = ["binance", "bybit", "coinbase", "hyperliquid"] as const;
export type ExchangeSlug = typeof EXCHANGES[number];

export const OHLCV_INTERVALS = ["1h", "1d"] as const;
export type OhlcvInterval = typeof OHLCV_INTERVALS[number];

export const exchanges = pgTable("exchanges", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const markets = pgTable("markets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exchangeSlug: text("exchange_slug").notNull(),
  symbol: text("symbol").notNull(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  type: text("type").notNull().default("spot"),
  listedAt: timestamp("listed_at"),
  status: text("status").notNull().default("active"),
  quoteVolume24h: doublePrecision("quote_volume_24h"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  exchangeSymbolUnique: uniqueIndex("markets_exchange_symbol_unique").on(table.exchangeSlug, table.symbol),
  baseIdx: index("markets_base_idx").on(table.base),
}));

export const ohlcv1h = pgTable("ohlcv_1h", {
  marketId: varchar("market_id").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
  quoteVolume: doublePrecision("quote_volume"),
  trades: integer("trades"),
}, (table) => ({
  pk: uniqueIndex("ohlcv_1h_pk").on(table.marketId, table.ts),
  tsIdx: index("ohlcv_1h_ts_idx").on(table.ts),
}));

export const ohlcv1d = pgTable("ohlcv_1d", {
  marketId: varchar("market_id").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
  quoteVolume: doublePrecision("quote_volume"),
  trades: integer("trades"),
}, (table) => ({
  pk: uniqueIndex("ohlcv_1d_pk").on(table.marketId, table.ts),
  tsIdx: index("ohlcv_1d_ts_idx").on(table.ts),
}));

/** Persisted record of a single backtest invocation. */
export const backtestRuns = pgTable("backtest_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id"),
  sessionMessageId: varchar("session_message_id"),
  prompt: text("prompt").notNull(),
  thesis: text("thesis"),
  plan: jsonb("plan").notNull(),
  metrics: jsonb("metrics"),
  equityCurve: jsonb("equity_curve"),
  trades: jsonb("trades"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  llmCostUsd: doublePrecision("llm_cost_usd"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("backtest_runs_user_idx").on(table.userId),
  createdIdx: index("backtest_runs_created_idx").on(table.createdAt),
}));

export const insertBacktestRunSchema = createInsertSchema(backtestRuns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BacktestRun = typeof backtestRuns.$inferSelect;
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;

/** Strategies that have backtested successfully — analog of `proven_queries`. */
export const provenStrategies = pgTable("proven_strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  asset: text("asset").notNull(),
  strategyType: text("strategy_type").notNull(),
  plan: jsonb("plan").notNull(),
  lastSharpe: doublePrecision("last_sharpe"),
  lastReturn: doublePrecision("last_return"),
  lastMaxDrawdown: doublePrecision("last_max_drawdown"),
  successCount: integer("success_count").notNull().default(1),
  failCount: integer("fail_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  lastUsed: timestamp("last_used").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  assetStrategyIdx: index("proven_strategies_asset_strategy_idx").on(table.asset, table.strategyType),
}));

export const insertProvenStrategySchema = createInsertSchema(provenStrategies).omit({
  id: true,
  successCount: true,
  failCount: true,
  isActive: true,
  lastUsed: true,
  createdAt: true,
  updatedAt: true,
});
export type ProvenStrategy = typeof provenStrategies.$inferSelect;
export type InsertProvenStrategy = z.infer<typeof insertProvenStrategySchema>;

/** Health/staleness watermark for the WebSocket worker. */
export const marketDataHealth = pgTable("market_data_health", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  exchangeSlug: text("exchange_slug").notNull(),
  interval: text("interval").notNull(),
  lastBarTs: timestamp("last_bar_ts", { withTimezone: true }),
  lastIngestAt: timestamp("last_ingest_at", { withTimezone: true }),
  lastError: text("last_error"),
  workerId: text("worker_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  exchangeIntervalUnique: uniqueIndex("market_data_health_unique").on(table.exchangeSlug, table.interval),
}));

export type Market = typeof markets.$inferSelect;
export type Exchange = typeof exchanges.$inferSelect;
export type Ohlcv1h = typeof ohlcv1h.$inferSelect;
export type Ohlcv1d = typeof ohlcv1d.$inferSelect;
