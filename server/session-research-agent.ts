import { callAnthropicRaw, type AnthropicRawResponse } from "./mpp-client";
import { executeDuneSQL, isDuneConfigured } from "./dune-client";
import { discoverTablesForProtocol } from "./dune-mcp-client";
import { fetchTokenSnapshot } from "./allium-client";
import * as defillama from "./defillama-client";
import * as vm from "vm";
import { retrieveRelevantContext, formatRetrievedContext } from "./brain-retrieval";
import { storage } from "./storage";
import { MODELS } from "./constants";
import {
  consultForTool,
  shouldShortCircuit,
  observeToolError,
  observeToolSuccess,
  recordSystemLearning,
  getBinding,
  registerToolBindings,
  type ToolBrainBinding,
} from "./data-source-brain/agent-hooks";
import { searchAnalystCorpus, searchAnalystFrameworks } from "./analyst-corpus";
import { ANALYST_NAMES } from "@shared/schema";
import {
  planResearch,
  reflectOnPlan,
  renderPlanForSystemPrompt,
  type ResearchPlan,
} from "./research-planner";

export interface ResearchArtifact {
  type: "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";
  title?: string;
  subtitle?: string;
  source?: string;
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
  plan?: ResearchPlan;
  needsContinuation?: boolean;
}

export type BrainContext = BrainGraph | null;

interface ToolDef {
  name: string;
  description: string;
  input_schema: any;
  brainBinding?: ToolBrainBinding;
}

