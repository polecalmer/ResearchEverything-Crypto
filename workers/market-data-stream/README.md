# Market Data Stream Worker

Persistent process that subscribes to kline streams from all four exchanges
(binance, bybit, coinbase, hyperliquid) and writes closed bars into Postgres.

**Important:** Run this on a Reserved VM / Fly machine / dedicated process —
NOT on Replit autoscale, which spins instances down between requests and
breaks long-lived WebSocket connections.

## Run

```bash
DATABASE_URL=postgresql://... \
MARKET_STREAM_INTERVAL=1h \
MARKET_STREAM_TOP_N=50 \
tsx workers/market-data-stream/index.ts
```

## Environment

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | (required) | Same Postgres as the API |
| `MARKET_STREAM_INTERVAL` | `1h` | `1h` or `1d` |
| `MARKET_STREAM_TOP_N` | `50` | Markets per exchange to subscribe to |
| `MARKET_STREAM_EXCHANGES` | `binance,bybit,coinbase,hyperliquid` | Comma-separated subset |
| `MARKET_STREAM_WORKER_ID` | `worker-<pid>` | Tag written to `market_data_health` |

## Health

Each successful bar updates `market_data_health.last_bar_ts`. The API can
surface staleness by querying this table — alert if `now() - last_bar_ts >
2 * interval`.

## Notes

- Coinbase doesn't push closed-bar events natively for arbitrary intervals;
  v1 leaves the matches→bar resampling as a TODO. The seed script picks up
  any gap on the next run, so coinbase data is REST-fresh, not WS-fresh.
- Hyperliquid pushes the in-progress bar with each tick; `upsertKlines` is
  idempotent on `(market_id, ts)` so the bar gets revised in place.
