import { callAnthropicServer, type AnthropicRequest } from "./mpp-client";
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
- Classify into Tier 1 (blue-chip), Tier 2 (established), Tier 3 (emerging), or Tier 4 (speculative)
- Apply decision tree: Does protocol generate real revenue? → Is there genuine PMF? → Does token accrue value? → Is there sustainable distribution?

## 2. Supply & Adjusted Market Cap
- Calculate: Float Market Cap, Adjusted Market Cap, FDV
- Identify Outstanding Supply vs excluded (treasury, unallocated, locked)
- Note upcoming unlock events and their potential impact

## 3. Valuation
- Cashflow Yield Model: Base Yield = Total Protocol Revenue / Circulating Token Supply
- P/E ratios on BOTH FDV and Adjusted MCAP basis
- Revenue multiples comparison to peers
- For Tier 2 tokens: Attempt bull/base/bear scenario analysis

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
- Use markdown formatting with headers, bullet points, and bold for emphasis`;


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

    const result = await callAnthropicServer({
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

    const request: AnthropicRequest = {
      model: "claude-opus-4-6",
      max_tokens: 8000,
      system: TOKEN_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `Analyze this token for investment due diligence:\n\n${dataContext}\n\nUse web search to supplement the data above with current market data, revenue metrics, supply schedules, and competitive context.` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }],
    };

    const result = await callAnthropicServer(request);

    await storage.updateTokenAnalysis(analysisId, {
      content: result.text,
      status: "complete",
      duneData: JSON.stringify({ snapshot: tokenSnapshot, duneResults }),
    });

    try {
      await storage.updateCompany(company.id, {
        liquidTokenAnalysis: result.text,
      } as any, company.userId ?? undefined);
    } catch (err) {
      console.warn("[TokenAgent] Failed to save liquidTokenAnalysis to company:", err);
    }

    const totalMppCost = result.mppCost + snapshotCost;
    const charge = totalMppCost * MARKUP_MULTIPLIER;
    try {
      await storage.logTransaction({
        userId,
        type: "token_analysis",
        description: `Token analysis: ${company.name} (${tokenProfile.tokenTicker || tokenProfile.contractAddress.slice(0, 10)})`,
        amount: charge.toFixed(4),
        apiCost: totalMppCost.toFixed(4),
        companyName: company.name,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      });
    } catch (err) {
      console.error("[TokenAgent] Failed to log transaction:", err);
    }

    console.log(`[TokenAgent] Analysis complete for ${company.name} (${analysisId}). Cost: $${totalMppCost.toFixed(6)}`);
  } catch (error: any) {
    console.error(`[TokenAgent] Analysis failed for ${company.name}:`, error.message);
    await storage.updateTokenAnalysis(analysisId, {
      content: `# Token Analysis Failed\n\nError: ${error.message}\n\nPlease try again.`,
      status: "failed",
    }).catch(() => {});
  }
}
