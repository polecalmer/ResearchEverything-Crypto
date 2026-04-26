# Backtest module

Self-contained NL→backtest engine. Designed to run three ways:

| Mode | LLM | Data | Persistence |
|---|---|---|---|
| **Sessions plugin** (this repo) | `mpp-client` (Tempo channel) | Postgres (`ohlcv_1h/1d`, `markets`) | Postgres (`backtest_runs`, `proven_strategies`) |
| **Standalone Node** | `@anthropic-ai/sdk` direct | Caller-supplied (inline bars / pg / parquet) | No-op or caller-supplied |
| **Library on third-party data** | Caller-supplied | Caller-supplied `DataProvider` | Caller-supplied |

The Python sidecar (`services/backtest-engine/`) is the same in all three modes — it accepts a discriminated `data` block (`postgres` / `inline` / `parquet_url` / `csv_path`) and never imports app code.

## Architecture

```
server/backtest/
├── interfaces.ts          ← LLMClient, DataProvider, RunStore, StrategyCache, EngineClient
├── adapters/
│   ├── sessions.ts        ← wires interfaces to mpp-client + Postgres + HTTP engine
│   └── standalone.ts      ← wires interfaces to @anthropic-ai/sdk + inline data + HTTP engine
├── sessions-plugin.ts     ← collapses tool registration to a single import
├── sample.ts              ← shared util
└── README.md              ← (this file)

server/
├── backtest-agent.ts      ← NL→Plan logic, takes a BacktestContext, no infra imports
├── backtest-storage.ts    ← Drizzle helpers (Sessions only)
└── exchange-clients/      ← REST + WS for binance, bybit, coinbase, hyperliquid (via Hydromancer)

services/backtest-engine/  ← FastAPI + vectorbt sidecar. Independent Python project.
workers/market-data-stream/← Persistent WS worker (Reserved VM target)
scripts/seed-ohlcv.ts      ← Idempotent backfill script
```

## Sessions integration

Three touch-points in `server/session-research-agent.ts`, all importing from `./backtest/sessions-plugin`:

```ts
import { BACKTEST_TOOL_DEF, BACKTEST_TOOL_NAME, BACKTEST_TOOL_LABEL,
         executeBacktestTool, parseBacktestArtifact } from "./backtest/sessions-plugin";

// 1. TOOLS array
const TOOLS: ToolDef[] = [..., BACKTEST_TOOL_DEF, ...];

// 2. executeTool switch
case BACKTEST_TOOL_NAME: return executeBacktestTool(input);

// 3. parseArtifacts
} else if (type === "backtest_result") {
  artifacts.push(parseBacktestArtifact(json));
}
```

That's the entire integration surface. To remove the module: delete the three references; `server/backtest/`, `server/backtest-agent.ts`, `server/backtest-storage.ts`, `server/exchange-clients/`, the Python sidecar, the worker, and the schema tables can all stay or go independently.

## Standalone usage

```ts
import Anthropic from "@anthropic-ai/sdk";
import { runBacktestAgent } from "./backtest-agent";
import { createStandaloneBacktestContext } from "./backtest/adapters/standalone";

const ctx = createStandaloneBacktestContext({
  anthropic: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  inlineBars: {
    "binance:BTCUSDT": myBars,        // OhlcvBar[]
  },
  engineUrl: "http://localhost:8787",
});

const result = await runBacktestAgent({
  prompt: "20/50 SMA crossover on BTC for the last year",
  ctx,
});
```

## Engine data-source modes

The Python sidecar's `POST /backtest` request body:

```json
{
  "plan": { ... BacktestPlan ... },
  "data": { "mode": "postgres", "market_id": "..." }
}
```

Other modes:

```json
{ "mode": "inline", "bars": [{ "ts": "2024-01-01T00:00:00Z", "open": ..., ... }, ...] }
{ "mode": "parquet_url", "url": "https://.../candles.parquet", "symbol": "BTC" }
{ "mode": "csv_path", "path": "/data/btcusdt-1h.csv" }
```

`parquet_url` works with Hydromancer's S3 reservoir — set `AWS_REQUEST_PAYER=requester` before launching the engine.

## Merge-surface notes

Inline edits to the agent loop (line 73 union, line 194 TOOLS, line 1196 switch, line 1219 regex, line 1314 labels) are conflict-prone if main extends the same lists. The plugin file shrinks each edit to one or two tokens, so most merges become trivial. A future refactor that turns these into a registry pattern (`registerTool`, `registerArtifactType`) would eliminate the inline edits entirely.
