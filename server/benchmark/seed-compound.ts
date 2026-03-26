/**
 * Seed Compound Benchmark Cases
 *
 * Manually curated test cases for compound financial queries.
 * Categories:
 *   - component: single metric (price, revenue, fees, market_cap) — scored against DeFiLlama/CoinGecko
 *   - derived: computed metric (P/E ratio) — scored against computed reference
 *   - compound: full financial statement — scored against template output
 */

import { storage } from "../storage";
import type { InsertBenchmarkCase } from "@shared/schema";

interface CompoundCaseDefinition {
  protocol: string;
  metricType: string;
  naturalLanguageQuery: string;
  referenceSource: string;   // 'defillama_revenue', 'coingecko', 'derived:coinId', 'template:businessModel'
  difficulty: string;
  protocolSlug: string;
  protocolCategory: string;
  tolerance: number;
}

const COMPOUND_CASES: CompoundCaseDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // ETHENA — Component tests
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Ethena",
    metricType: "price",
    naturalLanguageQuery: "Show me ENA token price history over 12 months",
    referenceSource: "coingecko:ethena",
    difficulty: "easy",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.25,
  },
  {
    protocol: "Ethena",
    metricType: "revenue",
    naturalLanguageQuery: "Show me Ethena monthly protocol revenue",
    referenceSource: "defillama_revenue",
    difficulty: "standard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.30,
  },
  {
    protocol: "Ethena",
    metricType: "fees",
    naturalLanguageQuery: "Show me Ethena total fees over time",
    referenceSource: "defillama_fees",
    difficulty: "standard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.30,
  },

  // ═══════════════════════════════════════════════════════════
  // ETHENA — Derived metric tests
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Ethena",
    metricType: "pe_ratio",
    naturalLanguageQuery: "What is Ethena's P/E ratio?",
    referenceSource: "derived:ethena",
    difficulty: "hard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.40,
  },
  {
    protocol: "Ethena",
    metricType: "pe_ratio",
    naturalLanguageQuery: "Show me Ethena's P/E ratio over time",
    referenceSource: "derived:ethena",
    difficulty: "hard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // ETHENA — Full financial statement tests
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Ethena",
    metricType: "financial_statement",
    naturalLanguageQuery: "Build me Ethena's monthly income statement with P/E",
    referenceSource: "template:stablecoin_yield",
    difficulty: "hard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.40,
  },
  {
    protocol: "Ethena",
    metricType: "financial_statement",
    naturalLanguageQuery: "Show me Ethena's full financial overview including revenue, fees, and valuation metrics",
    referenceSource: "template:stablecoin_yield",
    difficulty: "hard",
    protocolSlug: "ethena",
    protocolCategory: "Stablecoin Yield",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // AAVE — Component + Derived
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Aave",
    metricType: "revenue",
    naturalLanguageQuery: "Show me Aave's weekly protocol revenue over the last year",
    referenceSource: "defillama_revenue",
    difficulty: "standard",
    protocolSlug: "aave",
    protocolCategory: "Lending",
    tolerance: 0.30,
  },
  {
    protocol: "Aave",
    metricType: "fees",
    naturalLanguageQuery: "Chart Aave's total fees collected over 12 months",
    referenceSource: "defillama_fees",
    difficulty: "standard",
    protocolSlug: "aave",
    protocolCategory: "Lending",
    tolerance: 0.30,
  },
  {
    protocol: "Aave",
    metricType: "pe_ratio",
    naturalLanguageQuery: "Show me Aave's P/E ratio over the last 90 days",
    referenceSource: "derived:aave",
    difficulty: "hard",
    protocolSlug: "aave",
    protocolCategory: "Lending",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // LIDO — Component + Derived
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Lido",
    metricType: "revenue",
    naturalLanguageQuery: "Show Lido's protocol revenue over 12 months",
    referenceSource: "defillama_revenue",
    difficulty: "standard",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
    tolerance: 0.30,
  },
  {
    protocol: "Lido",
    metricType: "pe_ratio",
    naturalLanguageQuery: "Chart Lido's price-to-earnings ratio over 90 days",
    referenceSource: "derived:lido-dao",
    difficulty: "hard",
    protocolSlug: "lido",
    protocolCategory: "Liquid Staking",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // UNISWAP — Component + Derived
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Uniswap",
    metricType: "fees",
    naturalLanguageQuery: "Show me Uniswap's weekly fees over the last year",
    referenceSource: "defillama_fees",
    difficulty: "standard",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
    tolerance: 0.30,
  },
  {
    protocol: "Uniswap",
    metricType: "pe_ratio",
    naturalLanguageQuery: "What is Uniswap's P/E ratio trend over 3 months?",
    referenceSource: "derived:uniswap",
    difficulty: "hard",
    protocolSlug: "uniswap",
    protocolCategory: "Dexes",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // MORPHO — Component + Derived
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "Morpho",
    metricType: "revenue",
    naturalLanguageQuery: "Show me Morpho's protocol revenue over time",
    referenceSource: "defillama_revenue",
    difficulty: "standard",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
    tolerance: 0.30,
  },
  {
    protocol: "Morpho",
    metricType: "pe_ratio",
    naturalLanguageQuery: "Chart Morpho's P/E ratio over 90 days",
    referenceSource: "derived:morpho",
    difficulty: "hard",
    protocolSlug: "morpho-blue",
    protocolCategory: "Lending",
    tolerance: 0.40,
  },

  // ═══════════════════════════════════════════════════════════
  // MAKERDAO — Component + Derived
  // ═══════════════════════════════════════════════════════════
  {
    protocol: "MakerDAO",
    metricType: "revenue",
    naturalLanguageQuery: "Show me MakerDAO's monthly protocol revenue",
    referenceSource: "defillama_revenue",
    difficulty: "standard",
    protocolSlug: "makerdao",
    protocolCategory: "Lending",
    tolerance: 0.30,
  },
  {
    protocol: "MakerDAO",
    metricType: "pe_ratio",
    naturalLanguageQuery: "Show MakerDAO P/E ratio over 90 days",
    referenceSource: "derived:maker",
    difficulty: "hard",
    protocolSlug: "makerdao",
    protocolCategory: "Lending",
    tolerance: 0.40,
  },
];