const TOOLS: ToolDef[] = [
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
    brainBinding: { source: "defillama", scopeRef: "defillama:/protocol/{slug}", observationCategory: "coverage" },
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
    brainBinding: { source: "defillama", scopeRef: "defillama:/summary/fees/{slug}", observationCategory: "coverage" },
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
    brainBinding: { source: "defillama", scopeRef: "defillama:/summary/dexs/{slug}", observationCategory: "coverage" },
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
    brainBinding: { source: "defillama", scopeRef: "defillama:/protocol/{slug}", observationCategory: "coverage" },
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
    brainBinding: { source: "defillama", scopeRef: "defillama:coins/prices/chart", observationCategory: "coverage" },
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
    brainBinding: { source: "defillama", scopeRef: "defillama:/protocols", observationCategory: "coverage" },
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
    brainBinding: { source: "dune", scopeRef: "dune:/query/execute", observationCategory: "reliability" },
  },
  {
    name: "search_proven_queries",
    description: "Search the library of 130+ proven, production-tested Dune SQL queries. MUST be your FIRST tool call for ANY quantitative data request (charts, metrics, fees, revenue, volume, P/E, valuation). These queries produce richer data than DeFiLlama/CoinGecko APIs. Search by protocol name, metric type, or keyword. If a match is found, use it with execute_dune_sql instead of DeFiLlama tools.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol or project name (e.g. 'aave', 'hyperliquid', 'pump')" },
        keyword: { type: "string" as const, description: "Keyword to search query names/types (e.g. 'volume', 'tvl', 'stablecoin', 'trades')" },
      },
      required: ["protocol"],
    },
  },
  {
    name: "discover_dune_tables",
    description: "Search Dune's table catalog for decoded protocol tables and spellbook datasets. Use ONLY if search_proven_queries returned no useful results.",
    input_schema: {
      type: "object" as const,
      properties: {
        protocol: { type: "string" as const, description: "Protocol name to search for tables" },
        chain: { type: "string" as const, description: "Blockchain (e.g. 'ethereum', 'arbitrum', 'base')" },
      },
      required: ["protocol"],
    },
    brainBinding: { source: "dune", scopeRef: "dune:mcp/v1", observationCategory: "schema" },
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
    brainBinding: { source: "allium", scopeRef: "allium:token-snapshot", observationCategory: "coverage" },
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
    name: "query_analyst_corpus",
    description: `Search the writings of eight crypto analysts whose work is indexed into Sessions. Use this for QUALITATIVE perspective: what these analysts have actually written about a topic, in their own words. Returns specific passages with date, source URL, and analyst attribution. Do NOT use as a source for live numbers — for those use the data tools. Use early in deep-mode research to surface contrarian takes, historical context, and the analysts' frameworks before forming your own view.`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "Natural-language query — what perspective/passage are you looking for? E.g. 'how does fee accrual work for L2 sequencers' or 'macro view on crypto cycles'." },
        analyst: { type: "string" as const, enum: [...ANALYST_NAMES, "all"], description: "Restrict to one analyst, or 'all' to surface across all lenses (default 'all')." },
        limit: { type: "number" as const, description: "Max passages to return (default 6, max 12)." },
      },
      required: ["query"],
    },
  },
  {
    name: "query_analyst_frameworks",
    description: `Look up named analytical frameworks each analyst has developed over time. Each framework has a description, a category, version history (showing how the framework evolved across articles), and date range. Use this when you want the SHAPE of an analyst's reasoning rather than a specific passage. Especially useful for deep questions where you want to apply an established lens to a new asset.`,
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, description: "What kind of framework are you looking for? E.g. 'how to evaluate token fee accrual', 'market making PnL decomposition'." },
        analyst: { type: "string" as const, enum: [...ANALYST_NAMES, "all"], description: "Restrict to one analyst, or 'all' (default 'all')." },
        limit: { type: "number" as const, description: "Max frameworks to return (default 4, max 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "analyst_perspective",
    description: `Get a specific analyst's REASONING on a question — not just citations, but how they would actually think through the problem using their frameworks and analytical patterns. Returns a structured reasoning trace showing the analyst's chain of thought applied to your specific question. Use this when you want an analyst to "think" about something, not just retrieve what they've written. Much more powerful than query_analyst_corpus for generating novel analysis.`,
    input_schema: {
      type: "object" as const,
      properties: {
        analyst: { type: "string" as const, enum: [...ANALYST_NAMES], description: "Which analyst's perspective to generate." },
        question: { type: "string" as const, description: "The specific question you want this analyst to reason through. Be precise — e.g. 'Is HYPE overvalued at $28 given its fee trajectory and upcoming token unlocks?'" },
        context: { type: "string" as const, description: "Optional: relevant data or findings from your research so far that the analyst should consider in their reasoning." },
      },
      required: ["analyst", "question"],
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

// Register the brain bindings carried by each tool definition above.
// Module-level call: runs once on import.
registerToolBindings(TOOLS);

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
{"title": "...", "subtitle": "ONE-LINE INSIGHT IN ALL CAPS", "source": "Dune Analytics|DeFiLlama|CoinGecko|Allium", "chartType": "line|bar|area|composed", "xAxis": {"dataKey": "...", "format": "date|currency|number|percent"}, "yAxes": [{"dataKey": "...", "format": "...", "label": "...", "chartType": "..."}], "data": [...]}
\`\`\`
- "subtitle" = a short ALL-CAPS insight about the trend (e.g. "CYCLICAL PATTERN — PEAKED AT 37X IN MAY 2025, NOW BACK TO 30X ON RISING EARNINGS"). Always include this.
- "source" = the data source used (e.g. "Dune Analytics", "DeFiLlama"). Always include this.
- Prefer "line" chartType for most time-series data. Only use "area" when showing cumulative/total values.
- Use "composed" with different formats per yAxis when mixing $ and % series
- NEVER plot $ and % on same axis. Keep data under 365 points.

For tables:
\`\`\`artifact:table
{"title": "...", "columns": ["Window", "Daily Avg", "Annualized"], "data": [{"Window": "24h", "Daily Avg": "$289K", "Annualized": "$105M"}, {"Window": "7d", "Daily Avg": "$273K", "Annualized": "$99.6M"}]}
\`\`\`
- CRITICAL: Each object in "data" MUST use the EXACT same keys as the strings in "columns" (same case, same spacing, same punctuation). Mismatched keys will render as empty cells.
- Never include rows with all empty/null values. If you don't have a value for a cell, either omit the row or write "n/a".

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

ANALYST CORPUS — THIRD-PARTY LENSES:
You have indexed access to the writings of eight crypto analysts via query_analyst_corpus and query_analyst_frameworks:
- TopherGMI (Arca CIO): macro, market structure, ETF/regulatory, tokenomics
- shaundadevens (Blockworks): DeFi mechanics, fee switches, governance, microstructure
- thiccyth0t (Scimitar): derivatives, market making, on-chain quant, airdrop game theory
- CryptoHayes (Arthur Hayes / BitMEX): macro, geopolitics, monetary policy, crypto cycles
- AustinBarack: early-stage investing, market catalysts, ecosystem analysis
- defi_monk: DeFi protocol mechanics, yield strategies, on-chain analytics
- RyanWatkins_ (Messari alum): sector mapping, protocol valuation, market structure
- robbiepetersen_ (Delphi Digital): cross-chain research, emerging protocols
Treat these as PERSPECTIVES, not data. They are most useful for qualitative context, contrarian framings, and applying established frameworks to new assets. Do NOT use them as the source for live numbers — that's what the data tools are for.
IMPORTANT: Do NOT name individual analysts in your output. Never write "TopherGMI says…", "CryptoHayes argues…", or similar. Instead, absorb their reasoning into your own analysis seamlessly. You may reference the analytical lens generically (e.g. "from a macro-structural perspective…", "a derivatives-focused view suggests…") but never reveal the names of the underlying analysts. The user should experience this as the platform's own integrated analysis.

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
- If brain has competitors for an entity, include them without the user asking
- For market share / competitive landscape queries: check brain entities sharing the same CATEGORY — these are peers the brain already knows. Include ALL of them in your analysis, don't rely on memory alone. The brain's category field (e.g. "derivatives-dex", "lending", "dex") groups protocols by market segment.`;

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
- End with a brief "what this means" — but no probability-weighted price targets unless asked.

WHEN THE REQUEST IS A CHART/VISUALIZATION ("show me a chart of X", "pull up Y over Z", "graph the take rate"):
- STEP 0 (MANDATORY): Call search_proven_queries FIRST with the protocol name + metric (e.g. "hyperliquid revenue", "hype P/E", "aave fees"). The proven query library has 130+ Dune SQL queries that often produce richer, more accurate data than DeFiLlama APIs. If a match exists, use execute_dune_sql with it — skip DeFiLlama entirely.
- STEP 1: If no proven query matched, fetch data from DeFiLlama/CoinGecko (1-2 tool calls), do the trivial transform inline in the chart artifact's "data" array, and ship the chart with a 2-3 sentence summary above it.
- For a SINGLE ratio (one P/E number, one take rate), compute it inline — no execute_code needed.
- For a TIME-SERIES of a derived metric (daily P/E over 6 months, take rate trend), you MUST use execute_code to merge the component series row-by-row and output the chart data array. This is the #1 failure mode: the agent tries to build a 180-row data array by hand and gives up. Use code.
- Only use execute_code in focused mode if the math is genuinely non-trivial OR you need to merge two time-series datasets.
- No scenario tables, no sensitivity matrices, no thesis section. Just the chart + brief context.

CHART REQUESTS — ABSOLUTE DELIVERY RULE:
If the user explicitly asked for a chart/graph/plot, your response MUST contain at least one \`\`\`artifact:chart\`\`\` block. update_research_brain is supplementary record-keeping — it is NEVER a substitute for the requested chart. If the primary data source returned empty (e.g. fees/revenue endpoint has no series for this protocol), you must:
  1. Try an alternative source FIRST (query_defillama_volume with type:"derivatives" for perp DEXes, query_defillama_protocol_summary, get_token_snapshot for live mcap/FDV/supply, query_dune for on-chain metrics).
  2. If you can compute the requested metric from any combination of available data, ship the chart.
  3. Only if every relevant source is exhausted: state plainly which endpoints returned empty and what alternative chart you CAN deliver — then ship that alternative chart. Do not silently end with a brain-update message.

VALUATION RATIO CHARTS (P/E, P/S, P/F, FDV/Rev, MCAP/Rev, ADJ MCAP/Rev):
- For protocols with their own buyback/burn model where standard fees/revenue adapters are empty (HYPE, dYdX, etc.), derive revenue from query_defillama_volume + the protocol's known take rate (in the brain or stated in the prompt), or pull buyback flows from query_dune.
- ADJ MCAP = circulating mcap minus protocol-owned tokens (treasury, foundation locked); use brain context for the adjustment if known, otherwise note the assumption inline.
- FDV uses total supply; MCAP uses circulating supply — both come from get_token_snapshot.

DERIVED METRIC TIME-SERIES — THE PATTERN:
When the user asks for a chart of a metric that doesn't exist in a single API endpoint (P/E over time, take rate trend, revenue per user daily, emissions vs revenue), follow this exact 3-step pattern:
  Step 1: Fetch the component series separately. E.g. for daily P/E:
    - query_defillama_fees_revenue for daily revenue (or query_defillama_volume + known take rate)
    - get_token_snapshot for current mcap/FDV/supply, then DeFiLlama or Allium for historical prices
  Step 2: Use execute_code to merge and compute. The code should:
    - Accept the raw data arrays as inputs (pass them in the code as constants)
    - Align dates between the two series (join on date string)
    - Compute the derived metric for each row (e.g. pe = mcap / (dailyRevenue * 365))
    - Output a clean data array for the chart: [{date, pe_ratio}, ...]
    - Keep data under 365 points
  Step 3: Render the chart artifact using the computed data array from execute_code.
  
  CRITICAL: Do NOT try to manually construct 100+ row data arrays in your text output. Always use execute_code for multi-row derived computations. This is the #1 reason chart requests fail.`;

const DEEP_RULES = `RESPONSE MODE: DEEP
The user asked a substantive, multi-part question that needs real research and synthesis.

ANSWER THE QUESTION THAT WAS ASKED — NOT A TEMPLATE:
The single most common failure mode is producing a generic "deep dive report" (snapshot → history → scenarios → price target) regardless of what the user actually asked. STOP DOING THIS. Before you do anything else:

1. RE-READ the user's prompt and write down the sub-questions it contains, in your own head. A prompt like "what's happening with X, what's their roadmap, what have they built in 6mo, are flows positive, flesh out the thesis" is FIVE distinct sub-questions — four qualitative, one quantitative, one synthetic. Each one gets its own treatment.
2. Decide for each sub-question: is it qualitative (narrative, prose) or quantitative (numbers, charts, tables)? Use the format that fits.
3. The structure of your response should mirror the structure of the question, not a fixed template.

WHEN TO USE WHICH ARTIFACT (and when to use NONE):
- metric_cards: ONLY if the question is fundamentally a "what are the current KPIs / give me a snapshot" question. Do NOT lead with metric_cards just because the topic is a token. A question about roadmap or product does not need a price/MCAP/TVL snapshot at the top.
- chart: ONLY if the user asked for a visualization OR if a time series is genuinely the clearest answer (e.g. "are flows positive?" → net inflow chart is appropriate).
- table: ONLY for data that is naturally tabular (comparing N items across M dimensions). Do NOT put prose into a table.
- comparison block (bull/bear, market/reality): ONLY if the question asks about disagreement with consensus or pros/cons. NOT a default for every deep response.
- callout: 0–2 max, only when there is a genuinely non-obvious finding worth bolding.
- quote: 0–1 max, only when there is a single sentence that captures the whole answer.
- It is FINE — and often correct — for a deep response to be 80% prose with one chart and zero metric_cards. A roadmap question may have ZERO artifacts and that is the right answer.

SCENARIO ANALYSIS / PRICE TARGETS — STRICTLY CONDITIONAL:
Bear/Base/Bull scenarios with probability-weighted price targets are a VALUATION exercise. Only produce them when:
- The user explicitly asked for valuation, price target, scenarios, or "should I buy/size this"
- OR the user asked for "the investment thesis" AND there is enough financial data to actually model it
If the question is "what are they building" or "what's their roadmap", a scenario table is OFF-TOPIC. Do not produce one.

QUALITATIVE QUESTIONS DESERVE QUALITATIVE ANSWERS:
"What's happening", "what's the roadmap", "what have they built", "who's the team", "what's the narrative" — these are answered with researched PROSE, not KPI dashboards. Use web_search and the brain liberally for these. Cite specific shipped products, dates, governance proposals, partnerships. Be concrete.

QUANTITATIVE QUESTIONS DESERVE QUANTITATIVE ANSWERS:
"Are flows positive", "what's the revenue trajectory", "what's the take rate" — these need actual data. Pull it, transform it, show it (chart or table), then say what it means in 1–2 sentences.

SYNTHESIS LAST, NOT FIRST:
If the user asked for a "thesis" or "investment view", that is the SYNTHESIS of the prior sub-answers. Write it last, in 3–6 bullets or 2–3 short paragraphs. It should reference the specific findings above, not re-state the snapshot.

RESEARCH METHODOLOGY:
- 5–15 tool calls — let the question drive the count, not a quota
- Use web_search aggressively for qualitative context (roadmap, shipped products, governance, team) — this is the #1 underused tool
- PROVEN QUERY FIRST (MANDATORY): For ANY quantitative data request (charts, metrics, fees, revenue, volume, P/E, P/S, valuation, on-chain data), your VERY FIRST tool call MUST be search_proven_queries with a relevant search term (protocol name, metric type, or both). The proven query library contains 130+ battle-tested Dune SQL queries that produce better results than DeFiLlama/CoinGecko APIs. If a proven query exists for the metric, use execute_dune_sql with it. Only fall back to DeFiLlama/token snapshot tools if NO proven query matches.
- DUNE QUERY WORKFLOW: If search_proven_queries returns no match AND you need to write custom Dune SQL, call discover_dune_tables first to find the right tables. Only write custom SQL as a last resort.
- execute_code for non-trivial math (regressions, multi-variable models) OR when building a time-series of a derived metric (merging daily price + daily revenue to compute daily P/E). A single P/E ratio does NOT need code, but charting P/E over 180 days DOES.

QUALITY:
- Lead with the actual answer to the user's actual question, not a snapshot
- Format large numbers readably ($1.2B, not $1,200,000,000)
- Bold key numbers and key findings — reader should skim and get the thesis
- If you don't have data for something, say so plainly — never fabricate to fill a section

DATA INTEGRITY rules from the base prompt still apply. Brain rules still apply. update_research_brain still required at end.`;

function buildSystemPrompt(mode: ResearchMode, brainContext: string): string {
  const modeRules = mode === "quick" ? QUICK_RULES : mode === "focused" ? FOCUSED_RULES : DEEP_RULES;
  return `${BASE_PROMPT}\n\n${modeRules}${brainContext}`;
}

const INTENT_CLASSIFIER_PROMPT = `You classify the user's last message into one of three modes for a crypto research assistant.

quick = clarification, fact recall, simple lookup, "what does X mean", "which was higher", "what was the lock rate", short follow-up that doesn't need new analysis
focused = targeted question needing some research — "show me the TVL trend", "what's the P/S vs UNI", "explain the merger", "compare X and Y at a high level", "how does this affect Z", AND any pure data-visualization request like "pull up a chart of X", "show me a chart of Y over Z", "graph the take rate", "plot HYPE P/E ratios" — these need data fetching + a chart artifact, NOT a full model.
deep = explicit deep-dive, full analysis, comprehensive breakdown, scenario modeling — "dive deep into", "deep analysis", "full breakdown", "thorough analysis", "competitive analysis", "build me a model", "run a model", "model the NTM revenue", first message in a new session that asks open-ended "tell me about X". Modeling/scenarios/probability-weighted targets = deep. A request that just asks to SEE a chart of existing data = focused, not deep.

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
      model: MODELS.OPUS,
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

const ANALYST_PERSONAS: Record<string, { role: string; style: string }> = {
  TopherGMI: {
    role: "You are TopherGMI, CIO of Arca — a crypto fund manager with deep expertise in macro, market structure, and tokenomics.",
    style: "You think in cycles and capital rotation. You evaluate tokens through the lens of: (1) macro regime positioning, (2) tokenomics quality (buybacks, burns, fee accrual, supply concentration), (3) fundamental valuation using EV-adjusted metrics, and (4) relative value across crypto asset classes. You are quantitative but also narrative-aware — you understand how stories drive capital flows.",
  },
  shaundadevens: {
    role: "You are shaundadevens, a Blockworks research columnist specializing in DeFi protocol economics.",
    style: "You focus on the microstructure of protocols: fee switches, governance dynamics, value accrual mechanisms, and competitive moats. You analyze whether protocols actually capture the value they generate. Your signature move is decomposing take rates — who pays fees, where do they flow, are they sustainable or incentive-driven? You are skeptical of vanity metrics and always ask 'who is the marginal buyer of this token?'",
  },
  thiccyth0t: {
    role: "You are thiccyth0t from Scimitar Capital — a quantitative crypto strategist specializing in derivatives, market making, and on-chain flow analysis.",
    style: "You think in terms of reflexivity loops, funding rates, OI dynamics, and supply-side pressure. You decompose market moves into their mechanical drivers: forced liquidations, basis compression, spot-perp divergence, dealer gamma. You are comfortable with math and frequently reason about PnL decomposition, concentration metrics, and statistical edge. You are blunt and data-driven — you call out narrative-driven narratives that don't have flow support.",
  },
};

interface PerspectiveResult {
  payload: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  costSource?: string;
}

let _subCallCostAccum = { cost: 0, inputTokens: 0, outputTokens: 0, anyCostSourceVoucher: false };
function resetSubCallCosts() { _subCallCostAccum = { cost: 0, inputTokens: 0, outputTokens: 0, anyCostSourceVoucher: false }; }
function addSubCallCost(r: PerspectiveResult) {
  _subCallCostAccum.cost += r.cost;
  _subCallCostAccum.inputTokens += r.inputTokens;
  _subCallCostAccum.outputTokens += r.outputTokens;
  if (r.costSource === "voucher_estimate") _subCallCostAccum.anyCostSourceVoucher = true;
}
function drainSubCallCosts() {
  const c = { ..._subCallCostAccum };
  resetSubCallCosts();
  return c;
}

async function generateAnalystPerspective(
  analyst: string,
  question: string,
  userContext?: string,
): Promise<PerspectiveResult> {
  const persona = ANALYST_PERSONAS[analyst];
  if (!persona) return { payload: JSON.stringify({ error: `Unknown analyst: ${analyst}` }), cost: 0, inputTokens: 0, outputTokens: 0 };

  const [corpusHits, frameworkHits] = await Promise.all([
    searchAnalystCorpus({ query: question, analyst, limit: 4 }),
    searchAnalystFrameworks({ query: question, analyst, limit: 3, minSimilarity: 0.2 }),
  ]);

  const corpusContext = corpusHits.length > 0
    ? `\n\nRELEVANT PAST WRITINGS:\n${corpusHits.map(h => `[${h.source} ${h.date || ""}] ${h.content.slice(0, 600)}`).join("\n\n")}`
    : "";

  const frameworkContext = frameworkHits.length > 0
    ? `\n\nYOUR ANALYTICAL FRAMEWORKS:\n${frameworkHits.map(h => `- "${h.name}" (${h.category || "general"}): ${h.description}`).join("\n")}`
    : "";

  const dataContext = userContext
    ? `\n\nDATA THE RESEARCHER HAS GATHERED:\n${userContext.slice(0, 2000)}`
    : "";

  const systemPrompt = `${persona.role}

${persona.style}

You are being asked to REASON THROUGH a specific question from your analytical perspective. This is NOT a retrieval task — you must THINK about the question using your frameworks, style, and analytical patterns.

Structure your response as a reasoning trace:
1. Frame the question through your lens — what matters here from YOUR perspective?
2. Apply your relevant framework(s) step-by-step
3. Identify what data you'd need and what the data tells you
4. Reach a conclusion or identify the key uncertainty

Be specific, opinionated, and analytical. Use your signature style. Do not hedge excessively — take a clear analytical position and explain your reasoning.${frameworkContext}${corpusContext}${dataContext}`;

  const response = await callAnthropicRaw({
    model: MODELS.HAIKU,
    max_tokens: 1200,
    system: systemPrompt,
    messages: [{ role: "user", content: `Reason through this question from your analytical perspective:\n\n${question}` }],
  });

  const perspectiveText = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  return {
    payload: JSON.stringify({
      analyst,
      perspective_type: "reasoning_trace",
      reasoning: perspectiveText,
      frameworks_applied: frameworkHits.map(h => h.name),
      corpus_references: corpusHits.length,
      note: "This is analytical REASONING, not a citation. Integrate it seamlessly into your own analysis — do NOT name the analyst in your output. Absorb the reasoning and present it as part of your own synthesis.",
    }),
    cost: response.mppCost,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    costSource: response.costSource,
  };
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
        const [feesRes, revenueRes] = await Promise.allSettled([
          defillama.getProtocolFees(slug),
          defillama.getProtocolRevenue(slug),
        ]);
        const fees = feesRes.status === "fulfilled" ? feesRes.value : null;
        const revenue = revenueRes.status === "fulfilled" ? revenueRes.value : null;
        const feesErr = feesRes.status === "rejected" ? String(feesRes.reason?.message || feesRes.reason) : null;
        const revenueErr = revenueRes.status === "rejected" ? String(revenueRes.reason?.message || revenueRes.reason) : null;
        const feeData = fees?.dailyFees?.map((d: any) => [d.date, d.fees]) || [];
        const revData = revenue?.dailyRevenue?.map((d: any) => [d.date, d.revenue]) || [];
        if (feeData.length === 0 && revData.length === 0) {
          return JSON.stringify({
            error: `No fees or revenue series available on DeFiLlama for "${slug}". This protocol may not be tracked by the fees/revenue adapters (common for perpetuals, AMMs without fee splits, or new protocols). For perp DEXes use query_defillama_volume with type:"derivatives". For a high-level snapshot of any tracked metrics use query_defillama_protocol_summary. For live mcap/FDV/circulating supply use get_token_snapshot.`,
            protocol: slug,
            feesEndpointError: feesErr,
            revenueEndpointError: revenueErr,
            feesPoints: 0,
            revenuePoints: 0,
          });
        }
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
        return JSON.stringify({
          protocol: slug,
          points: result.length,
          feesPoints: feeData.length,
          revenuePoints: revData.length,
          summary: {
            fees24h: fees?.total24h ?? null,
            fees7d: fees?.total7d ?? null,
            fees30d: fees?.total30d ?? null,
            feesAllTime: fees?.totalAllTime ?? null,
            revenue24h: revenue?.total24h ?? null,
            revenue7d: revenue?.total7d ?? null,
            revenue30d: revenue?.total30d ?? null,
            revenueAllTime: revenue?.totalAllTime ?? null,
          },
          data: result,
        });
      }
      case "query_defillama_volume": {
        const slug = await defillama.resolveSlug(input.protocol);
        const volFn = input.type === "derivatives" ? defillama.getProtocolDerivativesVolume : defillama.getProtocolDexVolume;
        const vol = await volFn(slug);
        const data = (vol?.dailyVolume || []).map((d: any) => ({
          date: new Date(d.date * 1000).toISOString().slice(0, 10),
          volume: Math.round(d.volume),
        }));
        return JSON.stringify({
          protocol: slug,
          points: data.length,
          summary: { volume24h: vol?.total24h ?? null, volume7d: vol?.total7d ?? null, volumeAllTime: vol?.totalAllTime ?? null },
          data: sampleData(data, 365),
        });
      }
      case "query_defillama_protocol_summary": {
        const slug = await defillama.resolveSlug(input.protocol);
        const summary = await defillama.getProtocolSummary(slug);
        return JSON.stringify(summary);
      }
      case "query_defillama_price_history": {
        const days = input.days || 365;
        const result = await defillama.getCoinPriceHistory(input.coinId, days);
        const prices = result?.prices || [];
        if (prices.length === 0) return JSON.stringify({ error: `No price data found for "${input.coinId}". Try a different coinId — common ones: "ethereum", "bitcoin", "hyperliquid", "solana".` });
        const formatted = prices.map(p => ({
          date: new Date(p.date * 1000).toISOString().slice(0, 10),
          price: p.price,
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
        const startMs = Date.now();
        const result = await executeDuneSQL(input.sql);
        if (!result || !result.rows) return JSON.stringify({ error: "Query returned no results" });
        const rows = result.rows.slice(0, 500);

        if (rows.length > 0 && input.description) {
          try {
            const desc = (input.description || "").toLowerCase();
            const sqlLower = (input.sql || "").toLowerCase();
            const protocolMatch = sqlLower.match(/(?:from|join)\s+(\w+)[\._]/)?.[1] || desc.split(/\s+/).find((w: string) => w.length > 2 && !["the","for","and","from","with","get","all","by"].includes(w)) || "unknown";
            const metricGuess = desc.slice(0, 80) || "custom_query";
            await storage.saveProvenQuery({
              protocol: protocolMatch,
              metricType: metricGuess,
              sqlQuery: input.sql,
              dataSource: "dune-sql",
            });
            void recordSystemLearning({
              scope: "data_source",
              scopeKey: `dune:${protocolMatch}`,
              ruleType: "proven_query",
              ruleText: `Dune SQL query for ${metricGuess} (protocol: ${protocolMatch}) returned ${rows.length} rows successfully. Prefer this over DeFiLlama for ${protocolMatch} metrics.`,
              source: "auto:execute_dune_sql",
              triggeredBy: `session_research`,
            });
          } catch (e: any) {
            console.log(`[ProvenQuery] Failed to save from session agent: ${e.message}`);
          }
        }

        return JSON.stringify({ rowCount: rows.length, columns: result.columns?.map((c: any) => c.name) || Object.keys(rows[0] || {}), data: rows });
      }
      case "search_proven_queries": {
        const searchProtocol = (input.protocol || "").toLowerCase().trim();
        const keyword = (input.keyword || "").toLowerCase().trim();
        const allResults: any[] = [];

        const exact = await storage.findProvenQuery(searchProtocol, keyword || searchProtocol);
        if (exact) allResults.push(exact);

        const fewShot = await storage.getFewShotExamples(searchProtocol, keyword || searchProtocol, 8);
        for (const q of fewShot) {
          if (!allResults.find(r => r.id === q.id)) allResults.push(q);
        }

        if (allResults.length === 0) {
          const { db: dbImport } = await import("./db");
          const { sql: sqlOp } = await import("drizzle-orm");
          const { provenQueries: pqTable } = await import("@shared/schema");
          const fuzzy = await dbImport.select().from(pqTable)
            .where(sqlOp`(${pqTable.protocol} ILIKE ${'%' + searchProtocol + '%'} OR ${pqTable.metricType} ILIKE ${'%' + searchProtocol + '%'} OR ${pqTable.metricType} ILIKE ${'%' + (keyword || searchProtocol) + '%'}) AND ${pqTable.isActive} = true`)
            .orderBy(sqlOp`${pqTable.successCount} DESC`)
            .limit(10);
          allResults.push(...fuzzy);
        }

        if (allResults.length === 0) {
          return JSON.stringify({ found: 0, message: "No proven queries found. Use discover_dune_tables to find tables, then write SQL." });
        }

        const formatted = allResults.slice(0, 10).map(q => ({
          protocol: q.protocol,
          metricType: q.metricType,
          sql: q.sqlQuery,
          successCount: q.successCount,
          chartType: q.chartType,
        }));
        return JSON.stringify({ found: formatted.length, queries: formatted });
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
        if (!input.code || typeof input.code !== "string" || !input.code.trim()) {
          return JSON.stringify({
            error: "MISSING_CODE: You called execute_code without a 'code' field. The 'code' parameter must contain the actual JavaScript source as a string. For single-value ratios, compute inline. For time-series derived metrics (daily P/E, take rate trend), you DO need execute_code — pass the raw data arrays as constants in the code and merge/compute row-by-row. Do NOT retry this tool with the same empty input.",
          });
        }
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
      case "query_analyst_corpus": {
        const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 12);
        const hits = await searchAnalystCorpus({
          query: String(input.query || ""),
          analyst: input.analyst,
          limit,
        });
        if (hits.length === 0) {
          return JSON.stringify({
            count: 0,
            message: "No analyst passages matched. Try a broader query, a different analyst, or fall back to web_search for the same topic.",
          });
        }
        return JSON.stringify({
          count: hits.length,
          analyst_filter: input.analyst || "all",
          passages: hits.map((h) => ({
            analyst: h.analyst,
            source: h.source,
            date: h.date,
            title: h.title,
            url: h.url,
            similarity: h.similarity.toFixed(3),
            excerpt: h.content.length > 1600 ? h.content.slice(0, 1600) + "…" : h.content,
          })),
          attribution_note: "These are analytical perspectives, not live data. Absorb the reasoning into your own analysis — do NOT name the individual analysts in your output.",
        });
      }
      case "query_analyst_frameworks": {
        const limit = Math.min(Math.max(Number(input.limit) || 4, 1), 8);
        const hits = await searchAnalystFrameworks({
          query: String(input.query || ""),
          analyst: input.analyst,
          limit,
        });
        if (hits.length === 0) {
          return JSON.stringify({
            count: 0,
            message: "No matching frameworks. Try query_analyst_corpus for raw passages instead.",
          });
        }
        return JSON.stringify({
          count: hits.length,
          analyst_filter: input.analyst || "all",
          frameworks: hits.map((h) => ({
            analyst: h.analyst,
            slug: h.frameworkSlug,
            name: h.name,
            description: h.description,
            category: h.category,
            version_count: h.versionCount,
            first_seen: h.firstSeenDate,
            last_seen: h.lastSeenDate,
            similarity: h.similarity.toFixed(3),
            recent_versions: h.versions.slice(-3).map((v) => ({
              version: v.version,
              date: v.date,
              description: v.description,
              source_article: v.source_article,
            })),
          })),
        });
      }
      case "analyst_perspective": {
        const perspResult = await generateAnalystPerspective(
          String(input.analyst || "TopherGMI"),
          String(input.question || ""),
          input.context ? String(input.context) : undefined,
        );
        addSubCallCost(perspResult);
        return perspResult.payload;
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
          subtitle: json.subtitle,
          source: json.source,
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
  search_proven_queries: "Checking query library",
  execute_dune_sql: "Running on-chain SQL query",
  discover_dune_tables: "Discovering available data tables",
  compare_protocols: "Comparing protocols side-by-side",
  get_token_snapshot: "Fetching live token metrics",
  execute_code: "Running financial model",
  query_yield_pools: "Fetching yield/APY data",
  query_stablecoins: "Loading stablecoin market data",
  query_chain_tvl: "Querying chain TVL data",
  query_analyst_corpus: "Searching analyst writings",
  query_analyst_frameworks: "Looking up analyst frameworks",
  analyst_perspective: "Reasoning through a different lens",
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
  if (name === "analyst_perspective") return `${base}: "${(input.question || "").slice(0, 80)}"`;
  return base;
}

const CHART_INTENT_PATTERNS = [
  /(?:build|make|create|show|pull up|plot|graph|chart|draw|generate|give me)\s+(?:a|me|the)?\s*(?:chart|graph|plot|visualization)/i,
  /(?:chart|graph|plot)\s+(?:of|for|showing|comparing)/i,
  /P[\/-]?(?:E|S|F)\s+(?:chart|ratio|over|for)/i,
  /(?:FDV|MCAP|TVL|volume|revenue|fees)\s+(?:chart|graph|over|vs|trend)/i,
  /(?:show|pull|get|fetch)\s+(?:me\s+)?(?:the\s+)?(?:daily|weekly|monthly|historical)\s+/i,
  /(?:price\s+(?:chart|history|vs)|compare\s+.*(?:chart|graph))/i,
  /(?:take\s*rate|capital\s*efficiency|revenue\s*growth|fee\s*growth|volume[\s\/]tvl|fdv[\s\/]tvl)\s*(?:chart|trend|over|for|ratio)?/i,
];

function isChartRequest(msg: string): boolean {
  return CHART_INTENT_PATTERNS.some(p => p.test(msg));
}

interface ChartPipelineResult {
  response: ResearchResponse | null;
  fallbackContext: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

const CHART_EXTRACT_PROMPT = `Extract the protocol/token and metric from this chart request. Return ONLY valid JSON:
{"protocol": "<protocol name>", "ticker": "<token ticker>", "metric": "<metric category>", "variants": ["<variant1>", ...]}

metric must be one of: pe_ratio, ps_ratio, take_rate, capital_efficiency, revenue_growth, fee_growth, volume_tvl_ratio, fdv_tvl, revenue, fees, tvl, volume, price, custom
variants are specific sub-metrics the user wants (e.g. ["MCAP", "FDV", "Adj MCAP"] for a P/E chart)

Examples:
- "Build a P/E chart for HYPE (MCAP, FDV and Adj MCAP)" → {"protocol": "hyperliquid", "ticker": "HYPE", "metric": "pe_ratio", "variants": ["MCAP", "FDV", "Adj MCAP"]}
- "Show me AAVE revenue over time" → {"protocol": "aave", "ticker": "AAVE", "metric": "revenue", "variants": []}
- "Chart SOL TVL trend" → {"protocol": "solana", "ticker": "SOL", "metric": "tvl", "variants": []}
- "Compare HYPE fees vs revenue" → {"protocol": "hyperliquid", "ticker": "HYPE", "metric": "fees", "variants": ["fees", "revenue"]}
- "Show daily volume for Uniswap" → {"protocol": "uniswap", "ticker": "UNI", "metric": "volume", "variants": []}
- "What's Uniswap's take rate trend?" → {"protocol": "uniswap", "ticker": "UNI", "metric": "take_rate", "variants": []}
- "Capital efficiency of Aave" → {"protocol": "aave", "ticker": "AAVE", "metric": "capital_efficiency", "variants": []}
- "Revenue growth chart for Hyperliquid" → {"protocol": "hyperliquid", "ticker": "HYPE", "metric": "revenue_growth", "variants": []}
- "FDV/TVL ratio for Lido" → {"protocol": "lido", "ticker": "LDO", "metric": "fdv_tvl", "variants": []}
- "Volume to TVL ratio for Curve" → {"protocol": "curve", "ticker": "CRV", "metric": "volume_tvl_ratio", "variants": []}`;

function checkChartDataSanity(data: any[], yAxes: Array<{ dataKey: string; label: string }>): string | null {
  if (!data || data.length === 0) return "No data returned";

  for (const y of yAxes) {
    const values = data.map(d => d[y.dataKey]).filter(v => typeof v === "number" && !isNaN(v));
    if (values.length === 0) return `No numeric values for "${y.label}"`;

    const nonZero = values.filter(v => v !== 0);
    if (nonZero.length === 0) return `All values are zero for "${y.label}"`;

    const maxAbs = Math.max(...values.map(Math.abs));
    if (maxAbs > 1e15) return `Values appear to be raw token amounts for "${y.label}" (max: ${maxAbs.toExponential(2)})`;
  }

  return null;
}

function buildChartResponse(
  chartType: "line" | "bar" | "area" | "composed",
  title: string,
  data: any[],
  xAxisKey: string,
  yAxes: Array<{ dataKey: string; label: string }>,
  summary: string,
  pipelineCost: number,
  pipelineInputTokens: number,
  pipelineOutputTokens: number,
): ResearchResponse {
  const sanityIssue = checkChartDataSanity(data, yAxes);
  if (sanityIssue) {
    console.log(`[ChartPipeline] Data sanity check failed: ${sanityIssue}`);
    throw new Error(`Data sanity: ${sanityIssue}`);
  }
  const primaryKey = yAxes[0]?.dataKey;
  const first = data[0]?.[primaryKey];
  const last = data[data.length - 1]?.[primaryKey];
  let autoSubtitle = "";
  if (typeof first === "number" && typeof last === "number" && first !== 0) {
    const pctChange = ((last - first) / Math.abs(first)) * 100;
    const direction = pctChange >= 0 ? "UP" : "DOWN";
    autoSubtitle = `LATEST ${typeof last === "number" ? (Math.abs(last) >= 1e6 ? (last / 1e6).toFixed(1) + "M" : Math.abs(last) >= 1e3 ? (last / 1e3).toFixed(1) + "K" : last.toLocaleString(undefined, { maximumFractionDigits: 1 })) : last} — ${direction} ${Math.abs(pctChange).toFixed(0)}% OVER PERIOD (${data.length} DATA POINTS)`;
  }
  const source = "DeFiLlama + CoinGecko";
  const chartJson = {
    chartType,
    title,
    subtitle: autoSubtitle,
    source,
    data,
    xAxis: { dataKey: xAxisKey, format: "date" },
    yAxes: yAxes.map(y => ({ dataKey: y.dataKey, label: y.label })),
  };
  const artifactBlock = "```artifact:chart\n" + JSON.stringify(chartJson) + "\n```";
  const content = `<!-- mode:focused -->\n${summary}\n\n${artifactBlock}`;
  const artifact: ResearchArtifact = {
    type: "chart",
    title,
    subtitle: autoSubtitle,
    source,
    data,
    chartConfig: {
      chartType,
      xAxis: { dataKey: xAxisKey, format: "date" },
      yAxes: yAxes.map(y => ({ dataKey: y.dataKey, label: y.label })),
    },
  };
  return {
    content,
    artifacts: [artifact],
    mppCost: pipelineCost,
    inputTokens: pipelineInputTokens,
    outputTokens: pipelineOutputTokens,
    costBasis: "receipt",
    toolCalls: [`deterministic_${chartType}`],
    mode: "focused",
    modeReason: "chart request (deterministic pipeline)",
  };
}

async function runChartPipeline(
  userMessage: string,
  onStep?: (step: ThinkingStep) => void,
): Promise<ChartPipelineResult> {
  const startTime = Date.now();
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  let extracted: { protocol: string; ticker: string; metric: string; variants: string[] };
  try {
    const extractResp = await callAnthropicRaw({
      model: MODELS.SONNET,
      max_tokens: 300,
      system: CHART_EXTRACT_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
    cost += extractResp.mppCost;
    inputTokens += extractResp.usage?.input_tokens || 0;
    outputTokens += extractResp.usage?.output_tokens || 0;
    const text = extractResp.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    extracted = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || "{}");
    if (!extracted.protocol) {
      return { response: null, fallbackContext: "", cost, inputTokens, outputTokens };
    }
  } catch {
    return { response: null, fallbackContext: "", cost, inputTokens, outputTokens };
  }

  console.log(`[ChartPipeline] Extracted: protocol=${extracted.protocol}, metric=${extracted.metric}, variants=${extracted.variants?.join(",") || "none"}`);

  const { resolveCoinGeckoId, getRevenueSlugs } = await import("./coingecko-ids");
  const { lookupDerivedMetric, computeDerivedChart } = await import("./data-source-brain/derived-metrics");

  const recipe = lookupDerivedMetric(extracted.metric);
  if (recipe) {
    onStep?.({ type: "tool_start", label: `Computing ${recipe.displayLabel} for ${extracted.protocol}`, detail: "deterministic_fetch", round: 0 });
    try {
      const resolvers = { resolveCoinGeckoId, getRevenueSlugs };
      const { data: chartData, yAxes } = await computeDerivedChart(recipe, extracted.protocol, defillama, resolvers, 365);

      onStep?.({ type: "tool_result", label: `Computed ${chartData.length} ${recipe.displayLabel} data points`, detail: "deterministic_fetch", round: 0 });

      const primaryKey = yAxes[0].dataKey;
      const latest = chartData[chartData.length - 1];
      const priorIdx = Math.max(0, chartData.length - 91);
      const prior = chartData[priorIdx];
      const latestVal = Number(latest[primaryKey]);
      const priorVal = Number(prior[primaryKey]);

      const fmtVal = (v: number) => {
        if (recipe.format === "ratio") return `${v.toFixed(1)}x`;
        if (recipe.format === "percent") return `${v.toFixed(1)}%`;
        if (recipe.format === "currency") return v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
        return v.toFixed(2);
      };

      const trend = latestVal < priorVal ? "declining" : latestVal > priorVal ? "rising" : "flat";
      const summaryParts = [
        `**${extracted.ticker || extracted.protocol}** ${recipe.displayLabel}: **${fmtVal(latestVal)}** (${trend} from ${fmtVal(priorVal)} over ~3 months).`,
      ];
      if (yAxes.length > 1) {
        const secondKey = yAxes[1].dataKey;
        const secondVal = Number(latest[secondKey]);
        if (!isNaN(secondVal)) summaryParts.push(`${yAxes[1].label}: **${fmtVal(secondVal)}**.`);
      }
      summaryParts.push(`*${chartData.length} daily observations from ${recipe.sources.map(s => s.split(".")[0]).filter((v, i, a) => a.indexOf(v) === i).join(" + ")}.*`);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ChartPipeline] ${recipe.displayLabel} chart complete in ${elapsed}s — ${chartData.length} data points`);

      return {
        response: buildChartResponse(recipe.chartType, `${extracted.ticker || extracted.protocol} ${recipe.displayLabel}`, chartData, "date", yAxes, summaryParts.join(" "), cost, inputTokens, outputTokens),
        fallbackContext: "", cost, inputTokens, outputTokens,
      };
    } catch (e: any) {
      console.log(`[ChartPipeline] ${recipe.displayLabel} failed: ${e.message}`);
    }
  }

  if (extracted.metric === "revenue" || extracted.metric === "fees") {
    onStep?.({ type: "tool_start", label: `Fetching ${extracted.protocol} ${extracted.metric}`, detail: "deterministic_fetch", round: 0 });
    try {
      const slug = await defillama.resolveSlug(extracted.protocol);
      const [feesRes, revenueRes] = await Promise.allSettled([
        defillama.getProtocolFees(slug),
        defillama.getProtocolRevenue(slug),
      ]);
      const fees = feesRes.status === "fulfilled" ? feesRes.value : null;
      const revenue = revenueRes.status === "fulfilled" ? revenueRes.value : null;
      const dateMap = new Map<number, any>();
      if (fees?.dailyFees) { for (const d of fees.dailyFees) dateMap.set(d.date, { date: new Date(d.date * 1000).toISOString().slice(0, 10), fees: d.fees, _ts: d.date }); }
      if (revenue?.dailyRevenue) { for (const d of revenue.dailyRevenue) { const ex = dateMap.get(d.date) || { date: new Date(d.date * 1000).toISOString().slice(0, 10), _ts: d.date }; ex.revenue = d.revenue; dateMap.set(d.date, ex); } }
      const rows: any[] = [...dateMap.values()].sort((a, b) => a._ts - b._ts).map(({ _ts, ...rest }) => rest);
      if (rows.length < 7) throw new Error(`Insufficient data (${rows.length} points)`);

      const chartData = sampleData(rows, 365);
      onStep?.({ type: "tool_result", label: `Got ${chartData.length} data points`, detail: "deterministic_fetch", round: 0 });

      const hasFees = chartData[0].fees !== undefined;
      const hasRevenue = chartData[0].revenue !== undefined;
      const yAxes: Array<{ dataKey: string; label: string }> = [];
      if (hasFees) yAxes.push({ dataKey: "fees", label: "Daily Fees" });
      if (hasRevenue) yAxes.push({ dataKey: "revenue", label: "Daily Revenue" });

      const recentSlice = chartData.slice(-30);
      const avgFees = hasFees ? recentSlice.reduce((s: number, r: any) => s + (r.fees || 0), 0) / recentSlice.length : 0;
      const avgRev = hasRevenue ? recentSlice.reduce((s: number, r: any) => s + (r.revenue || 0), 0) / recentSlice.length : 0;

      const summaryParts = [`**${extracted.ticker || extracted.protocol}** recent 30-day averages:`];
      if (hasFees) summaryParts.push(`daily fees **$${avgFees >= 1000 ? (avgFees/1000).toFixed(1) + "K" : avgFees.toFixed(0)}**`);
      if (hasRevenue) summaryParts.push(`daily revenue **$${avgRev >= 1000 ? (avgRev/1000).toFixed(1) + "K" : avgRev.toFixed(0)}**`);
      summaryParts.push(`*(${chartData.length} daily data points from DeFiLlama)*`);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ChartPipeline] Fees/revenue chart complete in ${elapsed}s`);

      return {
        response: buildChartResponse("line", `${extracted.ticker || extracted.protocol} Daily Fees & Revenue`, chartData, "date", yAxes, summaryParts.join(", ") + ".", cost, inputTokens, outputTokens),
        fallbackContext: "", cost, inputTokens, outputTokens,
      };
    } catch (e: any) {
      console.log(`[ChartPipeline] Fees/revenue failed: ${e.message}`);
    }
  }

  if (extracted.metric === "tvl") {
    onStep?.({ type: "tool_start", label: `Fetching ${extracted.protocol} TVL`, detail: "deterministic_fetch", round: 0 });
    try {
      const slug = await defillama.resolveSlug(extracted.protocol);
      const data = await defillama.getProtocolTvl(slug);
      if (!data || data.length < 7) throw new Error(`Insufficient TVL data`);

      const chartData = sampleData(data.map((d: any) => ({
        date: new Date(d.date * 1000).toISOString().slice(0, 10),
        tvl: Math.round(d.totalLiquidityUSD),
      })), 365);

      onStep?.({ type: "tool_result", label: `Got ${chartData.length} TVL points`, detail: "deterministic_fetch", round: 0 });

      const latest = chartData[chartData.length - 1];
      const prior30 = chartData.length > 30 ? chartData[chartData.length - 31] : chartData[0];
      const tvlChange = prior30.tvl > 0 ? ((latest.tvl - prior30.tvl) / prior30.tvl * 100).toFixed(1) : "N/A";

      const tvlStr = latest.tvl >= 1e9 ? `$${(latest.tvl/1e9).toFixed(2)}B` : latest.tvl >= 1e6 ? `$${(latest.tvl/1e6).toFixed(1)}M` : `$${latest.tvl.toLocaleString()}`;
      const summary = `**${extracted.ticker || extracted.protocol}** current TVL: **${tvlStr}** (${tvlChange}% over 30 days). ${chartData.length} daily data points from DeFiLlama.`;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ChartPipeline] TVL chart complete in ${elapsed}s`);

      return {
        response: buildChartResponse("area", `${extracted.ticker || extracted.protocol} Total Value Locked`, chartData, "date", [{ dataKey: "tvl", label: "TVL" }], summary, cost, inputTokens, outputTokens),
        fallbackContext: "", cost, inputTokens, outputTokens,
      };
    } catch (e: any) {
      console.log(`[ChartPipeline] TVL failed: ${e.message}`);
    }
  }

  if (extracted.metric === "volume") {
    onStep?.({ type: "tool_start", label: `Fetching ${extracted.protocol} volume`, detail: "deterministic_fetch", round: 0 });
    try {
      const slug = await defillama.resolveSlug(extracted.protocol);
      const volData = await defillama.getProtocolDexVolume(slug);
      const dailyVol = volData?.dailyVolume || [];
      if (dailyVol.length < 7) throw new Error(`Insufficient volume data`);

      const chartData = sampleData(dailyVol.map((d: any) => ({
        date: new Date(d.date * 1000).toISOString().slice(0, 10),
        volume: Math.round(d.volume),
      })), 365);

      onStep?.({ type: "tool_result", label: `Got ${chartData.length} volume points`, detail: "deterministic_fetch", round: 0 });

      const latest = chartData[chartData.length - 1];
      const volStr = latest.volume >= 1e9 ? `$${(latest.volume/1e9).toFixed(2)}B` : latest.volume >= 1e6 ? `$${(latest.volume/1e6).toFixed(1)}M` : `$${latest.volume.toLocaleString()}`;

      const summary = `**${extracted.ticker || extracted.protocol}** latest daily volume: **${volStr}**. ${chartData.length} daily data points from DeFiLlama.`;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[ChartPipeline] Volume chart complete in ${elapsed}s`);

      return {
        response: buildChartResponse("bar", `${extracted.ticker || extracted.protocol} Daily DEX Volume`, chartData, "date", [{ dataKey: "volume", label: "Volume" }], summary, cost, inputTokens, outputTokens),
        fallbackContext: "", cost, inputTokens, outputTokens,
      };
    } catch (e: any) {
      console.log(`[ChartPipeline] Volume failed: ${e.message}`);
    }
  }

  onStep?.({ type: "tool_start", label: `Searching proven queries`, detail: "proven_query_search", round: 0 });
  const searchTerms = [
    `${extracted.protocol} ${extracted.metric}`,
    extracted.protocol,
    `${extracted.ticker} ${extracted.metric}`,
  ];
  const pqResults = await searchProvenQueriesForProtocol(extracted.protocol, searchTerms);
  if (pqResults.length > 0) {
    const formatted = pqResults.map(q => {
      const sql = q.sqlQuery || "(no SQL)";
      return `- [${q.protocol}] "${q.metricType}" (${q.successCount} successes)\n  SQL:\n  ${sql}`;
    }).join("\n\n");

    const fallbackContext = `\n\n<prefetched_proven_queries>
Pre-fetched proven queries for this chart request — execute directly with execute_dune_sql:

${formatted}

Pick the most relevant query, execute it, then render the chart.
</prefetched_proven_queries>`;

    console.log(`[ChartPipeline] Falling back to ${pqResults.length} proven queries for ${extracted.protocol}`);
    return { response: null, fallbackContext, cost, inputTokens, outputTokens };
  }

  return { response: null, fallbackContext: "", cost, inputTokens, outputTokens };
}

async function searchProvenQueriesForProtocol(protocol: string, searchTerms: string[]): Promise<any[]> {
  const allResults: any[] = [];
  const seen = new Set<number>();

  for (const term of searchTerms) {
    if (allResults.length >= 10) break;
    try {
      const exact = await storage.findProvenQuery(protocol, term);
      if (exact && !seen.has(exact.id)) { allResults.push(exact); seen.add(exact.id); }
      const fewShot = await storage.getFewShotExamples(protocol, term, 5);
      for (const q of fewShot) {
        if (!seen.has(q.id) && allResults.length < 10) { allResults.push(q); seen.add(q.id); }
      }
    } catch {}
  }

  if (allResults.length === 0) {
    try {
      const { db: dbImport } = await import("./db");
      const { sql: sqlOp } = await import("drizzle-orm");
      const { provenQueries: pqTable } = await import("@shared/schema");
      const fuzzy = await dbImport.select().from(pqTable)
        .where(sqlOp`(${pqTable.protocol} ILIKE ${'%' + protocol + '%'} OR ${pqTable.metricType} ILIKE ${'%' + protocol + '%'}) AND ${pqTable.isActive} = true`)
        .orderBy(sqlOp`${pqTable.successCount} DESC`)
        .limit(10);
      for (const q of fuzzy) {
        if (!seen.has(q.id)) { allResults.push(q); seen.add(q.id); }
      }
    } catch {}
  }

  return allResults;
}


export async function runSessionResearchAgent(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  brain: BrainContext | null,
  onStep?: (step: ThinkingStep) => void,
  forceMode?: ResearchMode,
  onPlan?: (plan: ResearchPlan) => void | Promise<void>,
  userId?: string,
): Promise<ResearchResponse> {
  const isChart = !forceMode && isChartRequest(userMessage);

  const toolCalls: string[] = [];
  const toolCallSignatures: string[] = [];
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCostSourceVoucher = false;
  let needsContinuation = false;
  let pendingBrainUpdate: BrainUpdate | undefined;
  let chartPrefetchContext = "";

  let mode: ResearchMode;
  let modeReason: string;
  if (forceMode) {
    mode = forceMode;
    modeReason = "user override";
    console.log(`[SessionResearch] Mode: ${mode} (forced by user)`);
  } else if (isChart) {
    mode = "focused";
    modeReason = "chart request (deterministic pipeline)";
    console.log(`[SessionResearch] Mode: focused (chart request — deterministic pipeline, no agent loop)`);

    onStep?.({ type: "thinking", label: "Chart mode — fetching data..." });
    try {
      const pipeline = await runChartPipeline(userMessage, onStep);
      totalCost += pipeline.cost;
      totalInputTokens += pipeline.inputTokens;
      totalOutputTokens += pipeline.outputTokens;

      if (pipeline.response) {
        console.log(`[SessionResearch] Chart pipeline returned complete response — skipping agent loop entirely`);
        onStep?.({ type: "complete", label: "Chart ready", detail: "deterministic_pipeline" });
        return pipeline.response;
      }

      if (pipeline.fallbackContext) {
        chartPrefetchContext = pipeline.fallbackContext;
        console.log(`[SessionResearch] Chart pipeline provided proven query context — using agent loop`);
      }
    } catch (e: any) {
      console.log(`[SessionResearch] Chart pipeline failed (non-fatal): ${e.message}`);
    }
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

  const retrieved = await retrieveRelevantContext(userMessage, brain, userId);
  const brainContext = formatRetrievedContext(retrieved);
  console.log(`[SessionResearch] Brain retrieval: ${retrieved.retrievalSummary}`);

  // ─── Planner pre-step ──────────────────────────────────────────────────────
  // Skip for quick mode and chart mode (data viz doesn't need planner decomposition).
  // For focused and deep, the planner emits a structured ResearchPlan that gets injected
  // into the system prompt and persisted on the user message for audit.
  let plan: ResearchPlan | undefined;
  if (mode !== "quick" && !isChart) {
    onStep?.({ type: "thinking", label: "Structuring the plan..." });
    try {
      const planResult = await planResearch(userMessage, history);
      plan = planResult.plan;
      totalCost += planResult.cost;
      totalInputTokens += planResult.inputTokens;
      totalOutputTokens += planResult.outputTokens;
      const subQs = plan.sub_questions.length;
      const playbook = plan.playbook_used ? ` via ${plan.playbook_used}` : "";
      console.log(`[SessionResearch] Plan: ${subQs} sub-questions${playbook}, confidence=${plan.confidence.toFixed(2)}, warnings=${(plan.warnings || []).length}`);

      try {
        const { resolveFrameworkProcedures } = await import("./research-planner");
        const fwResult = await resolveFrameworkProcedures(plan);
        plan = fwResult.plan;
        totalCost += fwResult.cost;
        totalInputTokens += fwResult.inputTokens;
        totalOutputTokens += fwResult.outputTokens;
        const resolved = plan.sub_questions.filter(q => q.resolvedFramework).length;
        if (resolved > 0) {
          console.log(`[SessionResearch] Resolved ${resolved} framework procedure(s) for plan sub-questions`);
        }
      } catch (fwErr: any) {
        console.warn("[SessionResearch] Framework resolution failed (non-fatal):", fwErr.message);
      }

      onStep?.({
        type: "thinking",
        label: `Planned ${subQs} sub-question${subQs === 1 ? "" : "s"}${playbook}`,
        detail: plan.sub_questions.map(q => `• ${q.text} [${q.types.join(", ")}]`).join("\n"),
      });
      if (onPlan) {
        try {
          await onPlan(plan);
        } catch (e: any) {
          console.warn("[SessionResearch] onPlan callback failed (non-fatal):", e.message);
        }
      }
    } catch (err: any) {
      if (err.costMeta) {
        totalCost += err.costMeta.cost || 0;
        totalInputTokens += err.costMeta.inputTokens || 0;
        totalOutputTokens += err.costMeta.outputTokens || 0;
      }
      console.error("[SessionResearch] Planner failed — falling back to unplanned execution:", err.message);
    }
  }

  const planAddendum = plan ? `\n\n${renderPlanForSystemPrompt(plan)}` : "";
  const systemPrompt = buildSystemPrompt(mode, brainContext) + planAddendum + chartPrefetchContext;

  const messages: Array<{ role: string; content: any }> = summarizeHistory(history);
  messages.push({ role: "user", content: userMessage });

  const CONTEXT_COMPRESSION_AFTER_ROUND = 4;
  const COMPRESS_OLDER_THAN_ROUNDS = 2;
  const MAX_COMPRESSED_RESULT_CHARS = 1500;

  function compressOlderToolResults(msgs: any[], currentRound: number): void {
    if (currentRound < CONTEXT_COMPRESSION_AFTER_ROUND) return;

    let toolResultMsgIndex = 0;
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      if (!Array.isArray(msg.content)) continue;
      const hasToolResult = msg.content.some((b: any) => b.type === "tool_result");
      if (!hasToolResult) continue;

      toolResultMsgIndex++;
      const roundAge = currentRound - toolResultMsgIndex;
      if (roundAge < COMPRESS_OLDER_THAN_ROUNDS) continue;

      let compressed = false;
      msg.content = msg.content.map((block: any) => {
        if (block.type !== "tool_result") return block;
        const raw = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
        if (raw.length <= MAX_COMPRESSED_RESULT_CHARS) return block;

        let summary: string;
        try {
          const text = raw.replace(/<brain_context>[\s\S]*?<\/brain_context>\s*/g, "");
          const inner = text.replace(/<\/?tool_output>/g, "").trim();
          const parsed = JSON.parse(inner);

          if (parsed.error) {
            summary = `[compressed] Error: ${String(parsed.error).slice(0, 300)}`;
          } else if (parsed.chartData || parsed.chart_data) {
            const cd = parsed.chartData || parsed.chart_data;
            const points = Array.isArray(cd) ? cd.length : "?";
            const keys = Array.isArray(cd) && cd[0] ? Object.keys(cd[0]).join(", ") : "";
            const first = Array.isArray(cd) && cd[0] ? JSON.stringify(cd[0]) : "";
            const last = Array.isArray(cd) && cd[cd.length - 1] ? JSON.stringify(cd[cd.length - 1]) : "";
            summary = `[compressed] Chart data: ${points} points, columns: [${keys}]. First: ${first}. Last: ${last}`;
            if (parsed.summary) summary += `\nSummary: ${JSON.stringify(parsed.summary).slice(0, 500)}`;
          } else if (parsed.result !== undefined && parsed.logs) {
            summary = `[compressed] Code execution result:\n${String(parsed.logs).slice(0, 600)}`;
            if (typeof parsed.result === "string") summary += `\nReturn: ${parsed.result.slice(0, 400)}`;
          } else if (Array.isArray(parsed.data)) {
            const rows = parsed.data;
            const cols = rows[0] ? Object.keys(rows[0]).join(", ") : "";
            const firstRows = rows.slice(0, 3).map((r: any) => JSON.stringify(r)).join("\n  ");
            const lastRow = rows.length > 3 ? JSON.stringify(rows[rows.length - 1]) : "";
            summary = `[compressed] ${rows.length} rows, columns: [${cols}].\nFirst rows:\n  ${firstRows}${lastRow ? `\nLast row:\n  ${lastRow}` : ""}`;
            if (parsed.metadata) summary += `\nMetadata: ${JSON.stringify(parsed.metadata).slice(0, 300)}`;
          } else if (parsed.tvl && Array.isArray(parsed.tvl)) {
            const first = parsed.tvl[0] ? JSON.stringify(parsed.tvl[0]) : "";
            const last = parsed.tvl[parsed.tvl.length - 1] ? JSON.stringify(parsed.tvl[parsed.tvl.length - 1]) : "";
            summary = `[compressed] TVL series: ${parsed.tvl.length} points. First: ${first}. Last: ${last}`;
          } else if (parsed.prices && Array.isArray(parsed.prices)) {
            const first = parsed.prices[0] ? JSON.stringify(parsed.prices[0]) : "";
            const last = parsed.prices[parsed.prices.length - 1] ? JSON.stringify(parsed.prices[parsed.prices.length - 1]) : "";
            summary = `[compressed] Price series: ${parsed.prices.length} points. First: ${first}. Last: ${last}`;
          } else {
            const str = JSON.stringify(parsed);
            summary = `[compressed] ${str.slice(0, MAX_COMPRESSED_RESULT_CHARS)}`;
          }
        } catch {
          summary = `[compressed] ${raw.slice(0, MAX_COMPRESSED_RESULT_CHARS)}`;
        }
        compressed = true;
        return { ...block, content: summary };
      });

      if (compressed) {
        const origLen = JSON.stringify(msg.content).length;
        console.log(`[SessionResearch] Compressed tool results from round ${toolResultMsgIndex} (age=${roundAge} rounds, ${origLen} chars remaining)`);
      }
    }
  }

  const planNeedsCode = plan?.sub_questions?.some((sq: any) =>
    sq.types?.includes("derived-metric-chart") || sq.types?.includes("valuation-ask") ||
    sq.suggested_tools?.includes("execute_code")
  );
  const chartNeedsCode = isChart;
  const FOCUSED_TOOL_BLOCKLIST = new Set((planNeedsCode || chartNeedsCode) ? [] : ["execute_code"]);
  const anthropicTools: any[] = TOOLS
    .filter(t => mode !== "focused" || !FOCUSED_TOOL_BLOCKLIST.has(t.name))
    .map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));

  anthropicTools.push({
    type: "web_search_20250305",
    name: "web_search",
    max_uses: mode === "quick" ? 1 : mode === "focused" ? 3 : 5,
  });

  const focusedRounds = isChart ? 4 : planNeedsCode ? 10 : 6;
  const focusedTokens = isChart ? 8000 : planNeedsCode ? 8000 : 6000;
  const MAX_TOOL_ROUNDS = mode === "quick" ? 3 : mode === "focused" ? focusedRounds : 15;
  const maxTokens = mode === "quick" ? 2000 : mode === "focused" ? focusedTokens : 16000;
  const SPEND_BUDGET_USD = mode === "quick" ? 5 : mode === "focused" ? 15 : 50;
  const useModel = "claude-opus-4-6";
  let finalText = "";
  let budgetExceeded = false;

  onStep?.({ type: "thinking", label: isChart ? "Building chart..." : mode === "quick" ? "Composing a quick answer..." : mode === "focused" ? "Working through this..." : "Planning deep analysis..." });
  if (isChart) {
    console.log(`[SessionResearch] Chart fallback mode: model=${useModel}, max ${MAX_TOOL_ROUNDS} rounds, execute_code=${chartNeedsCode ? "enabled" : "blocked"}`);
  }

  // Reflection checkpoint: for deep mode with a plan, after the agent has
  // executed enough tools to learn something, give the planner one chance to
  // revise the plan based on what's actually been found. Only fires once.
  let activeSystemPrompt = systemPrompt;
  let reflectionFired = false;
  // 0-indexed loop; round index 3 is the 4th iteration.
  const REFLECTION_ROUND_IDX = mode === "deep" ? 3 : -1;

  let loopError: string | null = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.log(`[SessionResearch] Round ${round + 1}/${MAX_TOOL_ROUNDS}`);

    if (plan && !reflectionFired && round === REFLECTION_ROUND_IDX && toolCalls.length >= 2) {
      reflectionFired = true;
      try {
        onStep?.({ type: "thinking", label: "Checking the plan against what's been found..." });
        const execSummary = `Tools called so far (${toolCalls.length}): ${toolCalls.join(", ")}`;
        const reflection = await reflectOnPlan(plan, userMessage, execSummary);
        totalCost += reflection.cost;
        totalInputTokens += reflection.inputTokens;
        totalOutputTokens += reflection.outputTokens;
        const oldCount = plan.sub_questions.length;
        const newCount = reflection.plan.sub_questions.length;
        plan = reflection.plan;
        activeSystemPrompt = buildSystemPrompt(mode, brainContext) + `\n\n${renderPlanForSystemPrompt(plan)}`;
        console.log(`[SessionResearch] Reflection: ${oldCount}→${newCount} sub-questions, reflection_count=${plan.reflection_count}`);
        if (onPlan) {
          try { await onPlan(plan); } catch (e: any) { console.warn("[SessionResearch] onPlan (post-reflection) failed:", e.message); }
        }
      } catch (err: any) {
        console.error("[SessionResearch] Reflection failed (non-fatal):", err.message);
      }
    }

    compressOlderToolResults(messages, round);

    const requestBody: any = {
      model: useModel,
      max_tokens: maxTokens,
      system: activeSystemPrompt,
      messages,
      tools: anthropicTools,
    };

    let response: AnthropicRawResponse;
    try {
      response = await callAnthropicRaw(requestBody);
    } catch (apiErr: any) {
      console.error(`[SessionResearch] API call failed at round ${round + 1}: ${apiErr.message}`);
      if (round === 0 && !apiErr.message.includes("InsufficientBalance") && !apiErr.message.includes("shutting down")) {
        console.log(`[SessionResearch] First-round failure — retrying once after 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        try {
          response = await callAnthropicRaw(requestBody);
        } catch (retryErr: any) {
          console.error(`[SessionResearch] Retry also failed: ${retryErr.message}`);
          loopError = retryErr.message;
          break;
        }
      } else {
        loopError = apiErr.message;
        break;
      }
    }

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
    let repeatedFailureDetected = false;
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const label = toolLabel(block.name, block.input);
        onStep?.({ type: "tool_start", label, detail: block.name, round: round + 1 });
        const inputStr = JSON.stringify(block.input);
        console.log(`[SessionResearch] Tool: ${block.name}(${inputStr.slice(0, 120)})`);
        toolCalls.push(block.name);

        const callSig = `${block.name}:${inputStr}`;
        toolCallSignatures.push(callSig);
        const sameCallCount = toolCallSignatures.filter(s => s === callSig).length;
        if (sameCallCount >= 3) {
          console.log(`[SessionResearch] Detected ${sameCallCount}x repeat of ${block.name} with identical input — breaking loop`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ error: `LOOP_DETECTED: You have called ${block.name} with the exact same input ${sameCallCount} times in a row. Stop retrying. Synthesize whatever you have and respond now.` }),
          });
          repeatedFailureDetected = true;
          continue;
        }

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

        const shortCircuit = getBinding(block.name)
          ? await shouldShortCircuit(block.name, block.input).catch(() => null)
          : null;

        let brainHint = "";
        let result: string;
        if (shortCircuit) {
          result = shortCircuit;
          onStep?.({ type: "tool_result", label: "Skipped — brain knows no data", detail: block.name, round: round + 1 });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
          continue;
        }

        brainHint = getBinding(block.name)
          ? await consultForTool(block.name, block.input).catch(() => "")
          : "";

        result = await executeTool(block.name, block.input);

        let resultSummary = "";
        let parsedError: string | null = null;
        try {
          const parsed = JSON.parse(result);
          if (parsed.error) {
            parsedError = String(parsed.error);
            const short = parsedError.split(".")[0].slice(0, 80);
            resultSummary = `No data — ${short}`;
          }
          else if (typeof parsed.points === "number") {
            resultSummary = parsed.points === 0 ? "No data returned" : `Got ${parsed.points} data points`;
          }
          else if (typeof parsed.rowCount === "number") {
            resultSummary = parsed.rowCount === 0 ? "No rows returned" : `Got ${parsed.rowCount} rows`;
          }
          else if (typeof parsed.count === "number") {
            resultSummary = parsed.count === 0 ? "No results found" : `Found ${parsed.count} results`;
          }
          else if (Array.isArray(parsed.data)) {
            resultSummary = parsed.data.length === 0 ? "No records returned" : `Got ${parsed.data.length} records`;
          }
          else if (parsed.price) resultSummary = `Price: $${parsed.price}`;
          else resultSummary = "Data received";
        } catch { resultSummary = "Data received"; }

        onStep?.({ type: "tool_result", label: resultSummary, detail: block.name, round: round + 1 });

        if (parsedError) {
          void observeToolError(block.name, block.input, parsedError);
        } else {
          void observeToolSuccess(block.name, block.input, resultSummary);
        }

        const finalContent = brainHint
          ? `<brain_context>\n${brainHint}\n</brain_context>\n<tool_output>\n${result}\n</tool_output>`
          : result;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: finalContent.slice(0, 80000),
        });
      } else if (block.type === "web_search_tool_result" || block.type === "server_tool_use") {
        onStep?.({ type: "tool_start", label: "Searching the web", detail: "web_search", round: round + 1 });
        toolCalls.push("web_search");
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: "user", content: toolResults });
    }

    const subCosts = drainSubCallCosts();
    if (subCosts.cost > 0) {
      totalCost += subCosts.cost;
      totalInputTokens += subCosts.inputTokens;
      totalOutputTokens += subCosts.outputTokens;
      if (subCosts.anyCostSourceVoucher) anyCostSourceVoucher = true;
      console.log(`[SessionResearch] Sub-call costs this round: $${subCosts.cost.toFixed(4)}`);
    }

    onStep?.({ type: "analyzing", label: "Analyzing results", round: round + 1, totalRounds: MAX_TOOL_ROUNDS });

    if (repeatedFailureDetected) {
      console.log(`[SessionResearch] Breaking loop early due to repeated identical tool calls`);
      break;
    }

    if (totalCost >= SPEND_BUDGET_USD) {
      console.log(`[SessionResearch] Spend budget exceeded ($${totalCost.toFixed(4)} >= $${SPEND_BUDGET_USD} for ${mode} mode) — breaking loop`);
      budgetExceeded = true;
      break;
    }
  }

  let perspectiveAddendum = "";
  if (mode === "deep" && !budgetExceeded) {
    try {
      onStep?.({ type: "thinking", label: "Gathering multi-perspective analysis..." });
      const analysts = ["TopherGMI", "shaundadevens", "thiccyth0t"] as const;
      const perspectiveResults = await Promise.allSettled(
        analysts.map(async (a) => {
          const result = await generateAnalystPerspective(a, userMessage);
          return { analyst: a, result };
        })
      );

      const perspectives: string[] = [];
      for (const r of perspectiveResults) {
        if (r.status === "fulfilled") {
          totalCost += r.value.result.cost;
          totalInputTokens += r.value.result.inputTokens;
          totalOutputTokens += r.value.result.outputTokens;
          if (r.value.result.costSource === "voucher_estimate") anyCostSourceVoucher = true;
          try {
            const parsed = JSON.parse(r.value.result.payload);
            if (parsed.reasoning) {
              const lensLabel = r.value.analyst === "TopherGMI" ? "Macro & Market Structure Lens"
                : r.value.analyst === "shaundadevens" ? "Protocol Economics & DeFi Mechanics Lens"
                : "Derivatives & Quantitative Lens";
              perspectives.push(`### ${lensLabel}\n${parsed.reasoning}`);
            }
          } catch {}
        }
      }

      if (perspectives.length > 0) {
        perspectiveAddendum = `\n\n# MULTI-PERSPECTIVE ANALYSIS
The following are reasoning traces from three different analytical perspectives on the user's question. Each applies different frameworks and analytical styles. You MUST:
1. Integrate these perspectives into your synthesis — do not ignore them
2. Note where they converge (strong signal) and where they diverge (key uncertainties)
3. Absorb the reasoning seamlessly — do NOT name the individual analysts. Reference perspectives generically (e.g. "from a macro-structural lens…", "a derivatives-focused analysis suggests…", "examining the protocol economics…")
4. Take a final synthesized position that weighs these perspectives against the data you gathered

${perspectives.join("\n\n")}`;
        console.log(`[SessionResearch] Multi-perspective debate: ${perspectives.length}/3 analyst perspectives generated`);
        onStep?.({ type: "thinking", label: `Synthesizing ${perspectives.length} analyst perspectives...` });
      }
    } catch (err: any) {
      console.warn(`[SessionResearch] Multi-perspective debate failed (non-fatal):`, err.message);
    }
  }

  if (!finalText) {
    const wrapReason = loopError
      ? `API error during research (${loopError.slice(0, 100)}). Synthesize everything gathered so far`
      : budgetExceeded
        ? `Spend budget of $${SPEND_BUDGET_USD} for ${mode} mode reached ($${totalCost.toFixed(2)} used)`
        : `${MAX_TOOL_ROUNDS} tool rounds exhausted`;
    console.log(`[SessionResearch] No final text — ${wrapReason} — forcing wrap-up call without tools`);
    onStep?.({ type: "thinking", label: loopError ? "Recovering — synthesizing results gathered so far..." : budgetExceeded ? "Budget reached, wrapping up..." : "Wrapping up..." });
    try {
      const wrapUp = await callAnthropicRaw({
        model: MODELS.OPUS,
        max_tokens: maxTokens,
        system: activeSystemPrompt + perspectiveAddendum + `\n\nIMPORTANT: ${wrapReason}. Synthesize what you learned from the tool results above into your response now. Do not call any more tools.`,
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
    if (!finalText && toolCalls.length > 0) {
      console.log(`[SessionResearch] Both main loop and wrap-up failed — constructing partial response from ${toolCalls.length} tool calls`);
      needsContinuation = true;
      finalText = `Your question warranted extensive research — I gathered data from ${toolCalls.length} sources but need one more pass to synthesize everything into a complete analysis. All the data is preserved and ready to go.`;
    } else if (!finalText) {
      const isPaymentIssue = loopError && (loopError.includes("InsufficientBalance") || loopError.includes("insufficient funds") || loopError.includes("payment"));
      const isTimeout = loopError && (loopError.includes("524") || loopError.includes("timeout") || loopError.includes("ECONNRESET"));
      if (isPaymentIssue) {
        finalText = "The AI service is temporarily unavailable due to a payment channel issue. This usually resolves automatically — please try again in a minute or two.";
      } else if (isTimeout) {
        finalText = "The request timed out while connecting to the AI service. This is a transient issue — please try sending the same question again.";
      } else if (loopError) {
        finalText = `The analysis encountered a service error and couldn't complete. Please try again — this is usually a temporary issue.\n\n*Technical detail: ${loopError.slice(0, 150)}*`;
      } else {
        finalText = "The AI service wasn't able to generate a response for this query. Please try again — if the issue persists, try rephrasing your question.";
      }
    } else {
      onStep?.({ type: "complete", label: "Composing final analysis" });
    }
  } else if (mode === "deep" && perspectiveAddendum) {
    try {
      onStep?.({ type: "thinking", label: "Integrating analyst perspectives into final synthesis..." });
      messages.push({ role: "assistant", content: finalText });
      messages.push({
        role: "user",
        content: "Now integrate the multi-perspective analysis below into your response. Absorb the reasoning seamlessly into your own analysis — do NOT name any individual analysts. Reference perspectives generically (e.g. 'from a macro lens…', 'a derivatives-focused view suggests…'). Note agreements and disagreements, and take a synthesized position. Do not repeat yourself, but ADD the perspectives where they strengthen or challenge your analysis." + perspectiveAddendum,
      });
      const debateWrap = await callAnthropicRaw({
        model: MODELS.OPUS,
        max_tokens: maxTokens,
        system: activeSystemPrompt,
        messages,
      });
      totalCost += debateWrap.mppCost;
      totalInputTokens += debateWrap.usage?.input_tokens || 0;
      totalOutputTokens += debateWrap.usage?.output_tokens || 0;
      if (debateWrap.costSource === "voucher_estimate") anyCostSourceVoucher = true;
      const debateText = debateWrap.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (debateText.length > 100) {
        finalText = debateText;
        console.log(`[SessionResearch] Multi-perspective synthesis replaced final text (${debateText.length} chars)`);
      }
      onStep?.({ type: "complete", label: "Composing final analysis" });
    } catch (err: any) {
      console.warn(`[SessionResearch] Perspective synthesis pass failed (non-fatal):`, err.message);
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
    plan,
    needsContinuation,
  };
}
