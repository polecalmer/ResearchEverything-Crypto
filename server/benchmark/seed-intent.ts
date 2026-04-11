/**
 * Seed Intent Interpretation Benchmark Cases
 *
 * Tests whether the agent understands what the user actually wants,
 * not just whether it can fetch data correctly.
 *
 * Categories:
 *   - intent_vague: Open-ended queries with multiple valid answers
 *   - intent_implicit: Queries where the metric is implied, not stated
 *   - intent_timerange: Queries that imply a specific time period
 *   - intent_comparison: Multi-entity comparisons
 *   - intent_multichain: Chain-specific or cross-chain queries
 *
 * Scoring uses an LLM judge (Opus) instead of magnitude/MAPE.
 */

import { storage } from "../storage";
import type { InsertBenchmarkCase } from "@shared/schema";

interface IntentCaseDefinition {
  protocol: string;
  metricType: string;
  naturalLanguageQuery: string;
  intentCategory: string;        // vague, implicit, timerange, comparison, multichain
  acceptableBehaviors: string;    // JSON description of what counts as a pass
  protocolSlug: string;
  protocolCategory: string;
}

const INTENT_CASES: IntentCaseDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // VAGUE / OPEN-ENDED (10 cases)
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "intent_vague",
    naturalLanguageQuery: "How is Aave doing?",
    intentCategory: "vague",
    acceptableBehaviors: "Any chart showing Aave TVL, revenue, fees, user growth, or borrow volume. Any reasonable metric is a pass. Must have real data, not empty.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Lido",
    metricType: "intent_vague",
    naturalLanguageQuery: "Is Lido still relevant?",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL trend, staking dominance, or market share. Any chart demonstrating Lido's current position or trajectory is a pass.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_vague",
    naturalLanguageQuery: "What's happening with Uniswap?",
    intentCategory: "vague",
    acceptableBehaviors: "Should show recent volume, TVL, fees, or any activity metric. Any chart with real Uniswap data is a pass.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Ethena",
    metricType: "intent_vague",
    naturalLanguageQuery: "Give me a quick overview of Ethena",
    intentCategory: "vague",
    acceptableBehaviors: "Should produce 1-3 charts covering key metrics (TVL, revenue, USDe supply, fees). At least one chart with real data is a pass.",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
  },
  {
    protocol: "Aave",
    metricType: "intent_vague",
    naturalLanguageQuery: "How's the lending market?",
    intentCategory: "vague",
    acceptableBehaviors: "Could compare Aave/Compound/Morpho, or show overall lending TVL/borrows. Any chart showing lending activity data is a pass.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "MakerDAO",
    metricType: "intent_vague",
    naturalLanguageQuery: "What's the state of MakerDAO?",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL, revenue, DAI supply, or any key MakerDAO/Sky metric. Any chart with real data is a pass.",
    protocolSlug: "makerdao",
    protocolCategory: "Lending",
  },
  {
    protocol: "Morpho",
    metricType: "intent_vague",
    naturalLanguageQuery: "Tell me about Morpho",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL, borrow volume, supply, or any Morpho metric. Any chart with real data is a pass.",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
  },
  {
    protocol: "Curve",
    metricType: "intent_vague",
    naturalLanguageQuery: "How is Curve Finance doing these days?",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL, volume, fees, or CRV price. Any chart with real Curve data is a pass.",
    protocolSlug: "curve-dex",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Compound",
    metricType: "intent_vague",
    naturalLanguageQuery: "Is Compound still used?",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL, borrow volume, user counts, or fees indicating activity level. Any chart with real data is a pass.",
    protocolSlug: "compound",
    protocolCategory: "Lending",
  },
  {
    protocol: "Lido",
    metricType: "intent_vague",
    naturalLanguageQuery: "Lido health check",
    intentCategory: "vague",
    acceptableBehaviors: "Should show TVL, revenue, stETH metrics, or validator data. Any chart showing Lido activity or health is a pass.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },

  // ═══════════════════════════════════════════════════════════
  // IMPLICIT METRIC (10 cases)
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How much does Aave make?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show revenue or fees — not TVL, not price. The user is asking about earnings. Revenue, fees, or protocol income chart is a pass.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Morpho",
    metricType: "intent_implicit",
    naturalLanguageQuery: "Is Morpho growing?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show a growth trend — TVL growth, user growth, borrow volume growth. An absolute snapshot without trend is a fail. A time series showing increase is a pass.",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
  },
  {
    protocol: "Hyperliquid",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How expensive is HYPE?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show P/E ratio, price, or valuation metric — not volume, not TVL. User is asking about valuation relative to fundamentals or token price.",
    protocolSlug: "hyperliquid",
    protocolCategory: "Derivatives",
  },
  {
    protocol: "Lido",
    metricType: "intent_implicit",
    naturalLanguageQuery: "What's Lido's market share?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show Lido's share relative to competitors or total staking. A chart comparing Lido TVL vs others, or Lido % of total ETH staked is a pass. Raw TVL alone is a fail.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },
  {
    protocol: "Compound",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How much are people borrowing on Compound?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show borrow volume or outstanding borrows — not TVL, not supply, not fees. A chart of lending.borrow or similar borrow metric is a pass.",
    protocolSlug: "compound",
    protocolCategory: "Lending",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_implicit",
    naturalLanguageQuery: "Is Uniswap profitable?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show revenue, fees, or P/E ratio — something about profitability. Volume alone is a fail. Fee revenue or protocol earnings is a pass.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Ethena",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How popular is USDe?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show USDe supply, adoption, or usage metric — not ENA token price, not protocol revenue. Supply growth, holder count, or transfer volume is a pass.",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
  },
  {
    protocol: "Aave",
    metricType: "intent_implicit",
    naturalLanguageQuery: "What are Aave's earnings?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show revenue or net earnings — not TVL, not borrow volume. Protocol revenue, fees, or income chart is a pass.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Curve",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How liquid is Curve?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show TVL or liquidity depth — not volume, not fees, not price. TVL chart or pool liquidity is a pass.",
    protocolSlug: "curve-dex",
    protocolCategory: "Dexes",
  },
  {
    protocol: "MakerDAO",
    metricType: "intent_implicit",
    naturalLanguageQuery: "How safe is MakerDAO?",
    intentCategory: "implicit",
    acceptableBehaviors: "MUST show a safety/risk metric — collateralization ratio, TVL, liquidation data, or DAI backing. Revenue alone is a fail. Any risk/collateral metric is a pass.",
    protocolSlug: "makerdao",
    protocolCategory: "Lending",
  },

  // ═══════════════════════════════════════════════════════════
  // TIME-RANGE INTERPRETATION (10 cases)
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Aave revenue last month",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover approximately the last 30 days (15-60 days acceptable). Showing 365 days of data is a fail. Must be revenue, not TVL.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Uniswap volume this year",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should start from approximately Jan 1 of current year. Showing data from 2+ years ago is a fail. Must be volume, not TVL.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Lido",
    metricType: "intent_timerange",
    naturalLanguageQuery: "How has Lido done since the merge?",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should start from approximately Sep 2022 (the Ethereum merge). Showing only last 90 days is a fail. Any metric from Sep 2022 onward is a pass.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },
  {
    protocol: "Morpho",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Morpho borrows this week",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover approximately the last 7 days (3-14 days acceptable). Showing 90 days of data is a fail. Must be borrow data.",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
  },
  {
    protocol: "Ethena",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Ethena TVL trend recently",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover approximately 30-90 days. Showing 365+ days is acceptable but suboptimal. Must be TVL.",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
  },
  {
    protocol: "Aave",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Aave TVL over the last quarter",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover approximately 90 days (60-120 days acceptable). Must be TVL.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Compound",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Compound fees yesterday",
    intentCategory: "timerange",
    acceptableBehaviors: "Should return a very recent data point or the last 1-3 days. Showing weekly/monthly aggregates is acceptable. Must be fees.",
    protocolSlug: "compound",
    protocolCategory: "Lending",
  },
  {
    protocol: "Curve",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Curve volume in Q1 2025",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover Jan-Mar 2025 specifically. Showing all of 2025 or 2024 data is a fail. Must be volume.",
    protocolSlug: "curve-dex",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_timerange",
    naturalLanguageQuery: "Uniswap TVL over the past 2 years",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should cover approximately 730 days (500-900 days acceptable). Showing only 90 days is a fail. Must be TVL.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "MakerDAO",
    metricType: "intent_timerange",
    naturalLanguageQuery: "MakerDAO revenue since they rebranded to Sky",
    intentCategory: "timerange",
    acceptableBehaviors: "Data should start from approximately mid-2024 (Sky rebrand). Must be revenue. Showing data before rebrand is acceptable as context.",
    protocolSlug: "makerdao",
    protocolCategory: "Lending",
  },

  // ═══════════════════════════════════════════════════════════
  // MULTI-ENTITY COMPARISON (10 cases)
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Compare Aave and Compound TVL",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show data for BOTH Aave AND Compound. Either on one chart (dual series) or two charts side by side. Showing only one protocol is a fail.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Which DEX has more volume, Uniswap or Curve?",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show volume data for BOTH Uniswap AND Curve. The comparison should make it possible to answer the question. Single protocol is a fail.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Aave",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Aave vs Morpho lending activity",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show lending data (borrows, supply, or TVL) for BOTH Aave AND Morpho. Single protocol is a fail.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Aave",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Top 3 lending protocols by TVL",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST identify and show data for at least 3 lending protocols. Showing only 1-2 is a fail. The protocols should be among the largest (Aave, Compound, MakerDAO, Morpho, Spark).",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Lido",
    metricType: "intent_comparison",
    naturalLanguageQuery: "How does Lido compare to Rocket Pool?",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show data for BOTH Lido AND Rocket Pool. TVL, staking volume, or market share comparison. Single protocol is a fail.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Uniswap vs PancakeSwap fees",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show fee data for BOTH Uniswap AND PancakeSwap. Single protocol is a fail.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Ethena",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Compare Ethena and MakerDAO revenue",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show revenue for BOTH Ethena AND MakerDAO. Single protocol is a fail.",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
  },
  {
    protocol: "Aave",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Which lending protocol has the most borrowers?",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST compare user/borrower counts across multiple lending protocols. Showing volume instead of user counts is acceptable. Single protocol is a fail.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Lido",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Liquid staking TVL comparison",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST compare TVL across multiple liquid staking protocols (Lido, Rocket Pool, Coinbase, etc). Single protocol is a fail.",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
  },
  {
    protocol: "Curve",
    metricType: "intent_comparison",
    naturalLanguageQuery: "Curve vs Balancer vs Uniswap TVL",
    intentCategory: "comparison",
    acceptableBehaviors: "MUST show TVL for ALL THREE: Curve, Balancer, AND Uniswap. Missing any one is a partial fail.",
    protocolSlug: "curve-dex",
    protocolCategory: "Dexes",
  },

  // ═══════════════════════════════════════════════════════════
  // MULTI-CHAIN SPECIFICITY (10 cases)
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Aave TVL on Arbitrum",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST filter to Arbitrum only. Showing aggregate TVL across all chains is a fail. Must specify chain='arbitrum' or filter Arbitrum data.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Uniswap volume on Base vs Ethereum",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST show volume for BOTH Base AND Ethereum separately. Aggregate across chains is a fail. Two series or two charts showing each chain.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Morpho",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Which chain has the most Morpho borrows?",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST break down Morpho borrows by chain (Ethereum, Base, etc). Aggregate without chain breakdown is a fail.",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
  },
  {
    protocol: "Compound",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Compound V3 on Polygon",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST filter to Polygon only. Showing all-chain data is a fail. Any metric (TVL, borrows, supply) filtered to Polygon is a pass.",
    protocolSlug: "compound-v3",
    protocolCategory: "Lending",
  },
  {
    protocol: "Aave",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Total lending TVL on Base",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST show lending TVL on Base chain specifically. Could be Aave+Compound+Morpho on Base, or total DeFi lending on Base. Must be chain-filtered.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "Uniswap",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Uniswap fees on Optimism",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST filter to Optimism only. Showing aggregate fees across all chains is a fail. Must be fee data, not volume.",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Aave",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Aave borrows on Ethereum vs Base",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST show borrow data for BOTH Ethereum AND Base separately. Aggregate is a fail. Two series or charts comparing chains.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
  {
    protocol: "PancakeSwap",
    metricType: "intent_multichain",
    naturalLanguageQuery: "PancakeSwap volume on BSC",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST filter to BSC (BNB Chain) only. Showing all-chain data is a fail. Must be volume data.",
    protocolSlug: "pancakeswap",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Curve",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Curve liquidity breakdown by chain",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST show Curve TVL/liquidity broken down by chain (Ethereum, Arbitrum, Polygon, etc). Aggregate is a fail. Multiple series by chain.",
    protocolSlug: "curve-dex",
    protocolCategory: "Dexes",
  },
  {
    protocol: "Aave",
    metricType: "intent_multichain",
    naturalLanguageQuery: "Where is Aave most popular?",
    intentCategory: "multichain",
    acceptableBehaviors: "MUST break down Aave activity by chain. Could show TVL, borrows, or users per chain. Aggregate without chain breakdown is a fail.",
    protocolSlug: "aave",
    protocolCategory: "Lending",
  },
];

