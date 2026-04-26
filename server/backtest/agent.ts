/**
 * NL → BacktestPlan translator.
 *
 * Mirrors the design of server/data-agent.ts: a heavy system prompt asks the
 * LLM to emit a JSON BacktestPlan, we Zod-validate it, sanity-check, and ship
 * it to the Python sidecar via the EngineClient. On validation failure we
 * retry once with the lighter model and the error fed back into the prompt
 * (same shape as retryDuneSqlWithFeedback in data-agent.ts).
 *
 * The agent never imports mpp-client / pg / @shared/schema directly. All
 * infrastructure flows in via a BacktestContext (see ./backtest/interfaces.ts),
 * so the same code runs:
 *   - inside Sessions (Sessions adapter wires Postgres + mpp-client)
 *   - standalone (Standalone adapter wires @anthropic-ai/sdk + inline bars)
 *   - on third-party datasets (caller supplies a DataProvider)
 */
import { z } from "zod";
import { EXCHANGES, type OhlcvInterval, type Market } from "@shared/schema";
import type { BacktestContext } from "./interfaces";
import { createSessionsBacktestContext } from "./adapters/sessions";

// ─── Zod schema (mirror of services/backtest-engine/app/plan.py) ────────────

const Indicator = z.object({
  indicator: z.enum([
    "rsi", "sma", "ema", "macd_hist", "atr",
    "bbands_upper", "bbands_lower",
    "vol_pct_change", "price_pct_change", "close",
  ]),
  period: z.number().int().positive().optional(),
  source: z.enum(["close", "high", "low", "open", "volume"]).optional(),
  lookback: z.number().int().positive().optional(),
});
const Constant = z.object({ const: z.number() });

type Operand = z.infer<typeof Indicator> | z.infer<typeof Constant> | BinaryOpType | LogicalOpType;
const OperandSchema: z.ZodType<Operand> = z.lazy(() =>
  z.union([Indicator, Constant, BinaryOp, LogicalOp]),
);
type BinaryOpType = { op: string; left: Operand; right: Operand };
type LogicalOpType = { op: "and" | "or" | "not"; args: Operand[] };

const BinaryOp: z.ZodType<BinaryOpType> = z.lazy(() => z.object({
  op: z.enum(["gt", "gte", "lt", "lte", "eq", "neq", "cross_above", "cross_below"]),
  left: OperandSchema,
  right: OperandSchema,
}));

const LogicalOp: z.ZodType<LogicalOpType> = z.lazy(() => z.object({
  op: z.enum(["and", "or", "not"]),
  args: z.array(OperandSchema).min(1),
}));

const Universe = z.object({
  exchange: z.enum(EXCHANGES),
  symbol: z.string().min(1),
});

export const BacktestPlanSchema = z.object({
  name: z.string().min(1),
  thesis: z.string().min(1),
  universe: z.array(Universe).min(1).max(20),
  interval: z.enum(["1h", "1d"]),
  lookback: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  }),
  signals: z.object({
    entry: z.union([BinaryOp, LogicalOp]),
    exit: z.union([BinaryOp, LogicalOp]),
  }),
  sizing: z.object({
    type: z.enum(["fixed_fraction", "volatility_target"]),
    value: z.number().positive(),
  }),
  costs: z.object({
    fee_bps: z.number().min(0).default(10),
    slippage_bps: z.number().min(0).default(5),
  }).default({ fee_bps: 10, slippage_bps: 5 }),
  benchmark: z.enum(["hodl", "btc"]).optional().default("hodl"),
  direction: z.enum(["long", "short", "long_short"]).optional().default("long"),
});

export type BacktestPlan = z.infer<typeof BacktestPlanSchema>;

// ─── System prompt ──────────────────────────────────────────────────────────

