/**
 * Pluggable interfaces for the backtest module.
 *
 * The module is designed to run three ways:
 *   1. Inside Sessions (this repo) — adapters wire to mpp-client + Postgres.
 *   2. Standalone Node CLI — adapters wire to @anthropic-ai/sdk + SQLite/inline.
 *   3. As a library on third-party datasets — caller supplies inline OHLCV.
 *
 * Concrete implementations live in ./adapters/*.ts. The agent never imports
 * mpp-client / pg / @shared/schema directly — it takes these via the
 * BacktestContext, so the module stays portable.
 */
import type { BacktestPlan } from "./agent";
import type { ExchangeSlug, OhlcvInterval, Market } from "@shared/schema";

// ─── LLM ────────────────────────────────────────────────────────────────────

export interface LLMRequest {
  model: string;
  system: string;
  userMessage: string;
  maxTokens: number;
}
export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export interface LLMClient {
  /** Names of the model tier the caller wants to use. The adapter resolves
   *  these to concrete model IDs (so callers don't need to know whether
   *  Sessions uses 'claude-opus-4-7' or the standalone path uses something
   *  else). */
  modelFor(tier: "planner" | "retry"): string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}

// ─── Market metadata + OHLCV ────────────────────────────────────────────────

export interface OhlcvBar {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number | null;
  trades: number | null;
}

export interface DataProvider {
  /** Resolve (exchange, symbol) → market id (or null if not seeded). */
  resolveMarket(exchange: ExchangeSlug, symbol: string): Promise<Market | null>;
  /** List markets the planner can choose from, grouped by exchange. */
  listAvailableMarkets(opts?: { topN?: number }): Promise<Record<ExchangeSlug, Market[]>>;
  /** Pull bars for a market over the lookback window. May return zero rows. */
  getOhlcv(args: { marketId: string; interval: OhlcvInterval; start: Date; end: Date }): Promise<OhlcvBar[]>;
}

// ─── Run + strategy persistence ─────────────────────────────────────────────

export interface RunStore {
  createRun(args: {
    userId?: string;
    prompt: string;
    plan: BacktestPlan;
  }): Promise<{ runId: string }>;
  finishRun(runId: string, args: {
    status: "ok" | "engine_error" | "no_market" | "plan_invalid";
    metrics?: any;
    equityCurve?: any[];
    trades?: any[];
    errorMessage?: string;
    durationMs: number;
    llmCostUsd: number;
  }): Promise<void>;
}

export interface StrategyCache {
  saveSuccessful(plan: BacktestPlan, metrics: { sharpe: number; total_return: number; max_drawdown: number }): Promise<void>;
}

// ─── Engine transport ───────────────────────────────────────────────────────

/** What the Node side ships to the Python sidecar. The engine accepts
 *  multiple data-source modes so the same service can run on Sessions
 *  Postgres, on a local parquet, or on inline bars from any caller. */
export type EngineDataSource =
  | { mode: "postgres"; market_id: string }
  | { mode: "inline"; bars: Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number; quote_volume?: number | null }> }
  | { mode: "parquet_url"; url: string; symbol: string }
  | { mode: "csv_path"; path: string };

export interface EngineRequest {
  plan: BacktestPlan;
  data: EngineDataSource;
}
export interface EngineMetrics {
  total_return: number;
  sharpe: number;
  sortino?: number;
  max_drawdown: number;
  win_rate?: number;
  trade_count?: number;
  exposure?: number;
  benchmark_return?: number;
  alpha_vs_hodl?: number;
}
export interface EngineResponse {
  metrics: EngineMetrics;
  equity_curve: Array<{ ts: string; equity: number }>;
  trades: any[];
  duration_ms?: number;
}
export interface EngineClient {
  run(req: EngineRequest): Promise<EngineResponse>;
}

// ─── Aggregate context handed to the agent ──────────────────────────────────

export interface BacktestContext {
  llm: LLMClient;
  data: DataProvider;
  runs: RunStore;
  strategies: StrategyCache;
  engine: EngineClient;
}
