# Backtest Engine (Python sidecar)

FastAPI service that executes `BacktestPlan` JSON against the OHLCV warehouse
in Postgres, using vectorbt. Called by the Node `backtest_thesis` tool.

## Setup

```bash
cd services/backtest-engine
python -m venv .venv && source .venv/bin/activate
pip install -e .
DATABASE_URL=postgresql://... uvicorn app.main:app --host 0.0.0.0 --port 8787
```

## Configure the Node side

```bash
# In the main app's environment
BACKTEST_ENGINE_URL=http://localhost:8787
```

## Test

```bash
curl -X POST http://localhost:8787/backtest \
  -H "Content-Type: application/json" \
  -d @example_plan.json
```

## Plan schema

See `app/plan.py`. Mirrors `server/backtest-agent.ts`'s Zod schema 1:1.
