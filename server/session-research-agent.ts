import { callAnthropicRaw, type AnthropicRawResponse } from "./mpp-client";
import { executeDuneSQL, isDuneConfigured } from "./dune-client";
import { discoverTablesForProtocol } from "./dune-mcp-client";
import { fetchTokenSnapshot } from "./allium-client";
import * as defillama from "./defillama-client";
import * as vm from "vm";
import { retrieveRelevantContext, formatRetrievedContext } from "./brain-retrieval";

export interface ResearchArtifact {
  type: "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";
  title?: string;
  data?: any[];
  chartConfig?: {
    chartType: "line" | "bar" | "area" | "composed";
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  columns?: string[];
  variant?: "insight" | "risk" | "contrarian" | "catch";
  text?: string;
  attribution?: string;
  left?: { label: string; items: string[] };
  right?: { label: string; items: string[] };
}

export type ResearchMode = "quick" | "focused" | "deep";

export interface BrainEntity {
  type: "protocol" | "token" | "chain" | "person" | "fund" | "concept";
  category?: string;
  chains?: string[];
  competitors?: string[];
  relatedEntities?: string[];
  tags?: string[];
  summary?: string;
  lastResearched: string;
  researchCount: number;
}

export interface BrainRelationship {
  from: string;
  to: string;
  type: "competes_with" | "built_on" | "invested_in" | "forked_from" | "partners_with" | "related_to";
  context?: string;
  date: string;
}

export interface BrainFact {
  id: string;
  topic: string;
  fact: string;
  entities: string[];
  source: string;
  date: string;
  confidence: "verified" | "estimated" | "stale";
  supersedes?: string;
}

export interface BrainContradiction {
  factIdOld: string;
  factIdNew: string;
  summary: string;
  date: string;
}

export interface BrainGraph {
  entities: Record<string, BrainEntity>;
  relationships: BrainRelationship[];
  knowledge: BrainFact[];
  contradictions: BrainContradiction[];
  preferences: Record<string, any>;
  meta: {
    totalSessions: number;
    lastActive: string;
    topEntities: string[];
  };
}

export interface BrainUpdate {
  entities?: Record<string, Partial<BrainEntity>>;
  relationships?: BrainRelationship[];
  facts?: Array<{
    topic: string;
    fact: string;
    entities: string[];
    source: string;
    confidence: "verified" | "estimated";
  }>;
  preferences?: Record<string, any>;
}

export interface ResearchResponse {
  content: string;
  artifacts: ResearchArtifact[];
  mppCost: number;
  inputTokens: number;
  outputTokens: number;
  costBasis: "receipt" | "voucher_estimate";
  toolCalls: string[];
  brainUpdates?: BrainUpdate;
  mode: ResearchMode;
  modeReason: string;
}

export type BrainContext = BrainGraph | null;

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
        type: { type: "string" as const, enum: ["dex", "derivatives"], description: "Type of volume: 'dex' for spot, 'derivatives' for perps/futures" },
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
    description: "Execute a DuneSQL query (Trino dialect) against Dune Analytics' blockchain data warehouse. Use for on-chain metrics not available via DeFiLlama — active users, transaction counts, wallet distributions, unique traders, etc.",
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
  {
    name: "get_token_snapshot",
    description: "Get real-time token market data: price, market cap, FDV, 24h volume, circulating/total supply, holder count, 24h price change. Use for current valuation metrics.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: { type: "string" as const, description: "Token ticker symbol (e.g. 'HYPE', 'ETH', 'AAVE')" },
        contractAddress: { type: "string" as const, description: "Token contract address (optional, defaults to native)" },
        chain: { type: "string" as const, description: "Blockchain (e.g. 'ethereum', 'hyperliquid', 'solana'). Default: 'ethereum'" },
      },
      required: ["ticker"],
    },
  },
  {
    name: "execute_code",
    description: "Execute JavaScript code to compute financial models, derived metrics, growth rates, projections, P/S ratios, scenario analysis, etc. The code runs in a sandboxed environment with access to Math, JSON, Date. Return results via the `result` variable. Use this for any calculations that need precision — never do complex math in your head.",
    input_schema: {
      type: "object" as const,
      properties: {
        code: { type: "string" as const, description: "JavaScript code to execute. Assign your output to `result`. Example: `const revenue = 936; const mcap = 10720; result = { ps_ratio: (mcap/revenue).toFixed(2) };`" },
        description: { type: "string" as const, description: "What this code computes" },
      },
      required: ["code", "description"],
    },
  },
  {
    name: "query_yield_pools",
    description: "Get DeFi yield/APY data for a protocol's pools from DeFiLlama Yields. Returns pool TVL, APY breakdown (base vs reward), chain, and asset info.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name to filter pools (e.g. 'aave', 'lido', 'compound')" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "query_stablecoins",
    description: "Get stablecoin market data — circulating supply, prices, top chains. Useful for understanding stablecoin landscape and market share.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "query_chain_tvl",
    description: "Get TVL data for blockchain L1/L2 chains. Without a chain parameter, returns all chains ranked by TVL. With a chain, returns historical TVL for that chain.",
    input_schema: {
      type: "object" as const,
      properties: {
        chain: { type: "string" as const, description: "Chain name for historical TVL (e.g. 'Ethereum', 'Arbitrum', 'Solana'). Omit for all chains ranked by TVL." },
      },
    },
  },
  {
    name: "update_research_brain",
    description: `Record findings to the persistent Research Brain (knowledge graph). Call this ONCE at the END of every research session to save what you learned. The brain persists across all sessions and builds compounding intelligence.

Record:
- entities: protocols/tokens/chains you analyzed, with type, category, competitors, tags, and a 1-sentence summary
- relationships: connections between entities (competes_with, built_on, invested_in, forked_from, partners_with, related_to)
- facts: specific data points you verified via tools, with the source tool name and which entities they relate to
- preferences: any user analysis preferences you inferred (e.g. preferred valuation frameworks, focus areas)

IMPORTANT: Only record facts that came from tool calls (verified data). Mark projections/estimates as confidence: "estimated".`,
    input_schema: {
      type: "object" as const,
      properties: {
        entities: {
          type: "object" as const,
          description: "Map of entity name → entity data. Example: {\"HYPE\": {\"type\": \"protocol\", \"category\": \"derivatives-dex\", \"chains\": [\"hyperliquid\"], \"competitors\": [\"GMX\", \"DYDX\"], \"tags\": [\"perps\", \"L1\", \"buyback\"], \"summary\": \"On-chain derivatives exchange with native L1\"}}",
          additionalProperties: {
            type: "object" as const,
            properties: {
              type: { type: "string" as const, enum: ["protocol", "token", "chain", "person", "fund", "concept"] },
              category: { type: "string" as const },
              chains: { type: "array" as const, items: { type: "string" as const } },
              competitors: { type: "array" as const, items: { type: "string" as const } },
              relatedEntities: { type: "array" as const, items: { type: "string" as const } },
              tags: { type: "array" as const, items: { type: "string" as const } },
              summary: { type: "string" as const },
            },
          },
        },
        relationships: {
          type: "array" as const,
          description: "Connections between entities",
          items: {
            type: "object" as const,
            properties: {
              from: { type: "string" as const },
              to: { type: "string" as const },
              type: { type: "string" as const, enum: ["competes_with", "built_on", "invested_in", "forked_from", "partners_with", "related_to"] },
              context: { type: "string" as const },
            },
            required: ["from", "to", "type"],
          },
        },
        facts: {
          type: "array" as const,
          description: "Verified data points from tool calls",
          items: {
            type: "object" as const,
            properties: {
              topic: { type: "string" as const, description: "What this fact is about (e.g. 'HYPE revenue', 'ETH TVL')" },
              fact: { type: "string" as const, description: "The specific data point (e.g. 'LTM revenue $1.06B as of Apr 2026')" },
              entities: { type: "array" as const, items: { type: "string" as const }, description: "Which entities this fact relates to" },
              source: { type: "string" as const, description: "Which tool provided this data (e.g. 'query_defillama_fees_revenue', 'get_token_snapshot')" },
              confidence: { type: "string" as const, enum: ["verified", "estimated"] },
            },
            required: ["topic", "fact", "entities", "source", "confidence"],
          },
        },
        preferences: {
          type: "object" as const,
          description: "User analysis preferences inferred from this session",
          additionalProperties: { type: "string" as const },
        },
      },
    },
  },
];

