/**
 * Exchange API facts — kline endpoints, rate limits, WS schemas, quirks.
 * Used by the backtest agent so the LLM can reason about which exchange to
 * pull data from and what symbol format to emit.
 */
import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "exchanges" as const;

export function seedExchanges(): Fact[] {
  return [
    // ─── Binance ────────────────────────────────────────────────────────────
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "binance",
      category: "auth",
      content: "Binance public market-data endpoints (klines, exchangeInfo, ticker/24hr) require no API key.",
      confidence: "verified_doc",
      source_of_fact: "https://binance-docs.github.io/apidocs/spot/en/",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "binance:/api/v3/klines",
      category: "schema",
      content: "GET /api/v3/klines returns up to 1000 candles per request. Params: symbol (BTCUSDT format, no slash), interval (1m/5m/15m/1h/4h/1d/1w), startTime, endTime, limit. Response is an array of [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore].",
      confidence: "verified_doc",
      source_of_fact: "https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "binance:wss/stream",
      category: "schema",
      content: "Binance WebSocket kline stream: wss://stream.binance.com:9443/stream?streams=<symbol>@kline_<interval>. Combined-stream messages have shape { stream, data: { k: { t,T,o,h,l,c,v,q,x } } }. The `x` field is true when the bar has closed; only persist closed bars.",
      confidence: "verified_doc",
      source_of_fact: "https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-streams",
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "binance",
      category: "rate_limit",
      content: "Binance market data: 6,000 weight/minute by IP. Klines costs 1-2 weight depending on limit. Backfilling 2y of 1h bars (~17,520 per symbol = 18 requests) is well within limits — cap concurrency at ~2 to be polite.",
      confidence: "verified_doc",
      source_of_fact: "https://binance-docs.github.io/apidocs/spot/en/#limits",
    }),

    // ─── Bybit ──────────────────────────────────────────────────────────────
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "bybit",
      category: "auth",
      content: "Bybit public market data (v5/market/*) requires no API key.",
      confidence: "verified_doc",
      source_of_fact: "https://bybit-exchange.github.io/docs/v5/intro",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "bybit:/v5/market/kline",
      category: "schema",
      content: "Bybit kline endpoint: GET /v5/market/kline?category=spot&symbol=BTCUSDT&interval=60&start=…&end=…&limit=1000. Interval is in MINUTES for sub-day (60 = 1h) and 'D' for daily. Response list is newest-first — reverse client-side. Each row: [start, open, high, low, close, volume, turnover].",
      confidence: "verified_doc",
      source_of_fact: "https://bybit-exchange.github.io/docs/v5/market/kline",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "bybit:wss/v5/public/spot",
      category: "schema",
      content: "Bybit WS: wss://stream.bybit.com/v5/public/spot. Subscribe via JSON frame: { op: 'subscribe', args: ['kline.60.BTCUSDT'] }. Messages have { topic: 'kline.60.BTCUSDT', data: [{ start, open, high, low, close, volume, turnover, confirm }] }. Persist only when confirm===true.",
      confidence: "verified_doc",
      source_of_fact: "https://bybit-exchange.github.io/docs/v5/websocket/public/kline",
    }),

    // ─── Coinbase ──────────────────────────────────────────────────────────
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coinbase:/products/{id}/candles",
      category: "schema",
      content: "Coinbase Exchange candles: GET https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=ISO&end=ISO. granularity in SECONDS (60, 300, 900, 3600, 21600, 86400). Returns max 300 candles per request, newest-first. Rows: [time, low, high, open, close, volume].",
      confidence: "verified_doc",
      source_of_fact: "https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproductcandles",
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coinbase",
      category: "reliability",
      content: "Coinbase WebSocket does NOT publish closed-bar kline events natively. To get streaming bars, subscribe to the 'matches' channel and resample client-side. v1 worker leaves this as a no-op — coinbase data stays REST-fresh, not WS-fresh, until the seeder runs again.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.cloud.coinbase.com/exchange/docs/websocket-overview",
    }),

    // ─── Hyperliquid (via Hydromancer) ─────────────────────────────────────
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "hyperliquid",
      category: "coverage",
      content: "Hyperliquid is a perpetuals-first L1 DEX. Symbols are bare base names (BTC, ETH, HYPE — NOT BTCUSDT). All markets quote in USD. Use exchange='hyperliquid', symbol='HYPE' in BacktestPlans referencing HL. We access HL data via Hydromancer (https://api.hydromancer.xyz), which proxies the native /info endpoint and adds 1s candles plus richer historical depth.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.hydromancer.xyz",
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "hyperliquid:hydromancer",
      category: "auth",
      content: "Hydromancer requires an API key for both REST and WS. REST: header 'Authorization: Bearer ${HYDROMANCER_API_KEY}'. WS: query param '?token=${HYDROMANCER_API_KEY}' on the connection URL. Same key for both. Provision at data@hydromancer.xyz.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.hydromancer.xyz/readme/get-api-keys.md",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "hyperliquid:hydromancer:/info",
      category: "schema",
      content: "Hydromancer candleSnapshot: POST https://api.hydromancer.xyz/info with body { type: 'candleSnapshot', req: { coin, interval, startTime, endTime, limit } }. coin = bare HL ticker ('BTC', 'HYPE') or 'dex:SYMBOL' for HIP-3. interval supports 1s/1m/3m/5m/15m/30m/1h/2h/4h/8h/12h/1d/3d/1w/1M (1s requires Growth tier or above). limit max 5000 (default 5000). Response is an array of bars with fields s,i,t,T,o,h,l,c,v,q,n,x — verbose Hyperliquid format with quoteVolume (q) and closed-flag (x) that the native API omits.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.hydromancer.xyz/readme/rest-api/candlesticks/candlesnapshot.md",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "hyperliquid:hydromancer:wss",
      category: "schema",
      content: "Hydromancer WS: wss://api.hydromancer.xyz/ws?token=KEY (mainnet) or wss://api-testnet.hydromancer.xyz/ws?token=KEY (testnet). For multi-symbol subscriptions, prefer { method:'subscribe', subscription:{ type:'allCandles', interval:'1h' } } — Hydromancer batches all coins-with-activity per block in a single feed, far cheaper than N 'candle' subscriptions. Per-bar messages have shape { type, seq, cursor, data: { s,i,t,T,o,h,l,c,v,q,n,x } } (single) or { ..., data: [...] } (batch). The 'x' field marks closed bars; the worker upserts on (market_id, ts) so in-progress bars get revised in place.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.hydromancer.xyz/readme/websocket/allcandles.md",
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "hyperliquid:hydromancer",
      category: "rate_limit",
      content: "Hydromancer pricing is token-based, not request-based. Each candleSnapshot call costs 20 points; tiers run 500k tokens/month (Starter, $300) → 15M (Scale, $2500) → unlimited (Enterprise). REST has no per-IP throttle as long as the token budget holds. For full historical backfills consider the S3 reservoir (s3://hydromancer-reservoir/by_dex/hyperliquid/candles/1s/date=YYYY-MM-DD/, requester-pays, parquet) instead of REST.",
      confidence: "verified_doc",
      source_of_fact: "https://docs.hydromancer.xyz/readme/get-api-keys.md",
    }),

    // ─── Cross-exchange routing rules for the backtest planner ──────────────
    makeFact({
      source: SRC,
      scope: "cross-source",
      scope_ref: "backtest:routing",
      category: "definition",
      content: "Backtest universe routing: prefer binance for spot majors (BTCUSDT/ETHUSDT/SOLUSDT and similar high-volume pairs); use hyperliquid for HYPE and perps-native theses; fall back to coinbase only when binance/bybit don't carry the asset (e.g. some US-only listings). Bybit is the secondary fallback for any spot pair binance lacks.",
      confidence: "verified_doc",
      source_of_fact: "internal:backtest-agent",
    }),
    makeFact({
      source: SRC,
      scope: "cross-source",
      scope_ref: "backtest:costs",
      category: "definition",
      content: "Default cost assumptions for backtests: spot = fee_bps 10, slippage_bps 5; perp (hyperliquid, bybit perp) = fee_bps 5, slippage_bps 3. Override only if the user provides explicit fee/slippage in the prompt.",
      confidence: "verified_doc",
      source_of_fact: "internal:backtest-agent",
    }),
  ];
}
