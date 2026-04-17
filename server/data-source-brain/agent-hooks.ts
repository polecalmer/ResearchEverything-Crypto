/**
 * Agent hooks: wrap tool execution with consult-before / observe-on-error.
 *
 * The mapping below tells the brain WHICH source/scope_ref a given tool name
 * touches. Tools not listed are passed through with no brain interaction.
 *
 * Adding a new tool here is the single integration point — no annotation
 * changes needed in the tool definition itself.
 */
import type { Source } from "./schema";
import { consult, observe } from "./db";

export interface ToolBrainBinding {
  source: Source;
  scopeRef: string;
  /** Tag attached to runtime observations so we can find them later. */
  observationCategory: "rate_limit" | "auth" | "coverage" | "reliability" | "schema";
}

const TOOL_BINDINGS: Record<string, ToolBrainBinding> = {
  // DeFiLlama
  query_defillama_tvl: {
    source: "defillama",
    scopeRef: "defillama:/protocol/{slug}",
    observationCategory: "coverage",
  },
  query_defillama_fees_revenue: {
    source: "defillama",
    scopeRef: "defillama:/summary/fees/{slug}",
    observationCategory: "coverage",
  },
  query_defillama_volume: {
    source: "defillama",
    scopeRef: "defillama:/summary/dexs/{slug}",
    observationCategory: "coverage",
  },
  query_defillama_protocol_summary: {
    source: "defillama",
    scopeRef: "defillama:/protocol/{slug}",
    observationCategory: "coverage",
  },
  query_defillama_price_history: {
    source: "defillama",
    scopeRef: "defillama:coins/prices/chart",
    observationCategory: "coverage",
  },
  list_defi_protocols: {
    source: "defillama",
    scopeRef: "defillama:/protocols",
    observationCategory: "coverage",
  },
  // Allium
  get_token_snapshot: {
    source: "allium",
    scopeRef: "allium:token-snapshot",
    observationCategory: "coverage",
  },
  // Dune
  query_dune_sql: {
    source: "dune",
    scopeRef: "dune:/query/execute",
    observationCategory: "reliability",
  },
  discover_dune_tables: {
    source: "dune",
    scopeRef: "dune:mcp/v1",
    observationCategory: "schema",
  },
};

export function getBinding(toolName: string): ToolBrainBinding | null {
  return TOOL_BINDINGS[toolName] ?? null;
}

/**
 * Consult the brain for facts relevant to a tool call. Returns a short
 * formatted hint string (or empty if no relevant facts), suitable for
 * injection into the tool result that the LLM sees.
 */
export async function consultForTool(
  toolName: string,
  input: any,
): Promise<string> {
  const binding = getBinding(toolName);
  if (!binding) return "";
  const protocol = input?.protocol || input?.coinId || input?.slug || "";
  const query = `${toolName} ${protocol}`.trim();
  try {
    const hits = await consult({
      query,
      source: binding.source,
      topK: 3,
      minSimilarity: 0.45,
    });
    if (hits.length === 0) return "";
    const lines = hits.map(
      (h) =>
        `  - [${h.fact.confidence}] ${h.fact.content} (sim ${h.similarity.toFixed(2)})`,
    );
    return `Brain hints for ${binding.source}:\n${lines.join("\n")}`;
  } catch (err: any) {
    console.warn(`[DataSourceBrain] consult failed for ${toolName}:`, err.message);
    return "";
  }
}

/**
 * Observe a tool failure or empty-result event. The error string is parsed
 * for known patterns (rate limit, auth, missing coverage). Best-effort —
 * never throws.
 */
export async function observeToolError(
  toolName: string,
  input: any,
  errorText: string,
): Promise<void> {
  const binding = getBinding(toolName);
  if (!binding) return;
  try {
    const lower = errorText.toLowerCase();
    let category: string = binding.observationCategory;
    let confidence: "observed_once" | "verified_runtime" = "observed_once";
    if (lower.includes("rate limit") || lower.includes("429")) category = "rate_limit";
    else if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("api key"))
      category = "auth";
    else if (lower.includes("not tracked") || lower.includes("no data") || lower.includes("not found"))
      category = "coverage";

    const protocol = input?.protocol || input?.coinId || input?.slug || "unknown";
    const content =
      `Runtime observation: ${toolName}(${protocol}) returned: ` +
      errorText.slice(0, 240);

    await observe({
      source: binding.source,
      scope_ref: binding.scopeRef.replace("{slug}", protocol),
      category,
      content,
      source_of_fact: `runtime:${toolName}`,
      confidence,
    });
  } catch (err: any) {
    console.warn(`[DataSourceBrain] observe failed for ${toolName}:`, err.message);
  }
}
