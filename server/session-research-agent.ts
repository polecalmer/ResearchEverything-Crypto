import { callAnthropicRaw, type AnthropicRawResponse } from "./mpp-client";
import { executeDuneSQL, isDuneConfigured } from "./dune-client";
import { discoverTablesForProtocol } from "./dune-mcp-client";
import * as defillama from "./defillama-client";

export interface ResearchArtifact {
  type: "chart" | "table";
  title: string;
  data: any[];
  chartConfig?: {
    chartType: "line" | "bar" | "area" | "composed";
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  columns?: string[];
}

export interface ResearchResponse {
  content: string;
  artifacts: ResearchArtifact[];
  mppCost: number;
  toolCalls: string[];
}

const TOOLS = [
  {
    name: "query_defillama_tvl",
    description: "Get TVL history for a protocol. Returns daily TVL values over time.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name or slug (e.g. 'aave', 'uniswap', 'hyperliquid')" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "query_defillama_fees_revenue",
    description: "Get fees and revenue data for a protocol. Returns daily fees and revenue over time.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name or slug" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "query_defillama_volume",
    description: "Get DEX trading volume for a protocol. Returns daily volume over time.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name or slug" },
        type: { type: "string" as const, enum: ["dex", "derivatives"], description: "Type of volume: 'dex' for spot trading, 'derivatives' for perps/futures" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "query_defillama_protocol_summary",
    description: "Get a summary overview of a protocol including current TVL, fees, revenue, description, chains, and category.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name or slug" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "query_defillama_price_history",
    description: "Get historical price data for a token using CoinGecko ID via DeFiLlama. Returns daily OHLC data.",
    input_schema: {
      type: "object" as const,
      properties: {
        coinId: { type: "string" as const, description: "CoinGecko coin ID (e.g. 'ethereum', 'bitcoin', 'hyperliquid')" },
        days: { type: "number" as const, description: "Number of days of history (default 365)" },
      },
      required: ["coinId"],
    },
  },
  {
    name: "list_defi_protocols",
    description: "Search and list DeFi protocols matching a name or category. Returns top matches with TVL, chain, and category.",
    input_schema: {
      type: "object" as const,
      properties: {
        search: { type: "string" as const, description: "Search term to filter protocols by name" },
        limit: { type: "number" as const, description: "Max results to return (default 20)" },
      },
      required: ["search"],
    },
  },
  {
    name: "execute_dune_sql",
    description: "Execute a DuneSQL query (Trino dialect) against Dune Analytics' blockchain data warehouse. Use for on-chain metrics not available via DeFiLlama. Dune indexes all major EVM chains and Solana with decoded contract data.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string" as const, description: "DuneSQL query (Trino dialect). Always include a date filter and LIMIT clause." },
        description: { type: "string" as const, description: "Brief description of what this query measures" },
      },
      required: ["sql", "description"],
    },
  },
  {
    name: "discover_dune_tables",
    description: "Search Dune's table catalog for decoded protocol tables and spellbook datasets. Use before writing SQL to find the right tables.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name to search for tables" },
        chain: { type: "string" as const, description: "Blockchain (e.g. 'ethereum', 'arbitrum', 'base')" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "compare_protocols",
    description: "Compare multiple protocols side-by-side on key metrics (TVL, fees, revenue). Returns a comparison table.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocols: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "List of protocol names/slugs to compare (2-10)",
        },
      },
      required: ["protocols"],
    },
  },
];

