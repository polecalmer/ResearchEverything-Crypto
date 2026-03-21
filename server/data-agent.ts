import { callAnthropicServerHeavy, type AnthropicResponse } from "./mpp-client";
import { getLatestDuneResults, executeDuneQuery, isDuneConfigured, type DuneQueryResult } from "./dune-client";
import { fetchTokenSnapshot, type TokenSnapshot } from "./allium-client";
import { isServerMppReady } from "./mpp-client";
import * as defillama from "./defillama-client";
import { storage } from "./storage";
import { MARKUP_MULTIPLIER } from "./enrichment";
import type { Company, TokenProfile, DashboardChart, DuneQuery } from "@shared/schema";

const DATA_CHART_CHARGE = 0.50;

const DATA_AGENT_SYSTEM = `You are a Data Analyst Agent in a VC deal intelligence platform called BookMark. You specialize in crypto/DeFi data visualization.

Your job: Given a user's chart request and available data context, produce a JSON plan for one or more charts.

AVAILABLE DATA SOURCES:
1. "dune" — Execute Dune Analytics queries. You will be provided a list of the user's saved Dune query IDs with labels. You can reference them by queryId. You can also suggest new Dune query IDs if you know popular public queries.
2. "defillama" — DeFiLlama API for protocol TVL history, daily fees, daily revenue. Provide the protocol slug.
3. "coingecko" — Price history for tokens. Provide the coingecko coin ID (e.g. "hyperliquid", "ethereum", "solana").
4. "allium" — Real-time token snapshot (price, mcap, volume). Good for single-point current data.

YOU MUST RESPOND WITH VALID JSON ONLY. No markdown, no explanation. Just the JSON array.

Response format — array of chart definitions:
[
  {
    "title": "TITLE IN UPPERCASE",
    "description": "One sentence",
    "chartType": "line" | "bar" | "area",
    "dataSource": "dune" | "defillama" | "coingecko" | "allium",
    "dataSourceConfig": {
      // For dune: { "queryId": 12345, "params": {} }
      // For defillama: { "endpoint": "tvl" | "fees" | "revenue", "slug": "hyperliquid" }
      // For coingecko: { "coinId": "hyperliquid", "daysBack": 90 }
      // For allium: { "ticker": "HYPE", "chain": "hyperliquid", "contractAddress": "" }
    },
    "chartConfig": {
      "xAxis": { "dataKey": "the_actual_column_name", "label": "Date", "type": "date" },
      "yAxes": [
        { "dataKey": "actual_column_name", "label": "Revenue", "color": "#38bdf8", "format": "currency", "yAxisId": "left" }
      ]
    }
  }
]

═══════════════════════════════════════════════════════════════
CRITICAL CHART CONFIGURATION RULES — READ CAREFULLY
═══════════════════════════════════════════════════════════════

1. X-AXIS COLUMN SELECTION:
   - For Dune queries: Look at the sample data columns. Pick the column that contains ACTUAL DATE STRINGS (e.g. "2025-01-01 00:00:00.000 UTC"), NOT bare integers.
   - Common pattern: Dune data has "date" (often just a day number like 20) and "month_start" (actual date string). ALWAYS use the string date column like "month_start", "day", "block_date", "week" etc.
   - NEVER use a column named "date" if its sample value is a small integer (like 1-31) — that's a day-of-month, not a date.
   - For DeFiLlama/CoinGecko: use "date" (these return proper unix timestamps).

2. Y-AXIS — PICK THE RIGHT METRIC:
   - When data has monthly_revenue AND annualized_revenue AND prev_month_revenue AND mom_growth_pct:
     → For a "revenue" chart: use "monthly_revenue" (the actual metric), NOT annualized, NOT prev_month.
   - Skip derivative/secondary columns: anything starting with "prev_", "annualized_", "cumulative_", "running_".
   - Exception: "totalLiquidityUSD" and other canonical aggregate fields are fine — only skip "total_" prefix when it's clearly a running total.
   - Skip growth/rate columns for primary metric: "mom_growth_pct", "pe_ratio_*", "*_change_*".
   - The user wants to see the core business metric, not derived calculations.

3. CHART TYPE SELECTION:
   - "bar" → periodic aggregates (monthly revenue, weekly volume, daily fees, TVL snapshots)
   - "line" → continuous time series (price, TVL over time, daily metrics with 100+ points)
   - "area" → cumulative or smooth continuous data (cumulative revenue, TVL growth)
   - For bar charts with ≤24 bars, every bar gets a tick label. Perfect for monthly data.
   - NEVER use "bar" for daily price data — always "line".

4. DUAL Y-AXIS CHARTS (when user asks for "X vs Y"):
   - ONLY possible when BOTH metrics exist in the SAME data source/query result.
   - If the metrics come from different sources (e.g. CoinGecko price + DeFiLlama revenue), create TWO SEPARATE charts instead.
   - When a single Dune query or data source returns both columns (e.g. a query with both "monthly_revenue" and "price"):
     → Create ONE chart with TWO yAxes entries with DIFFERENT yAxisId values ("left" and "right")
   - Price-type metrics → yAxisId: "right", format: "currency", color: "#38bdf8" (light blue)
   - Revenue/volume-type metrics → yAxisId: "left", format: "currency", color: "#2dd4bf" (teal)
   - Set chartType to "line" for dual-axis overlays
   - Example for "Price vs 30D MA Revenue" (when BOTH columns exist in one query):
     yAxes: [
       { "dataKey": "monthly_revenue", "label": "Revenue", "color": "#2dd4bf", "format": "currency", "yAxisId": "left", "chartType": "bar" },
       { "dataKey": "price", "label": "Price", "color": "#38bdf8", "format": "currency", "yAxisId": "right", "chartType": "line" }
     ]
   - Each yAxis can have its own "chartType" field to mix bar+line in the same chart.
   - If you're unsure both columns exist in the same source, create separate charts — never reference columns that don't exist in the data.

5. SINGLE METRIC CHARTS:
   - Only ONE yAxis entry. Pick the most relevant column.
   - Revenue chart → "monthly_revenue", chartType "bar", color "#38bdf8"
   - Price chart → "price", chartType "line", color "#38bdf8"
   - TVL chart → "totalLiquidityUSD", chartType "area", color "#2dd4bf"
   - Volume chart → "volume" or "daily_volume", chartType "bar", color "#818cf8"

6. COLOR PALETTE (in order of preference):
   - Primary: "#38bdf8" (sky blue)
   - Secondary: "#2dd4bf" (teal)
   - Tertiary: "#818cf8" (indigo)
   - Fourth: "#a78bfa" (violet)
   - NEVER use red, harsh green, or bright yellow for primary metrics.

7. FORMAT RULES:
   - "currency" → values displayed as $1.2M, $450K, $3.5B
   - "percent" → values are ALREADY in percentage form (150 means 150%). Display as 150.0%
   - "number" → plain numbers with abbreviation (1.2M, 450K)
   - Revenue, fees, TVL, price, volume, market_cap, fdv → "currency"
   - growth_pct, apy, apr, rate → "percent"
   - count, users, transactions → "number"

8. TITLES:
   - ALL CAPS, concise. Examples: "MONTHLY REVENUE", "PRICE (90D)", "TVL HISTORY"
   - For dual-axis: "PRICE VS MONTHLY REVENUE"

9. DUNE QUERY COLUMN INSPECTION:
   - You are given sample data with actual column names and values. USE THEM EXACTLY.
   - Do NOT guess column names. If sample shows {month_start: "2026-03-01...", monthly_revenue: 47517317}, use EXACTLY "month_start" and "monthly_revenue".
   - If no saved query matches, suggest a known public query ID or create separate charts from other sources.`;