const BACKTEST_AGENT_SYSTEM = `You are the Backtest Planner. Translate a trading thesis (or natural-language strategy description) into a single BacktestPlan JSON object that an execution engine can run against historical OHLCV.

Return ONLY valid JSON — no markdown, no commentary.

═══════════════════════════════════════════════════════════════
PLAN SCHEMA (mirror of services/backtest-engine/app/plan.py)
═══════════════════════════════════════════════════════════════

{
  "name": "Short title",
  "thesis": "Plain-English description of the trade idea",
  "universe": [{ "exchange": "binance"|"bybit"|"coinbase"|"hyperliquid", "symbol": "BTCUSDT" }],
  "interval": "1h" | "1d",
  "lookback": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" (optional, default = now) },
  "signals": {
    "entry": <Expr>,
    "exit":  <Expr>
  },
  "sizing": { "type": "fixed_fraction" | "volatility_target", "value": 0.1 },
  "costs":  { "fee_bps": 10, "slippage_bps": 5 },
  "benchmark": "hodl" | "btc",
  "direction": "long" | "short" | "long_short"
}

<Expr> grammar (recursive):
  - Indicator:    { "indicator": "rsi"|"sma"|"ema"|"macd_hist"|"atr"|"bbands_upper"|"bbands_lower"|"vol_pct_change"|"price_pct_change"|"close",
                    "period": <int>?, "source": "close"|"high"|"low"|"open"|"volume"?, "lookback": <int>? }
  - Constant:     { "const": 30 }
  - BinaryOp:     { "op": "gt"|"gte"|"lt"|"lte"|"eq"|"neq"|"cross_above"|"cross_below", "left": <Expr>, "right": <Expr> }
  - LogicalOp:    { "op": "and"|"or"|"not", "args": [<Expr>, ...] }

═══════════════════════════════════════════════════════════════
INTERVAL EXTRACTION
═══════════════════════════════════════════════════════════════

If the user says "intraday", "hourly", "1h", "every hour", "short-term momentum" → interval: "1h"
If the user says "daily", "swing", "trend", "macro", "1d", or no qualifier → interval: "1d"
DEFAULT when ambiguous: "1d".

═══════════════════════════════════════════════════════════════
TIME RANGE
═══════════════════════════════════════════════════════════════

User says         | lookback.start
"last 6 months"   | 6 months ago, ISO date
"last year"       | 12 months ago
"last 2 years"    | 24 months ago (use this when no range is specified — that's our seeded coverage)
"since 2024"      | 2024-01-01
"YTD"             | start of current year
DEFAULT when ambiguous: 2 years ago.

═══════════════════════════════════════════════════════════════
UNIVERSE / SYMBOL RESOLUTION
═══════════════════════════════════════════════════════════════

The user may say "BTC", "Bitcoin", "ETH", "HYPE", etc. Map to a (exchange, symbol) pair using the AVAILABLE MARKETS section that will be injected below. Prefer:
  - binance for spot majors (BTCUSDT, ETHUSDT, SOLUSDT, …)
  - hyperliquid for HYPE and HL-native perps (symbol form: "HYPE", quote = USD)
  - coinbase only when binance/bybit don't carry the asset
  - bybit as a fallback
DO NOT hallucinate symbols. If a requested symbol is not in AVAILABLE MARKETS, return an empty object: {}

═══════════════════════════════════════════════════════════════
DEFAULT COSTS
═══════════════════════════════════════════════════════════════

Spot: fee_bps 10, slippage_bps 5.
Perp (hyperliquid, bybit perp): fee_bps 5, slippage_bps 3.
If the user specifies costs explicitly, use those instead.

═══════════════════════════════════════════════════════════════
SIZING
═══════════════════════════════════════════════════════════════

If unspecified, use { "type": "fixed_fraction", "value": 1.0 } — full equity per trade.
If user says "10% per trade" → 0.1.
If user says "vol-targeted" → { "type": "volatility_target", "value": 0.20 }.

═══════════════════════════════════════════════════════════════
EXAMPLE
═══════════════════════════════════════════════════════════════

User: "Backtest a 20/50 SMA crossover on BTC for the last 2 years on the daily."

Output:
{
  "name": "BTC 20/50 SMA crossover",
  "thesis": "Buy when 20-day SMA crosses above 50-day SMA; exit on cross-below.",
  "universe": [{ "exchange": "binance", "symbol": "BTCUSDT" }],
  "interval": "1d",
  "lookback": { "start": "<2y ago>" },
  "signals": {
    "entry": { "op": "cross_above", "left": { "indicator": "sma", "period": 20 }, "right": { "indicator": "sma", "period": 50 } },
    "exit":  { "op": "cross_below", "left": { "indicator": "sma", "period": 20 }, "right": { "indicator": "sma", "period": 50 } }
  },
  "sizing": { "type": "fixed_fraction", "value": 1.0 },
  "costs":  { "fee_bps": 10, "slippage_bps": 5 },
  "benchmark": "hodl",
  "direction": "long"
}

CRITICAL RULES:
1. Output JSON ONLY — no surrounding prose, no markdown fence.
2. If you can't resolve every requested symbol against AVAILABLE MARKETS, output {} — the system will tell the user the symbol isn't seeded.
3. v1 supports a single-market universe. Never include more than one element in "universe". If the user requests multiple, pick the most relevant one and explain via "thesis".
4. Always populate "thesis" with one sentence describing the trade rationale.
`;

