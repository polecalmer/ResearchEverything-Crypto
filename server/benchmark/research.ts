/**
 * Protocol Revenue Research Pipeline
 *
 * Researches how a protocol generates revenue, validates against DeFiLlama,
 * and stores the model for use in financial query generation.
 *
 * Flow:
 * 1. Check if model exists in protocol_revenue_models table
 * 2. If not, call Claude with web search to research the protocol
 * 3. Validate the research output (test SQL against Dune, cross-validate vs DeFiLlama)
 * 4. Store the validated model
 * 5. Inject the model as context for SQL generation
 */

import { storage } from "../storage";
import { callAnthropicServer } from "../mpp-client";
import { executeDuneSQL, isDuneConfigured } from "../dune-client";
import * as defillama from "../defillama-client";
import type { ProtocolRevenueModel } from "@shared/schema";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RevenueSource {
  name: string;
  description: string;
  onChainSignal: string;
}

interface KeyContract {
  label: string;
  address: string;
  chain: string;
}

interface ResearchResult {
  protocol: string;
  protocolType: string;
  revenueSources: RevenueSource[];
  keyContracts: KeyContract[];
  feeStructure: string;
  suggestedDuneTables: string[];
  existingDuneQueryIds: number[];
  revenueSqlDraft: string;
  coinGeckoId?: string;
}

// ═══════════════════════════════════════════════════════════════
// STEP 1: CHECK EXISTING MODEL
// ═══════════════════════════════════════════════════════════════