const SYSTEM_PROMPT = `You are a DeFi Research Agent in Research Everything — an institutional-grade research platform. You help users analyze protocols, tokens, and on-chain data through natural conversation.

You have access to tools to query live blockchain data. Use them to answer questions with real data — never guess or hallucinate numbers.

RESPONSE FORMAT:
- Write clear, concise analysis in markdown
- When you have data to show, embed charts and tables using special blocks
- For charts, use this format in your response:

\`\`\`artifact:chart
{
  "title": "Chart Title",
  "chartType": "line|bar|area",
  "xAxis": { "dataKey": "column_name", "label": "X Label", "format": "date|currency|number|percent" },
  "yAxes": [{ "dataKey": "column_name", "label": "Y Label", "format": "currency|number|percent" }],
  "data": [{"column_name": value, ...}, ...]
}
\`\`\`

- For tables, use this format:

\`\`\`artifact:table
{
  "title": "Table Title",
  "columns": ["col1", "col2"],
  "data": [{"col1": "val1", "col2": "val2"}, ...]
}
\`\`\`

GUIDELINES:
- Always call tools to get real data before answering data questions
- Prefer DeFiLlama for aggregate metrics (TVL, fees, revenue, volume) — it's fast and reliable
- Use Dune SQL only for on-chain granularity that DeFiLlama doesn't cover
- Before writing Dune SQL, use discover_dune_tables to find the right tables
- When comparing protocols, use the compare_protocols tool
- Include data context: time periods, latest values, percentage changes
- Be concise but thorough. Lead with the key insight, then show the data
- Format large numbers readably ($1.2B, not $1,200,000,000)
- If a tool call fails, explain what happened and try an alternative approach

IMPORTANT: Keep chart data arrays reasonable (max ~365 points). For long time series, the system auto-samples — but prefer requesting just the timeframe you need.`;

async function executeTool(name: string, input: any): Promise<string> {
  try {
    switch (name) {
      case "query_defillama_tvl": {
        const slug = await defillama.resolveSlug(input.protocol);
        const data = await defillama.getProtocolTvl(slug);
        if (!data || data.length === 0) return JSON.stringify({ error: `No TVL data found for "${input.protocol}"` });
        const sampled = sampleData(data.map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), tvl: Math.round(d.totalLiquidityUSD) })), 365);
        return JSON.stringify({ protocol: slug, points: sampled.length, data: sampled });
      }
      case "query_defillama_fees_revenue": {
        const slug = await defillama.resolveSlug(input.protocol);
        const [fees, revenue] = await Promise.all([
          defillama.getProtocolFees(slug).catch(() => null),
          defillama.getProtocolRevenue(slug).catch(() => null),
        ]);
        const feeData = fees?.totalDataChart || [];
        const revData = revenue?.totalDataChart || [];
        const merged: Record<string, any> = {};
        for (const [ts, val] of feeData) {
          const d = new Date(ts * 1000).toISOString().slice(0, 10);
          merged[d] = { date: d, fees: Math.round(val) };
        }
        for (const [ts, val] of revData) {
          const d = new Date(ts * 1000).toISOString().slice(0, 10);
          if (merged[d]) merged[d].revenue = Math.round(val);
          else merged[d] = { date: d, revenue: Math.round(val) };
        }
        const result = sampleData(Object.values(merged).sort((a: any, b: any) => a.date.localeCompare(b.date)), 365);
        return JSON.stringify({ protocol: slug, points: result.length, data: result });
      }
      case "query_defillama_volume": {
        const slug = await defillama.resolveSlug(input.protocol);
        const volFn = input.type === "derivatives" ? defillama.getProtocolDerivativesVolume : defillama.getProtocolDexVolume;
        const vol = await volFn(slug);
        const data = (vol?.totalDataChart || []).map(([ts, val]: [number, number]) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          volume: Math.round(val),
        }));
        return JSON.stringify({ protocol: slug, points: data.length, data: sampleData(data, 365) });
      }
      case "query_defillama_protocol_summary": {
        const slug = await defillama.resolveSlug(input.protocol);
        const summary = await defillama.getProtocolSummary(slug);
        return JSON.stringify(summary);
      }
      case "query_defillama_price_history": {
        const days = input.days || 365;
        const data = await defillama.getCoinPriceHistory(input.coinId, days);
        if (!data || data.length === 0) return JSON.stringify({ error: `No price data found for "${input.coinId}"` });
        const formatted = data.map(d => ({
          date: new Date(d.timestamp * 1000).toISOString().slice(0, 10),
          price: d.price,
        }));
        return JSON.stringify({ coinId: input.coinId, points: formatted.length, data: sampleData(formatted, 365) });
      }
      case "list_defi_protocols": {
        const protocols = await defillama.listProtocols();
        const search = input.search.toLowerCase();
        const limit = input.limit || 20;
        const matches = protocols
          .filter((p: any) => p.name?.toLowerCase().includes(search) || p.slug?.toLowerCase().includes(search) || p.category?.toLowerCase().includes(search))
          .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
          .slice(0, limit)
          .map((p: any) => ({
            name: p.name,
            slug: p.slug,
            tvl: p.tvl ? Math.round(p.tvl) : null,
            category: p.category,
            chains: p.chains?.slice(0, 5),
          }));
        return JSON.stringify({ count: matches.length, protocols: matches });
      }
      case "execute_dune_sql": {
        if (!isDuneConfigured()) return JSON.stringify({ error: "Dune Analytics not configured" });
        const result = await executeDuneSQL(input.sql);
        if (!result || !result.rows) return JSON.stringify({ error: "Query returned no results" });
        const rows = result.rows.slice(0, 500);
        return JSON.stringify({ rowCount: rows.length, columns: result.columns?.map((c: any) => c.name) || Object.keys(rows[0] || {}), data: rows });
      }
      case "discover_dune_tables": {
        const tables = await discoverTablesForProtocol(input.protocol, input.chain);
        return JSON.stringify(tables);
      }
      case "compare_protocols": {
        const results: any[] = [];
        for (const proto of input.protocols.slice(0, 10)) {
          try {
            const slug = await defillama.resolveSlug(proto);
            const summary = await defillama.getProtocolSummary(slug);
            results.push({ name: proto, slug, ...summary });
          } catch {
            results.push({ name: proto, error: "Not found" });
          }
        }
        return JSON.stringify({ count: results.length, protocols: results });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message || "Tool execution failed" });
  }
}

