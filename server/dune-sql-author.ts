/**
 * Dune SQL Author — meta-tool that handles the full Dune-shaped query lifecycle:
 *
 *   1. Cache hit on (protocol, metricType) → execute the saved SQL directly
 *   2. Cache miss → discover tables via MCP, ask Opus 4.7 to write SQL, execute
 *   3. SQL fails → feed {prev SQL, error message} back to Opus, retry up to 5x
 *   4. On success → save to proven_queries so the next caller hits the cache
 *
 * Cache hits cost one DB query. Cache misses cost one MCP call + one Opus call
 * (or up to 5 on retry) + one Dune execution. The (protocol, metricType) key
 * means the system gets monotonically smarter — each novel question contributes
 * a battle-tested query to the library.
 */
import { callAnthropicServerHeavy } from "./mpp-client";
import { executeDuneSQL, isDuneConfigured, type DuneQueryResult } from "./dune-client";
import { discoverTablesForProtocol } from "./dune-mcp-client";
import { storage } from "./storage";
import { MODELS } from "./constants";

const MAX_RETRIES = 5;
const OPUS_MAX_TOKENS = 4096;

export interface AuthorResult {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  sql: string;
  source: "cache" | "authored";
  attempts: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cachedQueryId?: string;
}

interface OpusSqlOutput {
  protocol: string;
  metricType: string;
  sql: string;
}

const SQL_AUTHOR_SYSTEM = `You write Dune Analytics SQL (DuneSQL dialect — Trino-style).

Your output MUST be a single JSON object with these fields, no markdown fence, no surrounding text:
{
  "protocol": "<lowercase normalized protocol name, e.g. 'aave', 'hyperliquid', 'syrupusdc'>",
  "metricType": "<lowercase short metric label, e.g. 'net_inflows_30d', 'holder_distribution', 'volume_by_market'>",
  "sql": "<the full DuneSQL query>"
}

DuneSQL rules:
- Trino syntax. Use \`from_unixtime(seconds)\` not MySQL-style date conversions.
- Spellbook tables (curated, cross-chain): \`dex.trades\`, \`tokens.erc20\`, \`evms.erc20_transfers\`, \`lending.borrow\`, \`lending.supply\`, etc.
- Decoded tables follow \`<project>_<chain>.<contract>_evt_<EventName>\` or \`_call_<FunctionName>\`.
- Always cap with \`LIMIT 1000\` unless aggregating to small result sets.
- Always filter by date range when working with large tables (e.g. \`AND block_time >= NOW() - INTERVAL '30' day\`).
- Cast addresses to lowercase for joins: \`LOWER(address)\`.
- Use \`approx_distinct\` not \`COUNT(DISTINCT)\` on large columns.

If the user provides a "previous attempt" with an error, FIX the specific error reported. Do not rewrite from scratch.`;

