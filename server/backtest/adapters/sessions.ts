/**
 * Sessions adapter — binds the BacktestContext interfaces to this repo's
 * existing infrastructure: mpp-client for LLM, Postgres + Drizzle for data
 * and persistence, and an HTTP client for the Python engine.
 *
 * For a standalone Node deployment, swap this file for ./adapters/standalone.ts
 * (uses @anthropic-ai/sdk + a SQLite / pg / inline data provider).
 */
import { callAnthropicServer } from "../../mpp-client";
import { MODELS } from "../../constants";
import { backtestStorage } from "../../backtest-storage";
import { EXCHANGES, type ExchangeSlug, type Market } from "@shared/schema";
import type {
  BacktestContext, LLMClient, DataProvider, RunStore, StrategyCache,
  EngineClient, EngineRequest, EngineResponse,
} from "../interfaces";

const sessionsLLM: LLMClient = {
  modelFor: (tier) => tier === "planner" ? MODELS.OPUS : MODELS.SONNET,
  async complete(req) {
    const resp = await callAnthropicServer({
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.userMessage }],
    });
    return {
      text: resp.text,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      costUsd: resp.mppCost,
    };
  },
};

const sessionsData: DataProvider = {
  async resolveMarket(exchange, symbol) {
    return (await backtestStorage.getMarket(exchange, symbol)) ?? null;
  },
  async listAvailableMarkets(opts) {
    const out = {} as Record<ExchangeSlug, Market[]>;
    for (const slug of EXCHANGES) {
      out[slug] = await backtestStorage.listMarketsForExchange(slug, { topNByVolume: opts?.topN ?? 30 });
    }
    return out;
  },
  async getOhlcv(args) {
    const rows = await backtestStorage.getOhlcv(args);
    return rows.map(r => ({
      ts: r.ts,
      open: r.open, high: r.high, low: r.low, close: r.close,
      volume: r.volume,
      quoteVolume: r.quoteVolume ?? null,
      trades: r.trades ?? null,
    }));
  },
};

const sessionsRuns: RunStore = {
  async createRun(args) {
    const row = await backtestStorage.createBacktestRun({
      userId: args.userId,
      prompt: args.prompt,
      thesis: args.plan.thesis,
      plan: args.plan as any,
      status: "pending",
    });
    return { runId: row.id };
  },
  async finishRun(runId, args) {
    await backtestStorage.updateBacktestRun(runId, {
      status: args.status,
      metrics: args.metrics,
      equityCurve: args.equityCurve,
      trades: args.trades,
      errorMessage: args.errorMessage,
      durationMs: args.durationMs,
      llmCostUsd: args.llmCostUsd,
    });
  },
};

const sessionsStrategies: StrategyCache = {
  async saveSuccessful(plan, metrics) {
    if (!(metrics.sharpe > 0.5)) return;
    await backtestStorage.saveProvenStrategy({
      asset: plan.universe[0].symbol,
      strategyType: plan.name.toLowerCase().slice(0, 60),
      plan: plan as any,
      lastSharpe: metrics.sharpe,
      lastReturn: metrics.total_return,
      lastMaxDrawdown: metrics.max_drawdown,
    });
  },
};

class HttpEngineClient implements EngineClient {
  constructor(private url: string) {}
  async run(req: EngineRequest): Promise<EngineResponse> {
    const res = await fetch(`${this.url}/backtest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`backtest engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json() as Promise<EngineResponse>;
  }
}

export function createSessionsBacktestContext(opts?: { engineUrl?: string }): BacktestContext {
  const url = opts?.engineUrl || process.env.BACKTEST_ENGINE_URL || "http://localhost:8787";
  return {
    llm: sessionsLLM,
    data: sessionsData,
    runs: sessionsRuns,
    strategies: sessionsStrategies,
    engine: new HttpEngineClient(url),
  };
}
