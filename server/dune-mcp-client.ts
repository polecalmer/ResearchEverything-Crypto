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
