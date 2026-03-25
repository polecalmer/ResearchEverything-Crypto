import { callAnthropicServerHeavy, type AnthropicResponse } from "./mpp-client";
import { getLatestDuneResults, executeDuneQuery, executeDuneSQL, isDuneConfigured, type DuneQueryResult } from "./dune-client";
import { fetchTokenSnapshot, type TokenSnapshot } from "./allium-client";
import { isServerMppReady } from "./mpp-client";
import * as defillama from "./defillama-client";
import * as alliumApi from "./allium-api";
import { storage } from "./storage";
import { MARKUP_MULTIPLIER } from "./enrichment";
import type { Company, TokenProfile, DashboardChart, DuneQuery, MasterDuneQuery } from "@shared/schema";

const DATA_CHART_CHARGE = 0.50;

const DATA_AGENT_SYSTEM = `You are a Data Analyst Agent in a VC deal intelligence platform called Research Everything. You specialize in crypto/DeFi data visualization.

Your job: Given a user's request and available data context, produce a JSON plan for the chart(s) requested.

CRITICAL RULE #1: ALWAYS produce visual charts (line, bar, area) — NEVER tables — unless the user explicitly says "table". "USDe supply" = area chart. "Revenue" = bar chart. "Price" = line chart. Tables are ONLY for when the user literally types "table".

CRITICAL RULE #2: Generate ONLY what the user explicitly asked for. If they ask for ONE chart (e.g. "P/E ratio"), produce exactly ONE chart — not supporting/related charts. Only produce multiple charts when the user explicitly asks for multiple things (e.g. "revenue and TVL" = 2 charts) or when the request inherently requires it. When in doubt, produce fewer charts, not more.

═══════════════════════════════════════════════════════════════
AVAILABLE DATA SOURCES (in priority order)
═══════════════════════════════════════════════════════════════

1. ★★★ "dune-sql" — PRIMARY SOURCE FOR ALL ON-CHAIN DATA ★★★
   Write and execute raw DuneSQL (Trino dialect) against Dune's fully-indexed blockchain warehouse.
   Dune indexes EVERY EVM chain (Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, etc.) AND Solana with decoded contract-level data.
   The system creates a query, executes it, and returns results automatically — you just write the SQL.
   USE THIS FOR: revenue, fees, volume, TVL, user counts, protocol activity, token transfers, lending metrics, DEX metrics, stablecoin flows, governance, liquidations, yields, or ANY on-chain metric.
   This is your most powerful tool. If data exists on-chain, Dune has it.

2. "dune" — Execute a SAVED Dune query by ID. Only use when you have a specific query ID from the user's saved queries or the master library.

3. "defillama" — DeFiLlama API (free, pre-aggregated). Good quick fallback for TVL, fees, revenue, DEX volume, derivatives volume. Provide the protocol slug (will be provided in context). Use when the user asks for simple aggregate metrics AND a DeFiLlama slug is available.

4. "coingecko" — Token price + volume + market cap history. Provide coinId (e.g. "morpho", "ethereum"). Good for simple price charts when you don't need on-chain granularity.

5. "allium-sql" — Allium SQL for holder/balance queries across 150+ chains (Snowflake dialect). Best for: token holder distributions, whale tracking, balance snapshots. Tables: {chain}.assets.fungible_balances_latest, {chain}.assets.fungible_balances_daily.

6. "allium-prices" — Allium on-chain OHLCV price history. Provide chain + tokenAddress. Better than CoinGecko for tokens not listed on centralized exchanges.

7. "allium" — Real-time token snapshot (single-point current price, mcap, volume).

DATA SOURCE ROUTING — WHEN TO USE WHAT:
| Metric | Primary | Fallback |
| Protocol revenue, fees, earnings | dune-sql | defillama |
| TVL (total value locked) | dune-sql | defillama |
| DEX trading volume | dune-sql | defillama (dexVolume) |
| Perps/derivatives volume | dune-sql | defillama (derivatives) |
| Lending metrics (borrows, supply, utilization, liquidations) | dune-sql | — |
| User/address growth & activity | dune-sql | — |
| Token transfers & flows | dune-sql | — |
| Stablecoin supply & flows | dune-sql | defillama |
| Governance & voting | dune-sql | — |
| Gas usage & costs | dune-sql | — |
| Protocol-specific decoded events | dune-sql | — |
| Token price (simple chart) | coingecko | allium-prices, dune-sql (prices.usd) |
| Market cap, FDV, supply | coingecko | allium |
| Token holder distribution | allium-sql | dune-sql |
| Wallet balances & whale tracking | allium-sql | dune-sql |
| P/E ratio, custom derived metrics | dune-sql | — |
| Cross-protocol comparisons | dune-sql | — |

KEY PRINCIPLE: Dune-sql is the DEFAULT for any on-chain or protocol metric. It gives you the freshest, most granular data. Use defillama/coingecko only for simple convenience queries (quick price chart, quick TVL). If the user asks anything analytical, complex, or protocol-specific → always reach for dune-sql.

YOU MUST RESPOND WITH VALID JSON ONLY. No markdown, no explanation. Just the JSON array.

Response format — array of chart/table definitions:
[
  {
    "title": "Title Case Title",
    "subtitle": "ALL CAPS analytical insight — you MUST base this ONLY on what the data columns actually measure. Do NOT assume causation or drivers you cannot see in the data. GOOD: 'RATIO ROSE FROM 20x TO 30x SINCE JAN 2026' (describes what happened). BAD: 'BACK TO 30x ON RISING EARNINGS' (invents a cause). For P/E ratios: a rising ratio means EITHER price rose faster than earnings OR earnings fell — do NOT assume which without earnings data. For revenue: describe the trend shape, not why. Keep it factual and data-grounded. E.g. 'REVENUE 2X H2 VS H1 2025', '30-DAY MA TRENDING UP SINCE OCT', 'RATIO COMPRESSED FROM 40x PEAK TO 25x'. Should read like a Bloomberg terminal headline.",
    "description": "One sentence",
    "chartType": "line" | "bar" | "area" | "table",  // CHART TYPE RULES: Revenue/fees/earnings per period → "bar". Annualized run-rate or moving-average revenue → "line". Cumulative revenue/TVL/supply → "area". Prices/ratios/P&E → "line". Volume per period → "bar". Holder counts/distributions → "bar". Default to "bar" for periodic financial metrics.
    "dataSource": "dune" | "dune-sql" | "defillama" | "coingecko" | "allium" | "allium-prices" | "allium-sql",
    "dataSourceConfig": {
      // For dune: { "queryId": 12345, "params": {} }
      // For dune-sql: { "sql": "SELECT date_trunc('day', block_time) as day, SUM(amount_usd) as daily_revenue FROM dex_solana.trades WHERE project = 'pump.fun' GROUP BY 1 ORDER BY 1", "name": "pump_fun_daily_revenue" }
      // For defillama: { "endpoint": "tvl" | "fees" | "revenue", "slug": "hyperliquid" }
      // For coingecko: { "coinId": "hyperliquid", "daysBack": 90 }
      // For allium: { "ticker": "HYPE", "chain": "hyperliquid", "contractAddress": "" }
      // For allium-prices: { "chain": "hyperevm", "tokenAddress": "0x555...", "daysBack": 30, "granularity": "1d" }
      // For allium-sql: { "sql": "SELECT address, balance FROM hyperevm.assets.fungible_balances_latest WHERE token_address = '0x555...' AND balance > 0 ORDER BY balance DESC LIMIT 50", "limit": 5 }
    },
    "chartConfig": {
      // For chartType "table": just provide "columns" array with column names to display
      // e.g. { "columns": ["address", "balance", "pct_supply"] }
      // For chart types: provide xAxis and yAxes as below
      "xAxis": { "dataKey": "the_actual_column_name", "label": "Date", "type": "date" },
      "yAxes": [
        { "dataKey": "actual_column_name", "label": "Revenue", "color": "#38bdf8", "format": "currency", "yAxisId": "left" }
      ]
    }
  }
]

DEFAULT BEHAVIOR — ALWAYS GENERATE CHARTS, NOT TABLES:
- The DEFAULT output is ALWAYS a visual chart (line, bar, or area). Never default to a table.
- Only use chartType "table" when the user EXPLICITLY says the word "table" (e.g. "show me a table of..." or "...as a table").
- If the user says "USDe supply", "show me revenue", "P/E ratio", "price history" — these are ALL chart requests. Generate a line/bar/area chart.
- Tables should return a MAXIMUM of 5 rows. Set LIMIT 5 in SQL queries. For non-SQL sources, the system will truncate.
- chartConfig for tables should contain a "columns" array listing which columns to display. Pick the most relevant 3-6 columns.
- Tables are ONLY for: top holders table, comparison snapshot table, ranked list table — and ONLY when the user asks for a table.

═══════════════════════════════════════════════════════════════
CRITICAL CHART CONFIGURATION RULES — READ CAREFULLY
═══════════════════════════════════════════════════════════════

1. X-AXIS COLUMN SELECTION:
   - For Dune queries: Look at the sample data columns. Pick the column that contains ACTUAL DATE STRINGS (e.g. "2025-01-01 00:00:00.000 UTC"), NOT bare integers.
   - Common pattern: Dune data has "date" (often just a day number like 20) and "month_start" (actual date string). ALWAYS use the string date column like "month_start", "day", "block_date", "week" etc.
   - NEVER use a column named "date" if its sample value is a small integer (like 1-31) — that's a day-of-month, not a date.
   - CRITICAL: If the data has a "week" or "month" column with actual date strings (e.g. "2026-03-23"), use THAT as the xAxis dataKey, NOT a generic "date" column. The system converts date-string columns to unix timestamps automatically. Set dataKey to the EXACT column name from the data (e.g. "week", "month_start", "block_date").
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
   - STACKED BARS: When a bar chart has 2+ series (e.g. "Hyperliquid Volume" + "Lighter Volume"), bars are automatically stacked. Use chartType "bar" with multiple yAxes entries — do NOT use dual-axis for comparison volume charts. Stacked bars are ideal for: protocol vs protocol volume, revenue breakdown by source, multi-chain metrics, market share comparisons.

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
   - "percent" → values are in DECIMAL form (0.03 means 3%, 0.15 means 15%). The frontend auto-converts by multiplying by 100. IMPORTANT: Dune APY/APR columns typically store values as decimals (e.g. 0.0275 = 2.75%) — always use format "percent" for these.
   - "number" → plain numbers with abbreviation (1.2M, 450K)
   - Revenue, fees, TVL, price, volume, market_cap, fdv → "currency"
   - growth_pct, apy, apr, rate, ratio (non-price) → "percent"
   - count, users, transactions → "number"

8. TITLES:
   - Title Case, concise. Examples: "Monthly Revenue", "Price History", "TVL History"
   - For dual-axis: "Price vs Monthly Revenue"
   - NEVER use ALL CAPS for titles. Use Title Case only.

9. DUNE QUERY COLUMN INSPECTION:
   - You are given sample data with actual column names and values. USE THEM EXACTLY.
   - Do NOT guess column names. If sample shows {month_start: "2026-03-01...", monthly_revenue: 47517317}, use EXACTLY "month_start" and "monthly_revenue".
   - If no saved query matches, suggest a known public query ID or create separate charts from other sources.

10. FALLBACK BEHAVIOR:
   - If you specify a Dune query that fails (404, not found, etc.), the system will automatically attempt fallback:
     → For holder/wallet requests → falls back to Allium SQL (on-chain holder data)
     → For price requests → falls back to CoinGecko price history
     → For TVL requests → falls back to DeFiLlama TVL
     → For revenue/fees requests → falls back to DeFiLlama revenue/fees
   - So it's OK to suggest a Dune query ID if you think it might work. The fallback will handle failures gracefully.
   - However, if you KNOW there's no Dune query available, prefer using defillama/coingecko/allium directly instead of forcing a fallback.

11. ALLIUM-SQL FOR HOLDER/WALLET QUERIES:
   - When the user asks about token holders, whale wallets, balance distribution, or holder trends — USE "allium-sql".
   - Available tables (Snowflake SQL dialect):
     → {chain}.assets.fungible_balances_latest — current token balances per address
       Columns: address (varchar), token_address (varchar), balance (float)
     → {chain}.assets.fungible_balances_daily — daily historical balances
       Columns: date, address, token_address, balance
   - Chain names: ethereum, hyperevm, base, arbitrum, optimism, polygon, bsc, avalanche, solana
   - ALWAYS lowercase token_address in WHERE clauses.
   - Example holder distribution SQL:
     SELECT address, balance FROM hyperevm.assets.fungible_balances_latest WHERE token_address = '0x5555555555555555555555555555555555555555' AND balance > 0 ORDER BY balance DESC LIMIT 50
   - Example holder count distribution:
     SELECT COUNT(*) as total_holders, COUNT(CASE WHEN balance >= 10000 THEN 1 END) as whales FROM {chain}.assets.fungible_balances_latest WHERE token_address = '{addr}' AND balance > 0
   - Example daily holder trend:
     SELECT date, COUNT(DISTINCT CASE WHEN balance > 0 THEN address END) as holder_count FROM {chain}.assets.fungible_balances_daily WHERE token_address = '{addr}' AND date >= DATEADD(day, -30, CURRENT_DATE()) GROUP BY date ORDER BY date
   - For holder tables: chartType should be "table" (shows as data table) or "bar" (for distribution buckets).
   - For holder trends over time: chartType should be "line".

12. ALLIUM-PRICES FOR ON-CHAIN PRICE DATA:
   - Use "allium-prices" when you want price history from on-chain DEX data (more accurate for newer/smaller tokens).
   - Provides OHLCV data. Response columns: timestamp, price, open, high, low, close.
   - Better than CoinGecko for tokens like HYPE on HyperEVM that may not be listed on CoinGecko.
   - Granularity options: "1m", "5m", "15m", "1h", "4h", "1d".

═══════════════════════════════════════════════════════════════
DUNE SQL SCHEMA REFERENCE (for "dune-sql" source)
═══════════════════════════════════════════════════════════════

DuneSQL is based on Trino SQL. Dune indexes ALL major blockchains with decoded protocol-level tables.

CORE DECODED TABLES (Dune's "Spellbook" — curated, cross-chain):

DEX TRADING:
- dex.trades — All DEX trades across all chains
  Columns: block_time, block_date, blockchain, project, version, token_pair, taker, maker, token_bought_symbol, token_sold_symbol, token_bought_amount, token_sold_amount, amount_usd, tx_hash
  Filter: blockchain = 'ethereum'/'solana'/'base'/etc, project = 'uniswap'/'raydium'/etc
- dex_solana.trades — Solana DEX trades (pump.fun, Raydium, Jupiter, Orca)
- dex_aggregator.trades — Aggregator trades (1inch, Jupiter, Paraswap, CowSwap)

LENDING & BORROWING:
- lending.borrow — All lending borrows across protocols
  Columns: block_time, blockchain, project, version, borrower, token_address, token_symbol, amount, amount_usd, tx_hash
  project: 'aave', 'compound', 'morpho', 'spark', 'venus', 'benqi', 'radiant', 'silo', etc.
- lending.repay — Loan repayments (same schema as borrow)
- lending.supply — Lending deposits/supply
  Columns: block_time, blockchain, project, version, depositor, token_address, token_symbol, amount, amount_usd, tx_hash
- lending.withdraw — Withdrawals from lending pools
- lending.flashloans — Flash loan events
- lending.liquidations — Protocol liquidation events

STABLECOINS:
- stablecoin.transfers — Cross-chain stablecoin transfers
  Columns: block_time, blockchain, symbol, contract_address, "from", "to", amount, amount_usd

TOKEN DATA:
- tokens.transfers — ERC20/SPL token transfers
  Columns: block_time, blockchain, token_address, "from", "to", amount, amount_usd
- tokens.erc20 — Token metadata (symbol, decimals, contract_address, blockchain)
- prices.usd — Historical token prices (1-minute granularity)
  Columns: minute, blockchain, contract_address, symbol, decimals, price
  Example: SELECT date_trunc('day', minute) as day, AVG(price) as price FROM prices.usd WHERE symbol = 'MORPHO' AND minute > now() - interval '365' day GROUP BY 1 ORDER BY 1

NFTs & BRIDGES:
- nft.trades — NFT marketplace trades across chains
- bridge.flows — Cross-chain bridge transfers

CHAIN-SPECIFIC RAW TABLES:
- {chain}.transactions — Raw transactions (block_time, "from", "to", value, gas_used, gas_price, hash)
  Chains: ethereum, solana, arbitrum, base, optimism, polygon, bsc, avalanche, gnosis, fantom, celo, zksync, scroll, linea, blast, mantle, mode, zora
- {chain}.logs — Event logs (block_time, contract_address, topic0, topic1, topic2, topic3, data)
- {chain}.traces — Internal/trace calls

PROTOCOL-SPECIFIC DECODED TABLES (Dune decodes popular protocols):
- morpho_ethereum.morpho_evt_* — Morpho-specific decoded events
- aave_v3_ethereum.Pool_evt_* — Aave V3 events
- uniswap_v3_ethereum.Pair_evt_Swap — Uniswap swaps
- compound_v3_ethereum.* — Compound V3 events
- Pattern: {protocol}_{chain}.{contract}_evt_{EventName}
- To discover tables: use information_schema or check dune.com for the protocol's namespace

FINDING PROTOCOL TABLES — DISCOVERY QUERIES:
When you're not sure which tables exist for a protocol, use the lending.* spellbook tables first (they aggregate across all lending protocols). For protocol-specific decoded tables:
- Morpho on Ethereum: lending.borrow/supply/repay WHERE project = 'morpho' AND blockchain = 'ethereum'
- Morpho on Base: lending.borrow/supply/repay WHERE project = 'morpho' AND blockchain = 'base'  
- The Spellbook tables (dex.trades, lending.borrow, etc.) are the safest starting point — they're curated and work across protocols.

═══════════════════════════════════════════════════════════════
COMMON QUERY PATTERNS
═══════════════════════════════════════════════════════════════

1. PROTOCOL REVENUE (lending protocol — interest earned):
   SELECT date_trunc('week', block_time) as week,
     SUM(amount_usd) as weekly_supply_volume
   FROM lending.supply
   WHERE project = 'morpho' AND blockchain = 'ethereum'
     AND block_time > now() - interval '365' day
   GROUP BY 1 ORDER BY 1

2. LENDING ACTIVITY (borrows + repays):
   SELECT date_trunc('week', block_time) as week,
     SUM(amount_usd) as weekly_borrow_volume,
     COUNT(DISTINCT borrower) as unique_borrowers
   FROM lending.borrow
   WHERE project = 'morpho' AND block_time > now() - interval '365' day
   GROUP BY 1 ORDER BY 1

3. DEX VOLUME (daily):
   SELECT date_trunc('day', block_time) as day,
     SUM(amount_usd) as daily_volume
   FROM dex.trades
   WHERE project = 'uniswap' AND blockchain = 'ethereum'
     AND block_time > now() - interval '90' day
   GROUP BY 1 ORDER BY 1

4. USER GROWTH:
   SELECT date_trunc('week', block_time) as week,
     COUNT(DISTINCT borrower) as unique_users
   FROM lending.borrow
   WHERE project = 'aave' AND block_time > now() - interval '365' day
   GROUP BY 1 ORDER BY 1

5. PRICE HISTORY:
   SELECT date_trunc('day', minute) as day, AVG(price) as price
   FROM prices.usd
   WHERE symbol = 'MORPHO' AND minute > now() - interval '365' day
   GROUP BY 1 ORDER BY 1

6. CROSS-CHAIN COMPARISON:
   SELECT date_trunc('week', block_time) as week,
     blockchain,
     SUM(amount_usd) as weekly_volume
   FROM lending.borrow
   WHERE project = 'morpho' AND block_time > now() - interval '180' day
   GROUP BY 1, 2 ORDER BY 1

7. MONTHLY REVENUE WITH MOVING AVERAGES:
   SELECT day, daily_revenue,
     AVG(daily_revenue) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as ma_7d,
     AVG(daily_revenue) OVER (ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) as ma_30d
   FROM (
     SELECT date_trunc('day', block_time) as day, SUM(amount_usd) as daily_revenue
     FROM dex.trades WHERE project = 'uniswap' AND blockchain = 'ethereum'
       AND block_time > now() - interval '365' day
     GROUP BY 1
   ) sub ORDER BY day

8. TOKEN TRANSFER VOLUME:
   SELECT date_trunc('day', block_time) as day,
     SUM(amount_usd) as transfer_volume,
     COUNT(*) as transfer_count
   FROM tokens.transfers
   WHERE token_address = LOWER('0x...')
     AND blockchain = 'ethereum'
     AND block_time > now() - interval '90' day
   GROUP BY 1 ORDER BY 1

9. STABLECOIN FLOWS:
   SELECT date_trunc('day', block_time) as day,
     symbol,
     SUM(amount_usd) as daily_flow
   FROM stablecoin.transfers
   WHERE blockchain = 'ethereum'
     AND block_time > now() - interval '90' day
   GROUP BY 1, 2 ORDER BY 1

PROTOCOL NAME MAPPING (project values in Dune Spellbook):
- Morpho → 'morpho'
- Aave → 'aave' (versions: 'aave_v2', 'aave_v3')
- Compound → 'compound' (versions: 'compound_v2', 'compound_v3')
- Uniswap → 'uniswap'
- Hyperliquid → 'hyperliquid'
- pump.fun → 'pump_fun' (underscore, not dot)
- MakerDAO/Spark → 'spark'
- Lido → 'lido'
- Ethena → 'ethena'
- Curve → 'curve'
- Balancer → 'balancer'
- PancakeSwap → 'pancakeswap'
- SushiSwap → 'sushiswap'
- 1inch → 'oneinch'
- For unknown protocols: try the lowercase protocol name or query SELECT DISTINCT project FROM lending.borrow LIMIT 50 (or dex.trades) to find it.

IMPORTANT SQL RULES:
- Always use date_trunc('day'/'week'/'month', block_time) for time aggregation
- Always add ORDER BY for time series data
- Use now() - interval 'N' day for lookback periods (default to 365 days for comprehensive history)
- LIMIT to 1000 rows max for chart data
- Always alias columns with readable names for chart labels
- For weekly data, use date_trunc('week', ...) — gives cleaner charts than daily for long time ranges
- When filtering by protocol, always lowercase: project = 'morpho' not 'Morpho'
- When using contract addresses, always lowercase: LOWER('0xAbC...') or just use the lowercase version
- For multi-chain protocols, consider whether to aggregate across chains or split by blockchain`;



