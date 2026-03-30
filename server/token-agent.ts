import { callAnthropicServerHeavy, type AnthropicRequest } from "./mpp-client";
import { getLatestDuneResults, isDuneConfigured, type DuneQueryResult } from "./dune-client";
import { fetchTokenSnapshot, type TokenSnapshot } from "./allium-client";
import { isServerMppReady } from "./mpp-client";
import { storage } from "./storage";
import { MARKUP_MULTIPLIER } from "./enrichment";
import type { Company, DuneQuery, TokenProfile } from "@shared/schema";

const TOKEN_ANALYSIS_SYSTEM = `You are the Liquid Token Research Agent in a VC deal intelligence platform. You analyze on-chain data, market metrics, and web-sourced information to produce investment-grade liquid token analysis applying a comprehensive analytical framework.

YOU HAVE WEB SEARCH ACCESS. Use it aggressively to find:
- Current token price, market cap, FDV from CoinGecko/CoinMarketCap
- Protocol revenue data from Token Terminal, DefiLlama, or Dune
- Token supply schedule, vesting details, unlock calendar
- Staking rates, buyback data, fee distribution mechanisms
- DEX liquidity depth, trading volume data
- On-chain holder distribution data

You also receive real-time data feeds (token snapshot, Dune query results) when available.

YOUR ANALYSIS MUST COVER (use markdown formatting):

## 1. Token Classification
- Classify into Tier 0 (Monetary Premium — blue-chip assets trading on lindyness, network effects, or monetary premium like BTC/ETH), Tier 1 (Great Token — high recurring revenue, strong value accrual, fair distribution), Tier 2 (Average Token — some revenue but inconsistent, growth potential, needs monitoring), or Tier 3 (Bad Token — no revenue, extractive tokenomics, unfair distribution)
- Apply decision tree: Does protocol generate meaningful recurring revenue? No → check monetary premium/lindyness → Yes = Tier 0, No = Tier 3. If revenue exists: high AND growing with strong value accrual? → Yes = Tier 1, No = Tier 2. Is distribution fair (25-45% initial float)? No → downgrade one tier or flag as Tier 3.

## 2. Supply & Adjusted Market Cap
- Calculate: Float Market Cap, Adjusted Market Cap, FDV
- Identify Outstanding Supply vs excluded (treasury, unallocated, locked)
- Note upcoming unlock events and their potential impact

## 3. Valuation
- Cashflow Yield Model: Base Yield = Total Protocol Revenue / Circulating Token Supply
- P/E ratios on BOTH FDV and Adjusted MCAP basis
- Revenue multiples comparison to peers
- For Tier 1 (Great) tokens: Attempt bull/base/bear scenario analysis

## 4. Liquidity Assessment
- Average daily volume (filter wash trading if possible)
- Estimate days to exit a $1M position at 10% participation rate
- Apply liquidity discount tier (0-40%+ based on days to exit)
- Primary trading venues

## 5. Value Accrual Assessment
- Classify mechanism: direct distribution / buyback & burn / buyback & hold / indirect / none
- If buyback: note frequency, % of revenue allocated, verification status
- If staking: note yield, lock requirements, distribution token

## 6. Risk Flags
- Token unlock overhang (upcoming large unlocks)
- Concentration risk (whale dominance)
- Regulatory exposure
- Smart contract risk level
- Single revenue stream dependency

## 7. Investment Summary
- 3-5 sentence thesis incorporating all analysis
- Key monitoring metrics going forward

## RULES
- Be SPECIFIC with numbers from both web search and provided data
- Flag concerning patterns with severity levels (🔴 critical, 🟡 caution, 🟢 healthy)
- Compare metrics to peers when possible
- Note data limitations or gaps explicitly
- Write for a VC audience — focus on investment decisions
- Use markdown formatting with headers, bullet points, and bold for emphasis
- Use proper markdown tables (with | header | separators |) for all tabular data — never use ASCII art or dashed-line tables
- NEVER write in first person ("I analyzed", "I use", "I found"). Write objectively in third person as a professional research report
- Do NOT include your reasoning process, chain-of-thought, or methodology explanations. Present conclusions directly`;


const QUERY_SELECTION_SYSTEM = `You are a data query selector for a VC token analysis platform. Given a token profile and a list of available Dune Analytics queries, select the queries most relevant for analyzing this specific token.

Return ONLY a JSON array of query IDs (numbers) that are most relevant. Select queries that would provide useful on-chain data for this token's chain and use case. If no queries are relevant, return an empty array [].

Example response: [1234, 5678, 9012]`;

