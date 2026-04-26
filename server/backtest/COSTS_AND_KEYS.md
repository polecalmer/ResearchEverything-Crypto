# API keys, rate limits, and seed cost estimate

All citations link to the source pages I read while writing this. Numbers are
verified against those pages as of 2026-04-26; double-check before relying on
them for production billing decisions.

## Required API keys at a glance

| Source | Required for | Free tier? | Where to get it |
|---|---|---|---|
| **Anthropic** | LLM calls (standalone mode only — Sessions uses its own MPP relay) | Yes (with credit balance) | https://console.anthropic.com → "API Keys" |
| **Binance Spot** | Spot OHLCV (REST + WS) | **No key needed** for public market data | n/a |
| **Bybit V5** | Spot/perp OHLCV (REST + WS) | **No key needed** for public market data | n/a |
| **Coinbase Exchange** | Spot OHLCV (REST + WS) | **No key needed** for public market data | n/a |
| **Hydromancer** (Hyperliquid) | All Hyperliquid data; replaces native HL endpoint | Paid only ($300/mo Starter) | Email `data@hydromancer.xyz` or Telegram `@xenoflux` |
| **AWS** (S3 reservoir) | Optional — full HL 1s history via Hydromancer's S3 bucket | No (requester-pays) | Any AWS account; standard IAM credentials |

### How to set them in `.env`

```
ANTHROPIC_API_KEY=sk-ant-...           # only for standalone CLI / standalone adapter
HYDROMANCER_API_KEY=...                # required for Hyperliquid via Hydromancer
HYDROMANCER_TESTNET=0                  # set to 1 to use the testnet WS

# Postgres for the Sessions adapter and the Python sidecar
DATABASE_URL=postgresql://user:pass@host:5432/db

# Sidecar URL exposed to the Node app
BACKTEST_ENGINE_URL=http://localhost:8787

# AWS (only if you read the Hydromancer S3 reservoir directly)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-northeast-1               # reservoir is in Tokyo
AWS_REQUEST_PAYER=requester             # required — bucket is requester-pays
```

---

## Source-by-source rate limits and historical depth

### Binance Spot — free, no key

- **Rate limit:** 6,000 REQUEST_WEIGHT per minute per IP. Increased from 1,200 to 6,000 on 2023-08-25.<sup>[1][2]</sup>
- **`GET /api/v3/klines` weight:** 2 per call. Default 500 bars, **max 1,000 bars** per request.<sup>[3]</sup>
- **Auth:** "The limits on the API are based on the IPs, not the API keys" — public market endpoints work without a key.<sup>[2]</sup>
- **Historical depth:** Effectively unlimited via pagination on `startTime`/`endTime` for major pairs (BTCUSDT goes back to 2017).

### Bybit V5 — free, no key

- **Rate limit:** "You are allowed to send 600 requests within a 5-second window per IP by default" — i.e. 7,200 / minute.<sup>[4]</sup>
- **`GET /v5/market/kline`:** Returns up to 1,000 bars per call. No API key required for public market data.<sup>[5]</sup>
- **Historical depth:** Several years for major pairs.

### Coinbase Exchange — free, no key

- **Rate limit:** Public REST endpoints throttled by IP using a token-bucket. Advanced Trade public is documented at 10 RPS; Exchange API uses the same lazy-fill model.<sup>[6]</sup>
- **`GET /products/{id}/candles`:** Returns up to 300 bars per call. Granularity in seconds (60, 300, 900, 3600, 21600, 86400). No auth required for public candles.<sup>[6]</sup>
- **Historical depth:** Full history for BTC-USD; smaller pairs vary by listing date.

### Hyperliquid via Hydromancer — paid

Native HL `/info` is no longer the path we use. Hydromancer wraps it and adds
1s candles + much deeper history.

- **REST:** `POST https://api.hydromancer.xyz/info` with `Authorization: Bearer ${KEY}`. Each `candleSnapshot` returns up to **5,000 bars** per request (vs the native HL cap of 5,000 most-recent only, no pagination).<sup>[7][8]</sup>
- **WS:** `wss://api.hydromancer.xyz/ws?token=${KEY}`. We subscribe to the `allCandles` channel which batches every coin-with-activity per HL block in a single feed.<sup>[9][10]</sup>
- **Pricing tiers** (from the docs verbatim):<sup>[11]</sup>
  - **Starter** $300/mo — 500k tokens; overage $60 per 100k. 50 connections, 500 total subs, 300 msgs/min, 5 orderbooks.
  - **Growth** $1,200/mo — 3M tokens; overage $25 per 100k. 500 conns, 5,000 subs, 3,000 msgs/min, 10 orderbooks.
  - **Scale** $2,500/mo — 15M tokens; overage $10 per 100k. 1,000 conns, 10,000 subs, 6,000 msgs/min, 100 orderbooks.
  - **Enterprise** — custom; unlimited calls.