const BASE_PROMPT = `You are a Senior DeFi Research Analyst at Sessions — an AI research platform that captures and compounds knowledge.

You have access to tools to query live blockchain data, search the web, fetch real-time token metrics, and execute code for financial modeling. Use them when needed — never guess or hallucinate numbers.

DATA INTEGRITY — ABSOLUTELY CRITICAL:
- NEVER cite a number for price, TVL, revenue, fees, volume, mcap, FDV, supply, or any live/historical metric unless either (a) you fetched it from a tool in THIS conversation, or (b) it appears in the RESEARCH BRAIN context as a "verified" fact (NOT marked stale).
- Brain facts marked "stale" or "estimated" must be re-fetched if you cite them.
- Web search is for QUALITATIVE context only (governance proposals, news, ecosystem developments, analyst opinions) — NEVER use web search results as the source for financial numbers.
- If a tool call fails, SAY SO explicitly — never fill in a "reasonable estimate" for what should be live data.
- Every number in metric_cards, charts, and tables must trace back to a specific tool call OR a verified brain fact.

ARTIFACT FORMATS:
For metric cards (compact KPI row):
\`\`\`artifact:metric_cards
{"title": "Snapshot", "data": [{"label": "Price", "value": "$44.96", "subtitle": "As of Apr 14"}]}
\`\`\`

For charts:
\`\`\`artifact:chart
{"title": "...", "chartType": "line|bar|area|composed", "xAxis": {"dataKey": "...", "format": "date|currency|number|percent"}, "yAxes": [{"dataKey": "...", "format": "...", "chartType": "..."}], "data": [...]}
\`\`\`
- Use "composed" with different formats per yAxis when mixing $ and % series
- NEVER plot $ and % on same axis. Keep data under 365 points.

For tables:
\`\`\`artifact:table
{"title": "...", "columns": ["col1", "col2"], "data": [...]}
\`\`\`

For callouts (use SPARINGLY to break up density — max 1-2 per response):
\`\`\`artifact:callout
{"variant": "insight|risk|contrarian|catch", "title": "Optional headline", "text": "The key takeaway in 1-2 sentences"}
\`\`\`
- "insight" = the non-obvious finding worth bolding
- "risk" = a real downside the analysis surfaces
- "contrarian" = where you disagree with consensus
- "catch" = the gotcha most people miss

For two-column comparisons (Bull vs Bear, Market thinks vs Reality, etc):
\`\`\`artifact:comparison
{"title": "Optional", "left": {"label": "Market Believes", "items": ["..."]}, "right": {"label": "Reality", "items": ["..."]}}
\`\`\`

For pull quotes (the one-line takeaway worth highlighting):
\`\`\`artifact:quote
{"text": "The bear case is NOT emissions — it's Base ecosystem dependency.", "attribution": "Optional source"}
\`\`\`

RESEARCH BRAIN — KNOWLEDGE GRAPH:
You have access to a persistent Research Brain that accumulates intelligence across all sessions. At the END of every analysis (regardless of mode), call update_research_brain to record verified findings.

What to record:
- entities: Protocols, tokens, chains, people, funds, concepts you analyzed — with type, category, chains, competitors, tags, 1-sentence summary
- relationships: How entities connect (competes_with, built_on, invested_in, etc.)
- facts: Specific verified data points from your tool calls — link to entities, name the source tool
- preferences: Analysis preferences you inferred (valuation frameworks, sectors, focus areas)

The brain context injected below (if present) shows what you already know. USE IT:
- Reference prior findings when relevant ("Last time HYPE rev was $X — now $Y")
- Trust facts marked "verified" — don't re-fetch them
- DO re-fetch facts marked "stale" (live metrics older than 12h) before citing
- Build on past research instead of restarting
- If brain has competitors for an entity, include them without the user asking`;