interface RunArgs {
  prompt: string;
  thesisContext?: string;
  forcedInterval?: OhlcvInterval;
  userId?: string;
  /** Optional context override. Defaults to the Sessions adapter so existing
   *  callers in this repo don't need to change anything. */
  ctx?: BacktestContext;
}

interface RunResult {
  status: "ok" | "engine_error" | "no_market" | "plan_invalid";
  plan?: BacktestPlan;
  metrics?: any;
  equityCurve?: any[];
  trades?: any[];
  error?: string;
  llmCostUsd: number;
  durationMs: number;
  runId?: string;
}

async function loadMarketsContext(ctx: BacktestContext): Promise<string> {
  const grouped = await ctx.data.listAvailableMarkets({ topN: 30 });
  const lines: string[] = [];
  for (const slug of EXCHANGES) {
    const top = (grouped[slug] || [])
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, 30)
      .map((m: Market) => m.symbol);
    if (top.length > 0) lines.push(`  ${slug}: ${top.join(", ")}`);
  }
  return lines.length > 0
    ? `AVAILABLE MARKETS (top liquidity per exchange):\n${lines.join("\n")}`
    : `AVAILABLE MARKETS: (none seeded — backtests will fail until OHLCV is loaded)`;
}

function extractJson(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try { return JSON.parse(candidate.trim()); } catch { /* fall through */ }
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch { /* fall through */ }
  }
  return null;
}