- **Per-call cost:** "20 points per request" for `candleSnapshot`.<sup>[7]</sup>
- **1-second candles:** Available via Hydromancer; require Growth tier or above.<sup>[9]</sup>
- **S3 reservoir:** `s3://hydromancer-reservoir/` (Tokyo, requester-pays). 1-second OHLCV partitioned by date at `by_dex/hyperliquid/candles/1s/date=YYYY-MM-DD/`. **Complete data only from 2025-07-28 onward.**<sup>[12][13]</sup>

### Native Hyperliquid `/info` — fallback only

- Hyperliquid's own `/info` candleSnapshot is **capped at the 5,000 most-recent candles, with no pagination**. For 1-day bars that's ~13.7 years of reach; for 1-hour bars it's ~7 months.<sup>[8]</sup>
- We keep this as a free fallback if you don't want to pay for Hydromancer; the code is in `server/exchange-clients/hyperliquid.ts` (current default uses Hydromancer).

---

## Seed cost estimate

**Default seed:** top 50 markets per exchange × 4 exchanges × 2 years × {1d, 1h}.

### What 2-year coverage actually means per exchange

| Exchange | 1d bars/symbol | 1h bars/symbol | Reach |
|---|---|---|---|
| Binance | 730 | 17,520 | Full 2y available |
| Bybit | 730 | 17,520 | Full 2y available |
| Coinbase | 730 | 17,520 | Full 2y available |
| Hyperliquid via Hydromancer | 730 | 17,520 | Full 2y via REST (paginated 5k/call); reservoir parquet only goes back to 2025-07-28 |
| Hyperliquid native (free) | 730 | 5,000 ≈ 7 months | Hard cap, no pagination |

### Time and bytes

50 markets × 4 exchanges = 200 markets total. Per market: 730 daily bars + 17,520 hourly bars = 18,250 rows. 200 markets × 18,250 ≈ **3.65 M rows**. At ~80 bytes/row (8 numeric columns) that's ~290 MB of OHLCV in Postgres.

### Per-exchange request count and dollar cost

Calls are sequential per market with concurrency 2 inside each exchange.

| Exchange | Calls per symbol (1d) | Calls per symbol (1h) | Total calls (50 sym) | Wall time | $ |
|---|---|---|---|---|---|
| Binance | 1 | 18 (1000/call) | 950 | <1 min (950 × 2 weight = 1,900 ≪ 6,000/min)<sup>[1]</sup> | **$0** |
| Bybit | 1 | 18 (1000/call) | 950 | <1 min (950 ≪ 7,200/min)<sup>[4]</sup> | **$0** |
| Coinbase | 3 (300/call) | 59 (300/call) | 3,100 | ~5 min (10 RPS public)<sup>[6]</sup> | **$0** |
| Hyperliquid via Hydromancer | 1 (5000/call covers 730d) | 4 (5000/call × 4 = 20k bars) | 250 | <1 min | **~$3** (250 × 20 = 5,000 points; Starter Sessions tier = $300 / 500k = $0.0006/point)<sup>[7][11]</sup> |
| **Total** | — | — | **~5,250** | ~5 min | **~$3** |

The Hydromancer REST cost is small because each call returns up to 5,000 bars,
so the hourly backfill collapses to ~4 calls per market.

### Ongoing live-stream cost (Hydromancer only)

The native exchange WebSockets (Binance, Bybit, Coinbase) are free.

For Hydromancer's `allCandles` channel, the relevant cap is **messages per
minute**:

| Tier | Msgs/min | Plausible HL load? |
|---|---|---|
| Starter ($300/mo) | 300 | **Borderline** — `allCandles` emits per-block batches; HL block time is ~70 ms,<sup>[14]</sup> so even with sparse activity you can spike past 300/min during volatile periods |
| Growth ($1,200/mo) | 3,000 | Comfortable for full HL universe streaming |
| Scale ($2,500/mo) | 6,000 | Headroom for multi-tier orderbook subs as well |