interface DataAgentInput {
  companyId: string;
  companyName: string;
  userId: string;
  userPrompt: string;
  tokenProfile: TokenProfile | null;
  savedDuneQueries: DuneQuery[];
  masterDuneQueries?: MasterDuneQuery[];
  tokenSnapshot: TokenSnapshot | null;
}

interface ChartPlan {
  title: string;
  subtitle?: string;
  description: string;
  chartType: string;
  dataSource: string;
  dataSourceConfig: Record<string, any>;
  chartConfig: Record<string, any>;
}

function inferChartType(title: string, currentType: string, chartConfig: any): string {
  if (currentType === "table") return "table";
  const t = title.toLowerCase();
  const yKeys = (chartConfig?.yAxes || []).map((y: any) => (y.dataKey || "").toLowerCase()).join(" ");
  const combined = `${t} ${yKeys}`;

  if (/cumulative|total\s+supply|total\s+tvl/i.test(t)) return "area";
  if (/tvl|total.*locked/i.test(t) && !/daily|weekly|monthly/i.test(t)) return "area";

  if (/annualized|run.?rate|moving.?average|\bma\b|arr\b/i.test(t)) return currentType === "area" ? "area" : "line";
  if (/p\/e|pe.ratio|ratio|price|multiple/i.test(t)) return "line";

  if (/daily.*(revenue|fee|earn|income|profit)|revenue.*daily|fee.*daily/i.test(t)) return "bar";
  if (/weekly.*(revenue|fee|earn|income|profit|volume|buyback)|revenue.*weekly|fee.*weekly|volume.*weekly|buyback.*weekly/i.test(t)) return "bar";
  if (/monthly.*(revenue|fee|earn|income|profit|volume)|revenue.*monthly|fee.*monthly|volume.*monthly/i.test(t)) return "bar";
  if (/\b(revenue|fees?|earnings?|income|profit)\b/i.test(t) && !/cumulative|annualized|run.?rate|arr|ma\b/i.test(t)) return "bar";
  if (/\bvolume\b/i.test(t) && !/cumulative/i.test(t)) return "bar";
  if (/buyback/i.test(t)) return "bar";
  if (/holder|distribution|count/i.test(t)) return "bar";

  if (/daily_revenue|weekly_revenue|monthly_revenue|daily_fee|weekly_fee/i.test(combined)) return "bar";

  return currentType;
}

