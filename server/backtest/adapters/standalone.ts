/**
 * Standalone adapter — the same BacktestContext interfaces wired to:
 *   - @anthropic-ai/sdk directly (no MPP)
 *   - an in-memory or caller-supplied DataProvider
 *   - a no-op RunStore / StrategyCache (or pass your own)
 *
 * This makes the backtest module runnable outside Sessions, including on
 * arbitrary OHLCV the caller already holds (e.g. a parquet, a custom DB).
 *
 *   import Anthropic from "@anthropic-ai/sdk";
 *   import { createStandaloneBacktestContext, runBacktestAgent } from "...";
 *
 *   const ctx = createStandaloneBacktestContext({
 *     anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
 *     data: myInMemoryProvider,
 *     engineUrl: "http://localhost:8787",
 *   });
 *   await runBacktestAgent({ prompt: "...", ctx });
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BacktestContext, LLMClient, DataProvider, RunStore, StrategyCache,
  EngineClient, EngineRequest, EngineResponse, OhlcvBar,
} from "../interfaces";
import { EXCHANGES, type ExchangeSlug, type Market } from "@shared/schema";

interface StandaloneOpts {
  anthropic: Anthropic;
  data?: DataProvider;
  /** If `data` is omitted, supply per-symbol bar arrays here. The provider
   *  will assemble a synthetic Market record for each (exchange, symbol). */
  inlineBars?: Record<string, OhlcvBar[]>;   // key = "exchange:symbol"
  engineUrl: string;
  runs?: RunStore;
  strategies?: StrategyCache;
  /** Override which models to call. Default: claude-opus-4-7 / claude-sonnet-4-6. */
  models?: { planner?: string; retry?: string };
}

function makeLLM(anthropic: Anthropic, models?: { planner?: string; retry?: string }): LLMClient {
  const planner = models?.planner ?? "claude-opus-4-7";
  const retry = models?.retry ?? "claude-sonnet-4-6";
  return {
    modelFor: (tier) => (tier === "planner" ? planner : retry),
    async complete(req) {
      const resp = await anthropic.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.userMessage }],
      });
      const text = resp.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      return {
        text,
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
        // Standalone adapter doesn't track per-call USD cost — caller can
        // compute from token counts + their plan rates if they need to.
        costUsd: 0,
      };
    },
  };
}

function makeInlineDataProvider(inlineBars: Record<string, OhlcvBar[]>): DataProvider {
  const markets = new Map<string, Market>();
  for (const key of Object.keys(inlineBars)) {
    const [exchange, symbol] = key.split(":");
    markets.set(key, {
      id: key,
      exchangeSlug: exchange,
      symbol,
      base: symbol,
      quote: "USD",
      type: "spot",
      status: "active",
      listedAt: null,
      quoteVolume24h: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  return {
    async resolveMarket(exchange, symbol) {
      return markets.get(`${exchange}:${symbol}`) ?? null;
    },
    async listAvailableMarkets() {
      const out = {} as Record<ExchangeSlug, Market[]>;
      for (const slug of EXCHANGES) out[slug] = [];
      for (const m of Array.from(markets.values())) {
        const slug = m.exchangeSlug as ExchangeSlug;
        if (out[slug]) out[slug].push(m);
      }
      return out;
    },
    async getOhlcv({ marketId, start, end }) {
      const bars = inlineBars[marketId] || [];
      return bars.filter(b => b.ts >= start && b.ts <= end);
    },
  };
}

const noopRuns: RunStore = {
  async createRun() { return { runId: `run_${Date.now().toString(36)}` }; },
  async finishRun() { /* no-op */ },
};
const noopStrategies: StrategyCache = {
  async saveSuccessful() { /* no-op */ },
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

export function createStandaloneBacktestContext(opts: StandaloneOpts): BacktestContext {
  const data = opts.data ?? makeInlineDataProvider(opts.inlineBars ?? {});
  return {
    llm: makeLLM(opts.anthropic, opts.models),
    data,
    runs: opts.runs ?? noopRuns,
    strategies: opts.strategies ?? noopStrategies,
    engine: new HttpEngineClient(opts.engineUrl),
  };
}
