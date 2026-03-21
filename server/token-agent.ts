import { callAnthropicServer, type AnthropicRequest } from "./mpp-client";
import { executeDuneQuery, getLatestDuneResults, isDuneConfigured, type DuneQueryResult } from "./dune-client";
import { storage } from "./storage";
import { MARKUP_MULTIPLIER } from "./enrichment";
import type { Company, DuneQuery, TokenProfile } from "@shared/schema";

const TOKEN_ANALYSIS_SYSTEM = `You are the Token Intelligence Agent in a VC deal intelligence platform. You analyze on-chain data and market metrics to provide investment-grade token analysis.

You receive:
1. Company context (name, sector, description)
2. Token profile (contract address, chain, ticker)
3. Dune Analytics query results (charts, tables of on-chain data)

Your job is to produce a comprehensive token intelligence report covering:

## ANALYSIS FRAMEWORK
1. **Token Overview** — Price action summary, market cap context, where it sits relative to peers
2. **On-Chain Health** — Active addresses, transaction volume trends, holder distribution insights
3. **Liquidity Analysis** — DEX/CEX liquidity depth, trading volume patterns, slippage risk
4. **Holder Intelligence** — Whale concentration, smart money movements, holder growth/churn
5. **Risk Flags** — Unusual patterns, concentration risks, liquidity concerns, regulatory exposure
6. **Investment Thesis Impact** — How the on-chain data supports or contradicts the deal thesis

## RULES
- Be SPECIFIC with numbers and trends from the data provided
- Flag concerning patterns clearly with severity levels (🔴 critical, 🟡 caution, 🟢 healthy)
- Compare metrics to typical ranges for the token's sector/stage when possible
- Always note data limitations or gaps
- Write for a VC audience — focus on what matters for investment decisions
- Use markdown formatting with headers, bullet points, and bold for emphasis
- If data is insufficient for a section, say so explicitly rather than speculating

Return your analysis as a structured markdown report.`;

export async function runTokenAnalysis(
  analysisId: string,
  userId: string,
  company: Company,
  tokenProfile: TokenProfile,
  duneQueryConfigs: DuneQuery[],
): Promise<void> {
  try {
    console.log(`[TokenAgent] Starting analysis for ${company.name} (${analysisId})`);

    const duneResults: Record<string, DuneQueryResult> = {};

    if (isDuneConfigured() && duneQueryConfigs.length > 0) {
      for (const q of duneQueryConfigs) {
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
      dataContext += "\n## Note\nNo Dune queries attached to this company. Analysis is based on company context and token profile only. Recommend attaching relevant Dune queries for deeper on-chain analysis.\n";
    }

    const request: AnthropicRequest = {
      model: "claude-opus-4-6",
      max_tokens: 8000,
      system: TOKEN_ANALYSIS_SYSTEM,
      messages: [{ role: "user", content: `Analyze this token for investment due diligence:\n\n${dataContext}` }],
    };

    const result = await callAnthropicServer(request);

    await storage.updateTokenAnalysis(analysisId, {
      content: result.text,
      status: "complete",
      duneData: JSON.stringify(duneResults),
    });

    const charge = result.mppCost * MARKUP_MULTIPLIER;
    try {
      await storage.logTransaction({
        userId,
        type: "token_analysis",
        description: `Token analysis: ${company.name} (${tokenProfile.tokenTicker || tokenProfile.contractAddress.slice(0, 10)})`,
        amount: charge.toFixed(4),
        apiCost: result.mppCost.toFixed(4),
        companyName: company.name,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
      });
    } catch (err) {
      console.error("[TokenAgent] Failed to log transaction:", err);
    }

    console.log(`[TokenAgent] Analysis complete for ${company.name} (${analysisId}). Cost: $${result.mppCost.toFixed(6)}`);
  } catch (error: any) {
    console.error(`[TokenAgent] Analysis failed for ${company.name}:`, error.message);
    await storage.updateTokenAnalysis(analysisId, {
      content: `# Token Analysis Failed\n\nError: ${error.message}\n\nPlease try again.`,
      status: "failed",
    }).catch(() => {});
  }
}