export async function runDataAgent(input: DataAgentInput): Promise<{
  charts: DashboardChart[];
  totalCost: number;
}> {
  const { companyId, companyName, userId, userPrompt, tokenProfile, savedDuneQueries, masterDuneQueries, tokenSnapshot } = input;

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

  if (masterDuneQueries && masterDuneQueries.length > 0) {
    const relevantMaster = masterDuneQueries.filter(mq => mq.isActive);
    if (relevantMaster.length > 0) {
      contextParts.push(`\nMaster Dune Query Library (all available queries you can use):`);
      for (const mq of relevantMaster) {
        const tags = [
          ...(mq.protocolTags || []).map(t => `protocol:${t}`),
          ...(mq.chainTags || []).map(t => `chain:${t}`),
        ].join(', ');
        contextParts.push(`  - Query ID ${mq.queryId}: "${mq.label}" (category: ${mq.category || 'general'}, viz: ${mq.visualizationType}${tags ? `, tags: ${tags}` : ''}${mq.description ? ` — ${mq.description}` : ''})`);
      }
      contextParts.push(`  NOTE: These master queries are pre-built and available. Prefer using these over raw API calls when they match the user's request. Use source "dune" with the query ID.`);
    }
  }

  try {
    const resolvedSlug = await defillama.resolveSlug(companyName);
    const naiveSlug = companyName.toLowerCase().replace(/\s+/g, "-");
    contextParts.push(`\nDeFiLlama slug for ${companyName}: "${resolvedSlug}"${resolvedSlug !== naiveSlug ? ` (note: NOT "${naiveSlug}")` : ''}`);
  } catch {}

  if (isDuneConfigured()) {
    contextParts.push(`\nDune Analytics: AVAILABLE (API key configured)`);
  }

  contextParts.push(`DeFiLlama: AVAILABLE (TVL, fees, revenue for most DeFi protocols)`);
  contextParts.push(`CoinGecko: AVAILABLE (price history)`);
  contextParts.push(`Allium Prices: AVAILABLE (on-chain OHLCV price history via DEX data)`);
  contextParts.push(`Allium SQL: AVAILABLE (custom SQL analytics — holder distribution, balance queries, on-chain data across 150+ chains)`);

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

  const validSources = ["dune", "dune-sql", "defillama", "coingecko", "allium", "allium-prices", "allium-sql"];
  const validChartTypes = ["line", "bar", "area", "composed", "table"];

  chartPlans = chartPlans.filter(plan => {
    if (!plan.title || typeof plan.title !== "string") return false;
    if (!plan.dataSource || !validSources.includes(plan.dataSource)) return false;
    if (!plan.dataSourceConfig || typeof plan.dataSourceConfig !== "object") return false;
    if (!plan.chartConfig || typeof plan.chartConfig !== "object") return false;
    if (plan.chartType && !validChartTypes.includes(plan.chartType)) plan.chartType = "line";
    plan.chartType = inferChartType(plan.title, plan.chartType || "line", plan.chartConfig);
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
      description: plan.subtitle ? `${plan.subtitle}|||${plan.description || ""}` : (plan.description || null),
      chartType: plan.chartType || "line",
      dataSource: plan.dataSource,
      dataSourceConfig: JSON.stringify(plan.dataSourceConfig),
      chartConfig: JSON.stringify(plan.chartConfig),
      data: null,
      status: "generating",
      errorMessage: null,
    });

    try {
      let data: any[] | null = null;
      let fetchError: string | null = null;

      try {
        data = await fetchChartData(plan.dataSource, { ...plan.dataSourceConfig, forceRefresh: true });
      } catch (err: any) {
        fetchError = err.message || "Failed to fetch data";
        console.warn(`[Data Agent] Primary source "${plan.dataSource}" failed for "${plan.title}": ${fetchError}`);
      }

      if ((!data || data.length === 0) && fetchError) {
        const fallbackResult = await attemptFallback(plan, fetchError, tokenProfile, companyName);
        if (fallbackResult) {
          data = fallbackResult.data;
          plan.dataSource = fallbackResult.dataSource;
          plan.dataSourceConfig = fallbackResult.dataSourceConfig;
          plan.chartConfig = fallbackResult.chartConfig || plan.chartConfig;
          plan.chartType = fallbackResult.chartType || plan.chartType;
          plan.title = fallbackResult.title || plan.title;
          console.log(`[Data Agent] Fallback succeeded: re-routed "${plan.title}" via ${plan.dataSource}`);
          await storage.updateDashboardChart(chart.id, {
            title: plan.title,
            dataSource: plan.dataSource,
            dataSourceConfig: JSON.stringify(plan.dataSourceConfig),
            chartType: plan.chartType,
            chartConfig: JSON.stringify(plan.chartConfig),
          });
        }
      }

      if (!data || data.length === 0) {
        let errorMsg = fetchError || "No data returned from source.";
        if (/holder|wallet|whale|distribution/i.test(plan.title)) {
          errorMsg = `Could not fetch holder/distribution data. Ensure the token has a valid contract address and chain configured in Token Intelligence.`;
        } else if (fetchError?.includes("404") || fetchError?.includes("not found")) {
          errorMsg = `Data source not found. Try a different query or add the relevant Dune query in Token Intelligence first.`;
        }
        const updatedChart = await storage.updateDashboardChart(chart.id, {
          status: "failed",
          errorMessage: errorMsg,
        });
        charts.push(updatedChart || chart);
        continue;
      }

      const availableCols = data[0] ? Object.keys(data[0]) : [];
      const requestedCols = (plan.chartConfig?.yAxes || []).map((y: any) => y.dataKey);
      const missingCols = requestedCols.filter((col: string) => !availableCols.includes(col));

      if (plan.chartConfig?.xAxis) {
        const xKey = plan.chartConfig.xAxis.dataKey;
        let xNeedsFix = !availableCols.includes(xKey);
        if (!xNeedsFix && data.length > 1) {
          const xVals = data.map((d: any) => d[xKey]);
          const uniqueVals = new Set(xVals.map((v: any) => String(v)));
          if (uniqueVals.size <= 1) {
            console.log(`[Data Agent] xAxis "${xKey}" has all identical values — needs correction`);
            xNeedsFix = true;
          }
        }
        if (xNeedsFix) {
          const dateCols = availableCols.filter(c => /date|time|day|week|month|block_time|period/i.test(c));
          const goodDateCol = dateCols.find(c => {
            if (c === xKey) return false;
            const vals = data.map((d: any) => d[c]);
            const unique = new Set(vals.map((v: any) => String(v)));
            return unique.size > 1;
          });
          if (goodDateCol) {
            console.log(`[Data Agent] Auto-fixing xAxis: "${xKey}" → "${goodDateCol}"`);
            plan.chartConfig.xAxis.dataKey = goodDateCol;
            plan.chartConfig.xAxis.type = "date";
          } else if (dateCols.length > 0 && dateCols[0] !== xKey) {
            console.log(`[Data Agent] Auto-fixing xAxis: "${xKey}" → "${dateCols[0]}"`);
            plan.chartConfig.xAxis.dataKey = dateCols[0];
            plan.chartConfig.xAxis.type = "date";
          }
        }
      }

      if (missingCols.length > 0) {
        console.warn(`[Data Agent] Chart "${plan.title}" references missing columns: ${missingCols.join(", ")}. Available: ${availableCols.join(", ")}`);
        const usedCols = new Set([plan.chartConfig?.xAxis?.dataKey]);
        const numericCols = availableCols.filter(c => {
          if (usedCols.has(c)) return false;
          const sample = data.find((d: any) => d[c] != null)?.[c];
          return typeof sample === "number";
        });
        for (const y of (plan.chartConfig.yAxes || [])) {
          if (!availableCols.includes(y.dataKey)) {
            const fuzzy = availableCols.find((c: string) => {
              const cN = c.toLowerCase().replace(/[_\s]/g, "");
              const yN = y.dataKey.toLowerCase().replace(/[_\s]/g, "");
              return cN === yN || cN.includes(yN) || yN.includes(cN);
            });
            if (fuzzy && !usedCols.has(fuzzy)) {
              console.log(`[Data Agent] Fuzzy-matched "${y.dataKey}" → "${fuzzy}"`);
              y.dataKey = fuzzy;
              usedCols.add(fuzzy);
            } else {
              const avail = numericCols.find(c => !usedCols.has(c));
              if (avail) {
                console.log(`[Data Agent] Fallback-mapped "${y.dataKey}" → "${avail}"`);
                y.dataKey = avail;
                usedCols.add(avail);
              }
            }
          } else {
            usedCols.add(y.dataKey);
          }
        }
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

      if (plan.chartType === "table" && data.length > 5) {
        data = data.slice(0, 5);
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
    let data: any[] | null = null;
    let fetchError: string | null = null;

    try {
      data = await fetchChartData(chart.dataSource, { ...config, forceRefresh: true });
    } catch (err: any) {
      fetchError = err.message || "Failed to fetch data";
      console.warn(`[Data Agent] Refresh failed for chart "${chart.title}" (${chart.dataSource}): ${fetchError}`);
    }

    if (!data || data.length === 0) {
      if (!fetchError) fetchError = "No data returned from source";
      let tokenProfile: TokenProfile | null = null;
      let companyName = "";
      try {
        const company = await storage.getCompany(chart.companyId);
        companyName = company?.name || "";
        if (company) {
          const profile = await storage.getTokenProfile(company.id);
          tokenProfile = profile || null;
        }
      } catch (e: any) {
        console.warn(`[Data Agent] Failed to load context for fallback: ${e.message}`);
      }

      const plan: ChartPlan = {
        title: chart.title,
        description: chart.description || "",
        dataSource: chart.dataSource,
        dataSourceConfig: config,
        chartType: chart.chartType || "line",
        chartConfig: JSON.parse(chart.chartConfig || "{}"),
      };
      const fallbackResult = await attemptFallback(plan, fetchError, tokenProfile, companyName);
      if (fallbackResult) {
        data = fallbackResult.data;
        console.log(`[Data Agent] Refresh fallback succeeded for "${chart.title}" via ${fallbackResult.dataSource}`);
        const updated = await storage.updateDashboardChart(chartId, {
          data: JSON.stringify(data),
          status: "completed",
          errorMessage: null,
          dataSource: fallbackResult.dataSource,
          dataSourceConfig: JSON.stringify(fallbackResult.dataSourceConfig),
          chartType: fallbackResult.chartType || chart.chartType,
          chartConfig: JSON.stringify(fallbackResult.chartConfig || JSON.parse(chart.chartConfig || "{}")),
        });
        return updated || chart;
      }
    }

    if (!data || data.length === 0) {
      const updated = await storage.updateDashboardChart(chartId, {
        status: "failed",
        errorMessage: fetchError || "No data returned from source",
      });
      return updated || chart;
    }

    const chartCfg = JSON.parse(chart.chartConfig || "{}");
    let configUpdated = false;
    if (chartCfg.xAxis && chartCfg.yAxes && data.length > 0) {
      const availCols = Object.keys(data[0]);
      const xKey = chartCfg.xAxis.dataKey;
      let xNeedsFix = xKey && !availCols.includes(xKey);
      if (!xNeedsFix && xKey && data.length > 1) {
        const xVals = data.map((d: any) => d[xKey]);
        const uniqueVals = new Set(xVals.map((v: any) => String(v)));
        if (uniqueVals.size <= 1) {
          xNeedsFix = true;
        }
      }
      if (xNeedsFix) {
        const dateCols = availCols.filter((c: string) => /date|time|day|week|month|block_time|period/i.test(c));
        const goodDateCol = dateCols.find(c => {
          if (c === xKey) return false;
          const vals = data.map((d: any) => d[c]);
          const unique = new Set(vals.map((v: any) => String(v)));
          return unique.size > 1;
        });
        if (goodDateCol) {
          chartCfg.xAxis.dataKey = goodDateCol;
          chartCfg.xAxis.type = "date";
          configUpdated = true;
        } else if (dateCols.length > 0 && dateCols[0] !== xKey) {
          chartCfg.xAxis.dataKey = dateCols[0];
          chartCfg.xAxis.type = "date";
          configUpdated = true;
        }
      }
      const usedCols = new Set([chartCfg.xAxis.dataKey]);
      for (const y of chartCfg.yAxes) {
        if (!availCols.includes(y.dataKey)) {
          const fuzzy = availCols.find((c: string) => {
            const cN = c.toLowerCase().replace(/[_\s]/g, "");
            const yN = y.dataKey.toLowerCase().replace(/[_\s]/g, "");
            return !usedCols.has(c) && (cN === yN || cN.includes(yN) || yN.includes(cN));
          });
          if (fuzzy) {
            y.dataKey = fuzzy;
            usedCols.add(fuzzy);
            configUpdated = true;
          }
        }
      }
    }

    const updated = await storage.updateDashboardChart(chartId, {
      data: JSON.stringify(data),
      status: "completed",
      errorMessage: null,
      ...(configUpdated ? { chartConfig: JSON.stringify(chartCfg) } : {}),
    });
    return updated || chart;
  } catch (err: any) {
    const updated = await storage.updateDashboardChart(chartId, {
      status: "failed",
      errorMessage: err.message || "Failed to refresh data",
    });
    return updated || chart;
  }
}

interface FallbackResult {
  data: any[];
  dataSource: string;
  dataSourceConfig: Record<string, any>;
  chartConfig?: Record<string, any>;
  chartType?: string;
  title?: string;
}

async function attemptFallback(
  plan: ChartPlan,
  error: string,
  tokenProfile: TokenProfile | null,
  companyName: string,
): Promise<FallbackResult | null> {
  const title = plan.title.toLowerCase();
  const desc = (plan.description || "").toLowerCase();
  const combined = `${title} ${desc}`;
  const ticker = tokenProfile?.tokenTicker?.toLowerCase() || "";
  const chain = tokenProfile?.chain || "ethereum";
  const contractAddress = tokenProfile?.contractAddress || "";

  console.log(`[Data Agent] Attempting fallback for "${plan.title}" (original: ${plan.dataSource}, error: ${error})`);

  const isPrice = /\bprice\b|price.?history|price.?chart/i.test(combined);
  const isTvl = /\btvl\b|total.?value.?locked|liquidity/i.test(combined);
  const isRevenue = /\brevenue\b|daily.?fees|protocol.?fees|earnings/i.test(combined);
  const isVolume = /\bvolume\b|trading.?volume|daily.?volume|weekly.?volume|perp.?volume|dex.?volume/i.test(combined);
  const isHolder = /\bholder|wallet|whale|address|distribution|top.?\d/i.test(combined);

  let defillamaSlug: string | null = null;
  async function getSlug() {
    if (!defillamaSlug) {
      defillamaSlug = await defillama.resolveSlug(companyName);
      console.log(`[Data Agent] Resolved DeFiLlama slug for "${companyName}" → "${defillamaSlug}"`);
    }
    return defillamaSlug;
  }

  if (isVolume) {
    const slug = await getSlug();
    try {
      const volData = await defillama.getProtocolDerivativesVolume(slug);
      if (volData.dailyVolume && volData.dailyVolume.length > 0) {
        const data = volData.dailyVolume.map((d) => ({ date: d.date, volume: d.volume }));
        console.log(`[Data Agent] Volume fallback succeeded via DeFiLlama derivatives (${data.length} points)`);
        return {
          data,
          dataSource: "defillama",
          dataSourceConfig: { endpoint: "derivatives", slug },
          chartConfig: {
            xAxis: { dataKey: "date", label: "Date", type: "date" },
            yAxes: [{ dataKey: "volume", label: "Volume (USD)", color: "#818cf8", format: "currency", yAxisId: "left" }],
          },
          chartType: "bar",
          title: `${companyName} Daily Trading Volume`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] DeFiLlama derivatives volume fallback failed: ${e.message}`);
    }
    try {
      const dexData = await defillama.getProtocolDexVolume(slug);
      if (dexData.dailyVolume && dexData.dailyVolume.length > 0) {
        const data = dexData.dailyVolume.map((d) => ({ date: d.date, volume: d.volume }));
        console.log(`[Data Agent] Volume fallback succeeded via DeFiLlama DEX (${data.length} points)`);
        return {
          data,
          dataSource: "defillama",
          dataSourceConfig: { endpoint: "dexVolume", slug },
          chartConfig: {
            xAxis: { dataKey: "date", label: "Date", type: "date" },
            yAxes: [{ dataKey: "volume", label: "Volume (USD)", color: "#818cf8", format: "currency", yAxisId: "left" }],
          },
          chartType: "bar",
          title: `${companyName} Daily DEX Volume`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] DeFiLlama DEX volume fallback failed: ${e.message}`);
    }
  }

  if (isPrice && ticker) {
    try {
      const priceData = await defillama.getCoinPriceHistory(ticker.toLowerCase(), 90);
      if (priceData.prices && priceData.prices.length > 0) {
        const data = priceData.prices.map((p) => ({ date: p.date, price: p.price }));
        console.log(`[Data Agent] Price fallback succeeded via CoinGecko (${data.length} points)`);
        return {
          data,
          dataSource: "coingecko",
          dataSourceConfig: { coinId: ticker.toLowerCase(), daysBack: 90 },
          chartConfig: {
            xAxis: { dataKey: "date", label: "Date", type: "date" },
            yAxes: [{ dataKey: "price", label: "Price (USD)", color: "#38bdf8", format: "currency", yAxisId: "left" }],
          },
          chartType: "line",
          title: `${ticker.toUpperCase()} Price History`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] CoinGecko price fallback failed: ${e.message}`);
    }
  }

  if (isTvl) {
    const slug = await getSlug();
    try {
      const tvlData = await defillama.getProtocolTvl(slug);
      if (tvlData && tvlData.length > 0) {
        const data = tvlData.map((d) => ({ date: d.date, totalLiquidityUSD: d.totalLiquidityUSD }));
        console.log(`[Data Agent] TVL fallback succeeded via DeFiLlama (${data.length} points)`);
        return {
          data,
          dataSource: "defillama",
          dataSourceConfig: { endpoint: "tvl", slug },
          chartConfig: {
            xAxis: { dataKey: "date", label: "Date", type: "date" },
            yAxes: [{ dataKey: "totalLiquidityUSD", label: "TVL (USD)", color: "#2dd4bf", format: "currency", yAxisId: "left" }],
          },
          chartType: "area",
          title: `${companyName} TVL History`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] DeFiLlama TVL fallback failed: ${e.message}`);
    }
  }

  if (isRevenue) {
    const slug = await getSlug();
    try {
      const revData = await defillama.getProtocolRevenue(slug);
      if (revData.dailyRevenue && revData.dailyRevenue.length > 0) {
        const data = revData.dailyRevenue.map((d) => ({ date: d.date, revenue: d.revenue }));
        console.log(`[Data Agent] Revenue fallback succeeded via DeFiLlama (${data.length} points)`);
        return {
          data,
          dataSource: "defillama",
          dataSourceConfig: { endpoint: "revenue", slug },
          chartConfig: {
            xAxis: { dataKey: "date", label: "Date", type: "date" },
            yAxes: [{ dataKey: "revenue", label: "Daily Revenue", color: "#38bdf8", format: "currency", yAxisId: "left" }],
          },
          chartType: "bar",
          title: `${companyName} Daily Revenue`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] DeFiLlama revenue fallback failed: ${e.message}`);
    }

    if (isDuneConfigured()) {
      try {
        const masterQueries = await storage.getMasterDuneQueries();
        const companyLower = companyName.toLowerCase();
        const revenueQuery = masterQueries.find(mq => {
          const tags = (mq.protocolTags || []).map((t: string) => t.toLowerCase());
          const labelLower = mq.label.toLowerCase();
          const isRevenueCategory = mq.category === "revenue" || /revenue|fees|earnings/i.test(labelLower);
          const matchesCompany = tags.some((t: string) => companyLower.includes(t)) || labelLower.includes(companyLower);
          return isRevenueCategory && matchesCompany;
        });
        if (revenueQuery) {
          console.log(`[Data Agent] Revenue fallback: trying master Dune query #${revenueQuery.queryId} "${revenueQuery.label}"`);
          const result = await getLatestDuneResults(revenueQuery.queryId);
          if (result.rows.length > 0) {
            const data = result.rows;
            console.log(`[Data Agent] Revenue fallback via Dune succeeded (${data.length} rows, cols: ${result.columns.join(", ")})`);
            return {
              data,
              dataSource: "dune",
              dataSourceConfig: { queryId: revenueQuery.queryId },
              chartConfig: { columns: result.columns },
              chartType: "table",
              title: revenueQuery.label.toUpperCase(),
            };
          }
        }
      } catch (e: any) {
        console.warn(`[Data Agent] Dune revenue fallback failed: ${e.message}`);
      }
    }
  }

  if (isHolder && contractAddress && chain) {
    try {
      const normalizedChain = chain === "hyperliquid" ? "hyperevm" : chain.toLowerCase();
      const sql = alliumApi.buildHolderDistributionSql(normalizedChain, contractAddress, undefined, 50);
      console.log(`[Data Agent] Holder fallback via Allium SQL: ${sql.substring(0, 80)}...`);
      const result = await alliumApi.runAlliumSql(sql, 50);
      if (result.data && result.data.length > 0) {
        console.log(`[Data Agent] Holder fallback succeeded via Allium SQL (${result.data.length} holders)`);
        return {
          data: result.data,
          dataSource: "allium-sql",
          dataSourceConfig: { sql, limit: 50 },
          chartConfig: {
            columns: ["address", "balance"],
          },
          chartType: "table",
          title: `${ticker.toUpperCase()} Top Holders`,
        };
      }
    } catch (e: any) {
      console.warn(`[Data Agent] Allium SQL holder fallback failed: ${e.message}`);
    }
  } else if (isHolder) {
    console.warn(`[Data Agent] No contract address/chain for holder fallback`);
  }

  console.warn(`[Data Agent] No matching fallback for "${plan.title}"`);
  return null;
}

async function fetchChartData(
  dataSource: string,
  config: Record<string, any>
): Promise<any[]> {
  switch (dataSource) {
    case "dune":
      return fetchDuneData(config);
    case "dune-sql":
      return fetchDuneSqlData(config);
    case "defillama":
      return fetchDefiLlamaData(config);
    case "coingecko":
      return fetchCoinGeckoData(config);
    case "allium":
      return fetchAlliumData(config);
    case "allium-prices":
      return fetchAlliumPricesData(config);
    case "allium-sql":
      return fetchAlliumSqlData(config);
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
    try {
      result = await executeDuneQuery(queryId, config.params || {});
    } catch (execErr: any) {
      console.log(`[Dune] Force refresh failed for query ${queryId}, trying cached results: ${execErr.message}`);
      result = await getLatestDuneResults(queryId);
      if (result.rows.length === 0) {
        throw execErr;
      }
      console.log(`[Dune] Using ${result.rows.length} cached rows for query ${queryId} after execution failure`);
    }
  } else {
    result = await getLatestDuneResults(queryId);
    if (result.rows.length === 0) {
      console.log(`[Dune] Cached results empty for query ${queryId}, executing fresh...`);
      result = await executeDuneQuery(queryId, config.params || {});
    }
  }

  return result.rows.map((row) => {
    const processed: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if ((key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key.toLowerCase().includes('day') || key === 'week' || key === 'month') && typeof value === 'string' && /\d{4}/.test(value)) {
        processed[key] = new Date(value).getTime() / 1000;
      } else {
        processed[key] = value;
      }
    }
    return processed;
  });
}