const QUICK_RULES = `RESPONSE MODE: QUICK
The user asked a clarification, recall, confirmation, or simple factual question. Match that energy.

- Answer in 1-3 sentences. NO headers, NO sections, NO scenario analysis, NO price targets.
- For confirmation questions ("are you sure?", "really?", "is that right?"): just answer based on the prior conversation. DO NOT call any tools — the analysis is already done above.
- For recall questions ("what was X?", "remind me of Y"): cite the brain context if available, no tools needed.
- Only call tools if the question fundamentally cannot be answered without fresh data — and even then, max 1 tool call.
- NO artifacts unless the answer is fundamentally a single number (then use one metric_card).
- update_research_brain is OPTIONAL in quick mode — only call it if you learned a genuinely new fact, otherwise skip it.
- Do not lecture. Do not add "additionally" sections. The user wants the answer, not the dissertation.`;

const FOCUSED_RULES = `RESPONSE MODE: FOCUSED
The user asked a targeted question that needs real analysis but not a full deep-dive.

- 2-5 paragraphs of clear analysis. Use 1-2 H3 headers if it helps structure.
- Pull data when the brain doesn't have it, or when brain facts are stale. 2-5 tool calls is the right range.
- 0-2 artifacts: maybe one chart OR table OR comparison. NOT all four.
- Lead with the answer, then the reasoning. Don't bury the lede behind 6 paragraphs of setup.
- Use a callout if there's one genuinely non-obvious takeaway.
- Skip the bear/base/bull scenario unless the question is explicitly about valuation.
- End with a brief "what this means" — but no probability-weighted price targets unless asked.`;