function extractJsonObject(text: string): OpusSqlOutput | null {
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const candidate = (fenceMatch ? fenceMatch[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    if (typeof parsed.sql !== "string" || !parsed.sql.trim()) return null;
    return {
      protocol: String(parsed.protocol || "unknown").toLowerCase().trim(),
      metricType: String(parsed.metricType || "custom").toLowerCase().trim(),
      sql: parsed.sql.trim(),
    };
  } catch {
    return null;
  }
}

async function authorSqlOnce(
  intent: string,
  schemaContext: string,
  prevAttempt?: { sql: string; error: string },
): Promise<{ output: OpusSqlOutput; cost: number; inputTokens: number; outputTokens: number }> {
  const userMsg = prevAttempt
    ? `Intent: ${intent}\n\nAvailable Dune tables:\n${schemaContext}\n\nPrevious attempt FAILED. Fix the error.\n\nPrevious SQL:\n\`\`\`sql\n${prevAttempt.sql}\n\`\`\`\n\nError from Dune:\n${prevAttempt.error}`
    : `Intent: ${intent}\n\nAvailable Dune tables:\n${schemaContext}\n\nWrite a DuneSQL query that answers the intent. Output the JSON object only.`;

  const res = await callAnthropicServerHeavy({
    model: MODELS.OPUS,
    max_tokens: OPUS_MAX_TOKENS,
    system: SQL_AUTHOR_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const parsed = extractJsonObject(res.text);
  if (!parsed) {
    throw new Error(`Opus returned unparseable output (no JSON SQL block): ${res.text.slice(0, 200)}`);
  }
  return {
    output: parsed,
    cost: res.mppCost,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  };
}

async function tryCacheHit(intent: string): Promise<{ rows: any[]; columns: string[]; sql: string; queryId: string } | null> {
  // Brain-grounded routing: hybrid (vector + BM25) lookup over proven_queries.
  // Replaces the old hardcoded protocol/metric regex that gated access by
  // closed-list literal match — APY, market_share, derived ratios, and any
  // protocol outside the 19-name whitelist couldn't reach the cache even
  // when the right SQL was sitting in the table. See the Ethena-sUSDe
  // incident in HANDOFF-chart-quality.local.md for the failure pattern.
  //
  // Threshold tuning: 0.78 cosine on Voyage embeddings is the empirical
  // sweet spot for this corpus — high enough that "AAVE TVL" doesn't match
  // "Lido stETH yield", low enough that "sUSDe APY" matches the existing
  // "susde apy weekly" entry. Lower thresholds risk false-positive cache
  // hits which serve wrong data; higher thresholds force re-authoring SQL
  // we already have.
  try {
    const { findCacheHitForIntent } = await import("./proven-queries-search");
    const hit = await findCacheHitForIntent(intent, { cacheHitSimilarity: 0.6 });
    if (!hit?.query?.sqlQuery) return null;
    const cached = hit.query;
    console.log(
      `[DuneSqlAuthor] Cache HIT via vector match: ${cached.protocol}/${cached.metricType} (sim=${hit.similarity?.toFixed(3) ?? "n/a"})`,
    );
    try {
      const result = await executeDuneSQL(cached.sqlQuery, `cached:${cached.protocol}:${cached.metricType}`);
      await storage.saveProvenQuery({
        protocol: cached.protocol,
        metricType: cached.metricType,
        sqlQuery: cached.sqlQuery,
        dataSource: "dune-sql",
      }).catch(() => { /* successCount bump is best-effort */ });
      return { rows: result.rows, columns: result.columns, sql: cached.sqlQuery, queryId: cached.id };
    } catch (err: any) {
      console.warn(`[DuneSqlAuthor] Cache hit failed for ${cached.protocol}/${cached.metricType}: ${err.message}`);
      await storage.recordProvenQueryFailure(cached.id).catch(() => undefined);
      return null;
    }
  } catch (err: any) {
    console.warn(`[DuneSqlAuthor] tryCacheHit semantic search threw: ${err.message}`);
    return null;
  }
}

/**
 * Write & execute a Dune SQL query for the given intent. Auto-saves successful
 * queries to proven_queries on the (protocol, metricType) key so future calls
 * hit the cache.
 */
export async function writeAndExecuteDuneQuery(
  intent: string,
  options: { blockchain?: string; protocolHint?: string } = {},
): Promise<AuthorResult> {
  if (!isDuneConfigured()) {
    throw new Error("DUNE_API_KEY not set — Dune SQL authoring is unavailable");
  }

  // Step 1: cache lookup
  const cacheHit = await tryCacheHit(intent);
  if (cacheHit) {
    return {
      rows: cacheHit.rows,
      columns: cacheHit.columns,
      rowCount: cacheHit.rows.length,
      sql: cacheHit.sql,
      source: "cache",
      attempts: 1,
      cost: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedQueryId: cacheHit.queryId,
    };
  }

  // Step 2: discover tables via MCP for grounded SQL
  const protocolForDiscovery = options.protocolHint || intent;
  const schemaContext = await discoverTablesForProtocol(protocolForDiscovery, {
    blockchain: options.blockchain,
  }).catch((e) => `[Dune Table Discovery] Lookup failed: ${e.message}. Use generic Spellbook tables.`);

  // Step 3 + retry loop
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastError = "";
  let lastSql = "";
  let lastOutput: OpusSqlOutput | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { output, cost, inputTokens, outputTokens } = await authorSqlOnce(
      intent,
      schemaContext,
      lastSql && lastError ? { sql: lastSql, error: lastError } : undefined,
    );
    totalCost += cost;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;
    lastOutput = output;
    lastSql = output.sql;

    try {
      const result: DuneQueryResult = await executeDuneSQL(
        output.sql,
        `authored:${output.protocol}:${output.metricType}`,
      );
      // Success — save to proven_queries for next time
      await storage.saveProvenQuery({
        protocol: output.protocol,
        metricType: output.metricType,
        sqlQuery: output.sql,
        dataSource: "dune-sql",
      }).catch((e) => {
        console.warn(`[DuneSqlAuthor] saveProvenQuery failed (non-fatal): ${e.message}`);
      });

      return {
        rows: result.rows,
        columns: result.columns,
        rowCount: result.metadata.rowCount,
        sql: output.sql,
        source: "authored",
        attempts: attempt,
        cost: totalCost,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      };
    } catch (err: any) {
      lastError = String(err?.message || err).slice(0, 800);
      console.log(`[DuneSqlAuthor] Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.slice(0, 160)}`);
      // Fall through to next iteration with prevAttempt context
    }
  }

  throw new Error(
    `Dune SQL authoring failed after ${MAX_RETRIES} attempts. ` +
    `Last error: ${lastError}. ` +
    `Last SQL (truncated): ${lastSql.slice(0, 200)}`,
  );
}