export async function runBacktestAgent(args: RunArgs): Promise<RunResult> {
  const ctx = args.ctx ?? createSessionsBacktestContext();
  const started = Date.now();
  let llmCost = 0;

  const marketsContext = await loadMarketsContext(ctx);
  const userMessage = [
    args.thesisContext ? `THESIS CONTEXT:\n${args.thesisContext}\n` : "",
    `USER REQUEST:\n${args.prompt}\n`,
    args.forcedInterval ? `FORCED INTERVAL: ${args.forcedInterval}\n` : "",
    marketsContext,
  ].filter(Boolean).join("\n");

  // First attempt: planner-tier model
  const first = await ctx.llm.complete({
    model: ctx.llm.modelFor("planner"),
    system: BACKTEST_AGENT_SYSTEM,
    userMessage,
    maxTokens: 3000,
  });
  llmCost += first.costUsd;

  let plan: BacktestPlan | null = null;
  let lastError: string | null = null;
  const firstJson = extractJson(first.text);

  if (firstJson && Object.keys(firstJson).length > 0) {
    const parsed = BacktestPlanSchema.safeParse(firstJson);
    if (parsed.success) plan = parsed.data;
    else lastError = parsed.error.message;
  } else if (firstJson && Object.keys(firstJson).length === 0) {
    return {
      status: "no_market",
      error: "Could not resolve the requested symbol against the available OHLCV universe.",
      llmCostUsd: llmCost,
      durationMs: Date.now() - started,
    };
  } else {
    lastError = `LLM returned non-JSON output: ${first.text.slice(0, 200)}`;
  }

  // Retry once with retry-tier model + error feedback
  if (!plan && lastError) {
    const retry = await ctx.llm.complete({
      model: ctx.llm.modelFor("retry"),
      system: BACKTEST_AGENT_SYSTEM,
      userMessage: `${userMessage}\n\nThe previous attempt produced an invalid plan. Error: ${lastError}\nReturn ONLY corrected JSON.`,
      maxTokens: 3000,
    });
    llmCost += retry.costUsd;
    const retryJson = extractJson(retry.text);
    if (retryJson) {
      const reparsed = BacktestPlanSchema.safeParse(retryJson);
      if (reparsed.success) plan = reparsed.data;
      else lastError = reparsed.error.message;
    }
  }

  if (!plan) {
    return {
      status: "plan_invalid",
      error: `LLM could not produce a valid BacktestPlan: ${lastError ?? "unknown"}`,
      llmCostUsd: llmCost,
      durationMs: Date.now() - started,
    };
  }

  // Sanity check: every (exchange, symbol) must resolve to a market.
  for (const u of plan.universe) {
    const m = await ctx.data.resolveMarket(u.exchange, u.symbol);
    if (!m) {
      return {
        status: "no_market",
        plan,
        error: `Market ${u.exchange}/${u.symbol} is not available. Run scripts/seed-ohlcv.ts --exchanges ${u.exchange} --symbols ${u.symbol.replace(/USDT?$|USD$/, "")} (or load it into your DataProvider).`,
        llmCostUsd: llmCost,
        durationMs: Date.now() - started,
      };
    }
  }

  // Persist the run and call the engine.
  const { runId } = await ctx.runs.createRun({ userId: args.userId, prompt: args.prompt, plan });
  const market = await ctx.data.resolveMarket(plan.universe[0].exchange, plan.universe[0].symbol);
  if (!market) {
    return { status: "no_market", plan, runId, error: "Market disappeared after resolution", llmCostUsd: llmCost, durationMs: Date.now() - started };
  }

  let engineResult;
  try {
    engineResult = await ctx.engine.run({
      plan,
      data: { mode: "postgres", market_id: market.id },
    });
  } catch (err: any) {
    await ctx.runs.finishRun(runId, {
      status: "engine_error",
      errorMessage: err.message,
      durationMs: Date.now() - started,
      llmCostUsd: llmCost,
    });
    return {
      status: "engine_error",
      plan,
      runId,
      error: err.message,
      llmCostUsd: llmCost,
      durationMs: Date.now() - started,
    };
  }

  await ctx.runs.finishRun(runId, {
    status: "ok",
    metrics: engineResult.metrics,
    equityCurve: engineResult.equity_curve,
    trades: engineResult.trades,
    durationMs: Date.now() - started,
    llmCostUsd: llmCost,
  });

  // Promote winning strategies to the cache for future few-shot.
  try {
    if ((engineResult.metrics?.trade_count ?? 0) >= 5) {
      await ctx.strategies.saveSuccessful(plan, {
        sharpe: engineResult.metrics.sharpe ?? 0,
        total_return: engineResult.metrics.total_return ?? 0,
        max_drawdown: engineResult.metrics.max_drawdown ?? 0,
      });
    }
  } catch (err: any) {
    console.warn("[backtest-agent] strategy cache save failed:", err.message);
  }

  return {
    status: "ok",
    plan,
    runId,
    metrics: engineResult.metrics,
    equityCurve: engineResult.equity_curve,
    trades: engineResult.trades,
    llmCostUsd: llmCost,
    durationMs: Date.now() - started,
  };
}
