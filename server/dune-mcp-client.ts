/**
 * Dune MCP Client — Table discovery for SQL generation
 *
 * Uses Dune's MCP endpoint to discover available tables BEFORE
 * the LLM writes SQL, so queries target tables that actually exist.
 */

import { EXTERNAL_URLS } from "./constants";

const DUNE_MCP_URL = EXTERNAL_URLS.DUNE_MCP;

function getDuneApiKey(): string {
  const key = process.env.DUNE_API_KEY;
  if (!key) throw new Error("DUNE_API_KEY not set");
  return key;
}

interface DuneTable {
  full_name: string;       // e.g. "morpho_multichain.morpho_evt_accrueinterest"
  category: string;        // "decoded" | "spell" | "raw" | "community"
  dataset_type: string;    // "decoded_table" | "spell" | "raw_table"
  blockchains: string[];   // ["ethereum", "arbitrum", ...]
  visibility: string;      // "public"
  metadata?: {
    page_rank_score?: number;
    abi_type?: string;      // "event" | "function"
    contract_name?: string; // "Pool", "Morpho", etc.
    project_name?: string;  // "aave_v3", "morpho", etc.
  };
}

interface TableSearchResult {
  total: number;
  results: DuneTable[];
}

/**
 * Call a Dune MCP tool via JSON-RPC over HTTP.
 */
async function callMcpTool(toolName: string, args: Record<string, any>): Promise<any> {
  const apiKey = getDuneApiKey();

  const res = await fetch(DUNE_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "x-dune-api-key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const text = await res.text();
  // Parse SSE response: "event: message\nid: ...\ndata: {...}"
  const dataMatch = text.match(/data: (.+)/);
  if (!dataMatch) throw new Error(`MCP response parsing failed: ${text.substring(0, 200)}`);

  const parsed = JSON.parse(dataMatch[1]);
  if (parsed.error) throw new Error(`MCP error: ${parsed.error.message}`);

  return parsed.result?.structuredContent || parsed.result;
}

/**
 * Search Dune tables by natural language query.
 * Use this to discover available tables for a protocol before writing SQL.
 */
export async function searchTables(
  query: string,
  options: {
    limit?: number;
    categories?: ("spell" | "decoded" | "raw" | "community")[];
    blockchains?: string[];
  } = {},
): Promise<TableSearchResult> {
  const args: Record<string, any> = { query, limit: options.limit || 10 };
  if (options.categories) args.categories = options.categories;
  if (options.blockchains) args.blockchains = options.blockchains;

  return await callMcpTool("searchTables", args);
}

/**
 * Search for decoded tables by contract address.
 * Use this when you know the protocol's contract address.
 */
export async function searchTablesByContractAddress(
  contractAddress: string,
  blockchain?: string,
): Promise<TableSearchResult> {
  const args: Record<string, any> = { contractAddress };
  if (blockchain) args.blockchain = blockchain;

  return await callMcpTool("searchTablesByContractAddress", args);
}

/**
 * Discover tables for a protocol and format as context for the LLM.
 * Returns a compact string listing available Spellbook and decoded tables.
 */
export async function discoverTablesForProtocol(
  protocolName: string,
  options: { blockchain?: string } = {},
): Promise<string> {
  try {
    // Search for both Spellbook (curated) and decoded (raw events) tables
    const [spellResults, decodedResults] = await Promise.all([
      searchTables(`${protocolName}`, { limit: 10, categories: ["spell"] }).catch(() => ({ total: 0, results: [] })),
      searchTables(`${protocolName}`, { limit: 10, categories: ["decoded"] }).catch(() => ({ total: 0, results: [] })),
    ]);

    const spellTables = spellResults.results || [];
    const decodedTables = decodedResults.results || [];

    if (spellTables.length === 0 && decodedTables.length === 0) {
      return `[Dune Table Discovery] No specific tables found for "${protocolName}". Use generic Spellbook tables (dex.trades, lending.borrow, lending.supply, etc.) with project filter.`;
    }

    const lines: string[] = [`[Dune Table Discovery] Available tables for ${protocolName}:`];

    if (spellTables.length > 0) {
      lines.push("  Spellbook (curated, cross-chain):");
      for (const t of spellTables.slice(0, 5)) {
        lines.push(`    • ${t.full_name} [${t.blockchains.join(", ")}]`);
      }
    }

    if (decodedTables.length > 0) {
      lines.push("  Decoded (protocol-specific events):");
      for (const t of decodedTables.slice(0, 8)) {
        const meta = t.metadata;
        const suffix = meta?.abi_type ? ` (${meta.abi_type})` : "";
        lines.push(`    • ${t.full_name} [${t.blockchains.join(", ")}]${suffix}`);
      }
    }

    lines.push(`  Total available: ${spellResults.total + decodedResults.total} tables`);
    return lines.join("\n");
  } catch (err: any) {
    return `[Dune Table Discovery] Lookup failed: ${err.message}. Use generic Spellbook tables.`;
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * SQL validation — defense against agent-injected SQL abuse.
 *
 * Threat: the agent authors raw SQL inline in `dune_execute_query({sql})`.
 * A prompt-injected or jailbroken agent could pass:
 *   - "SELECT * FROM information_schema.tables"  — schema enumeration
 *   - "SELECT * FROM dex.trades; DROP TABLE x;"  — statement stacking
 *   - "SELECT pg_sleep(60)"                       — resource abuse
 *   - write ops (CREATE/ALTER/DROP/INSERT/...)   — Dune is read-only but
 *     enforce client-side too (defense in depth, never trust the upstream).
 *
 * Approach: deny-list. Allow-list of legitimate Dune analytics queries is
 * too broad to enumerate (every dex.trades / lending / chain table). The
 * deny-list catches the high-signal abuse patterns. False-positive risk:
 * a legitimate column named "current_user" or "version" would trip — we
 * use word boundaries + function-call shape to minimize this.
 *
 * NOT validated: executeQueryById(query_id) for saved queries — those are
 * authored by Dune's community, vetted, and the agent only chooses the ID.
 * The risk surface there is the saved query body, which we don't control.
 * ────────────────────────────────────────────────────────────────────── */

export class DuneSqlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuneSqlValidationError";
  }
}

/**
 * Strip SQL comments + string literals before pattern-matching, so
 * deny-list regexes don't false-positive on comments or quoted text.
 * (e.g. `WHERE token_name = 'Drop Token'` should not trip /DROP/.)
 */
function stripCommentsAndStrings(sql: string): string {
  return sql
    // /* ... */ block comments (greedy across newlines)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // -- line comments
    .replace(/--[^\n]*/g, " ")
    // 'single-quoted strings' (handle escaped '')
    .replace(/'(?:''|[^'])*'/g, "''")
    // "double-quoted identifiers" — Dune/Postgres uses these for column
    // names with spaces; safe to keep but blank for pattern-match too
    .replace(/"(?:""|[^"])*"/g, '""');
}

