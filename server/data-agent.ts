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

CHART TYPES: "line", "bar", "area", "composed" (for multi-axis overlays like price vs revenue)

YOU MUST RESPOND WITH VALID JSON ONLY. No markdown, no explanation. Just the JSON array.

Response format — an array of chart definitions:
[
  {
    "title": "Short descriptive title",
    "description": "One sentence explaining what the chart shows",
    "chartType": "line" | "bar" | "area" | "composed",
    "dataSource": "dune" | "defillama" | "coingecko" | "allium",
    "dataSourceConfig": {
      // For dune: { "queryId": 12345, "params": {} }
      // For defillama: { "endpoint": "tvl" | "fees" | "revenue", "slug": "hyperliquid" }
      // For coingecko: { "coinId": "hyperliquid", "daysBack": 90 }
      // For allium: { "ticker": "HYPE", "chain": "hyperliquid", "contractAddress": "" }
    },
    "chartConfig": {
      "xAxis": { "dataKey": "date", "label": "Date", "type": "date" },
      "yAxes": [
        { "dataKey": "value", "label": "TVL (USD)", "color": "#3b82f6", "type": "number", "format": "currency" | "number" | "percent", "yAxisId": "left" | "right" }
      ]
    }
  }
]

RULES:
- For composed charts with different scales (e.g. price AND revenue), use yAxisId "left" and "right" to separate axes.
- For DeFiLlama revenue/fees charts, dataKey options are "revenue" or "fees" depending on the endpoint.
- For DeFiLlama TVL, the dataKey is "totalLiquidityUSD".
- For CoinGecko price history, the dataKey is "price".
- For Dune queries, examine the column names from the provided query results to set correct dataKeys.
- Always pick meaningful colors: blue (#3b82f6) for primary, green (#10b981) for positive metrics, orange (#f59e0b) for secondary, red (#ef4444) for risk.
- Use "composed" chartType when overlaying two different data types on the same chart.
- Keep titles concise and professional. Example: "HYPE Price vs Protocol Revenue (30D)"
- If the user asks for something requiring multiple charts, return multiple items in the array.
- If a Dune query is needed but none of the user's saved queries match, suggest a well-known public query ID if you know one, or explain in the title that a Dune query ID is needed.`;

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
