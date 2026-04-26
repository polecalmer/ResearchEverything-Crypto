/**
 * Sessions plugin: everything Sessions needs to expose `backtest_thesis` to
 * the agent loop, in a single export. Designed so the integration point in
 * session-research-agent.ts is one import + one function call — minimising
 * merge conflicts when main moves under us.
 *
 * Today the agent loop wires this in three places (TOOLS array, executeTool
 * switch, parseArtifacts regex). All three are still inline edits, but their
 * BODIES live here, so a future tool/artifact registry refactor can absorb
 * them without touching the agent loop again.
 */
import { runBacktestAgent, type BacktestPlan } from "./agent";
import { sampleData } from "./sample";

export const BACKTEST_TOOL_NAME = "backtest_thesis";

export const BACKTEST_TOOL_DEF = {
  name: BACKTEST_TOOL_NAME,
  description: `Translate a directional trading thesis (or natural-language strategy spec) into a structured BacktestPlan and run it against the OHLCV warehouse (binance, bybit, coinbase, hyperliquid; daily + hourly).

Use this when the user asks: "backtest this", "would this have been profitable", "test this strategy", "did this work historically", or after forming a directional view in deep mode. The result includes Sharpe, max drawdown, win rate, trade count, and an equity curve.

CRITICAL: After this tool returns, copy its 'artifact_payload' object verbatim into a \`\`\`artifact:backtest_result block in your response so the equity curve renders for the user. Then summarize the metrics in 2-3 sentences.`,
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: { type: "string" as const, description: "Natural-language description of the strategy to backtest. Be explicit about entry/exit, asset, timeframe, and any sizing or cost assumptions." },
      thesis_context: { type: "string" as const, description: "Optional: the broader thesis the strategy operationalizes. Helps the planner pick a sensible interval and lookback." },
      interval: { type: "string" as const, enum: ["1h", "1d"], description: "Optional: force daily or hourly bars. If omitted, the planner extracts from the prompt (default: 1d)." },
    },
    required: ["prompt"],
  },
  brainBinding: { source: "exchanges" as const, scopeRef: "backtest:engine", observationCategory: "reliability" as const },
};

export const BACKTEST_TOOL_LABEL = "Backtesting strategy against historical OHLCV";

/** Tool executor — the body of the `case "backtest_thesis":` arm. Returns
 *  the JSON string the agent loop should hand back to the LLM. */
export async function executeBacktestTool(input: any): Promise<string> {
  const result = await runBacktestAgent({
    prompt: String(input.prompt || ""),
    thesisContext: input.thesis_context ? String(input.thesis_context) : undefined,
    forcedInterval: (input.interval === "1h" || input.interval === "1d") ? input.interval : undefined,
  });

  if (result.status !== "ok") {
    return JSON.stringify({
      status: result.status,
      error: result.error,
      plan: result.plan,
    });
  }

  const sampledCurve = sampleData(result.equityCurve || [], 80);
  return JSON.stringify({
    status: "ok",
    summary_for_user: {
      total_return_pct: ((result.metrics?.total_return ?? 0) * 100).toFixed(2),
      sharpe: (result.metrics?.sharpe ?? 0).toFixed(2),
      max_drawdown_pct: ((result.metrics?.max_drawdown ?? 0) * 100).toFixed(2),
      win_rate_pct: ((result.metrics?.win_rate ?? 0) * 100).toFixed(2),
      trade_count: result.metrics?.trade_count ?? 0,
      benchmark_return_pct: ((result.metrics?.benchmark_return ?? 0) * 100).toFixed(2),
      alpha_vs_hodl_pct: ((result.metrics?.alpha_vs_hodl ?? 0) * 100).toFixed(2),
    },
    plan: result.plan,
    artifact_payload: {
      title: result.plan?.name,
      thesis: result.plan?.thesis,
      runId: result.runId,
      metrics: result.metrics,
      equityCurve: sampledCurve,
      plan: result.plan,
    },
  });
}

/** Parse a raw `backtest_result` artifact JSON block. Used by parseArtifacts. */
export function parseBacktestArtifact(json: any) {
  return {
    type: "backtest_result" as const,
    title: json.title || "Backtest",
    text: json.thesis ? String(json.thesis).slice(0, 500) : undefined,
    metrics: json.metrics || {},
    equityCurve: Array.isArray(json.equityCurve)
      ? json.equityCurve.slice(0, 500).map((p: any) => ({ ts: String(p.ts), equity: Number(p.equity) }))
      : [],
    plan: json.plan,
    runId: json.runId,
  };
}

export type { BacktestPlan };
