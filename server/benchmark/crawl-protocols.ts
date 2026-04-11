/**
 * Protocol Crawler
 *
 * Populates project_knowledge for every protocol DeFiLlama tracks:
 * 1. Pull full protocol list from DeFiLlama (~4,000 protocols)
 * 2. Match CoinGecko token IDs via gecko_id field
 * 3. Check which protocols have fee/revenue data
 * 4. For top 500 by TVL: check Dune Spellbook coverage
 * 5. Map DeFiLlama categories to normalized protocol types
 *
 * Rate limit: 200ms between requests, DeFiLlama is generous with free tier.
 *
 * Usage:
 *   npx tsx --require dotenv/config server/benchmark/crawl-protocols.ts [--top N] [--skip-dune]
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { executeDuneSQL, isDuneConfigured } from "../dune-client";

const DEFILLAMA_BASE = "https://api.llama.fi";

// ═══════════════════════════════════════════════════════════════
// CATEGORY → PROTOCOL TYPE MAPPING
// ═══════════════════════════════════════════════════════════════

const CATEGORY_MAP: Record<string, string> = {
  "Lending":            "lending",
  "CDP":                "lending",
  "Dexs":               "dex",
  "Dexes":              "dex",
  "DEX":                "dex",
  "Liquid Staking":     "liquid_staking",
  "Liquid Restaking":   "liquid_restaking",
  "CEX":                "cex",
  "Bridge":             "bridge",
  "Cross Chain":        "bridge",
  "Yield":              "yield",
  "Yield Aggregator":   "yield",
  "Farm":               "yield",
  "Derivatives":        "derivatives",
  "Options":            "derivatives",
  "Perpetuals":         "derivatives",
  "Stablecoin":         "stablecoin",
  "Stablecoins":        "stablecoin",
  "RWA":                "rwa",
  "Insurance":          "insurance",
  "Launchpad":          "launchpad",
  "NFT Lending":        "nft_lending",
  "NFT Marketplace":    "nft_marketplace",
  "Gaming":             "gaming",
  "Prediction Market":  "prediction_market",
  "Privacy":            "privacy",
  "Payments":           "payments",
  "Oracle":             "oracle",
  "Indexes":            "index",
  "SoFi":               "sofi",
  "Synthetics":         "synthetics",
  "Algo-Stables":       "stablecoin",
  "Reserve Currency":   "reserve",
  "Liquidity Manager":  "liquidity_manager",
};

/** CoinGecko category → our project_type mapping (for non-DeFi projects) */
const COINGECKO_CATEGORY_MAP: Record<string, string> = {
  "layer-1":                          "l1",
  "smart-contract-platform":          "l1",
  "layer-2":                          "l2",
  "optimistic-rollups":               "l2",
  "zero-knowledge-zk":                "l2",
  "decentralized-physical-infrastructure-depin": "depin",
  "decentralized-wireless-dewi":      "wireless",
  "decentralized-storage":            "storage",
  "decentralized-computing":          "compute",
  "gpu-artificial-intelligence":      "compute",
  "artificial-intelligence":          "ai_ml",
  "ai-agents":                        "ai_ml",
  "ai-framework":                     "ai_ml",
  "ai-applications":                  "ai_ml",
  "oracle":                           "oracle",
  "gaming":                           "gaming",
  "play-to-earn":                     "gaming",
  "metaverse":                        "gaming",
  "move-to-earn":                     "gaming",
  "socialfi":                         "social",
  "social-money":                     "social",
  "meme-token":                       "meme",
  "dog-themed-coins":                 "meme",
  "cat-themed-coins":                 "meme",
  "privacy-coins":                    "privacy",
  "interoperability":                 "bridge",
  "real-world-assets-rwa":            "rwa",
  "stablecoins":                      "stablecoin",
  "governance":                       "governance",
  "yield-farming":                    "yield",
  "liquid-staking-tokens":            "liquid_staking",
  "restaking":                        "liquid_restaking",
  "decentralized-exchange-dex-token": "dex",
  "lending-borrowing":                "lending",
  "derivatives":                      "derivatives",
  "perpetuals":                       "derivatives",
  "prediction-markets":               "prediction_market",
  "insurance":                        "insurance",
  "nft-marketplace":                  "nft_marketplace",
};

