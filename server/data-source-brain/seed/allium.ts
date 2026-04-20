/**
 * Allium seeder — extracts facts from Allium documentation.
 *
 * Source docs: https://docs.allium.so
 * Reference: ResearchEverything-Crypto crypto-data-catalog/references/allium.md
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "allium" as const;
const DOCS = "https://docs.allium.so";
const REF = "https://github.com/polecalmer/ResearchEverything-Crypto/blob/main/server/skills/crypto-data-catalog/references/allium.md";

export function seedAllium(): Fact[] {
  return [
    // --- Three product surfaces ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "definition",
      content:
        "Allium has three product surfaces: (1) Developer — REST/SQL API for programmatic querying, (2) Datashares — direct warehouse integration (Snowflake, BigQuery), (3) Datastreams — real-time data via Kafka, PubSub, or SNS.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Enterprise access ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "auth",
      content:
        "Allium is enterprise-tier with no public self-serve free tier. Access requires contacting sales. API key required for all endpoints. Base URL: https://api.allium.so.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Coverage claims ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "coverage",
      content:
        "Allium claims coverage of 100+ blockchains and 1000+ schemas per public marketing. NOTE: specific numbers need verification against current documentation — these are marketing claims, not API-documented guarantees.",
      confidence: "unverified",
      source_of_fact: DOCS,
    }),

    // --- Known consumers ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "reliability",
      content:
        "Known enterprise consumers of Allium include Phantom (wallet), Visa, and notably DeFiLlama itself (uses Allium for data ingestion). This speaks to data quality and coverage breadth.",
      confidence: "verified_doc",
      source_of_fact: DOCS,
    }),

    // --- Non-EVM chain coverage ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "coverage",
      content:
        "Allium's key differentiator is non-EVM chain coverage: Solana (full IDL decoding), Cosmos/IBC chains, Sui, Aptos, Bitcoin (UTXO + Ordinals + BRC-20). This is significantly broader than Dune's primarily EVM-focused coverage.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- When to use Allium vs Dune ---
    makeFact({
      source: SRC,
      scope: "cross-source",
      scope_ref: "allium<->dune",
      category: "definition",
      content:
        "Use Allium over Dune when: (1) analyzing Solana with decoded IDL data, (2) Cosmos/IBC msg types, (3) Sui/Aptos analysis, (4) cross-chain EVM + non-EVM in unified schema, (5) need lower latency on raw data. Use Dune when: EVM-only with Spellbook coverage, community dashboards, or community query reuse.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Schema patterns ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "schema",
      content:
        "Allium EVM table patterns: {chain}.raw_transactions, {chain}.raw_logs, {chain}.raw_traces, {chain}.decoded_events, {chain}.decoded_calls, {chain}.erc20_transfers, {chain}.token_balances. Similar to Dune's structure but with different naming conventions.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Solana-specific ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "schema",
      content:
        "Allium Solana tables: solana.raw_transactions, solana.raw_instructions, solana.decoded_instructions (IDL-decoded), solana.token_transfers, solana.token_balances. Instructions are the unit of work on Solana (vs events on EVM). program_id is the Solana equivalent of contract_address.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- No Spellbook equivalent ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "coverage",
      content:
        "Allium has no equivalent of Dune's Spellbook (pre-built community abstractions like dex.trades). You work with raw/decoded tables and build your own abstractions. Also no community dashboard layer — can't browse/fork other people's queries.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Query execution ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "allium:/v1/query",
      category: "definition",
      content:
        "Allium supports SQL queries via POST /v1/query with JSON body {sql, parameters}. Generally lower latency than Dune (no cold start queue). Results delivered as JSON or Parquet. Synchronous for fast queries, async with polling for heavy ones.",
      confidence: "verified_doc",
      source_of_fact: REF,
    }),

    // --- Rate limits unknown ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "allium",
      category: "rate_limit",
      content:
        "Allium rate limits are not publicly documented. As an enterprise product, limits are likely negotiated per customer contract. Contact sales for specifics.",
      confidence: "unverified",
      source_of_fact: DOCS,
    }),
  ];
}
