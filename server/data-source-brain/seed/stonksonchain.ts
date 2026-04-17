/**
 * StonksOnChain seeder — extracts facts from StonksOnChain API docs.
 *
 * Source docs: https://stonksonchain.net/llms.txt, https://stonksonchain.net/api/openapi.json
 * This is a narrow, specialist source for HIP-3 deployer analytics on Hyperliquid.
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "stonksonchain" as const;
const LLMS_TXT = "https://stonksonchain.net/llms.txt";
const OPENAPI = "https://stonksonchain.net/api/openapi.json";

export function seedStonksOnChain(): Fact[] {
  return [
    // --- Auth ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "stonksonchain",
      category: "auth",
      content:
        "StonksOnChain API uses x-api-key header for authentication. API key is obtained by contacting @StonksOnChain on X (Twitter). There is no self-serve signup.",
      confidence: "verified_doc",
      source_of_fact: LLMS_TXT,
    }),

    // --- Scope ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "stonksonchain",
      category: "coverage",
      content:
        "StonksOnChain is a narrow, specialist data source focused specifically on HIP-3 deployer analytics on Hyperliquid. It is NOT a general crypto data provider — do not use it for general market data, prices, or TVL.",
      confidence: "verified_doc",
      source_of_fact: LLMS_TXT,
    }),

    // --- Fees endpoints ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/v1/fees/summary",
      category: "definition",
      content:
        "GET /api/v1/fees/summary returns a summary of HIP-3 deployer fees across all tracked coins. Provides aggregate fee data for the HIP-3 ecosystem on Hyperliquid.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/v1/fees/history",
      category: "definition",
      content:
        "GET /api/v1/fees/history?days=N returns historical fee data for HIP-3 deployers. The 'days' parameter controls the lookback window. Returns time series of fee accrual.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),

    // --- Global metrics ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/global-metrics",
      category: "definition",
      content:
        "GET /api/global-metrics returns aggregate Hyperliquid ecosystem metrics. Use this for high-level overview of the HIP-3 ecosystem health and activity.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),

    // --- HYPE unlocks ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/hype-unlocks",
      category: "definition",
      content:
        "POST /api/hype-unlocks (with empty body) returns HYPE token unlock schedule data. Note: this is a POST endpoint despite being a read operation — must send an empty body, not GET.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),

    // --- Market quality ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/market-quality/:coin",
      category: "definition",
      content:
        "GET /api/market-quality/:coin returns market quality metrics (spread, depth, liquidity) for a specific HIP-3 coin on Hyperliquid. Use the coin ticker as the path parameter.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),

    // --- Data freshness ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "stonksonchain",
      category: "freshness",
      content:
        "StonksOnChain data uses hourly snapshots since January 18, 2026. Data before that date uses candleSnapshot backfill, which may have different granularity or coverage characteristics.",
      confidence: "verified_doc",
      source_of_fact: LLMS_TXT,
    }),

    // --- Fee calculation ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "stonksonchain",
      category: "definition",
      content:
        "StonksOnChain fee calculation uses deployer-specific feeScale with a 0.1x growth mode multiplier since November 22, 2025. This means fee computations differ before and after that date — historical comparisons must account for the multiplier change.",
      confidence: "verified_doc",
      source_of_fact: LLMS_TXT,
    }),

    // --- Comparison endpoints ---
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: "stonksonchain:/api/lighter/kpis",
      category: "definition",
      content:
        "GET /api/lighter/kpis and GET /api/ostium/kpis provide cross-exchange comparison KPIs against Lighter and Ostium exchanges respectively. Use these for benchmarking Hyperliquid HIP-3 metrics against competing platforms.",
      confidence: "verified_doc",
      source_of_fact: OPENAPI,
    }),

    // --- Rate limits ---
    makeFact({
      source: SRC,
      scope: "source",
      scope_ref: "stonksonchain",
      category: "rate_limit",
      content:
        "StonksOnChain API rate limits are not publicly documented. As a small specialist API with key-based access, assume conservative rate limits and implement backoff on 429 responses.",
      confidence: "unverified",
      source_of_fact: LLMS_TXT,
    }),
  ];
}