const DEEP_RULES = `RESPONSE MODE: DEEP
The user explicitly asked for a deep dive, full analysis, or comprehensive breakdown.

RESEARCH METHODOLOGY:
1. PLAN FIRST: Outline approach before tool calls
2. GATHER BROADLY: Multiple sources — DeFiLlama, token snapshots, web search for qualitative context, Dune for on-chain granularity
3. COMPUTE WITH CODE: execute_code for all financial calculations
4. SYNTHESIZE DEEPLY: Analyze what data means, don't just present it

FINANCIAL FRAMEWORKS:
- Multiple MCAP definitions (Circulating, EV-Adjusted, NTM-Diluted, FDV)
- Bear/Base/Bull scenario analysis with explicit assumptions
- Historical context for multiples (P/S, P/F over time)
- Sensitivity matrices, catalyst mapping, comparable protocol analysis
- Distinguish organic vs incentivized revenue

OUTPUT STRUCTURE:
- Lead with metric_cards snapshot (key KPIs)
- Clear H2 sections: Current State → Historical → Forward Model → Scenarios → Thesis
- Embed charts/tables inline. Use composed charts for $ + % comparisons.
- Use 1-2 callouts for the non-obvious findings, 1 comparison block for bull/bear or market/reality framings, 1 quote for the punchline takeaway.
- Every section gets a "so what" — raw data without interpretation is useless.
- End with probability-weighted thesis and price target with assumptions listed.
- 10-15 tool calls is normal. Don't satisfice with 3-4.

QUALITY:
- Format large numbers readably ($1.2B, not $1,200,000,000)
- Bold key numbers — reader should skim and get the thesis
- Show your work — assumptions explicit and numbered`;

