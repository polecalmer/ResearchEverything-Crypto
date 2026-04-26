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
├── agent.ts               ← NL→Plan logic, takes a BacktestContext, no infra imports
├── storage.ts             ← Drizzle helpers (Sessions only)
├── interfaces.ts          ← LLMClient, DataProvider, RunStore, StrategyCache, EngineClient
├── adapters/
│   ├── sessions.ts        ← wires interfaces to mpp-client + Postgres + HTTP engine
│   └── standalone.ts      ← wires interfaces to @anthropic-ai/sdk + inline data + HTTP engine
├── sessions-plugin.ts     ← exposes the tool def + executor + artifact parser
├── sample.ts              ← shared util
├── README.md              ← (this file)
└── COSTS_AND_KEYS.md      ← API key acquisition + seed cost estimate with citations

server/
├── agent-plugins/         ← Tool/artifact registry that lets feature modules
│   ├── registry.ts        ← register/getRegistered helpers
│   └── index.ts           ← side-effect file: registers backtest plugin
└── exchange-clients/      ← REST + WS for binance, bybit, coinbase, hyperliquid (Hydromancer)

shared/models/backtest.ts  ← All backtest tables, kept out of central schema.ts
services/backtest-engine/  ← FastAPI + vectorbt sidecar. Independent Python project.
workers/market-data-stream/← Persistent WS worker (Reserved VM target)
scripts/seed-ohlcv.ts      ← Idempotent backfill script
bin/backtest.ts            ← Standalone CLI (`run` and `ask` subcommands)
```

## Sessions integration

Zero inline edits to `session-research-agent.ts`. The agent loop imports
`./agent-plugins` (side-effect import) which self-registers every plugin via
`registerToolPlugin` / `registerArtifactPlugin`. The agent loop then merges
registered entries into:

- The TOOLS array (`getRegisteredToolDefs()`).
- The TOOL_LABELS map (`getRegisteredToolLabels()`).
- The `parseArtifacts` regex + dispatch (`getRegisteredArtifactTypes()` + `tryRegisteredArtifactParser()`).
- The history-summary regex + icon map (same).

Adding another feature module is one new file in `server/backtest/`-style and
one import line in `server/agent-plugins/index.ts`. To remove: delete the
import line and the plugin's directory.

## Standalone usage

### CLI

```bash
# Hand-written plan, postgres data:
tsx bin/backtest.ts run plan.json

# Hand-written plan, local CSV:
tsx bin/backtest.ts run plan.json --csv ./btc-1d.csv

# Hand-written plan, parquet URL (e.g. Hydromancer reservoir):
AWS_REQUEST_PAYER=requester \
  tsx bin/backtest.ts run plan.json --parquet s3://hydromancer-reservoir/.../candles.parquet --symbol BTC

# NL prompt with inline bars:
ANTHROPIC_API_KEY=sk-ant-... \
  tsx bin/backtest.ts ask "20/50 SMA on BTC last year" --inline ./btc-bars.json

# Override sidecar URL or write full output to file:
tsx bin/backtest.ts run plan.json --engine http://my-engine:8787 --out result.json
```

### Library

```ts
import Anthropic from "@anthropic-ai/sdk";
import { runBacktestAgent } from "./backtest/agent";
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

See `COSTS_AND_KEYS.md` for API key acquisition and seed-cost estimates with citations.

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

The plugin registry eliminates the inline edits to TOOLS / executeTool /
parseArtifacts / TOOL_LABELS / history-summarizer. Two true union conflicts
remain in `shared/schema.ts` (`DATA_SOURCES` enum) and the agent's
`ResearchArtifact` interface — both are 5-second `git mergetool` resolves
since each merger is just appending to a list.