async function selectRelevantQueries(
  tokenProfile: TokenProfile,
  company: Company,
  queries: DuneQuery[],
): Promise<DuneQuery[]> {
  if (queries.length <= 3) return queries;

  try {
    const queryList = queries.map(q => ({
      id: q.queryId,
      label: q.label,
      visualizationType: q.visualizationType,
    }));

    const result = await callAnthropicServerHeavy({
      model: "claude-opus-4-6",
      max_tokens: 512,
      system: QUERY_SELECTION_SYSTEM,
      messages: [{
        role: "user",
        content: `Token: ${tokenProfile.tokenTicker || "Unknown"} on ${tokenProfile.chain}
Contract: ${tokenProfile.contractAddress}
Company: ${company.name} (${company.sector || "Unknown"} / ${company.subSector || "Unknown"})

Available queries:
${JSON.stringify(queryList, null, 2)}

Select the most relevant queries for analyzing this token.`,
      }],
    });

    const match = result.text.match(/\[[\s\S]*?\]/);
    if (match) {
      const selectedIds: number[] = JSON.parse(match[0]);
      const selected = queries.filter(q => selectedIds.includes(q.queryId));
      if (selected.length > 0) {
        console.log(`[TokenAgent] Selected ${selected.length}/${queries.length} queries: ${selected.map(q => q.label).join(", ")}`);
        return selected;
      }
    }
  } catch (err: any) {
    console.error("[TokenAgent] Query selection failed, using all queries:", err.message);
  }

  return queries;
}

