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

    // ─── Hyperliquid ───────────────────────────────────────────────────────
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "hyperliquid",
      category: "coverage",
      content: "Hyperliquid is a perpetuals-first L1 DEX. Symbols are bare base names (BTC, ETH, HYPE — NOT BTCUSDT). All markets quote in USD. Use exchange='hyperliquid', symbol='HYPE' in BacktestPlans referencing HL.",
      confidence: "verified_doc",
      source_of_fact: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "hyperliquid:/info",
      category: "schema",
      content: "Hyperliquid info endpoint is POST-only. Body { type: 'candleSnapshot', req: { coin, interval, startTime, endTime } } returns array of { t, T, o, c, h, l, v, n }. Body { type: 'metaAndAssetCtxs' } returns [{ universe }, [ctx]] with 24h volume in dayNtlVlm.",
      confidence: "verified_doc",
      source_of_fact: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint",
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "hyperliquid:wss",
      category: "schema",
      content: "Hyperliquid WS: wss://api.hyperliquid.xyz/ws. Subscribe with { method: 'subscribe', subscription: { type: 'candle', coin: 'HYPE', interval: '1h' } }. Messages stream the in-progress bar with each tick — upsert by (market_id, ts) so the last write wins.",
      confidence: "verified_doc",
      source_of_fact: "https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket",
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
