/**
 * Benchmark Seeder
 * 
 * Auto-generates ground-truth test cases from DeFiLlama's protocol list.
 * Each test case has a natural language query and a reference source
 * that the eval system can compare against.
 * 
 * Run manually: npx tsx server/benchmark/seed.ts
 * Or call seedBenchmark() programmatically.
 */

import { storage } from "../storage";
import * as defillama from "../defillama-client";
import type { InsertBenchmarkCase } from "@shared/schema";

const DEFILLAMA_BASE = "https://api.llama.fi";

interface DeFiLlamaProtocolFull {
  name: string;
  slug: string;
  category: string;
  tvl: number;
  change_1d?: number;
  change_7d?: number;
  chains?: string[];
  symbol?: string;
}

/** Fetch top protocols by TVL from DeFiLlama */
async function fetchTopProtocols(limit: number = 100): Promise<DeFiLlamaProtocolFull[]> {
  const res = await fetch(`${DEFILLAMA_BASE}/protocols`);
  if (!res.ok) throw new Error(`DeFiLlama protocols fetch failed: ${res.status}`);
  const all: DeFiLlamaProtocolFull[] = await res.json();

  // Filter to protocols with meaningful TVL and sort by TVL
  return all
    .filter(p => p.tvl > 1_000_000 && p.name && p.slug)
    .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
    .slice(0, limit);
}

/** Check if DeFiLlama has fees/revenue data for a protocol */
async function hasFeeData(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${DEFILLAMA_BASE}/summary/fees/${slug}?dataType=dailyRevenue`);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.totalDataChart?.length > 0) || !!data.total24h;
  } catch {
    return false;
  }
}

/** Check if DeFiLlama has DEX volume data */
async function hasDexVolume(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${DEFILLAMA_BASE}/summary/dexs/${slug}?dataType=dailyVolume`);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.totalDataChart?.length > 0) || !!data.total24h;
  } catch {
    return false;
  }
}