export async function seedCompoundBenchmark(dryRun = false): Promise<{ inserted: number }> {
  console.log(`[seed-compound] Preparing ${COMPOUND_CASES.length} compound benchmark cases...`);

  const cases: InsertBenchmarkCase[] = COMPOUND_CASES.map(c => ({
    protocol: c.protocol,
    metricType: c.metricType,
    referenceSource: c.referenceSource,
    naturalLanguageQuery: c.naturalLanguageQuery,
    referenceFetcher: c.referenceSource.startsWith("derived:")
      ? "fetchDerivedReference"
      : c.referenceSource.startsWith("template:")
        ? "fetchTemplateReference"
        : "fetchReferenceTimeSeries",
    tolerance: c.tolerance,
    difficulty: c.difficulty,
    protocolSlug: c.protocolSlug,
    protocolCategory: c.protocolCategory,
    isActive: true,
  }));

  if (dryRun) {
    console.log(`[seed-compound] DRY RUN — would insert ${cases.length} cases:`);
    for (const c of cases) {
      console.log(`  • ${c.protocol} / ${c.metricType} — "${c.naturalLanguageQuery}" [${c.difficulty}]`);
    }
    return { inserted: 0 };
  }

  // Check for existing compound cases and skip duplicates
  const existing = await storage.getActiveBenchmarkCases();
  const existingKeys = new Set(existing.map(e => `${e.protocol}|${e.naturalLanguageQuery}`));
  const newCases = cases.filter(c => !existingKeys.has(`${c.protocol}|${c.naturalLanguageQuery}`));

  if (newCases.length === 0) {
    console.log(`[seed-compound] All ${cases.length} cases already exist. Skipping.`);
    return { inserted: 0 };
  }

  const results = await storage.insertBenchmarkCases(newCases);
  console.log(`[seed-compound] Inserted ${results.length} compound benchmark cases.`);

  // Print summary by category
  const byDifficulty = new Map<string, number>();
  for (const c of newCases) {
    byDifficulty.set(c.difficulty!, (byDifficulty.get(c.difficulty!) || 0) + 1);
  }
  for (const [diff, count] of byDifficulty) {
    console.log(`  ${diff}: ${count} cases`);
  }

  return { inserted: results.length };
}

// CLI entry point
if (process.argv[1]?.includes("seed-compound")) {
  import("dotenv/config").catch(() => {});
  const dryRun = process.argv.includes("--dry-run");
  seedCompoundBenchmark(dryRun)
    .then(() => process.exit(0))
    .catch(err => { console.error("Fatal:", err); process.exit(1); });
}