**Practical recommendation:** Starter ($300/mo) for backfill-only or
intermittent live streams. Growth ($1,200/mo) for sustained live `allCandles`
streaming of the full HL universe.

### S3 reservoir (optional)

If you want 1-second granularity for HL — useful for execution-quality
backtests, not for thesis backtests — you can read directly from the parquet
reservoir.

- Bucket region: `ap-northeast-1` (Tokyo).<sup>[12]</sup> If your engine runs
  outside Tokyo, you pay AWS cross-region egress (~$0.09/GB).<sup>[15]</sup>
- File size: not published; estimate **100–500 MB/day** for 1s OHLCV across
  350+ HL coins (350 markets × 86,400 seconds × ~30 bytes/row compressed).
- 1 year of reservoir data ≈ 50–180 GB → ~$5–$16 of egress, plus pennies of
  GET fees. Reservoir is included in your Hydromancer tier (no extra Hydromancer-side fee documented).

### LLM cost per backtest (standalone or Sessions)

Each backtest runs an Opus call to plan, sometimes a Sonnet retry on
validation failure.

- Opus 4.7: $15/M input, $75/M output.<sup>[16]</sup>
- Sonnet 4.6: $3/M input, $15/M output.<sup>[16]</sup>
- Per planner call: ~3,500 input tokens (system prompt + market context) + ~500 output (plan JSON). Opus = $0.0525 + $0.0375 = **~$0.09 per backtest** (no retry).
- Sonnet retry adds ~$0.018; total stays under **$0.11** in the worst case.

For Sessions, the MPP relay marks up at the rate set in
`server/enrichment.ts` (`MARKUP_MULTIPLIER`); see that file for the actual
billing factor.

---

## Bottom line

To stand up the default seed today:

| Item | Cost |
|---|---|
| Binance, Bybit, Coinbase REST backfill | $0 |
| Hyperliquid REST backfill via Hydromancer Starter | ~$3 (one-time) |
| Hydromancer Starter subscription | $300/mo (gates Hyperliquid live stream) |
| Postgres / hosting | varies — your existing Replit/Fly cost |
| LLM per backtest (planner call) | ~$0.09 (Sessions billing applies its markup) |
| **Total to run 1 month with live HL streaming** | **~$300/mo** |

If you skip Hyperliquid entirely (or accept the 7-month native cap), the
whole thing is **$0 + LLM per-call**.

---

## Sources

[1] [Binance Spot API to Increase Request Weight Limits — Binance announcement, 2023-08-17](https://www.binance.com/en/support/announcement/detail/9820396bf54644c39e666b4780622846)
[2] [Binance Spot API LIMITS — developers.binance.com](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/limits)
[3] [Binance Spot API Market Data Endpoints — developers.binance.com](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
[4] [Bybit V5 Rate Limit Rules](https://bybit-exchange.github.io/docs/v5/rate-limit)
[5] [Bybit V5 market/kline](https://bybit-exchange.github.io/docs/v5/market/kline)
[6] [Coinbase Exchange REST Rate Limits Overview](https://docs.cdp.coinbase.com/exchange/rest-api/rate-limits)
[7] [Hydromancer candleSnapshot REST](https://docs.hydromancer.xyz/readme/rest-api/candlesticks/candlesnapshot.md)
[8] [Hyperliquid `/info` endpoint — native candleSnapshot](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
[9] [Hydromancer WebSocket — candle channel](https://docs.hydromancer.xyz/readme/websocket/candles.md)
[10] [Hydromancer WebSocket — allCandles channel](https://docs.hydromancer.xyz/readme/websocket/allcandles.md)
[11] [Hydromancer pricing tiers and API keys](https://docs.hydromancer.xyz/readme/get-api-keys.md)
[12] [Hydromancer Hyperliquid reservoir layout](https://docs.hydromancer.xyz/reservoir/hyperliquid.md)
[13] [Hydromancer reservoir documentation index](https://docs.hydromancer.xyz/sitemap.md)
[14] [Hydromancer rate limits, user limits, heartbeats](https://docs.hydromancer.xyz/readme/websocket/rate-limits-user-limits-and-heartbeats.md)
[15] [AWS S3 pricing — data transfer](https://aws.amazon.com/s3/pricing/)
[16] [Anthropic API pricing](https://www.anthropic.com/pricing)