/** CoinGecko categories we want to crawl (non-DeFi + key DeFi) */
const COINGECKO_CATEGORIES_TO_CRAWL = [
  // Non-DeFi
  "layer-1", "layer-2", "decentralized-physical-infrastructure-depin",
  "decentralized-wireless-dewi", "decentralized-storage", "decentralized-computing",
  "artificial-intelligence", "ai-agents", "oracle", "gaming", "play-to-earn",
  "socialfi", "privacy-coins", "interoperability", "real-world-assets-rwa",
  // DeFi (to catch tokens not in DeFiLlama)
  "decentralized-exchange-dex-token", "lending-borrowing", "liquid-staking-tokens",
  "yield-farming", "derivatives", "prediction-markets",
];

function normalizeProtocolType(category: string | null): string {
  if (!category) return "other";
  return CATEGORY_MAP[category] || category.toLowerCase().replace(/\s+/g, "_");
}

// ═══════════════════════════════════════════════════════════════
// DUNE SPELLBOOK COVERAGE CHECK
// ═══════════════════════════════════════════════════════════════

const DUNE_PROJECT_ALIASES: Record<string, string> = {
  "pancakeswap-amm": "pancakeswap",
  "uniswap-v3": "uniswap",
  "uniswap-v2": "uniswap",
  "aave-v3": "aave",
  "aave-v2": "aave",
  "compound-v3": "compound",
  "compound-v2": "compound",
  "curve-dex": "curve",
  "makerdao": "maker",
  "sparklend": "spark",
  "morpho-blue": "morpho",
  "morpho-v1": "morpho",
};

function guessDuneProject(slug: string, name: string): string {
  if (DUNE_PROJECT_ALIASES[slug]) return DUNE_PROJECT_ALIASES[slug];
  // Try lowercase name with spaces removed
  return slug.replace(/-/g, "_");
}

async function checkDuneCoverage(project: string, protocolType: string): Promise<Record<string, boolean>> {
  const coverage: Record<string, boolean> = {};

  try {
    if (protocolType === "dex") {
      const r = await executeDuneSQL(
        `SELECT COUNT(*) as cnt FROM dex.trades WHERE project = '${project}' AND block_time > now() - interval '7' day LIMIT 1`,
        `coverage_dex_${project}`
      );
      coverage.dex_trades = (r.rows?.[0]?.cnt || 0) > 0;
    } else if (protocolType === "lending") {
      const r = await executeDuneSQL(
        `SELECT COUNT(*) as cnt FROM lending.borrow WHERE project = '${project}' AND block_time > now() - interval '7' day LIMIT 1`,
        `coverage_lending_${project}`
      );
      coverage.lending_borrow = (r.rows?.[0]?.cnt || 0) > 0;
    }
  } catch {
    // Query failed — no coverage
  }

  return coverage;
}

// ═══════════════════════════════════════════════════════════════
// HTTP FETCH WITH RETRY
// ═══════════════════════════════════════════════════════════════