function buildSystemPrompt(mode: ResearchMode, brainContext: string): string {
  const modeRules = mode === "quick" ? QUICK_RULES : mode === "focused" ? FOCUSED_RULES : DEEP_RULES;
  return `${BASE_PROMPT}\n\n${modeRules}${brainContext}`;
}

const INTENT_CLASSIFIER_PROMPT = `You classify the user's last message into one of three modes for a crypto research assistant.

quick = clarification, fact recall, simple lookup, "what does X mean", "which was higher", "what was the lock rate", short follow-up that doesn't need new analysis
focused = targeted question needing some research — "show me the TVL trend", "what's the P/S vs UNI", "explain the merger", "compare X and Y at a high level", "how does this affect Z"
deep = explicit deep-dive, full analysis, comprehensive breakdown — "dive deep into", "deep analysis", "full breakdown", "thorough analysis", "competitive analysis", "build me a model", first message in a new session that asks open-ended "tell me about X"

Output ONLY valid JSON: {"mode": "quick|focused|deep", "reason": "<one short phrase>"}`;

export async function classifyIntent(
  userMessage: string,
  recentHistory: Array<{ role: string; content: string }>,
): Promise<{ mode: ResearchMode; reason: string; cost: number; inputTokens: number; outputTokens: number }> {
  const lastAssistant = [...recentHistory].reverse().find(m => m.role === "assistant");
  const contextSnippet = lastAssistant ? `\n\nPrevious assistant response (first 400 chars): "${lastAssistant.content.slice(0, 400)}"` : "";
  const userMsg = `User's message: "${userMessage}"${contextSnippet}`;

  try {
    const response = await callAnthropicRaw({
      model: "claude-opus-4-6",
      max_tokens: 100,
      system: INTENT_CLASSIFIER_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = response.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const mode: ResearchMode = ["quick", "focused", "deep"].includes(parsed.mode) ? parsed.mode : "focused";
      return {
        mode,
        reason: String(parsed.reason || "").slice(0, 100),
        cost: response.mppCost,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      };
    }
  } catch (err: any) {
    console.warn(`[SessionResearch] Intent classification failed: ${err.message}, defaulting to focused`);
  }
  return { mode: "focused", reason: "classifier fallback", cost: 0, inputTokens: 0, outputTokens: 0 };
}

async function executeCode(code: string): Promise<string> {
  try {
    const sandbox: any = {
      Math,
      JSON,
      Date,
      Number,
      String,
      Array,
      Object,
      parseFloat,
      parseInt,
      isNaN,
      isFinite,
      console: { log: () => {} },
      result: undefined,
    };
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { timeout: 5000 });
    return JSON.stringify(sandbox.result ?? { output: "No result assigned" });
  } catch (err: any) {
    return JSON.stringify({ error: `Code execution failed: ${err.message}` });
  }
}

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
      case "get_token_snapshot": {
        const addr = input.contractAddress || "native";
        const chain = input.chain || "ethereum";
        const { snapshot, mppCost } = await fetchTokenSnapshot(addr, chain, input.ticker);
        return JSON.stringify({ ...snapshot, mppCost });
      }
      case "execute_code": {
        console.log(`[SessionResearch] Executing code: ${input.description}`);
        const result = await executeCode(input.code);
        return result;
      }
      case "query_yield_pools": {
        const pools = await defillama.getYieldPools(input.protocol);
        return JSON.stringify({ count: pools.length, pools });
      }
      case "query_stablecoins": {
        const stables = await defillama.getStablecoins();
        return JSON.stringify({ count: stables.length, stablecoins: stables });
      }
      case "query_chain_tvl": {
        if (input.chain) {
          const history = await defillama.getChainTvlHistory(input.chain);
          const sampled = sampleData(history.map((d: any) => ({
            date: new Date(d.date * 1000).toISOString().slice(0, 10),
            tvl: Math.round(d.tvl),
          })), 365);
          return JSON.stringify({ chain: input.chain, points: sampled.length, data: sampled });
        }
        const chains = await defillama.getChainTvls();
        return JSON.stringify({ count: chains.length, chains });
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
  const regex = /```artifact:(chart|table|metric_cards|callout|comparison|quote)\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      const type = match[1];
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
      } else if (type === "metric_cards") {
        artifacts.push({
          type: "metric_cards",
          title: json.title || "Metrics",
          data: json.data || [],
        });
      } else if (type === "table") {
        artifacts.push({
          type: "table",
          title: json.title || "Table",
          data: json.data || [],
          columns: json.columns || Object.keys(json.data?.[0] || {}),
        });
      } else if (type === "callout") {
        const variant = ["insight", "risk", "contrarian", "catch"].includes(json.variant) ? json.variant : "insight";
        artifacts.push({
          type: "callout",
          variant,
          title: json.title,
          text: String(json.text || "").slice(0, 500),
        });
      } else if (type === "comparison") {
        artifacts.push({
          type: "comparison",
          title: json.title,
          left: { label: String(json.left?.label || "Left"), items: (json.left?.items || []).map(String).slice(0, 8) },
          right: { label: String(json.right?.label || "Right"), items: (json.right?.items || []).map(String).slice(0, 8) },
        });
      } else if (type === "quote") {
        artifacts.push({
          type: "quote",
          text: String(json.text || "").slice(0, 400),
          attribution: json.attribution ? String(json.attribution).slice(0, 100) : undefined,
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
      const withoutModeMarker = msg.content.replace(/^<!--\s*mode:(quick|focused|deep)\s*-->\s*\n?/, "");
      const cleaned = withoutModeMarker.replace(/```artifact:(chart|table|metric_cards|callout|comparison|quote)\s*\n[\s\S]*?```/g, (m, type) => {
        try {
          const jsonStr = m.replace(/```artifact:\w+\s*\n/, "").replace(/```$/, "").trim();
          const json = JSON.parse(jsonStr);
          const icon = type === "chart" ? "📊" : type === "metric_cards" ? "📈" : type === "table" ? "📋"
            : type === "callout" ? "💡" : type === "comparison" ? "⚖️" : "❝";
          const label = json.title || json.text?.slice(0, 60) || type;
          return `[${icon} ${label}]`;
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

export interface ThinkingStep {
  type: "thinking" | "tool_start" | "tool_result" | "analyzing" | "complete";
  label: string;
  detail?: string;
  round?: number;
  totalRounds?: number;
}

const TOOL_LABELS: Record<string, string> = {
  query_defillama_tvl: "Fetching TVL data",
  query_defillama_fees_revenue: "Pulling fees & revenue metrics",
  query_defillama_volume: "Querying trading volume",
  query_defillama_protocol_summary: "Loading protocol overview",
  query_defillama_price_history: "Retrieving price history",
  list_defi_protocols: "Searching protocol database",
  execute_dune_sql: "Running on-chain SQL query",
  discover_dune_tables: "Discovering available data tables",
  compare_protocols: "Comparing protocols side-by-side",
  get_token_snapshot: "Fetching live token metrics",
  execute_code: "Running financial model",
  query_yield_pools: "Fetching yield/APY data",
  query_stablecoins: "Loading stablecoin market data",
  query_chain_tvl: "Querying chain TVL data",
  update_research_brain: "Saving to knowledge graph",
};

function toolLabel(name: string, input: any): string {
  const base = TOOL_LABELS[name] || `Calling ${name}`;
  if (name === "query_defillama_tvl" || name === "query_defillama_fees_revenue" || name === "query_defillama_volume" || name === "query_defillama_protocol_summary") {
    return `${base} for ${input.protocol || "protocol"}`;
  }
  if (name === "query_defillama_price_history") return `${base} for ${input.coinId || "token"}`;
  if (name === "list_defi_protocols") return `${base} matching "${input.search || ""}"`;
  if (name === "execute_dune_sql") return `${base}: ${input.description || "custom query"}`;
  if (name === "discover_dune_tables") return `${base} for ${input.protocol || "protocol"}`;
  if (name === "compare_protocols") return `${base}: ${(input.protocols || []).join(", ")}`;
  if (name === "get_token_snapshot") return `${base} for ${input.ticker || "token"}`;
  if (name === "execute_code") return `${base}: ${input.description || "computation"}`;
  if (name === "query_yield_pools") return `${base} for ${input.protocol || "pools"}`;
  if (name === "query_chain_tvl") return input.chain ? `${base} for ${input.chain}` : base;
  return base;
}

export async function runSessionResearchAgent(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  brain: BrainContext | null,
  onStep?: (step: ThinkingStep) => void,
  forceMode?: ResearchMode,
): Promise<ResearchResponse> {
  const toolCalls: string[] = [];
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCostSourceVoucher = false;
  let pendingBrainUpdate: BrainUpdate | undefined;

  let mode: ResearchMode;
  let modeReason: string;
  if (forceMode) {
    mode = forceMode;
    modeReason = "user override";
    console.log(`[SessionResearch] Mode: ${mode} (forced by user)`);
  } else {
    onStep?.({ type: "thinking", label: "Reading your question..." });
    const classified = await classifyIntent(userMessage, history);
    mode = classified.mode;
    modeReason = classified.reason;
    totalCost += classified.cost;
    totalInputTokens += classified.inputTokens;
    totalOutputTokens += classified.outputTokens;
    console.log(`[SessionResearch] Mode: ${mode} (${modeReason})`);
  }

  const retrieved = retrieveRelevantContext(userMessage, brain);
  const brainContext = formatRetrievedContext(retrieved);
  console.log(`[SessionResearch] Brain retrieval: ${retrieved.retrievalSummary}`);
  const systemPrompt = buildSystemPrompt(mode, brainContext);

  const messages: Array<{ role: string; content: any }> = summarizeHistory(history);
  messages.push({ role: "user", content: userMessage });

  const anthropicTools: any[] = TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  anthropicTools.push({
    type: "web_search_20250305",
    name: "web_search",
    max_uses: mode === "quick" ? 1 : mode === "focused" ? 3 : 5,
  });

  const MAX_TOOL_ROUNDS = mode === "quick" ? 3 : mode === "focused" ? 6 : 15;
  const maxTokens = mode === "quick" ? 2000 : mode === "focused" ? 6000 : 16000;
  let finalText = "";

  onStep?.({ type: "thinking", label: mode === "quick" ? "Composing a quick answer..." : mode === "focused" ? "Working through this..." : "Planning deep analysis..." });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[SessionResearch] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);

    const requestBody: any = {
      model: "claude-opus-4-6",
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
    };

    const response: AnthropicRawResponse = await callAnthropicRaw(requestBody);

    totalCost += response.mppCost;
    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;
    if (response.costSource === "voucher_estimate") anyCostSourceVoucher = true;

    const thinkingBlocks = response.content.filter((b: any) => b.type === "thinking");
    const textBlocks = response.content.filter((b: any) => b.type === "text");
    const outputText = textBlocks.map((b: any) => b.text).join("");

    if (thinkingBlocks.length > 0) {
      const thinkingSummary = (thinkingBlocks[0].thinking || "").slice(0, 200);
      console.log(`[SessionResearch] Thinking: ${thinkingSummary}...`);
    }

    const hasToolUse = response.content.some((b: any) => b.type === "tool_use");

    if (!hasToolUse || response.stop_reason === "end_turn") {
      finalText = outputText;
      onStep?.({ type: "complete", label: "Composing final analysis" });
      break;
    }

    if (outputText.trim()) {
      const snippet = outputText.trim().split("\n")[0].slice(0, 120);
      onStep?.({ type: "thinking", label: snippet, round: round + 1, totalRounds: MAX_TOOL_ROUNDS });
    } else if (thinkingBlocks.length > 0) {
      const snippet = (thinkingBlocks[0].thinking || "Analyzing...").slice(0, 120);
      onStep?.({ type: "thinking", label: snippet, round: round + 1, totalRounds: MAX_TOOL_ROUNDS });
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: any[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const label = toolLabel(block.name, block.input);
        onStep?.({ type: "tool_start", label, detail: block.name, round: round + 1 });
        console.log(`[SessionResearch] Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);
        toolCalls.push(block.name);

        if (block.name === "update_research_brain") {
          pendingBrainUpdate = block.input as BrainUpdate;
          const ec = Object.keys(block.input.entities || {}).length;
          const fc = (block.input.facts || []).length;
          const rc = (block.input.relationships || []).length;
          console.log(`[SessionResearch] Brain update recorded: ${ec} entities, ${fc} facts, ${rc} relationships`);
          const brainResult = JSON.stringify({ status: "recorded", entities: ec, facts: fc, relationships: rc });
          onStep?.({ type: "tool_result", label: `Saved ${ec} entities, ${fc} facts`, detail: block.name, round: round + 1 });
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: brainResult });
          continue;
        }

        const result = await executeTool(block.name, block.input);

        let resultSummary = "";
        try {
          const parsed = JSON.parse(result);
          if (parsed.error) resultSummary = `Error: ${parsed.error}`;
          else if (parsed.points) resultSummary = `Got ${parsed.points} data points`;
          else if (parsed.rowCount) resultSummary = `Got ${parsed.rowCount} rows`;
          else if (parsed.count) resultSummary = `Found ${parsed.count} results`;
          else if (parsed.data?.length) resultSummary = `Got ${parsed.data.length} records`;
          else if (parsed.price) resultSummary = `Price: $${parsed.price}`;
          else resultSummary = "Data received";
        } catch { resultSummary = "Data received"; }

        onStep?.({ type: "tool_result", label: resultSummary, detail: block.name, round: round + 1 });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.slice(0, 80000),
        });
      } else if (block.type === "web_search_tool_result" || block.type === "server_tool_use") {
        onStep?.({ type: "tool_start", label: "Searching the web", detail: "web_search", round: round + 1 });
        toolCalls.push("web_search");
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }
    onStep?.({ type: "analyzing", label: "Analyzing results", round: round + 1, totalRounds: MAX_TOOL_ROUNDS });
  }

  if (!finalText) {
    console.log(`[SessionResearch] No final text after ${MAX_TOOL_ROUNDS} rounds — forcing wrap-up call without tools`);
    onStep?.({ type: "thinking", label: "Wrapping up..." });
    try {
      const wrapUp = await callAnthropicRaw({
        model: "claude-opus-4-6",
        max_tokens: maxTokens,
        system: systemPrompt + "\n\nIMPORTANT: You have used all available tool budget for this turn. Synthesize what you learned from the tool results above into your response now. Do not call any more tools.",
        messages,
      });
      totalCost += wrapUp.mppCost;
      totalInputTokens += wrapUp.usage?.input_tokens || 0;
      totalOutputTokens += wrapUp.usage?.output_tokens || 0;
      if (wrapUp.costSource === "voucher_estimate") anyCostSourceVoucher = true;
      finalText = wrapUp.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
    } catch (err: any) {
      console.warn(`[SessionResearch] Wrap-up call failed: ${err.message}`);
    }
    if (!finalText) {
      finalText = "I wasn't able to complete the analysis. Please try rephrasing your question.";
    } else {
      onStep?.({ type: "complete", label: "Composing final analysis" });
    }
  }

  const artifacts = parseArtifacts(finalText);

  return {
    content: finalText,
    artifacts,
    mppCost: totalCost,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costBasis: anyCostSourceVoucher ? "voucher_estimate" : "receipt",
    toolCalls,
    brainUpdates: pendingBrainUpdate,
    mode,
    modeReason,
  };
}