export async function seedIntentBenchmark(dryRun: boolean = false): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;

  // Check for existing intent cases to avoid duplicates
  const existing = await storage.getActiveBenchmarkCases();
  const existingQueries = new Set(existing.map(c => c.naturalLanguageQuery));

  const casesToInsert: InsertBenchmarkCase[] = [];

  for (const def of INTENT_CASES) {
    if (existingQueries.has(def.naturalLanguageQuery)) {
      skipped++;
      continue;
    }

    casesToInsert.push({
      protocol: def.protocol,
      metricType: def.metricType,
      naturalLanguageQuery: def.naturalLanguageQuery,
      // Store intent metadata in referenceSource — format: "intent:{category}:{acceptableBehaviors}"
      referenceSource: `intent:${def.intentCategory}`,
      referenceFetcher: "llmJudge",
      tolerance: 0.50,  // not used for LLM judge, but required by schema
      difficulty: "hard",
      protocolSlug: def.protocolSlug,
      protocolCategory: def.protocolCategory,
      isActive: true,
    });
  }

  if (casesToInsert.length > 0 && !dryRun) {
    await storage.insertBenchmarkCases(casesToInsert);
    inserted = casesToInsert.length;
  } else if (dryRun) {
    inserted = casesToInsert.length;
  }

  // Store acceptable behaviors in a separate lookup (in-memory, used by runner)
  console.log(`Intent cases: ${inserted} inserted, ${skipped} skipped`);
  return { inserted, skipped };
}

/**
 * Get the acceptable behaviors for an intent case by its query.
 * Used by the LLM judge in the runner.
 */
export function getAcceptableBehaviors(query: string): string | null {
  const match = INTENT_CASES.find(c => c.naturalLanguageQuery === query);
  return match?.acceptableBehaviors || null;
}

/**
 * Get the intent category for a case.
 */
export function getIntentCategory(query: string): string | null {
  const match = INTENT_CASES.find(c => c.naturalLanguageQuery === query);
  return match?.intentCategory || null;
}
