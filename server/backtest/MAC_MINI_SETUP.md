# Hermes task: Set up ResearchEverything-Crypto backtest module on Mac Mini

## Goal

Bring the backtest module up locally on this Mac Mini, seed 2 years of OHLCV from Binance, Bybit, and Coinbase across the top-50 markets each, and confirm the end-to-end path with one sample backtest. Skip Hyperliquid entirely.

## Idempotency rules

- Before every install step, check whether the dependency is already present and skip if so. Use the verification command listed in each phase.
- Every script in this repo is idempotent on its own (the seeder resumes from `max(ts)`). Re-running a phase is always safe.
- If a phase fails, capture the exact error and stop — do not invent fixes for unknown failures, surface them.

## Phase 1 — Prerequisites

```bash
# Verify; install only what's missing.
brew --version || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
node --version | grep -qE 'v(2[0-9]|[3-9][0-9])' || brew install node@20
python3.11 --version || brew install python@3.11
psql --version | grep -q 'PostgreSQL 1[6-9]' || brew install postgresql@16
brew list pgvector >/dev/null 2>&1 || brew install pgvector
git --version >/dev/null
```

Apple Silicon path: Homebrew lives at `/opt/homebrew`. On Intel Macs it's `/usr/local`. Use `$(brew --prefix)` if you need the path.

## Phase 2 — Postgres up

```bash
brew services list | grep -q 'postgresql@16.*started' || brew services start postgresql@16
sleep 2
psql postgres -c '\q'    # smoke test
```

Create the database (idempotent):

```bash
psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='researcheverything'" | grep -q 1 \
  || createdb researcheverything
psql researcheverything -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql researcheverything -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

## Phase 3 — Clone the repo and install

```bash
cd ~/code 2>/dev/null || (mkdir -p ~/code && cd ~/code)
[ -d ResearchEverything-Crypto ] || git clone https://github.com/polecalmer/ResearchEverything-Crypto.git
cd ResearchEverything-Crypto
git fetch origin
git checkout claude/add-backtesting-module-D2xht
git pull --ff-only origin claude/add-backtesting-module-D2xht
npm install
```

## Phase 4 — Configure `.env`

If `.env` doesn't exist, create one with the minimum required for the seed:

```bash
[ -f .env ] || cat > .env <<'EOF'
DATABASE_URL=postgresql://localhost:5432/researcheverything?sslmode=disable
BACKTEST_ENGINE_URL=http://localhost:8787
NODE_ENV=development
EOF
```

If `.env` already exists, only add missing keys — do not overwrite the existing values:

```bash
grep -q '^DATABASE_URL=' .env || echo 'DATABASE_URL=postgresql://localhost:5432/researcheverything?sslmode=disable' >> .env
grep -q '^BACKTEST_ENGINE_URL=' .env || echo 'BACKTEST_ENGINE_URL=http://localhost:8787' >> .env
```

## Phase 5 — Push schema

```bash
npm run db:push
```

Expected output ends with `[✓] Changes applied`. Verify the backtest tables exist:

```bash
psql researcheverything -c "\dt" | grep -E 'exchanges|markets|ohlcv_1[hd]|backtest_runs'
```

You should see at least `exchanges`, `markets`, `ohlcv_1h`, `ohlcv_1d`, `backtest_runs`, `proven_strategies`, `market_data_health`.

## Phase 6 — Seed OHLCV (the long step)

Run each exchange separately so a partial failure doesn't take the others down. Each is idempotent — resuming a partially-completed run is safe.

```bash
npx tsx scripts/seed-ohlcv.ts --exchanges binance  --top 50 --intervals 1d,1h --days 730
npx tsx scripts/seed-ohlcv.ts --exchanges bybit    --top 50 --intervals 1d,1h --days 730
npx tsx scripts/seed-ohlcv.ts --exchanges coinbase --top 50 --intervals 1d,1h --days 730
```

Expected wall time on a Mac Mini with reasonable home internet:

- Binance: <2 min
- Bybit: <2 min
- Coinbase: ~5–8 min (300 bars/call cap means more roundtrips)

Verify after each one:

```bash
psql researcheverything <<'SQL'
SELECT m.exchange_slug,
       COUNT(DISTINCT m.id)                                                                AS markets,
       (SELECT COUNT(*) FROM ohlcv_1d  WHERE market_id IN (SELECT id FROM markets WHERE exchange_slug = m.exchange_slug)) AS d_bars,
       (SELECT COUNT(*) FROM ohlcv_1h  WHERE market_id IN (SELECT id FROM markets WHERE exchange_slug = m.exchange_slug)) AS h_bars
FROM markets m
GROUP BY m.exchange_slug;
SQL
```

Healthy result: ~50 markets per exchange, ~36,500 daily bars, ~876,000 hourly bars (50 × 17,520) per exchange.

If any row shows zero bars, re-run that exchange's seed — likely a transient API hiccup.

## Phase 7 — Python backtest sidecar

```bash
cd services/backtest-engine
[ -d .venv ] || python3.11 -m venv .venv
source .venv/bin/activate
pip install -e . >/dev/null

