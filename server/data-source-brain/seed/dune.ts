/**
 * Dune Analytics seeder — extracts facts from Dune API documentation.
 *
 * Source docs: https://docs.dune.com/
 * Reference: ResearchEverything-Crypto crypto-data-catalog/references/dune.md
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "dune" as const;
const DOCS = "https://docs.dune.com/";
const REF = "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/server/skills/crypto-data-catalog/references/dune.md";

export function seedDune(): Fact[] {
  return [
    // --- Auth ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "auth",
      content:
        "Dune Analytics API uses x-dune-api-key header for authentication. Base URL: https://api.dune.com/api/v1. The Sim API (pre-indexed real-time endpoints) uses SEPARATE API keys from the Analytics API — they are not interchangeable.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Analytics vs Sim API ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "definition",
      content:
        "Dune has two distinct APIs: Analytics API (write and execute your own SQL queries against decoded on-chain data) and Sim API (pre-indexed, real-time endpoints for common data needs). Analytics API is for bespoke analysis; Sim API is for fast lookups without SQL.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Credit-based pricing ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "rate_limit",
      content:
        "Dune uses credit-based pricing. Free tier: 2,500 credits/month, 10 concurrent executions. API calls consume compute units (credits) based on query complexity and data scanned. One complex query is cheaper than 10 simple ones — batch analysis where possible.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Query execution workflow ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "dune:/query/{query_id}/execute",
      category: "definition",
      content:
        "Dune query execution has two patterns: (1) Async: POST /query/{id}/execute → GET /execution/{id}/status (poll) → GET /execution/{id}/results. (2) Blocking: POST /query/{id}/execute/result blocks until complete. Supports parameterized queries via query_parameters in request body.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Cold start latency ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "reliability",
      content:
        "Dune cold query execution typically takes 30-120 seconds, can be longer for complex queries. There is no real-time streaming — it's a polling-based execution model. Add block_time filters to drastically speed up queries (Dune partitions by time).",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Spellbook tables ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "coverage",
      content:
        "Dune Spellbook provides curated, cross-chain abstraction tables: dex.trades (normalized DEX trades), nft.trades, tokens.erc20 (metadata), tokens.transfers, prices.usd (minute-granularity prices), balances.erc20_daily, labels.all (address labels). These are community-maintained and pre-joined.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Decoded tables naming ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "schema",
      content:
        "Dune decoded tables follow pattern: {protocol}_{chain}.{ContractName}_{evt|call}_{EventName}. Examples: uniswap_v3_ethereum.Pair_evt_Swap, aave_v3_ethereum.Pool_evt_Supply. _evt_ = events, _call_ = function calls. Decoded tables may not exist for new/small protocols.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Scheduled query alerts ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "reliability",
      content:
        "Dune supports scheduled query alerts, but Dune's own documentation says they are NOT recommended for time-sensitive applications due to execution delays and queuing behavior.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- prices.usd table ---
    makeFact({
      source: SRC,
      scope: "field",
      scope_ref: "dune:prices.usd",
      category: "definition",
      content:
        "Dune's prices.usd table provides minute-granularity token prices and is critical for converting on-chain amounts to USD. Join on contract_address + minute = date_trunc('minute', block_time). WARNING: prices.usd does NOT cover all tokens — small/new tokens may be missing.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Multi-chain tables ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "coverage",
      content:
        "Dune has same table structure for multiple EVM chains: ethereum.transactions, arbitrum.transactions, optimism.transactions, polygon.transactions, base.transactions. Solana has different schema (account-based model). Cross-chain joins are expensive — query per chain when possible.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Private query limit ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "dune",
      category: "rate_limit",
      content:
        "Dune free tier caps private queries. Workaround: set is_private: false when creating queries via API. Queries become public but are auto-archived after execution. This is a known limitation of the free tier.",
      confidence: "verified_runtime",
      source_of_fact: "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/HANDOFF.md",
    }),

    // --- MCP table discovery ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "dune:mcp/v1",
      category: "definition",
      content:
        "Dune provides an MCP endpoint at https://api.dune.com/mcp/v1 for table discovery. Supports searchTables (by natural language query, with category/blockchain filters) and searchTablesByContractAddress. Useful for discovering available decoded/spellbook tables before writing SQL.",
      confidence: "verified_doc",
      source_of_fact: "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/server/dune-mcp-client.ts",
    }),

    // --- Result pagination and caching ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "dune:/execution/{id}/results",
      category: "schema",
      content:
        "Dune API results support pagination via ?limit=1000&offset=0. Results include execution_id which can be used to re-fetch results without re-executing the query (saves credits). Query results expire after some time — re-execute if stale.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),
  ];
}
