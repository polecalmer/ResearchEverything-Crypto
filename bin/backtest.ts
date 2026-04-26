#!/usr/bin/env tsx
/**
 * Standalone CLI for the backtest module.
 *
 * Usage:
 *   tsx bin/backtest.ts run <plan.json>             # postgres data, calls engine
 *   tsx bin/backtest.ts run <plan.json> --csv ./btc.csv
 *   tsx bin/backtest.ts run <plan.json> --parquet https://.../btc.parquet --symbol BTC
 *   tsx bin/backtest.ts ask "20/50 SMA on BTC last year" --inline ./btc-bars.json
 *
 * `run` skips the LLM and ships a hand-written plan straight to the engine.
 * `ask` runs the NL→Plan agent with the provided context.
 *
 * Required env:
 *   BACKTEST_ENGINE_URL  (default: http://localhost:8787)
 * Required for `ask`:
 *   ANTHROPIC_API_KEY    (standalone uses @anthropic-ai/sdk directly)
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runBacktestAgent, BacktestPlanSchema } from "../server/backtest/agent";
import { createStandaloneBacktestContext } from "../server/backtest/adapters/standalone";

interface CliArgs {
  command: "run" | "ask" | "help";
  positional: string[];
  csv?: string;
  parquet?: string;
  symbol?: string;
  inline?: string;
  out?: string;
  engineUrl: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const out: CliArgs = {
    command: "help",
    positional: [],
    engineUrl: process.env.BACKTEST_ENGINE_URL || "http://localhost:8787",
  };
  let i = 0;
  if (args[0] === "run" || args[0] === "ask") { out.command = args[0]; i = 1; }
  while (i < args.length) {
    const a = args[i];
    if (a === "--csv") { out.csv = args[++i]; }
    else if (a === "--parquet") { out.parquet = args[++i]; }
    else if (a === "--symbol") { out.symbol = args[++i]; }
    else if (a === "--inline") { out.inline = args[++i]; }
    else if (a === "--out") { out.out = args[++i]; }
    else if (a === "--engine") { out.engineUrl = args[++i]; }
    else { out.positional.push(a); }
    i++;
  }
  return out;
}

function buildDataBlock(args: CliArgs, plan: any): any {
  if (args.csv) return { mode: "csv_path", path: resolve(args.csv) };
  if (args.parquet) {
    if (!args.symbol) throw new Error("--parquet requires --symbol");
    return { mode: "parquet_url", url: args.parquet, symbol: args.symbol };
  }
  if (args.inline) {
    const raw = JSON.parse(readFileSync(args.inline, "utf-8"));
    const bars = Array.isArray(raw) ? raw : raw.bars;
    if (!Array.isArray(bars)) throw new Error("inline file must be an array of bars or { bars: [...] }");
    return { mode: "inline", bars };
  }
  // default: postgres — caller must seed the market themselves
  const u = plan.universe?.[0];
  if (!u) throw new Error("plan.universe is empty");
  return { mode: "postgres", market_id: process.env.BACKTEST_MARKET_ID
    ?? `${u.exchange}:${u.symbol}` };
}

async function cmdRun(args: CliArgs) {
  if (!args.positional[0]) throw new Error("run: pass a plan JSON path");
  const planRaw = JSON.parse(readFileSync(args.positional[0], "utf-8"));
  const planParsed = BacktestPlanSchema.safeParse(planRaw);
  if (!planParsed.success) {
    console.error("invalid plan:", planParsed.error.flatten());
    process.exit(2);
  }
  const plan = planParsed.data;
  const data = buildDataBlock(args, plan);

  const res = await fetch(`${args.engineUrl}/backtest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, data }),
  });
  if (!res.ok) {
    console.error(`engine ${res.status}: ${(await res.text()).slice(0, 500)}`);
    process.exit(1);
  }
  const out = await res.json();
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(out, null, 2));
    console.log(`wrote full output to ${args.out}`);
  }
  printSummary(out);
}

async function cmdAsk(args: CliArgs) {
  const prompt = args.positional.join(" ");
  if (!prompt) throw new Error("ask: pass a natural-language prompt as positional args");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!args.inline && !args.csv && !args.parquet) {
    throw new Error("ask: standalone mode needs --inline / --csv / --parquet to provide OHLCV");
  }

  // Lazy import so the SDK is only required when actually running `ask`.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;

  // Build inline-bars dict if --inline was provided.
  let inlineBars: Record<string, any[]> | undefined;
  if (args.inline) {
    const raw = JSON.parse(readFileSync(args.inline, "utf-8"));
    if (Array.isArray(raw)) {
      // Expect: [{ exchange, symbol, bars: [...] }, ...] or [{ts, open, ...}, ...]
      if (raw.length && raw[0].exchange) {
        inlineBars = {};
        for (const m of raw) inlineBars[`${m.exchange}:${m.symbol}`] = m.bars;
      } else {
        throw new Error("--inline format ambiguous: pass [{ exchange, symbol, bars }, ...] for ask mode");
      }
    } else {
      inlineBars = raw;   // already keyed
    }
  }

  const ctx = createStandaloneBacktestContext({
    anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    inlineBars,
    engineUrl: args.engineUrl,
  });

  const result = await runBacktestAgent({ prompt, ctx });
  if (result.status !== "ok") {
    console.error(`status=${result.status}: ${result.error}`);
    process.exit(1);
  }

  if (args.out) {
    writeFileSync(args.out, JSON.stringify(result, null, 2));
    console.log(`wrote full output to ${args.out}`);
  }
  printSummary({ metrics: result.metrics, equity_curve: result.equityCurve, trades: result.trades });
}

function printSummary(out: any) {
  const m = out.metrics || {};
  const fmt = (v: number | undefined, suffix = "") =>
    typeof v === "number" ? `${(v * (suffix === "%" ? 100 : 1)).toFixed(2)}${suffix}` : "—";
  console.log("");
  console.log("─── Backtest result ───");
  console.log(`Total return     ${fmt(m.total_return, "%")}`);
  console.log(`Sharpe           ${fmt(m.sharpe)}`);
  console.log(`Sortino          ${fmt(m.sortino)}`);
  console.log(`Max drawdown     ${fmt(m.max_drawdown, "%")}`);
  console.log(`Win rate         ${fmt(m.win_rate, "%")}`);
  console.log(`Trades           ${m.trade_count ?? "—"}`);
  console.log(`Exposure         ${fmt(m.exposure, "%")}`);
  console.log(`Benchmark (HODL) ${fmt(m.benchmark_return, "%")}`);
  console.log(`Alpha vs HODL    ${fmt(m.alpha_vs_hodl, "%")}`);
  console.log(`Equity points    ${(out.equity_curve || []).length}`);
  console.log("");
}

function help() {
  console.log(`backtest CLI

Commands:
  run <plan.json>                 Ship a hand-written plan to the engine
  ask "<prompt>"                  NL→Plan→engine (requires ANTHROPIC_API_KEY)
  help                            Show this

Data flags (mutually exclusive):
  --csv <path>                    CSV with ts,open,high,low,close,volume[,quote_volume]
  --parquet <url> --symbol <sym>  Parquet URL (e.g. Hydromancer S3 reservoir)
  --inline <path>                 Inline bars JSON file
  (default: --postgres, requires BACKTEST_MARKET_ID env)

Output flags:
  --out <path>                    Write full JSON result to file
  --engine <url>                  Override BACKTEST_ENGINE_URL

Env:
  BACKTEST_ENGINE_URL             Defaults to http://localhost:8787
  ANTHROPIC_API_KEY               Required for 'ask'
  BACKTEST_MARKET_ID              Optional postgres market_id override
`);
}

(async () => {
  const args = parseArgs();
  try {
    if (args.command === "run") await cmdRun(args);
    else if (args.command === "ask") await cmdAsk(args);
    else help();
  } catch (err: any) {
    console.error("error:", err.message);
    process.exit(1);
  }
})();
