/**
 * DeFiLlama seeder — extracts facts from DeFiLlama API documentation.
 *
 * Source docs: https://defillama.com/docs/api and reference from
 * ResearchEverything-Crypto/server/skills/crypto-data-catalog/references/defillama.md
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "defillama" as const;
const DOCS_BASE = "https://defillama.com/docs/api";
const REF = "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/server/skills/crypto-data-catalog/references/defillama.md";

export function seedDeFiLlama(): Fact[] {
  return [
    // --- Auth & Base URL ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "auth",
      content:
        "DeFiLlama API is fully free with no API key required. No authentication needed for any endpoint.",
      confidence: "verified_doc",
      source_of_fact: DOCS_BASE,
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "auth",
      content:
        "Free API base URL is https://api.llama.fi. Pro API base URL is https://pro-api.llama.fi/{KEY}. These are NOT interchangeable — pro endpoints require a valid key in the URL path.",
      confidence: "verified_doc",
      source_of_fact: DOCS_BASE,
    }),

    // --- Rate Limits ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "rate_limit",
      content:
        "DeFiLlama does not publicly document specific rate limits. If you get 429 responses, back off 5 seconds and retry. Rate limiting happens rarely under normal usage.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Coverage ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "coverage",
      content:
        "DeFiLlama covers: TVL tracking (all DeFi protocols), DEX volumes, derivatives volumes, fees & revenue, yields/APY, stablecoin metrics, bridge volumes, and token prices. It is the largest DeFi TVL aggregator.",
      confidence: "verified_doc",
      source_of_fact: DOCS_BASE,
    }),
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "coverage",
      content:
        "DeFiLlama has multiple sub-APIs on different subdomains: api.llama.fi (core TVL/fees/volumes), coins.llama.fi (prices), yields.llama.fi (APY data), stablecoins.llama.fi (stablecoin metrics).",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Endpoint: /protocols vs /protocol/{name} ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:/protocol/{name}",
      category: "definition",
      content:
        "GET /protocol/{name} returns a much richer response than /v2/protocols for a single protocol — includes historical TVL array, chain breakdown (chainTvls), borrowed/staking TVL if relevant. Use /v2/protocols for listing, /protocol/{name} for deep dives.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:/v2/protocols",
      category: "schema",
      content:
        "Protocol slugs in DeFiLlama are lowercase, hyphenated strings. Always check /v2/protocols to find the exact slug. The response is large (~2MB) — cache it as it changes slowly.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Endpoint: /v2/historicalChainTvl ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:/v2/historicalChainTvl",
      category: "definition",
      content:
        "GET /v2/historicalChainTvl returns global TVL history. This endpoint excludes liquid staking and double-counted TVL by default per the docs, giving a cleaner aggregate figure.",
      confidence: "verified_doc",
      source_of_fact: DOCS_BASE,
    }),

    // --- Fees vs Revenue ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:/summary/fees/{protocol}",
      category: "definition",
      content:
        "In DeFiLlama, 'fees' != 'revenue'. Fees = total paid by users. Revenue = portion of fees accruing to the protocol or token holders. Use dataType=dailyFees or dataType=dailyRevenue query param to select. Not all protocols have fee/revenue data.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Timestamp format ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "schema",
      content:
        "DeFiLlama API timestamps are Unix seconds (not milliseconds) unless otherwise noted. The totalDataChart arrays use [timestamp_seconds, value] pairs.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Prices API ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:coins.llama.fi/prices",
      category: "definition",
      content:
        "DeFiLlama Prices API (coins.llama.fi) uses address format {chain}:{address} (e.g., ethereum:0xdac17f...) or coingecko:{id} for CoinGecko IDs. Can batch multiple coins comma-separated. Returns confidence score — values < 0.9 indicate unreliable price (low liquidity).",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Yields API ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:yields.llama.fi/pools",
      category: "definition",
      content:
        "DeFiLlama Yields API returns 10,000+ pools. Pool IDs are UUIDs, not protocol names — search by 'project' or 'symbol' field. apy = apyBase + apyReward (base = organic yield, reward = token incentives). Some pools return apy: null — skip these.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- DEX Volume endpoints ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "defillama:/summary/dexs/{protocol}",
      category: "definition",
      content:
        "DeFiLlama has separate volume endpoints for DEXes (/summary/dexs/{protocol}), derivatives (/summary/derivatives/{protocol}), and options (/overview/options). A protocol's volume won't appear under dexs if it's a derivatives exchange — you must check the correct category.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Protocol with zero TVL ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "defillama",
      category: "reliability",
      content:
        "Some DeFiLlama protocols show tvl: 0. This may indicate the protocol has deprecated, migrated to a new version, or has no active TVL. Do not assume tvl: 0 means the protocol is inactive — check fee/revenue endpoints separately.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),
  ];
}