function sampleData(data: any[], maxPoints: number): any[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[i]);
  }
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]);
  }
  return sampled;
}

export function parseArtifacts(content: string): ResearchArtifact[] {
  const artifacts: ResearchArtifact[] = [];
  const regex = /```artifact:(chart|table)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const type = match[1] as "chart" | "table";
      const json = JSON.parse(match[2].trim());
      if (type === "chart") {
        artifacts.push({
          type: "chart",
          title: json.title || "Chart",
          data: json.data || [],
          chartConfig: {
            chartType: json.chartType || "line",
            xAxis: json.xAxis || { dataKey: "date" },
            yAxes: json.yAxes || [],
          },
        });
      } else {
        artifacts.push({
          type: "table",
          title: json.title || "Table",
          data: json.data || [],
          columns: json.columns || Object.keys(json.data?.[0] || {}),
        });
      }
    } catch {}
  }
  return artifacts;
}

function summarizeHistory(history: Array<{ role: string; content: string }>): Array<{ role: string; content: any }> {
  const msgs: Array<{ role: string; content: any }> = [];
  const recent = history.slice(-20);
  for (const msg of recent) {
    if (msg.role === "assistant") {
      const cleaned = msg.content.replace(/```artifact:(chart|table)\s*\n[\s\S]*?```/g, (m, type) => {
        try {
          const jsonStr = m.replace(/```artifact:\w+\s*\n/, "").replace(/```$/, "").trim();
          const json = JSON.parse(jsonStr);
          return `[${type === "chart" ? "📊" : "📋"} ${json.title || type}]`;
        } catch {
          return `[${type}]`;
        }
      });
      msgs.push({ role: "assistant", content: cleaned });
    } else {
      msgs.push({ role: "user", content: msg.content });
    }
  }
  return msgs;
}

export async function runSessionResearchAgent(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
): Promise<ResearchResponse> {
  const toolCalls: string[] = [];
  let totalCost = 0;

  const messages: Array<{ role: string; content: any }> = summarizeHistory(history);
  messages.push({ role: "user", content: userMessage });

  const anthropicTools = TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  const MAX_TOOL_ROUNDS = 8;
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[SessionResearch] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);

    const response: AnthropicRawResponse = await callAnthropicRaw({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages,
      tools: anthropicTools,
    });

    totalCost += response.mppCost;

    const hasToolUse = response.content.some((b: any) => b.type === "tool_use");

    if (!hasToolUse || response.stop_reason === "end_turn") {
      finalText = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: any[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`[SessionResearch] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);
        toolCalls.push(block.name);
        const result = await executeTool(block.name, block.input);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.slice(0, 80000),
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) {
    finalText = "I wasn't able to complete the analysis. Please try rephrasing your question.";
  }

  const artifacts = parseArtifacts(finalText);

  return {
    content: finalText,
    artifacts,
    mppCost: totalCost,
    toolCalls,
  };
}