export async function getOrResearchProtocol(
  protocol: string,
  slug?: string,
): Promise<ProtocolRevenueModel | null> {
  // Check if we already have a validated model
  const existing = await storage.getProtocolRevenueModel(protocol);
  if (existing) {
    console.log(`[Research] Found existing model for ${protocol} (status: ${existing.validationStatus})`);
    return existing;
  }

  // Research the protocol
  console.log(`[Research] No model for ${protocol} — researching...`);
  const research = await researchProtocol(protocol, slug);
  if (!research) {
    console.log(`[Research] Research failed for ${protocol}`);
    return null;
  }

  // Validate and store
  const model = await validateAndStore(protocol, research, slug);
  return model;
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: RESEARCH THE PROTOCOL
// ═══════════════════════════════════════════════════════════════

async function researchProtocol(protocol: string, slug?: string): Promise<ResearchResult | null> {
  const prompt = `Research how ${protocol} generates revenue. I need a structured analysis for building Dune SQL queries.

Search their documentation, DeFiLlama methodology pages, Dune public dashboards, and governance forums.

Return the following as valid JSON (no markdown, no explanation):
{
  "protocol": "${protocol}",
  "protocolType": "lending" | "dex" | "staking" | "stablecoin_yield" | "derivatives" | "bridge" | "cdp" | "liquid_staking" | "yield_aggregator",
  "revenueSources": [
    { "name": "source name", "description": "how it works", "onChainSignal": "what on-chain event/transfer represents this" }
  ],
  "keyContracts": [
    { "label": "Treasury/Fee Collector/Staking", "address": "0x...", "chain": "ethereum" }
  ],
  "feeStructure": "Human-readable description of the fee structure and protocol take rate",
  "suggestedDuneTables": ["tokens.transfers", "lending.borrow", "dex.trades"],
  "existingDuneQueryIds": [],
  "revenueSqlDraft": "SELECT date_trunc('week', block_time) AS week, SUM(amount_usd) AS revenue FROM ... WHERE ... GROUP BY 1 ORDER BY 1",
  "coinGeckoId": "coingecko-token-id"
}

Key requirements:
- The revenueSqlDraft MUST be valid DuneSQL (Trino dialect) that returns a weekly time series with columns: week (timestamp), revenue (numeric USD)
- Use Spellbook tables where possible: dex.trades, lending.borrow, lending.supply, tokens.transfers, prices.usd
- For lending protocols: revenue ≈ interest earned = SUM(amount_usd) from lending.borrow (proxy)
- For DEX protocols: revenue ≈ trading fees = SUM(amount_usd) * fee_rate from dex.trades
- For staking/yield protocols: look for fee distribution contract transfers
- Always use amount_usd, never raw amounts
- Filter block_time >= now() - interval '365' day
- Include the CoinGecko token ID for price/mcap lookups

JSON only. No markdown fences.`;

  try {
    const response = await callAnthropicServer({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: "You are a DeFi protocol analyst. Return only valid JSON. No markdown, no explanation.",
      messages: [{ role: "user", content: prompt }],
    });

    // Parse the response — apply same JSON repair as runner
    let text = response.text.trim();
    // Strip markdown fences
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    // Extract JSON if embedded in text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];

    const result = JSON.parse(text) as ResearchResult;
    console.log(`[Research] Researched ${protocol}: type=${result.protocolType}, ${result.revenueSources.length} revenue sources, ${result.keyContracts.length} contracts`);
    return result;
  } catch (err) {
    console.error(`[Research] Failed to research ${protocol}:`, (err as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: VALIDATE AND STORE
// ═══════════════════════════════════════════════════════════════

async function validateAndStore(
  protocol: string,
  research: ResearchResult,
  slug?: string,
): Promise<ProtocolRevenueModel | null> {
  let validationStatus = "unvalidated";
  let validationScore: number | undefined;
  let validationError: string | undefined;

  // Try to validate the SQL against DeFiLlama reference
  if (research.revenueSqlDraft && isDuneConfigured()) {
    try {
      console.log(`[Research] Validating SQL for ${protocol}...`);

      // Execute the draft SQL on Dune
      const duneResult = await executeDuneSQL(
        research.revenueSqlDraft,
        `research_validate_${protocol.toLowerCase().replace(/\s+/g, "_")}`
      );

      if (duneResult.rows && duneResult.rows.length > 0) {
        // Get DeFiLlama revenue for comparison
        const resolvedSlug = slug || protocol.toLowerCase().replace(/\s+/g, "-");
        const defiLlamaRevenue = await defillama.getProtocolRevenue(resolvedSlug).catch(() => null);

        if (defiLlamaRevenue && defiLlamaRevenue.dailyRevenue && defiLlamaRevenue.dailyRevenue.length > 0) {
          // Compare latest values (rough cross-validation)
          const duneLatest = duneResult.rows[duneResult.rows.length - 1];
          const duneValue = Object.values(duneLatest).find(v => typeof v === "number" && v > 0) as number;

          // Sum recent DeFiLlama weekly revenue for comparison
          const recentDL = defiLlamaRevenue.dailyRevenue.slice(-7);
          const dlWeekly = recentDL.reduce((s: number, d: any) => s + (d.value || d.revenue || 0), 0);

          if (duneValue && dlWeekly > 0) {
            const ratio = duneValue / dlWeekly;
            validationScore = ratio > 0.3 && ratio < 3.0 ? Math.max(0, 1 - Math.abs(1 - ratio)) : 0;
            validationStatus = validationScore > 0.3 ? "validated" : "failed";
            console.log(`[Research] Validation: Dune=${duneValue.toFixed(0)}, DeFiLlama weekly=${dlWeekly.toFixed(0)}, ratio=${ratio.toFixed(2)}, score=${validationScore.toFixed(2)}, status=${validationStatus}`);
          } else {
            validationStatus = "unvalidated";
            validationError = "Could not extract comparable values";
          }
        } else {
          // No DeFiLlama data — can't cross-validate, but SQL worked
          validationStatus = "unvalidated";
          validationError = "DeFiLlama revenue data unavailable for cross-validation";
          console.log(`[Research] SQL executed (${duneResult.rows.length} rows) but no DeFiLlama data to validate against`);
        }
      } else {
        validationStatus = "failed";
        validationError = "SQL returned no rows";
      }
    } catch (err) {
      validationStatus = "failed";
      validationError = (err as Error).message.substring(0, 200);
      console.log(`[Research] SQL validation failed for ${protocol}: ${validationError}`);
    }
  }

  // Store regardless of validation status — we log everything
  try {
    const model = await storage.insertProtocolRevenueModel({
      protocol: research.protocol,
      protocolSlug: slug || protocol.toLowerCase().replace(/\s+/g, "-"),
      protocolType: research.protocolType,
      revenueSources: research.revenueSources,
      keyContracts: research.keyContracts,
      feeStructure: research.feeStructure || null,
      suggestedDuneTables: research.suggestedDuneTables,
      existingDuneQueryIds: research.existingDuneQueryIds,
      revenueSqlDraft: research.revenueSqlDraft || null,
      validationStatus,
      validationScore: validationScore ?? null,
      validationError: validationError ?? null,
      coinGeckoId: research.coinGeckoId || null,
      isActive: true,
    });

    console.log(`[Research] Stored model for ${protocol} (id: ${model.id}, status: ${validationStatus})`);
    return model;
  } catch (err) {
    console.error(`[Research] Failed to store model for ${protocol}:`, (err as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: BUILD CONTEXT INJECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Build context string to inject into the agent's prompt when generating
 * financial queries for a protocol with a researched revenue model.
 */
export function buildRevenueModelContext(model: ProtocolRevenueModel): string {
  const sources = (model.revenueSources as RevenueSource[]) || [];
  const contracts = (model.keyContracts as KeyContract[]) || [];
  const duneTables = (model.suggestedDuneTables as string[]) || [];

  let ctx = `
═══════════════════════════════════════════════════════════════
PROTOCOL REVENUE MODEL — ${model.protocol} (${model.protocolType})
═══════════════════════════════════════════════════════════════
`;

  if (model.feeStructure) {
    ctx += `Fee Structure: ${model.feeStructure}\n`;
  }

  if (sources.length > 0) {
    ctx += `\nRevenue Sources:\n`;
    for (const s of sources) {
      ctx += `  • ${s.name}: ${s.description}\n    On-chain signal: ${s.onChainSignal}\n`;
    }
  }

  if (contracts.length > 0) {
    ctx += `\nKey Contracts:\n`;
    for (const c of contracts) {
      ctx += `  • ${c.label}: ${c.address} (${c.chain})\n`;
    }
  }

  if (duneTables.length > 0) {
    ctx += `\nRelevant Dune Tables: ${duneTables.join(", ")}\n`;
  }

  if (model.revenueSqlDraft) {
    const status = model.validationStatus === "validated"
      ? "✓ VALIDATED against DeFiLlama"
      : model.validationStatus === "failed"
        ? "✗ FAILED validation — use with caution"
        : "⚠ UNVALIDATED — not yet cross-checked";

    ctx += `\nReference Revenue SQL (${status}):\n${model.revenueSqlDraft}\n`;
  }

  if (model.coinGeckoId) {
    ctx += `\nCoinGecko ID: ${model.coinGeckoId} (use for price/mcap via CoinGecko data source)\n`;
  }

  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: SELF-IMPROVEMENT — re-research on failure
// ═══════════════════════════════════════════════════════════════

/**
 * Called when the benchmark detects a revenue model produced wrong numbers.
 * Re-researches with error context to produce a corrected model.
 */
export async function reResearchProtocol(
  protocol: string,
  failedSql: string,
  agentValue: number,
  referenceValue: number,
  slug?: string,
): Promise<ProtocolRevenueModel | null> {
  console.log(`[Research] Re-researching ${protocol} after failure (agent=${agentValue.toFixed(0)}, ref=${referenceValue.toFixed(0)})`);

  const prompt = `The previous revenue model for ${protocol} computed $${agentValue.toFixed(0)} but DeFiLlama shows $${referenceValue.toFixed(0)}.

The SQL was:
${failedSql}

Research what went wrong and produce a corrected model. Common issues:
- Wrong contract address for fee collection
- Using borrow volume as revenue (revenue ≈ interest, not principal)
- Missing multi-chain data (protocol may be on multiple chains)
- Wrong fee rate or take rate

Return corrected JSON (same format as before):
{
  "protocol": "${protocol}",
  "protocolType": "...",
  "revenueSources": [...],
  "keyContracts": [...],
  "feeStructure": "...",
  "suggestedDuneTables": [...],
  "existingDuneQueryIds": [],
  "revenueSqlDraft": "SELECT ...",
  "coinGeckoId": "..."
}

JSON only. No markdown.`;

  try {
    const response = await callAnthropicServer({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: "You are a DeFi protocol analyst debugging incorrect revenue SQL. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.text.trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];

    const result = JSON.parse(text) as ResearchResult;

    // Deactivate old model
    const oldModel = await storage.getProtocolRevenueModel(protocol);
    if (oldModel) {
      await storage.updateProtocolRevenueModel(oldModel.id, {
        isActive: false,
        validationStatus: "superseded",
        validationError: `Replaced: agent=${agentValue.toFixed(0)}, ref=${referenceValue.toFixed(0)}`,
      } as any);
    }

    // Validate and store new model
    return await validateAndStore(protocol, result, slug);
  } catch (err) {
    console.error(`[Research] Re-research failed for ${protocol}:`, (err as Error).message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SEED ETHENA MODEL FROM EXISTING TEMPLATE
// ═══════════════════════════════════════════════════════════════

export async function seedEthenaModel(): Promise<ProtocolRevenueModel | null> {
  const existing = await storage.getProtocolRevenueModel("Ethena");
  if (existing) {
    console.log(`[Research] Ethena model already exists (id: ${existing.id})`);
    return existing;
  }

  const model = await storage.insertProtocolRevenueModel({
    protocol: "Ethena",
    protocolSlug: "ethena",
    protocolType: "stablecoin_yield",
    revenueSources: [
      {
        name: "Staking rewards distribution",
        description: "Ethena collects yield from delta-neutral strategies (funding rates + staking ETH) and distributes to USDe stakers via the staking contract",
        onChainSignal: "Token transfers FROM the Ethena staking contract (0x9D39A5DE30e57443BfF2A8307A4256c8797A3497)"
      },
      {
        name: "Protocol fee take",
        description: "Ethena takes ~50% of generated fees as protocol revenue",
        onChainSignal: "Difference between total yield and staker distributions"
      }
    ],
    keyContracts: [
      { label: "USDe Token", address: "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", chain: "ethereum" },
      { label: "sUSDe Staking", address: "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497", chain: "ethereum" },
      { label: "ENA Token", address: "0x57e114B691Db790C35207b2e685D4A43181e6061", chain: "ethereum" }
    ],
    feeStructure: "Ethena generates yield from delta-neutral strategies. ~50% goes to sUSDe stakers, ~50% is protocol revenue. Total fees = staking distributions + protocol take.",
    suggestedDuneTables: ["tokens.transfers", "prices.usd"],
    existingDuneQueryIds: [5732961, 5737311, 5737510],
    revenueSqlDraft: `WITH fees_data AS (
  SELECT
    date_trunc('month', block_time) AS month,
    SUM(amount_usd) AS total_fees
  FROM tokens.transfers
  WHERE "from" = 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497
    AND blockchain = 'ethereum'
    AND block_time >= now() - interval '365' day
    AND amount_usd > 0
    AND amount_usd < 1e12
  GROUP BY 1
)
SELECT
  month AS date,
  total_fees AS fees,
  total_fees * 0.5 AS revenue
FROM fees_data
WHERE month < date_trunc('month', now())
ORDER BY month`,
    validationStatus: "validated",
    validationScore: 0.85,
    validationError: null,
    coinGeckoId: "ethena",
    isActive: true,
  });

  console.log(`[Research] Seeded Ethena revenue model (id: ${model.id})`);
  return model;
}
