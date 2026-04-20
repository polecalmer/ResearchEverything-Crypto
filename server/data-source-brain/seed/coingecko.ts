/**
 * CoinGecko seeder — extracts facts from CoinGecko API documentation.
 *
 * Source docs: https://docs.coingecko.com/reference/introduction
 * Reference: ResearchEverything-Crypto crypto-data-catalog/references/coingecko.md
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "coingecko" as const;
const DOCS = "https://docs.coingecko.com/reference/introduction";
const REF = "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/server/skills/crypto-data-catalog/references/coingecko.md";
const CHANGELOG = "https://docs.coingecko.com/changelog";

export function seedCoinGecko(): Fact[] {
  return [
    // --- Auth ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "auth",
      content:
        "CoinGecko free tier works without an API key (or with a demo key for slightly better stability). Pro tier requires x-cg-pro-api-key header. Free base URL: https://api.coingecko.com/api/v3. Pro base URL: https://pro-api.coingecko.com/api/v3.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Rate Limits ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "rate_limit",
      content:
        "CoinGecko demo/free tier: ~30 requests/minute (enforced, returns 429). On 429, wait 60 seconds before retrying. Register for a free demo API key for more stable access at the same rate limit.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "rate_limit",
      content:
        "CoinGecko paid Pro plan: 500-1000 requests/minute depending on tier. Also unlocks interval=5m override for market_chart endpoints (up to 30 days) and precision parameter for price calls.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Changelog ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "freshness",
      content:
        "CoinGecko's changelog at https://docs.coingecko.com/changelog is the canonical source of breaking change notifications. Check it before relying on specific endpoint behavior — they periodically deprecate or modify responses.",
      confidence: "verified_doc",
      source_of_fact: CHANGELOG,
    }),

    // --- ID Resolution ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/coins/list",
      category: "definition",
      content:
        "CoinGecko uses its own internal IDs, NOT ticker symbols. IDs are often unintuitive: 'bitcoin' not 'btc', 'lido-dao' not 'lido', 'tether' not 'usdt', 'usd-coin' not 'usdc'. Multiple tokens may share a symbol. ALWAYS resolve ID first via /search or /coins/list before calling other endpoints.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Prices endpoint ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/simple/price",
      category: "definition",
      content:
        "GET /simple/price supports batching up to ~100 IDs per call (comma-separated). Supports include_market_cap, include_24hr_vol, include_24hr_change params. This is the most efficient endpoint for bulk current price lookups.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Market Chart granularity ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/coins/{id}/market_chart",
      category: "definition",
      content:
        "CoinGecko /coins/{id}/market_chart auto-selects granularity: days=1 → ~5min intervals, days=2..90 → hourly, days=91+ or 'max' → daily. Free tier caps historical data at daily granularity beyond 90 days. Pro plan unlocks 5-min override for up to 30 days.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Markets endpoint ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/coins/markets",
      category: "definition",
      content:
        "GET /coins/markets returns top tokens by market cap with per_page max 250. Supports filtering by category and specific IDs. Use this for bulk market data instead of individual /coins/{id} calls which are heavy (~50KB each).",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- On-chain DEX endpoints (GeckoTerminal) ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "coverage",
      content:
        "CoinGecko has two distinct endpoint families: standard endpoints (prices, markets, coins) and on-chain DEX endpoints (GeckoTerminal integration, currently in beta). The on-chain endpoints use a different base path and provide pool-level DEX trading data. These are separate from the main CoinGecko API.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Detailed coin data ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/coins/{id}",
      category: "schema",
      content:
        "GET /coins/{id} is heavy (~50KB per call). Key fields: market_data.current_price.usd, market_data.market_cap.usd, market_data.fully_diluted_valuation.usd, market_data.circulating_supply, market_data.total_supply, market_data.max_supply (null if no cap). Use lean params (?localization=false&tickers=false&community_data=false&developer_data=false) to reduce payload.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Known limitations ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "reliability",
      content:
        "CoinGecko exchange volume data includes wash trading — use trust_score field to filter exchanges. Category assignments can be subjective/incomplete. max_supply is null for many tokens (no hard cap). Some new/small tokens may not be listed — fall back to DeFiLlama contract price.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Timestamp format ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "coingecko",
      category: "schema",
      content:
        "CoinGecko market_chart endpoints return timestamps in MILLISECONDS (not seconds). Convert to seconds by dividing by 1000. This is opposite to DeFiLlama which uses seconds.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Token by contract ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "coingecko:/simple/token_price/{platform}",
      category: "definition",
      content:
        "CoinGecko supports price lookup by contract address via /simple/token_price/{platform}. Platform IDs: ethereum, polygon-pos, arbitrum-one, optimistic-ethereum, base, binance-smart-chain, solana, avalanche. Alternative: DeFiLlama coins.llama.fi/prices/current/{chain}:{addr} is often easier.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),
  ];
}