interface DataAgentInput {
  companyId: string;
  companyName: string;
  userId: string;
  userPrompt: string;
  tokenProfile: TokenProfile | null;
  savedDuneQueries: DuneQuery[];
  tokenSnapshot: TokenSnapshot | null;
}

interface ChartPlan {
  title: string;
  description: string;
  chartType: string;
  dataSource: string;
  dataSourceConfig: Record<string, any>;
  chartConfig: Record<string, any>;
}

export async function runDataAgent(input: DataAgentInput): Promise<{
  charts: DashboardChart[];
  totalCost: number;
}> {
  const { companyId, companyName, userId, userPrompt, tokenProfile, savedDuneQueries, tokenSnapshot } = input;

  let contextParts: string[] = [];
  contextParts.push(`Company: ${companyName}`);

  if (tokenProfile) {
    contextParts.push(`Token: ${tokenProfile.tokenTicker || 'unknown'} on ${tokenProfile.chain}`);
    if (tokenProfile.contractAddress) contextParts.push(`Contract: ${tokenProfile.contractAddress}`);
  }

  if (tokenSnapshot) {
    contextParts.push(`Current Price: $${tokenSnapshot.price?.toFixed(4) ?? 'N/A'}`);
    contextParts.push(`Market Cap: $${tokenSnapshot.marketCap?.toLocaleString() ?? 'N/A'}`);
    contextParts.push(`24h Volume: $${tokenSnapshot.volume24h?.toLocaleString() ?? 'N/A'}`);
  }

  if (savedDuneQueries.length > 0) {
    contextParts.push(`\nUser's saved Dune queries:`);
    for (const q of savedDuneQueries) {
      let columnInfo = "";
      if (isDuneConfigured()) {
        try {
          const results = await getLatestDuneResults(q.queryId);
          if (results.columns.length > 0) {
            columnInfo = ` | Columns: [${results.columns.join(", ")}]`;
            if (results.rows.length > 0) {
              const sample = results.rows[0];
              const sampleStr = Object.entries(sample).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(", ");
              columnInfo += ` | Sample: {${sampleStr}}`;
            }
          }
        } catch {}
      }
      contextParts.push(`  - Query ID ${q.queryId}: "${q.label}" (viz: ${q.visualizationType})${columnInfo}`);
    }
  }

  if (isDuneConfigured()) {
    contextParts.push(`\nDune Analytics: AVAILABLE (API key configured)`);
  }

  contextParts.push(`\nDeFiLlama: AVAILABLE (TVL, fees, revenue for most DeFi protocols)`);
  contextParts.push(`CoinGecko: AVAILABLE (price history)`);

  const dataContext = contextParts.join('\n');

  const response = await callAnthropicServerHeavy({
    model: "claude-opus-4-6",
    max_tokens: 4000,
    system: DATA_AGENT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Data context:\n${dataContext}\n\nUser request: "${userPrompt}"`,
      },
    ],
  });

  let totalCost = response.mppCost;

  let chartPlans: ChartPlan[];
  try {
    const cleaned = response.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    chartPlans = JSON.parse(cleaned);
    if (!Array.isArray(chartPlans)) chartPlans = [chartPlans];
  } catch (e) {
    throw new Error(`AI returned invalid chart plan: ${response.text.substring(0, 200)}`);
  }

  const validSources = ["dune", "defillama", "coingecko", "allium"];
  const validChartTypes = ["line", "bar", "area", "composed"];

  chartPlans = chartPlans.filter(plan => {
    if (!plan.title || typeof plan.title !== "string") return false;
    if (!plan.dataSource || !validSources.includes(plan.dataSource)) return false;
    if (!plan.dataSourceConfig || typeof plan.dataSourceConfig !== "object") return false;
    if (!plan.chartConfig || typeof plan.chartConfig !== "object") return false;
    if (plan.chartType && !validChartTypes.includes(plan.chartType)) plan.chartType = "line";
    return true;
  });

  if (chartPlans.length === 0) {
    throw new Error("AI could not produce a valid chart plan for this request. Try rephrasing.");
  }

  const charts: DashboardChart[] = [];

  for (const plan of chartPlans) {
    const chart = await storage.createDashboardChart({
      companyId,
      userId,
      title: plan.title,
      description: plan.description || null,
      chartType: plan.chartType || "line",
      dataSource: plan.dataSource,
      dataSourceConfig: JSON.stringify(plan.dataSourceConfig),
      chartConfig: JSON.stringify(plan.chartConfig),
      data: null,
      status: "generating",
      errorMessage: null,
    });

    try {
      const data = await fetchChartData(plan.dataSource, plan.dataSourceConfig);
      if (!data || data.length === 0) {
        const updatedChart = await storage.updateDashboardChart(chart.id, {
          status: "failed",
          errorMessage: "No data returned from source. The protocol or token may not be indexed.",
        });
        charts.push(updatedChart || chart);
        continue;
      }

      const availableCols = data[0] ? Object.keys(data[0]) : [];
      const requestedCols = (plan.chartConfig?.yAxes || []).map((y: any) => y.dataKey);
      const missingCols = requestedCols.filter((col: string) => !availableCols.includes(col));
      if (missingCols.length > 0) {
        console.warn(`[Data Agent] Chart "${plan.title}" references missing columns: ${missingCols.join(", ")}. Available: ${availableCols.join(", ")}`);
        const fixedYAxes = (plan.chartConfig.yAxes || []).filter((y: any) => availableCols.includes(y.dataKey));
        if (fixedYAxes.length === 0) {
          plan.chartConfig = { columns: availableCols };
          plan.chartType = "table";
        } else {
          plan.chartConfig.yAxes = fixedYAxes;
        }
        await storage.updateDashboardChart(chart.id, {
          chartType: plan.chartType,
          chartConfig: JSON.stringify(plan.chartConfig),
        });
      }

      const updatedChart = await storage.updateDashboardChart(chart.id, {
        data: JSON.stringify(data),
        status: "completed",
      });
      charts.push(updatedChart || chart);
    } catch (err: any) {
      const updatedChart = await storage.updateDashboardChart(chart.id, {
        status: "failed",
        errorMessage: err.message || "Failed to fetch data",
      });
      charts.push(updatedChart || chart);
    }
  }

  return { charts, totalCost };
}

export async function refreshChartData(chartId: string): Promise<DashboardChart> {
  const chart = await storage.getDashboardChart(chartId);
  if (!chart) throw new Error("Chart not found");

  await storage.updateDashboardChart(chartId, { status: "generating" });

  try {
    const config = JSON.parse(chart.dataSourceConfig);
    const existingChartConfig = JSON.parse(chart.chartConfig || "{}");
    const data = await fetchChartData(chart.dataSource, { ...config, forceRefresh: true });

    const updates: any = {
      data: JSON.stringify(data),
      status: "completed",
      errorMessage: null,
    };

    // Preserve existing chart config on refresh — only update data, not chart type or config

    const updated = await storage.updateDashboardChart(chartId, updates);
    return updated || chart;
  } catch (err: any) {
    const updated = await storage.updateDashboardChart(chartId, {
      status: "failed",
      errorMessage: err.message || "Failed to refresh data",
    });
    return updated || chart;
  }
}

async function fetchChartData(
  dataSource: string,
  config: Record<string, any>
): Promise<any[]> {
  switch (dataSource) {
    case "dune":
      return fetchDuneData(config);
    case "defillama":
      return fetchDefiLlamaData(config);
    case "coingecko":
      return fetchCoinGeckoData(config);
    case "allium":
      return fetchAlliumData(config);
    default:
      throw new Error(`Unknown data source: ${dataSource}`);
  }
}

async function fetchDuneData(config: Record<string, any>): Promise<any[]> {
  if (!isDuneConfigured()) throw new Error("Dune API key not configured");

  const queryId = config.queryId;
  if (!queryId) throw new Error("No Dune query ID provided");

  let result: DuneQueryResult;
  if (config.forceRefresh) {
    result = await executeDuneQuery(queryId, config.params || {});
  } else {
    result = await getLatestDuneResults(queryId);
  }

  return result.rows.map((row) => {
    const processed: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key.toLowerCase().includes('day')) {
        processed.date = typeof value === 'string' ? new Date(value).getTime() / 1000 : value;
      }
      processed[key] = value;
    }
    if (!processed.date && result.rows.indexOf(row) >= 0) {
      processed.date = Date.now() / 1000;
    }
    return processed;
  });
}

async function fetchDefiLlamaData(config: Record<string, any>): Promise<any[]> {
  const slug = config.slug;
  if (!slug) throw new Error("No DeFiLlama protocol slug provided");

  switch (config.endpoint) {
    case "tvl": {
      const tvlData = await defillama.getProtocolTvl(slug);
      return tvlData.map((d) => ({
        date: d.date,
        totalLiquidityUSD: d.totalLiquidityUSD,
      }));
    }
    case "fees": {
      const feesData = await defillama.getProtocolFees(slug);
      return feesData.dailyFees.map((d) => ({
        date: d.date,
        fees: d.fees,
      }));
    }
    case "revenue": {
      const revData = await defillama.getProtocolRevenue(slug);
      return revData.dailyRevenue.map((d) => ({
        date: d.date,
        revenue: d.revenue,
      }));
    }
    default:
      throw new Error(`Unknown DeFiLlama endpoint: ${config.endpoint}`);
  }
}

async function fetchCoinGeckoData(config: Record<string, any>): Promise<any[]> {
  const coinId = config.coinId;
  if (!coinId) throw new Error("No CoinGecko coin ID provided");

  const daysBack = config.daysBack || 90;
  const priceData = await defillama.getCoinPriceHistory(coinId, daysBack);

  return priceData.prices.map((p) => ({
    date: p.date,
    price: p.price,
  }));
}

async function fetchAlliumData(config: Record<string, any>): Promise<any[]> {
  const { snapshot } = await fetchTokenSnapshot(
    config.contractAddress || "",
    config.chain || "ethereum",
    config.ticker || ""
  );

  return [{
    date: Date.now() / 1000,
    price: snapshot.price,
    marketCap: snapshot.marketCap,
    volume24h: snapshot.volume24h,
    holderCount: snapshot.holderCount,
    priceChange24h: snapshot.priceChange24h,
  }];
}

export { DATA_CHART_CHARGE };