/**
 * Detect statement stacking: a semicolon followed by another non-empty
 * statement. A trailing semicolon (or whitespace-only after) is fine.
 */
function hasStatementStacking(stripped: string): boolean {
  // Split on ; then check whether more than one non-empty fragment exists
  const fragments = stripped.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  return fragments.length > 1;
}

/**
 * Validate raw SQL before submission to Dune. Throws DuneSqlValidationError
 * with a specific reason if any deny-list pattern matches. No-op (returns
 * void) on success.
 *
 * Call this in any code path that accepts agent-authored SQL and forwards
 * it to Dune execution (server/session-research-agent.ts dune_execute_query
 * dispatch, the legacy write_dune_query path if still active, etc.).
 */
export function validateDuneSql(sql: string): void {
  if (typeof sql !== "string" || !sql.trim()) {
    throw new DuneSqlValidationError("SQL is empty");
  }
  if (sql.length > 50_000) {
    throw new DuneSqlValidationError(`SQL too long (${sql.length} chars; max 50000)`);
  }

  const cleaned = stripCommentsAndStrings(sql);

  // Statement stacking — semicolons separating multiple statements.
  // Trailing single `;` is fine; we only block when more than one
  // non-empty statement remains.
  if (hasStatementStacking(cleaned)) {
    throw new DuneSqlValidationError(
      "Statement stacking detected (multiple statements separated by `;`). Submit one statement per call.",
    );
  }

  // High-signal deny patterns. Each tuple = [regex, human-readable label].
  const denyPatterns: Array<[RegExp, string]> = [
    // Schema enumeration
    [/\binformation_schema\b/i, "information_schema access (schema enumeration)"],
    [/\bpg_catalog\b/i, "pg_catalog access (Postgres system catalog)"],
    [/\bpg_(?:tables|namespace|class|attribute|database|stat_|sleep|read_file|ls_dir)\b/i, "pg_* system function/table"],
    [/\bsys\.(?:tables|columns|databases|objects)\b/i, "sys.* system tables (MSSQL/Trino)"],
    [/\bmysql\.(?:user|db|tables_priv)\b/i, "mysql.* system tables"],

    // Identity / version leakage
    [/\bcurrent_user\s*(?:\(\s*\))?/i, "current_user identity disclosure"],
    [/\bsession_user\s*(?:\(\s*\))?/i, "session_user identity disclosure"],
    [/\bversion\s*\(\s*\)/i, "version() server fingerprinting"],
    [/\bcurrent_database\s*\(/i, "current_database() server fingerprinting"],

    // Resource abuse
    [/\bpg_sleep\s*\(/i, "pg_sleep() resource abuse"],
    [/\bbenchmark\s*\(/i, "benchmark() resource abuse (MySQL)"],
    [/\bgenerate_series\s*\(\s*1\s*,\s*\d{7,}/i, "generate_series with massive range (resource abuse)"],

    // Write ops — Dune is read-only but enforce client-side (defense in depth).
    // Use lookbehind-free word boundaries; restrict to leading position OR
    // following whitespace so column names like "created" don't trip.
    [/(?:^|\s|;)\s*(?:create|alter|drop|truncate|grant|revoke|insert|update|delete|merge|replace|rename)\s+/i, "write/DDL operation"],

    // Data exfil to disk / shell
    [/\bxp_cmdshell\b/i, "xp_cmdshell (MSSQL shell execution)"],
    [/\bsp_executesql\b/i, "sp_executesql (dynamic execution)"],
    [/\bload_file\s*\(/i, "load_file() (MySQL filesystem read)"],
    [/\binto\s+outfile\b/i, "SELECT ... INTO OUTFILE (filesystem write)"],
    [/\binto\s+dumpfile\b/i, "SELECT ... INTO DUMPFILE (filesystem write)"],
    [/\bcopy\b\s+\S+\s+(?:to|from)\b/i, "COPY ... TO/FROM (filesystem I/O)"],

    // Defense in depth — generic command injection markers seen in the wild
    [/\b__system_\w+/i, "__system_* internal identifier"],
  ];

  for (const [pattern, label] of denyPatterns) {
    if (pattern.test(cleaned)) {
      throw new DuneSqlValidationError(`SQL rejected: ${label} detected`);
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * Saved-query + execution surface (hermes-parity, 2026-05-17).
 *
 * Replaces the LLM-author-then-execute path (server/dune-sql-author.ts)
 * with direct Dune MCP calls. Hermes uses these tools via its generic
 * mcp_tool.py and lets the AGENT author SQL inline as part of its
 * reasoning, eliminating the Opus middleman ($0.5-1 per call × multiple
 * calls per turn).
 *
 * Cost model: Dune MCP is billed per execution credit, not per LLM call.
 * The agent's table discovery + SQL authoring happens within its normal
 * inference budget (no extra Opus call), so the per-query cost drops
 * from ~$0.5-1 to ~$0 (just the existing turn's marginal output tokens).
 * ────────────────────────────────────────────────────────────────────── */

export interface DuneQueryMetadata {
  query_id: number;
  name: string;
  description?: string;
  /** The SQL body. Dune MCP returns this under `query` (not `query_sql`). */
  query?: string;
  user_id?: number;
  team_id?: number | null;
  version?: number;
  tags?: string[];
  is_archived?: boolean;
  is_private?: boolean;
  is_temp?: boolean;
  /** Parameter definitions for {{name}} placeholders in the SQL. */
  parameters?: Array<{ key: string; type: string; value?: string }>;
  latest_execution_id?: string;
  latest_execution_state?: string;
  query_engine?: string;
}

export interface DuneExecutionRow {
  [column: string]: any;
}

export interface DuneExecutionResults {
  execution_id: string;
  state: string;                          // "QUERY_STATE_COMPLETED" | "QUERY_STATE_EXECUTING" | "QUERY_STATE_FAILED" | ...
  result?: {
    rows: DuneExecutionRow[];
    metadata?: {
      column_names?: string[];
      column_types?: string[];
      row_count?: number;
      datapoint_count?: number;
      total_row_count?: number;
    };
  };
  error?: string;
}

/**
 * Search saved Dune queries by name. Returns a list of (query_id, name)
 * candidates. Use this FIRST when looking for an existing query that
 * matches the user's intent — most common metrics already have public
 * queries the agent can reuse.
 *
 * Dune MCP returns under `results` key (not `queries`); owner is an
 * object like { handle, name }, not a string.
 */
export async function searchDuneQueries(
  searchString: string,
  options: { scope?: "all_visible" | "owned"; limit?: number } = {},
): Promise<{ queries: Array<{ query_id: number; name: string; owner?: string; is_private?: boolean }> }> {
  const args: Record<string, any> = {
    search_string: searchString,
    scope: options.scope || "all_visible",
    limit: options.limit ?? 25,
  };
  const r = await callMcpTool("searchDuneQueries", args);
  const raw: any[] = (r?.results || r?.queries || []);
  return {
    queries: raw.map((q: any) => ({
      query_id: q.query_id,
      name: q.name,
      // Dune MCP returns owner as {type, id, handle, name}; flatten to string
      owner: q.owner && typeof q.owner === "object"
        ? (q.owner.handle || q.owner.name || String(q.owner.id || ""))
        : (q.owner || undefined),
      is_private: q.is_private,
    })),
  };
}

/**
 * Fetch a saved query by ID — returns the SQL + metadata. Useful for
 * inspecting query shape before executing, or for cache-hit reuse where
 * the agent already knows a good query_id from proven_queries.
 */
export async function getDuneQuery(queryId: number): Promise<DuneQueryMetadata> {
  return await callMcpTool("getDuneQuery", { query_id: queryId });
}

/**
 * Execute a saved Dune query by ID. Returns the execution_id and initial
 * state. To get rows, call getExecutionResults(execution_id) afterwards
 * (it polls internally until complete or timeout).
 */
export async function executeQueryById(
  queryId: number,
  options: {
    performance?: "medium" | "large";
    query_parameters?: Record<string, any>;
  } = {},
): Promise<{ execution_id: string; state: string }> {
  const args: Record<string, any> = { query_id: queryId };
  if (options.performance) args.performance = options.performance;
  if (options.query_parameters) args.query_parameters = options.query_parameters;
  return await callMcpTool("executeQueryById", args);
}

/**
 * Poll for execution results. Blocks (up to `timeout` seconds, default 60)
 * until the execution completes or the timeout is reached. Returns the
 * rows + metadata on completion.
 */
export async function getExecutionResults(
  executionId: string,
  options: { limit?: number; offset?: number; timeout?: number } = {},
): Promise<DuneExecutionResults> {
  const args: Record<string, any> = { executionId };
  if (options.limit != null) args.limit = options.limit;
  if (options.offset != null) args.offset = options.offset;
  if (options.timeout != null) args.timeout = options.timeout;
  return await callMcpTool("getExecutionResults", args);
}

/**
 * Create a new Dune query (saves SQL on Dune's side and returns the
 * query_id). Use this when the agent has authored fresh SQL that doesn't
 * exist as a saved query yet — saving it makes it reusable next time
 * and allows execute-by-id workflows.
 */
export async function createDuneQuery(
  name: string,
  sql: string,
  options: {
    description?: string;
    is_private?: boolean;
    is_temp?: boolean;
    parameters?: any[];
  } = {},
): Promise<{ query_id: number }> {
  const args: Record<string, any> = { name, query: sql };
  if (options.description) args.description = options.description;
  if (options.is_private != null) args.is_private = options.is_private;
  if (options.is_temp != null) args.is_temp = options.is_temp;
  if (options.parameters) args.parameters = options.parameters;
  return await callMcpTool("createDuneQuery", args);
}

/**
 * Ergonomic helper: author + execute fresh SQL in one round-trip.
 *   1. createDuneQuery → query_id
 *   2. executeQueryById → execution_id
 *   3. getExecutionResults → rows
 *
 * Use this when the agent has fresh SQL to run. For cache-hit cases
 * (query already exists), call executeQueryById + getExecutionResults
 * directly with the known query_id.
 */
export async function executeFreshSql(
  sql: string,
  options: {
    name?: string;
    description?: string;
    is_temp?: boolean;
    performance?: "medium" | "large";
    timeout?: number;
    limit?: number;
  } = {},
): Promise<{ query_id: number; execution_id: string; results: DuneExecutionResults }> {
  const name = options.name || `sessions_runtime_${Date.now()}`;
  const created = await createDuneQuery(name, sql, {
    description: options.description,
    is_temp: options.is_temp ?? true,
    is_private: true,
  });
  const exec = await executeQueryById(created.query_id, {
    performance: options.performance,
  });
  const results = await getExecutionResults(exec.execution_id, {
    timeout: options.timeout ?? 60,
    limit: options.limit ?? 1000,
  });
  return { query_id: created.query_id, execution_id: exec.execution_id, results };
}

/**
 * Discover tables for a token by contract address and format as context.
 */
export async function discoverTablesForToken(
  contractAddress: string,
  blockchain: string = "ethereum",
): Promise<string> {
  try {
    const result = await searchTablesByContractAddress(contractAddress, blockchain);
    const tables = result.results || [];

    if (tables.length === 0) {
      return `[Dune Table Discovery] No decoded tables found for contract ${contractAddress} on ${blockchain}.`;
    }

    const lines: string[] = [`[Dune Table Discovery] Decoded tables for ${contractAddress} on ${blockchain}:`];
    for (const t of tables.slice(0, 10)) {
      const meta = t.metadata;
      const suffix = meta?.abi_type ? ` (${meta.abi_type}${meta.contract_name ? `: ${meta.contract_name}` : ""})` : "";
      lines.push(`  • ${t.full_name}${suffix}`);
    }
    lines.push(`  Total: ${result.total} tables`);
    return lines.join("\n");
  } catch (err: any) {
    return `[Dune Table Discovery] Lookup failed for ${contractAddress}: ${err.message}`;
  }
}