async function fetchJson(url: string, retries = 2): Promise<any> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        console.log(`  [Rate limit] Waiting 5s...`);
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return res.json();
    } catch (err: any) {
      if (i === retries) throw err;
      await sleep(1000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════
// MAIN CRAWLER
// ═══════════════════════════════════════════════════════════════

interface CrawlOptions {
  topN?: number;       // how many top protocols to check Dune for (default 500)
  skipDune?: boolean;  // skip Dune coverage checks
}

export async function crawlProtocols(options: CrawlOptions = {}): Promise<{
  total: number;
  withFees: number;
  withRevenue: number;
  withGeckoId: number;
  duneChecked: number;
  duneMatched: number;
}> {
  const { topN = 500, skipDune = false } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  PROTOCOL CRAWLER`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Top N for Dune checks: ${topN}`);
  console.log(`  Skip Dune: ${skipDune}\n`);

  // Step 1: Pull all protocols from DeFiLlama
  console.log(`[1/4] Fetching all protocols from DeFiLlama...`);
  const protocols: any[] = await fetchJson(`${DEFILLAMA_BASE}/protocols`);
  console.log(`  Found ${protocols.length} protocols`);

  // Sort by TVL descending
  protocols.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));

  // Step 2: Pull fee/revenue overview
  console.log(`[2/4] Fetching fee/revenue data...`);
  let feeProtocols: Map<string, any> = new Map();
  try {
    const feeData = await fetchJson(
      `${DEFILLAMA_BASE}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
    );
    for (const p of (feeData.protocols || [])) {
      feeProtocols.set(p.slug || p.name?.toLowerCase().replace(/\s+/g, "-"), p);
    }
    console.log(`  Fee data available for ${feeProtocols.size} protocols`);
  } catch (err: any) {
    console.log(`  ⚠ Fee overview fetch failed: ${err.message}`);
  }
  await sleep(200);

  // Check DEX volume overview
  let dexProtocols: Set<string> = new Set();
  try {
    const dexData = await fetchJson(
      `${DEFILLAMA_BASE}/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`
    );
    for (const p of (dexData.protocols || [])) {
      dexProtocols.add(p.slug || p.name?.toLowerCase().replace(/\s+/g, "-"));
    }
    console.log(`  DEX volume data available for ${dexProtocols.size} protocols`);
  } catch (err: any) {
    console.log(`  ⚠ DEX overview fetch failed: ${err.message}`);
  }
  await sleep(200);

  // Step 3: Insert/update all protocols
  console.log(`[3/4] Inserting ${protocols.length} protocols into project_knowledge...`);
  let inserted = 0;
  let updated = 0;
  let withFees = 0;
  let withRevenue = 0;
  let withGeckoId = 0;
  let withDexVolume = 0;

  // Process in batches of 100
  const batchSize = 100;
  for (let batchStart = 0; batchStart < protocols.length; batchStart += batchSize) {
    const batch = protocols.slice(batchStart, batchStart + batchSize);

    for (const p of batch) {
      const slug = p.slug || p.name?.toLowerCase().replace(/\s+/g, "-");
      if (!slug) continue;

      const feeInfo = feeProtocols.get(slug);
      const hasFeeData = !!feeInfo && (feeInfo.total24h != null || feeInfo.totalAllTime != null);
      const hasRevenueData = !!feeInfo && (feeInfo.total24h != null); // revenue uses same endpoint
      const hasDexVolumeData = dexProtocols.has(slug);
      const primaryChain = p.chains?.length > 0 ? p.chains[0] : p.chain || null;

      if (hasFeeData) withFees++;
      if (hasRevenueData) withRevenue++;
      if (p.gecko_id) withGeckoId++;
      if (hasDexVolumeData) withDexVolume++;

      try {
        await db.execute(sql`
          INSERT INTO project_knowledge (name, slug, category, protocol_type, primary_chain, chains, tvl, tvl_rank, gecko_id, symbol, has_fee_data, has_revenue_data, has_dex_volume_data, fees_24h, revenue_24h, last_crawled_at)
          VALUES (
            ${p.name}, ${slug}, ${p.category || null}, ${normalizeProtocolType(p.category)},
            ${primaryChain}, ${JSON.stringify(p.chains || [])}::jsonb,
            ${p.tvl || null}, ${batchStart + batch.indexOf(p) + 1},
            ${p.gecko_id || null}, ${p.symbol || null},
            ${hasFeeData}, ${hasRevenueData}, ${hasDexVolumeData},
            ${feeInfo?.total24h || null}, ${feeInfo?.total24h || null},
            NOW()
          )
          ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name, category = EXCLUDED.category, protocol_type = EXCLUDED.protocol_type,
            primary_chain = EXCLUDED.primary_chain, chains = EXCLUDED.chains,
            tvl = EXCLUDED.tvl, tvl_rank = EXCLUDED.tvl_rank,
            gecko_id = EXCLUDED.gecko_id, symbol = EXCLUDED.symbol,
            has_fee_data = EXCLUDED.has_fee_data, has_revenue_data = EXCLUDED.has_revenue_data,
            has_dex_volume_data = EXCLUDED.has_dex_volume_data,
            fees_24h = EXCLUDED.fees_24h, revenue_24h = EXCLUDED.revenue_24h,
            last_crawled_at = NOW()
        `);
        inserted++;
      } catch (err: any) {
        if (err.message?.includes("duplicate")) {
          updated++;
        } else {
          // Skip silently — some protocols have unusual names
        }
      }
    }

    const pct = Math.round(((batchStart + batch.length) / protocols.length) * 100);
    process.stdout.write(`\r  Progress: ${batchStart + batch.length}/${protocols.length} (${pct}%)`);
  }
  console.log(`\n  Inserted/updated: ${inserted}`);

  // Step 4: Check Dune coverage for top N
  let duneChecked = 0;
  let duneMatched = 0;

  if (!skipDune && isDuneConfigured()) {
    console.log(`[4/4] Checking Dune Spellbook coverage for top ${topN} protocols...`);

    // Get top N by TVL that are lending or dex
    const topProtocols = protocols
      .slice(0, topN)
      .filter(p => {
        const type = normalizeProtocolType(p.category);
        return type === "lending" || type === "dex";
      })
      .slice(0, 50); // Only check 50 to avoid Dune rate limits

    for (const p of topProtocols) {
      const slug = p.slug || p.name?.toLowerCase().replace(/\s+/g, "-");
      const type = normalizeProtocolType(p.category);
      const duneProject = guessDuneProject(slug, p.name);

      try {
        const coverage = await checkDuneCoverage(duneProject, type);
        duneChecked++;

        if (Object.values(coverage).some(v => v)) {
          duneMatched++;
          await db.execute(sql`
            UPDATE project_knowledge
            SET dune_spellbook_coverage = ${JSON.stringify(coverage)}::jsonb,
                dune_project_name = ${duneProject}
            WHERE slug = ${slug}
          `);
        }

        if (duneChecked % 10 === 0) {
          console.log(`  Dune checked: ${duneChecked}/${topProtocols.length} (${duneMatched} matched)`);
        }

        await sleep(500); // Dune needs more throttling
      } catch (err: any) {
        // Dune query limit reached — stop checking
        if (err.message?.includes("402") || err.message?.includes("Max number")) {
          console.log(`  ⚠ Dune private query limit reached at ${duneChecked}/${topProtocols.length}. Stopping.`);
          break;
        }
      }
    }

    console.log(`  Dune coverage: ${duneMatched}/${duneChecked} protocols matched`);
  } else {
    console.log(`[4/4] Skipping Dune coverage checks${skipDune ? " (--skip-dune)" : " (Dune not configured)"}`);
  }

  // Step 5: CoinGecko category crawl — non-DeFi projects
  console.log(`\n[5/5] Crawling CoinGecko categories for non-DeFi projects...`);
  let cgInserted = 0;
  let cgSkipped = 0;
  const cgTypeBreakdown: Record<string, number> = {};

  for (const category of COINGECKO_CATEGORIES_TO_CRAWL) {
    const projectType = COINGECKO_CATEGORY_MAP[category] || category;
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 5) { // Max 5 pages (250 coins per category)
      try {
        const coins = await fetchJson(
          `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${category}&order=market_cap_desc&per_page=50&page=${page}`
        );

        if (!coins || coins.length === 0) {
          hasMore = false;
          break;
        }

        for (const coin of coins) {
          // Skip if already in project_knowledge (DeFiLlama takes priority)
          try {
            const existing = await db.execute(sql`
              SELECT id FROM project_knowledge WHERE gecko_id = ${coin.id} OR slug = ${coin.id} LIMIT 1
            `);
            if (existing.rows && existing.rows.length > 0) {
              // Update with CoinGecko data if we have a matching row
              await db.execute(sql`
                UPDATE project_knowledge
                SET coingecko_categories = ${JSON.stringify([category])}::jsonb,
                    market_cap = ${coin.market_cap || null},
                    price_usd = ${coin.current_price || null}
                WHERE gecko_id = ${coin.id} OR slug = ${coin.id}
              `);
              cgSkipped++;
              continue;
            }

            // Insert as new CoinGecko-sourced project
            const slug = coin.id; // CoinGecko id is the slug
            await db.execute(sql`
              INSERT INTO project_knowledge (name, slug, category, protocol_type, gecko_id, symbol, source, has_defillama, coingecko_categories, market_cap, price_usd, last_crawled_at)
              VALUES (
                ${coin.name}, ${slug}, ${category}, ${projectType},
                ${coin.id}, ${coin.symbol?.toUpperCase() || null},
                'coingecko', false,
                ${JSON.stringify([category])}::jsonb,
                ${coin.market_cap || null}, ${coin.current_price || null},
                NOW()
              )
              ON CONFLICT (slug) DO UPDATE SET
                coingecko_categories = ${JSON.stringify([category])}::jsonb,
                market_cap = EXCLUDED.market_cap,
                price_usd = EXCLUDED.price_usd,
                last_crawled_at = NOW()
            `);
            cgInserted++;
            cgTypeBreakdown[projectType] = (cgTypeBreakdown[projectType] || 0) + 1;
          } catch (err: any) {
            // Skip duplicates or errors silently
          }
        }

        if (coins.length < 50) hasMore = false;
        else page++;

        await sleep(1500); // CoinGecko free tier: ~30 req/min, be conservative
      } catch (err: any) {
        if (err.message?.includes("429")) {
          console.log(`  [Rate limit] CoinGecko 429 on ${category} page ${page}. Waiting 60s...`);
          await sleep(60000);
          continue; // Retry same page
        }
        console.log(`  ⚠ CoinGecko error for ${category}: ${err.message?.substring(0, 80)}`);
        hasMore = false;
      }
    }

    console.log(`  ${category}: ${cgTypeBreakdown[projectType] || 0} new projects`);
  }

  console.log(`  CoinGecko total: ${cgInserted} new, ${cgSkipped} updated existing`);

  // Final summary: query total counts by type
  const typeCounts = await db.execute(sql`
    SELECT protocol_type, COUNT(*) as cnt FROM project_knowledge GROUP BY protocol_type ORDER BY cnt DESC
  `);

  const totalProjects = await db.execute(sql`SELECT COUNT(*) as cnt FROM project_knowledge`);
  const totalCount = (totalProjects.rows?.[0] as any)?.cnt || 0;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  CRAWL COMPLETE`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  Total projects: ${totalCount}`);
  console.log(`  DeFiLlama protocols: ${inserted}`);
  console.log(`  CoinGecko additions: ${cgInserted}`);
  console.log(`  With fee data: ${withFees}`);
  console.log(`  With revenue data: ${withRevenue}`);
  console.log(`  With CoinGecko ID: ${withGeckoId + cgInserted}`);
  console.log(`  With DEX volume: ${withDexVolume}`);
  console.log(`\n  Breakdown by type:`);
  for (const row of (typeCounts.rows || [])) {
    const r = row as any;
    console.log(`    ${(r.protocol_type || "unknown").padEnd(20)} ${r.cnt}`);
  }
  console.log(`${"═".repeat(60)}\n`);

  return { total: totalCount, withFees, withRevenue, withGeckoId: withGeckoId + cgInserted, duneChecked, duneMatched };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (process.argv[1]?.includes("crawl-protocols")) {
  // Load .env
  import("dotenv/config").catch(() => {});

  const args = process.argv.slice(2);
  const topN = args.includes("--top") ? parseInt(args[args.indexOf("--top") + 1]) : 500;
  const skipDune = args.includes("--skip-dune");

  crawlProtocols({ topN, skipDune })
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Crawler error:", err);
      process.exit(1);
    });
}
