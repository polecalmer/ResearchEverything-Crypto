/**
 * NL → BacktestPlan translator.
 *
 * Mirrors the design of server/data-agent.ts: a heavy system prompt asks
 * Claude Opus to emit a JSON BacktestPlan, we Zod-validate it, run a
 * sanity-check pass, and POST it to the Python sidecar at BACKTEST_ENGINE_URL.
 * On validation failure we retry once with Sonnet and the error fed back into
 * the prompt — same shape as retryDuneSqlWithFeedback in data-agent.ts.
 */
import { z } from "zod";
import { callAnthropicServer } from "./mpp-client";
import { MODELS } from "./constants";
import { backtestStorage } from "./backtest-storage";
import { EXCHANGES, type ExchangeSlug, type OhlcvInterval } from "@shared/schema";

const ENGINE_URL = process.env.BACKTEST_ENGINE_URL || "http://localhost:8787";

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
}

async function loadAvailableMarketsContext(filterBases?: string[]): Promise<string> {
  const lines: string[] = [];
  for (const slug of EXCHANGES) {
    const all = await backtestStorage.listMarketsForExchange(slug);
    const top = all
      .filter(m => !filterBases || filterBases.includes(m.base.toUpperCase()))
      .sort((a, b) => (b.quoteVolume24h ?? 0) - (a.quoteVolume24h ?? 0))
      .slice(0, 30)
      .map(m => m.symbol);
    if (top.length > 0) lines.push(`  ${slug}: ${top.join(", ")}`);
  }
  return lines.length > 0
    ? `AVAILABLE MARKETS (top liquidity per exchange):\n${lines.join("\n")}`
    : `AVAILABLE MARKETS: (none seeded — backtests will fail until scripts/seed-ohlcv.ts has run)`;
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

async function callPlanner(opts: {
  systemPrompt: string;
  userMessage: string;
  model: string;
  maxTokens: number;
}): Promise<{ json: any | null; cost: number; raw: string }> {
  const resp = await callAnthropicServer({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.systemPrompt,
    messages: [{ role: "user", content: opts.userMessage }],
  });
  const json = extractJson(resp.text);
  return { json, cost: resp.mppCost, raw: resp.text };
}

export async function runBacktestAgent(args: RunArgs): Promise<RunResult> {
  const started = Date.now();
  let llmCost = 0;

  // Build context: list of seeded markets so the LLM doesn't hallucinate symbols
  const marketsContext = await loadAvailableMarketsContext();

  const userMessage = [
    args.thesisContext ? `THESIS CONTEXT:\n${args.thesisContext}\n` : "",
    `USER REQUEST:\n${args.prompt}\n`,
    args.forcedInterval ? `FORCED INTERVAL: ${args.forcedInterval}\n` : "",
    marketsContext,
  ].filter(Boolean).join("\n");

  // First attempt: Opus
  const first = await callPlanner({
    systemPrompt: BACKTEST_AGENT_SYSTEM,
    userMessage,
    model: MODELS.OPUS,
    maxTokens: 3000,
  });
  llmCost += first.cost;

  let plan: BacktestPlan | null = null;
  let lastError: string | null = null;

  if (first.json && Object.keys(first.json).length > 0) {
    const parsed = BacktestPlanSchema.safeParse(first.json);
    if (parsed.success) plan = parsed.data;
    else lastError = parsed.error.message;
  } else if (first.json && Object.keys(first.json).length === 0) {
    return {
      status: "no_market",
      error: "Could not resolve the requested symbol against the seeded OHLCV universe. Run scripts/seed-ohlcv.ts to backfill more markets.",
      llmCostUsd: llmCost,
      durationMs: Date.now() - started,
    };
  } else {
    lastError = `LLM returned non-JSON output: ${first.raw.slice(0, 200)}`;
  }

  // Retry once with Sonnet + error feedback (mirrors retryDuneSqlWithFeedback)
  if (!plan && lastError) {
    const retry = await callPlanner({
      systemPrompt: BACKTEST_AGENT_SYSTEM,
      userMessage: `${userMessage}\n\nThe previous attempt produced an invalid plan. Error: ${lastError}\nReturn ONLY corrected JSON.`,
      model: MODELS.SONNET,
      maxTokens: 3000,
    });
    llmCost += retry.cost;
    if (retry.json) {
      const reparsed = BacktestPlanSchema.safeParse(retry.json);
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

  // Sanity check: every (exchange, symbol) must exist in markets table.
  for (const u of plan.universe) {
    const m = await backtestStorage.getMarket(u.exchange as ExchangeSlug, u.symbol);
    if (!m) {
      return {
        status: "no_market",
        plan,
        error: `Market ${u.exchange}/${u.symbol} is not seeded. Run scripts/seed-ohlcv.ts --exchanges ${u.exchange} --symbols ${u.symbol.replace(/USDT?$|USD$/, "")}`,
        llmCostUsd: llmCost,
        durationMs: Date.now() - started,
      };
    }
  }

  // POST to Python sidecar
  let engineResult: any;
  try {
    const res = await fetch(`${ENGINE_URL}/backtest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        status: "engine_error",
        plan,
        error: `Backtest engine returned ${res.status}: ${text.slice(0, 300)}`,
        llmCostUsd: llmCost,
        durationMs: Date.now() - started,
      };
    }
    engineResult = await res.json();
  } catch (err: any) {
    return {
      status: "engine_error",
      plan,
      error: `Could not reach backtest engine at ${ENGINE_URL}: ${err.message}. Is the Python sidecar running?`,
      llmCostUsd: llmCost,
      durationMs: Date.now() - started,
    };
  }

  // Persist run
  const run = await backtestStorage.createBacktestRun({
    userId: args.userId,
    prompt: args.prompt,
    thesis: plan.thesis,
    plan: plan as any,
    metrics: engineResult.metrics,
    equityCurve: engineResult.equity_curve,
    trades: engineResult.trades,
    status: "ok",
    durationMs: Date.now() - started,
    llmCostUsd: llmCost,
  });

  // Save as a proven strategy on success (positive Sharpe + 5+ trades)
  try {
    if (engineResult.metrics?.sharpe > 0.5 && (engineResult.metrics?.trade_count ?? 0) >= 5) {
      await backtestStorage.saveProvenStrategy({
        asset: plan.universe[0].symbol,
        strategyType: plan.name.toLowerCase().slice(0, 60),
        plan: plan as any,
        lastSharpe: engineResult.metrics.sharpe,
        lastReturn: engineResult.metrics.total_return,
        lastMaxDrawdown: engineResult.metrics.max_drawdown,
      });
    }
  } catch (err: any) {
    console.warn("[backtest-agent] proven-strategy save failed:", err.message);
  }

  return {
    status: "ok",
    plan,
    metrics: engineResult.metrics,
    equityCurve: engineResult.equity_curve,
    trades: engineResult.trades,
    llmCostUsd: llmCost,
    durationMs: Date.now() - started,
  };
}