export async function runTokenAnalysis(
  analysisId: string,
  userId: string,
  company: Company,
  tokenProfile: TokenProfile,
  duneQueryConfigs: DuneQuery[],
): Promise<void> {
  try {
    console.log(`[TokenAgent] Starting analysis for ${company.name} (${analysisId})`);

    let tokenSnapshot: TokenSnapshot | null = null;
    let snapshotCost = 0;

    if (isServerMppReady()) {
      try {
        console.log(`[TokenAgent] Fetching token snapshot for ${tokenProfile.tokenTicker || tokenProfile.contractAddress}`);
        const snapResult = await fetchTokenSnapshot(
          tokenProfile.contractAddress,
          tokenProfile.chain,
          tokenProfile.tokenTicker || "UNKNOWN"
        );
        tokenSnapshot = snapResult.snapshot;
        snapshotCost = snapResult.mppCost;
        console.log(`[TokenAgent] Snapshot fetched. Price: $${tokenSnapshot.price}, MCap: $${tokenSnapshot.marketCap}`);
      } catch (err: any) {
        console.error(`[TokenAgent] Token snapshot failed:`, err.message);
      }
    }

    const selectedQueries = duneQueryConfigs.length > 0
      ? await selectRelevantQueries(tokenProfile, company, duneQueryConfigs)
      : [];

    const duneResults: Record<string, DuneQueryResult> = {};

    if (isDuneConfigured() && selectedQueries.length > 0) {
      for (const q of selectedQueries) {
        try {
          console.log(`[TokenAgent] Fetching Dune query ${q.queryId} (${q.label})`);
          const result = await getLatestDuneResults(q.queryId);
          duneResults[q.label] = result;
        } catch (err: any) {
          console.error(`[TokenAgent] Dune query ${q.queryId} failed:`, err.message);
          duneResults[q.label] = {
            columns: [],
            rows: [],
            metadata: { queryId: q.queryId, executionId: "", state: "failed", rowCount: 0 },
          };
        }
      }
    }

    let dataContext = `## Company Context
Name: ${company.name}
Sector: ${company.sector || "Unknown"}
Sub-sector: ${company.subSector || "Unknown"}
Description: ${company.description || "N/A"}
Stage: ${company.stage || "Unknown"}

## Token Profile
Contract: ${tokenProfile.contractAddress}
Chain: ${tokenProfile.chain}
Ticker: ${tokenProfile.tokenTicker || "Unknown"}
`;

    if (tokenSnapshot) {
      dataContext += `\n## Real-Time Token Snapshot
Price: ${tokenSnapshot.price !== null ? `$${tokenSnapshot.price}` : "N/A"}
Market Cap: ${tokenSnapshot.marketCap !== null ? `$${tokenSnapshot.marketCap.toLocaleString()}` : "N/A"}
24h Volume: ${tokenSnapshot.volume24h !== null ? `$${tokenSnapshot.volume24h.toLocaleString()}` : "N/A"}
Holder Count: ${tokenSnapshot.holderCount !== null ? tokenSnapshot.holderCount.toLocaleString() : "N/A"}
24h Price Change: ${tokenSnapshot.priceChange24h !== null ? `${tokenSnapshot.priceChange24h > 0 ? "+" : ""}${tokenSnapshot.priceChange24h}%` : "N/A"}
Data Source: ${tokenSnapshot.source}
Fetched At: ${tokenSnapshot.fetchedAt}
`;
    } else {
      dataContext += "\n## Token Snapshot\nReal-time token data unavailable. Analysis based on on-chain data only.\n";
    }

    if (Object.keys(duneResults).length > 0) {
      dataContext += "\n## Dune Analytics Data\n";
      for (const [label, result] of Object.entries(duneResults)) {
        dataContext += `\n### ${label}\n`;
        if (result.metadata.state === "failed") {
          dataContext += "Query failed — no data available.\n";
          continue;
        }
        dataContext += `Columns: ${result.columns.join(", ")}\n`;
        dataContext += `Row count: ${result.metadata.rowCount}\n`;
        const sampleRows = result.rows.slice(0, 50);
        if (sampleRows.length > 0) {
          dataContext += `Data (first ${sampleRows.length} rows):\n`;
          dataContext += "```json\n" + JSON.stringify(sampleRows, null, 2) + "\n```\n";
        }
      }
    } else {
      dataContext += "\n## Note\nNo Dune queries attached to this company. Analysis is based on company context and token data only. Recommend attaching relevant Dune queries for deeper on-chain analysis.\n";
    }

    // Dune MCP table discovery — find decoded tables for this token's contract
    try {
      const { discoverTablesForToken, discoverTablesForProtocol } = await import("./dune-mcp-client");
      if (tokenProfile.contractAddress) {
        const tokenTables = await discoverTablesForToken(
          tokenProfile.contractAddress,
          tokenProfile.chain || "ethereum",
        );
        dataContext += `\n${tokenTables}\n`;
      }
      const protocolTables = await discoverTablesForProtocol(company.name);
      dataContext += `\n${protocolTables}\n`;
    } catch (err: any) {
      console.warn(`[TokenAgent] Dune MCP table discovery failed: ${err.message}`);
    }

    console.log(`[TokenAgent] Phase 1/3: Market data research for ${company.name}`);
    const phase1Request: AnthropicRequest = {
      model: "claude-opus-4-6",
      max_tokens: 5000,
      system: TOKEN_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `PHASE 1 — MARKET DATA RESEARCH for ${tokenProfile.tokenTicker || company.name}.\n\n${dataContext}\n\nFocus your web searches on gathering:\n- Current token price, market cap, FDV from CoinGecko/CoinMarketCap\n- Token supply schedule, vesting details, unlock calendar\n- DEX/CEX liquidity depth, trading volume data\n- On-chain holder distribution\n- Staking rates and lock-up data\n\nCompile ALL findings as detailed research notes. Do NOT write the final analysis report yet — just gather and organize the raw data.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    };
    const phase1Result = await callAnthropicServerHeavy(phase1Request);
    const phase1Notes = phase1Result.text;
    let totalAiCost = phase1Result.mppCost;
    let totalInput = phase1Result.usage.input_tokens;
    let totalOutput = phase1Result.usage.output_tokens;
    console.log(`[TokenAgent] Phase 1 complete. Cost: $${phase1Result.mppCost.toFixed(6)}`);

    console.log(`[TokenAgent] Phase 2/3: Valuation & risk research for ${company.name}`);
    const phase2Request: AnthropicRequest = {
      model: "claude-opus-4-6",
      max_tokens: 5000,
      system: TOKEN_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `PHASE 2 — VALUATION & RISK RESEARCH for ${tokenProfile.tokenTicker || company.name}.\n\nToken: ${tokenProfile.tokenTicker || "Unknown"} on ${tokenProfile.chain}\nContract: ${tokenProfile.contractAddress}\nCompany: ${company.name} (${company.sector || "Unknown"})\n\nFocus your web searches on:\n- Protocol revenue data from Token Terminal, DefiLlama\n- Revenue multiples, P/E ratios vs comparable tokens\n- Value accrual mechanisms (buyback, burn, staking rewards, fee distribution)\n- Competitive landscape — similar protocols and their valuations\n- Regulatory risks and exposure\n- Recent governance proposals or tokenomics changes\n- Any red flags (exploit history, insider selling, concentration)\n\nCompile ALL findings as detailed research notes. Do NOT write the final analysis report yet.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
    };
    const phase2Result = await callAnthropicServerHeavy(phase2Request);
    const phase2Notes = phase2Result.text;
    totalAiCost += phase2Result.mppCost;
    totalInput += phase2Result.usage.input_tokens;
    totalOutput += phase2Result.usage.output_tokens;
    console.log(`[TokenAgent] Phase 2 complete. Cost: $${phase2Result.mppCost.toFixed(6)}`);

    console.log(`[TokenAgent] Phase 3/3: Synthesizing final analysis for ${company.name}`);
    const phase3Request: AnthropicRequest = {
      model: "claude-opus-4-6",
      max_tokens: 8000,
      system: TOKEN_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `PHASE 3 — FINAL SYNTHESIS for ${tokenProfile.tokenTicker || company.name}.\n\nYou have completed two research phases. Now synthesize ALL research into the final Markdown analysis report following the exact 7-section structure specified in your system instructions (Token Classification, Supply & Adjusted Market Cap, Valuation, Liquidity Assessment, Value Accrual Assessment, Risk Flags, Investment Summary).\n\nORIGINAL DATA CONTEXT:\n${dataContext}\n\nPHASE 1 RESEARCH NOTES (Market Data):\n${phase1Notes}\n\nPHASE 2 RESEARCH NOTES (Valuation & Risk):\n${phase2Notes}\n\nProduce the FINAL complete Markdown analysis report now. Use ALL the research gathered above. Do NOT search again — just write the comprehensive analysis.` }],
    };
    const phase3Result = await callAnthropicServerHeavy(phase3Request);
    totalAiCost += phase3Result.mppCost;
    totalInput += phase3Result.usage.input_tokens;
    totalOutput += phase3Result.usage.output_tokens;
    console.log(`[TokenAgent] Phase 3 complete. Cost: $${phase3Result.mppCost.toFixed(6)}`);

    await storage.updateTokenAnalysis(analysisId, {
      content: phase3Result.text,
      status: "complete",
      duneData: JSON.stringify({ snapshot: tokenSnapshot, duneResults }),
    });

    try {
      await storage.updateCompany(company.id, {
        liquidTokenAnalysis: phase3Result.text,
      } as any, company.userId ?? undefined);
    } catch (err) {
      console.warn("[TokenAgent] Failed to save liquidTokenAnalysis to company:", err);
    }

    const totalMppCost = totalAiCost + snapshotCost;
    const charge = totalMppCost * MARKUP_MULTIPLIER;
    try {
      await storage.logTransaction({
        userId,
        type: "token_analysis",
        description: `Token analysis: ${company.name} (${tokenProfile.tokenTicker || tokenProfile.contractAddress.slice(0, 10)})`,
        amount: charge.toFixed(4),
        apiCost: totalMppCost.toFixed(4),
        companyName: company.name,
        inputTokens: totalInput,
        outputTokens: totalOutput,
      });
    } catch (err) {
      console.error("[TokenAgent] Failed to log transaction:", err);
    }

    console.log(`[TokenAgent] Analysis complete for ${company.name} (${analysisId}). Total cost: $${totalMppCost.toFixed(6)}`);
  } catch (error: any) {
    console.error(`[TokenAgent] Analysis failed for ${company.name}:`, error.message);
    await storage.updateTokenAnalysis(analysisId, {
      content: `# Token Analysis Failed\n\nError: ${error.message}\n\nPlease try again.`,
      status: "failed",
    }).catch(() => {});
    if (typeof totalAiCost === "number" && totalAiCost > 0) {
      try {
        const partialMppCost = totalAiCost + snapshotCost;
        await storage.logTransaction({
          userId,
          type: "token_analysis",
          description: `Token analysis FAILED (partial): ${company.name}`,
          amount: (partialMppCost * MARKUP_MULTIPLIER).toFixed(4),
          apiCost: partialMppCost.toFixed(4),
          companyName: company.name,
          inputTokens: totalInput || 0,
          outputTokens: totalOutput || 0,
        });
      } catch {}
    }
  }
}