async function fetchDuneSqlData(config: Record<string, any>): Promise<any[]> {
  if (!isDuneConfigured()) throw new Error("Dune API key not configured");

  const sql = config.sql;
  if (!sql) throw new Error("No SQL provided for dune-sql source");

  console.log(`[DuneSQL] Executing ad-hoc SQL: ${sql.slice(0, 150)}...`);

  const result = await executeDuneSQL(sql, config.name || undefined);

  console.log(`[DuneSQL] Got ${result.rows.length} rows, columns: ${result.columns.join(', ')}`);

  return result.rows.map((row) => {
    const processed: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if ((key.toLowerCase().includes('date') || key.toLowerCase().includes('time') || key === 'day' || key === 'week' || key === 'month') && typeof value === 'string' && /\d{4}/.test(value)) {
        processed[key] = new Date(value).getTime() / 1000;
      } else {
        processed[key] = value;
      }
    }
    return processed;
  });
}

async function fetchDefiLlamaData(config: Record<string, any>): Promise<any[]> {
  let slug = config.slug;
  if (!slug) throw new Error("No DeFiLlama protocol slug provided");

  async function tryWithSlugResolution<T>(fn: (s: string) => Promise<T>): Promise<T> {
    try {
      return await fn(slug);
    } catch (e: any) {
      if (e.message?.includes("404") || e.message?.includes("API error")) {
        const resolved = await defillama.resolveSlug(slug);
        if (resolved !== slug) {
          console.log(`[DeFiLlama] Slug "${slug}" failed, resolved to "${resolved}"`);
          slug = resolved;
          config.slug = resolved;
          return await fn(resolved);
        }
      }
      throw e;
    }
  }

  switch (config.endpoint) {
    case "tvl": {
      const tvlData = await tryWithSlugResolution(defillama.getProtocolTvl);
      return tvlData.map((d) => ({
        date: d.date,
        totalLiquidityUSD: d.totalLiquidityUSD,
      }));
    }
    case "fees": {
      const feesData = await tryWithSlugResolution(defillama.getProtocolFees);
      return feesData.dailyFees.map((d) => ({
        date: d.date,
        fees: d.fees,
      }));
    }
    case "revenue": {
      const revData = await tryWithSlugResolution(defillama.getProtocolRevenue);
      return revData.dailyRevenue.map((d) => ({
        date: d.date,
        revenue: d.revenue,
      }));
    }
    case "dexVolume": {
      const volData = await tryWithSlugResolution(defillama.getProtocolDexVolume);
      return volData.dailyVolume.map((d) => ({
        date: d.date,
        volume: d.volume,
      }));
    }
    case "derivatives": {
      const derivData = await defillama.getProtocolDerivativesVolume(slug);
      return derivData.dailyVolume.map((d) => ({
        date: d.date,
        volume: d.volume,
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

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${daysBack}&interval=daily`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CoinGecko API error: ${resp.status}`);
    const data = await resp.json();

    const prices = data.prices || [];
    const volumes = data.total_volumes || [];
    const marketCaps = data.market_caps || [];

    return prices.map((p: [number, number], i: number) => ({
      date: Math.floor(p[0] / 1000),
      price: p[1],
      volume: volumes[i]?.[1] || 0,
      market_cap: marketCaps[i]?.[1] || 0,
    }));
  } catch (err: any) {
    console.warn(`[CoinGecko] Direct API failed, falling back to DeFiLlama: ${err.message}`);
    const priceData = await defillama.getCoinPriceHistory(coinId, daysBack);
    return priceData.prices.map((p) => ({
      date: p.date,
      price: p.price,
    }));
  }
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

async function fetchAlliumPricesData(config: Record<string, any>): Promise<any[]> {
  const chain = config.chain;
  const tokenAddress = config.tokenAddress;
  if (!chain || !tokenAddress) throw new Error("allium-prices requires chain and tokenAddress");

  const daysBack = config.daysBack || 30;
  const granularity = config.granularity || "1d";

  const endDate = new Date().toISOString().split("T")[0] + "T00:00:00Z";
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0] + "T00:00:00Z";

  const prices = await alliumApi.fetchAlliumPriceHistory(
    chain, tokenAddress, startDate, endDate, granularity
  );

  return prices.map((p) => ({
    date: new Date(p.timestamp).getTime() / 1000,
    price: p.price,
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
  }));
}

async function fetchAlliumSqlData(config: Record<string, any>): Promise<any[]> {
  const sql = config.sql;
  if (!sql) throw new Error("allium-sql requires a SQL query");

  const limit = config.limit || 100;
  console.log(`[Data Agent] Running Allium SQL: ${sql.substring(0, 100)}...`);

  const result = await alliumApi.runAlliumSql(sql, limit);

  if (!result.data || result.data.length === 0) {
    throw new Error("Allium SQL query returned no results");
  }

  console.log(`[Data Agent] Allium SQL returned ${result.data.length} rows, columns: ${result.meta.columns.map(c => c.name).join(", ")}`);

  return result.data.map((row) => {
    const processed: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        processed[key] = new Date(value).getTime() / 1000;
        processed.date = processed[key];
      } else {
        processed[key] = value;
      }
    }
    return processed;
  });
}

export { DATA_CHART_CHARGE };