# Smoke-test the engine manually
DATABASE_URL='postgresql://localhost:5432/researcheverything?sslmode=disable' \
  uvicorn app.main:app --host 127.0.0.1 --port 8787 &
SIDECAR_PID=$!
sleep 3
curl -sf http://127.0.0.1:8787/health | grep '"status":"ok"'
```

Leave the sidecar running in the background for the smoke test. If you want it to survive logout, install it as a launchd agent (Phase 9).

## Phase 8 — End-to-end smoke test

From the repo root in another shell:

```bash
cd ~/code/ResearchEverything-Crypto

# Find a real market_id we just seeded
MARKET_ID=$(psql researcheverything -tAc "SELECT id FROM markets WHERE exchange_slug='binance' AND symbol='BTCUSDT' LIMIT 1")
echo "BTCUSDT market_id=$MARKET_ID"

# Build a sample plan
cat > /tmp/btc_plan.json <<EOF
{
  "plan": {
    "name": "BTC SMA crossover",
    "thesis": "Buy when 20d crosses above 50d, exit when it crosses below.",
    "universe": [{ "exchange": "binance", "symbol": "BTCUSDT" }],
    "interval": "1d",
    "lookback": { "start": "2024-01-01" },
    "signals": {
      "entry": { "op": "cross_above", "left": { "indicator": "sma", "period": 20 }, "right": { "indicator": "sma", "period": 50 } },
      "exit":  { "op": "cross_below", "left": { "indicator": "sma", "period": 20 }, "right": { "indicator": "sma", "period": 50 } }
    },
    "sizing": { "type": "fixed_fraction", "value": 1.0 },
    "costs": { "fee_bps": 10, "slippage_bps": 5 },
    "benchmark": "hodl",
    "direction": "long"
  },
  "data": { "mode": "postgres", "market_id": "$MARKET_ID" }
}
EOF

curl -sS -X POST http://127.0.0.1:8787/backtest \
  -H 'Content-Type: application/json' \
  -d @/tmp/btc_plan.json | jq '.metrics'
```

Healthy response: a JSON object with `total_return`, `sharpe`, `max_drawdown`, `win_rate`, `trade_count`, `benchmark_return`, `alpha_vs_hodl` — all numbers, no error field.

If you see a non-2xx, capture the response body and stop.

## Phase 9 — (Optional) Run the sidecar as a launchd agent

Only do this if Phase 8 succeeded. Otherwise the daemon will just spin failing.

```bash
PLIST=~/Library/LaunchAgents/xyz.researcheverything.backtest-engine.plist
REPO=$HOME/code/ResearchEverything-Crypto

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>xyz.researcheverything.backtest-engine</string>
  <key>WorkingDirectory</key><string>$REPO/services/backtest-engine</string>
  <key>ProgramArguments</key>
  <array>
    <string>$REPO/services/backtest-engine/.venv/bin/uvicorn</string>
    <string>app.main:app</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8787</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATABASE_URL</key><string>postgresql://localhost:5432/researcheverything?sslmode=disable</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/backtest-engine.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/backtest-engine.err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 2
curl -sf http://127.0.0.1:8787/health
```

## Success criteria for Hermes

Report back with all four of these:

1. `psql` row counts per exchange (Phase 6 verification query) — paste the table
2. Output of `curl /health` (Phase 7) — should be `{"status":"ok","version":"0.2.0"}`
3. The `metrics` JSON from the smoke test (Phase 8)
4. Whether launchd is running the sidecar (Phase 9, if you ran it): `launchctl list | grep backtest-engine`

## What to skip / defer

- **Hyperliquid** — entirely. Don't seed it, don't subscribe to Hydromancer, don't set `HYDROMANCER_API_KEY`. Adding it later is just running the seed script with `--exchanges hyperliquid` once the key is provisioned.
- **WebSocket worker** (`workers/market-data-stream/`) — don't run on this Mac unless you want live updates. The seeded data is good for backtesting on its own; freshness will lag without the worker, but for thesis-grade backtests over the last 2 years that's irrelevant.
- **Sessions integration** — that side-effects through the Sessions deployment, not the local Mac. The Mac is purely a backtest workhorse.

## If something breaks

Don't try to fix unknown errors autonomously. Capture: the exact command, the full stderr/stdout, the relevant log file (`~/Library/Logs/backtest-engine.err.log` if it's the sidecar). Stop and surface it.

## Notes

- macOS Postgres `pg_hba.conf` defaults to trust auth on local sockets, which is why the `DATABASE_URL` doesn't carry a password. If your install requires one, append `&user=$USER&password=...` to the URL or set `PGPASSWORD` in `.env`.
- The seed needs ~290 MB of disk for 200 markets × 2 years × {1d, 1h}. Plenty for a Mac Mini, just noting it.