/** Check if DeFiLlama has derivatives volume data */
async function hasDerivativesVolume(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${DEFILLAMA_BASE}/summary/derivatives/${slug}?dataType=dailyVolume`);
    if (!res.ok) return false;
    const data = await res.json();
    return (data.totalDataChart?.length > 0) || !!data.total24h;
  } catch {
    return false;
  }
}

/** Generate varied natural language queries for a metric */
function generateQueries(protocolName: string, metricType: string): { query: string; difficulty: string }[] {
  const name = protocolName;
  switch (metricType) {
    case "tvl":
      return [
        { query: `Show me ${name} TVL over 90 days`, difficulty: "easy" },
        { query: `${name} total value locked history`, difficulty: "easy" },
        { query: `How much liquidity does ${name} have?`, difficulty: "standard" },
      ];
    case "revenue":
      return [
        { query: `Show me ${name} weekly revenue over 90 days`, difficulty: "easy" },
        { query: `${name} revenue over time`, difficulty: "easy" },
        { query: `How much does ${name} earn?`, difficulty: "standard" },
        { query: `${name} protocol earnings`, difficulty: "standard" },
      ];
    case "fees":
      return [
        { query: `Show me ${name} daily fees`, difficulty: "easy" },
        { query: `${name} fee generation over time`, difficulty: "standard" },
      ];
    case "dex_volume":
      return [
        { query: `Show me ${name} daily trading volume`, difficulty: "easy" },
        { query: `${name} volume over 30 days`, difficulty: "easy" },
        { query: `How much volume does ${name} do?`, difficulty: "standard" },
      ];
    case "derivatives_volume":
      return [
        { query: `Show me ${name} derivatives volume`, difficulty: "easy" },
        { query: `${name} perp volume over time`, difficulty: "standard" },
      ];
    default:
      return [];
  }
}

export interface SeedResult {
  totalProtocols: number;
  totalCases: number;
  byMetric: Record<string, number>;
  byDifficulty: Record<string, number>;
}

/**
 * Main seeding function.
 * Pulls top protocols from DeFiLlama and generates benchmark cases
 * for every metric that has reference data available.
 */
export async function seedBenchmark(options?: {
  protocolLimit?: number;
  queriesPerMetric?: number;
  dryRun?: boolean;
}): Promise<SeedResult> {
  const { protocolLimit = 100, queriesPerMetric = 2, dryRun = false } = options || {};

  console.log(`[Benchmark Seed] Fetching top ${protocolLimit} protocols from DeFiLlama...`);
  const protocols = await fetchTopProtocols(protocolLimit);
  console.log(`[Benchmark Seed] Got ${protocols.length} protocols`);

  // Check existing cases to avoid duplicates
  const existingCases = await storage.getActiveBenchmarkCases();
  const existingKeys = new Set(existingCases.map(c => `${c.protocol}:${c.metricType}:${c.naturalLanguageQuery}`));

  const allCases: InsertBenchmarkCase[] = [];
  const byMetric: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};

  for (let i = 0; i < protocols.length; i++) {
    const protocol = protocols[i];
    const slug = protocol.slug;
    const name = protocol.name;
    const category = protocol.category || "Unknown";

    if (i % 10 === 0) {
      console.log(`[Benchmark Seed] Processing ${i + 1}/${protocols.length}: ${name} (${category})`);
    }

    // Every protocol has TVL
    const tvlQueries = generateQueries(name, "tvl").slice(0, queriesPerMetric);
    for (const q of tvlQueries) {
      const key = `${name}:tvl:${q.query}`;
      if (!existingKeys.has(key)) {
        allCases.push({
          protocol: name,
          metricType: "tvl",
          referenceSource: "defillama_tvl",
          naturalLanguageQuery: q.query,
          referenceFetcher: "fetchReferenceTimeSeries",
          tolerance: 0.15,
          difficulty: q.difficulty,
          protocolSlug: slug,
          protocolCategory: category,
          isActive: true,
        });
        byMetric["tvl"] = (byMetric["tvl"] || 0) + 1;
        byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
      }
    }

    // Check fees/revenue (rate-limit friendly — sequential with small delay)
    const hasFees = await hasFeeData(slug);
    if (hasFees) {
      const revenueQueries = generateQueries(name, "revenue").slice(0, queriesPerMetric);
      for (const q of revenueQueries) {
        const key = `${name}:revenue:${q.query}`;
        if (!existingKeys.has(key)) {
          allCases.push({
            protocol: name,
            metricType: "revenue",
            referenceSource: "defillama_revenue",
            naturalLanguageQuery: q.query,
            referenceFetcher: "fetchReferenceTimeSeries",
            tolerance: 0.30,
            difficulty: q.difficulty,
            protocolSlug: slug,
            protocolCategory: category,
            isActive: true,
          });
          byMetric["revenue"] = (byMetric["revenue"] || 0) + 1;
          byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
        }
      }

      const feeQueries = generateQueries(name, "fees").slice(0, queriesPerMetric);
      for (const q of feeQueries) {
        const key = `${name}:fees:${q.query}`;
        if (!existingKeys.has(key)) {
          allCases.push({
            protocol: name,
            metricType: "fees",
            referenceSource: "defillama_fees",
            naturalLanguageQuery: q.query,
            referenceFetcher: "fetchReferenceTimeSeries",
            tolerance: 0.30,
            difficulty: q.difficulty,
            protocolSlug: slug,
            protocolCategory: category,
            isActive: true,
          });
          byMetric["fees"] = (byMetric["fees"] || 0) + 1;
          byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
        }
      }
    }

    // Check DEX volume
    if (category === "Dexes" || category === "Derivatives") {
      const hasDex = await hasDexVolume(slug);
      if (hasDex) {
        const volQueries = generateQueries(name, "dex_volume").slice(0, queriesPerMetric);
        for (const q of volQueries) {
          const key = `${name}:dex_volume:${q.query}`;
          if (!existingKeys.has(key)) {
            allCases.push({
              protocol: name,
              metricType: "dex_volume",
              referenceSource: "defillama_dex_volume",
              naturalLanguageQuery: q.query,
              referenceFetcher: "fetchReferenceTimeSeries",
              tolerance: 0.25,
              difficulty: q.difficulty,
              protocolSlug: slug,
              protocolCategory: category,
              isActive: true,
            });
            byMetric["dex_volume"] = (byMetric["dex_volume"] || 0) + 1;
            byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
          }
        }
      }

      // Derivatives volume
      const hasDeriv = await hasDerivativesVolume(slug);
      if (hasDeriv) {
        const derivQueries = generateQueries(name, "derivatives_volume").slice(0, queriesPerMetric);
        for (const q of derivQueries) {
          const key = `${name}:derivatives_volume:${q.query}`;
          if (!existingKeys.has(key)) {
            allCases.push({
              protocol: name,
              metricType: "volume",  // canonical metric type
              referenceSource: "defillama_derivatives_volume",
              naturalLanguageQuery: q.query,
              referenceFetcher: "fetchReferenceTimeSeries",
              tolerance: 0.25,
              difficulty: q.difficulty,
              protocolSlug: slug,
              protocolCategory: category,
              isActive: true,
            });
            byMetric["volume"] = (byMetric["volume"] || 0) + 1;
            byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] || 0) + 1;
          }
        }
      }
    }

    // Tiny delay to not hammer DeFiLlama
    if (i % 5 === 0) await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Benchmark Seed] Generated ${allCases.length} new cases`);

  if (!dryRun && allCases.length > 0) {
    // Insert in batches of 50
    for (let i = 0; i < allCases.length; i += 50) {
      const batch = allCases.slice(i, i + 50);
      await storage.insertBenchmarkCases(batch);
      console.log(`[Benchmark Seed] Inserted batch ${Math.floor(i / 50) + 1}/${Math.ceil(allCases.length / 50)}`);
    }
  }

  const result: SeedResult = {
    totalProtocols: protocols.length,
    totalCases: allCases.length,
    byMetric,
    byDifficulty,
  };

  console.log(`[Benchmark Seed] Done:`, JSON.stringify(result, null, 2));
  return result;
}

// CLI entry point
if (process.argv[1]?.includes("seed")) {
  const dryRun = process.argv.includes("--dry-run");
  seedBenchmark({ dryRun })
    .then(result => {
      console.log(dryRun ? "[DRY RUN] Would have inserted:" : "Seed complete:", result);
      process.exit(0);
    })
    .catch(err => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
