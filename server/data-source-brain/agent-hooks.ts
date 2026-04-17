/**
 * Agent hooks: wrap tool execution with consult-before / observe-on-error.
 *
 * Bindings are registered by the agent module that owns the tool definitions
 * (via `registerToolBindings` at module init). This keeps the binding next to
 * the tool definition itself — no parallel map to drift out of sync.
 */
import type { Source } from "./schema";
import { consult, observe } from "./db";

export interface ToolBrainBinding {
  source: Source;
  scopeRef: string;
  /** Tag attached to runtime observations so we can find them later. */
  observationCategory: "rate_limit" | "auth" | "coverage" | "reliability" | "schema";
}

/** Tool descriptors carry an optional brainBinding co-located with the tool. */
export interface ToolWithBinding {
  name: string;
  brainBinding?: ToolBrainBinding;
}

const BINDINGS = new Map<string, ToolBrainBinding>();

/**
 * Register tool→binding associations. Idempotent. Call once at module init
 * with the full tool array; later calls overwrite (useful for hot reload).
 */
export function registerToolBindings(tools: readonly ToolWithBinding[]): void {
  for (const t of tools) {
    if (t.brainBinding) BINDINGS.set(t.name, t.brainBinding);
  }
}

export function getBinding(toolName: string): ToolBrainBinding | null {
  return BINDINGS.get(toolName) ?? null;
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
  const protocol = input?.protocol || input?.coinId || input?.slug || input?.ticker || "";
  const query = `${toolName} ${protocol}`.trim();
  try {
    const hits = await consult({
      query,
      source: binding.source,
      topK: 3,
      minSimilarity: 0.45,
    });
    if (hits.length === 0) return "";
    const lines = hits.map((h) => {
      // Annotate which ranker(s) surfaced each hit so the model has a sense
      // of why the fact is being shown.
      const v = h.vectorRank != null ? `vec=${h.similarity.toFixed(2)}` : null;
      const t = h.textRank != null ? `text` : null;
      const tag = [v, t].filter(Boolean).join(", ") || "match";
      return `  - [${h.fact.confidence}] ${h.fact.content} (${tag})`;
    });
    return `Brain hints for ${binding.source}:\n${lines.join("\n")}`;
  } catch (err: any) {
    console.warn(`[DataSourceBrain] consult failed for ${toolName}:`, err.message);
    return "";
  }
}

const TOOL_ALTERNATIVES: Record<string, (protocol: string) => string> = {
  query_defillama_tvl: (p) =>
    `Instead, try: (1) query_defillama_protocol_summary("${p}") for whatever metrics DeFiLlama does track, (2) get_token_snapshot("${p}") for market cap/FDV/price which can proxy for protocol size, (3) execute_dune_query or query_dune_mcp to search for on-chain TVL data directly.`,
  query_defillama_fees_revenue: (p) =>
    `Instead, try: (1) query_defillama_volume("${p}", type="derivatives") if this is a perp/derivatives protocol, (2) query_defillama_volume("${p}") if this is a DEX, (3) query_defillama_protocol_summary("${p}") for whatever metrics DeFiLlama does track, (4) execute_dune_query or query_dune_mcp to find on-chain fee/revenue data directly.`,
  query_defillama_volume: (p) =>
    `Instead, try: (1) query_defillama_volume("${p}", type="derivatives") if you used type="dexs" or vice versa, (2) query_defillama_protocol_summary("${p}") for a high-level snapshot, (3) execute_dune_query or query_dune_mcp to search for on-chain volume data.`,
  query_defillama_protocol_summary: (p) =>
    `Instead, try: (1) get_token_snapshot("${p}") for market cap/FDV/price, (2) execute_dune_query or query_dune_mcp to find on-chain data directly, (3) search_protocols_by_category to find similar protocols that are tracked.`,
  query_defillama_price_history: (p) =>
    `Instead, try: (1) get_token_snapshot("${p}") for current price/mcap, (2) execute_dune_query or query_dune_mcp with a price query for historical data.`,
};

/**
 * Check if the brain has high-confidence knowledge that a specific tool+protocol
 * call will return no data. If so, return a short-circuit result string with
 * concrete alternative tools the agent should call instead. Returns null if no
 * short-circuit applies.
 */
export async function shouldShortCircuit(
  toolName: string,
  input: any,
): Promise<string | null> {
  const binding = getBinding(toolName);
  if (!binding) return null;
  const protocol = input?.protocol || input?.coinId || input?.slug || input?.ticker || "";
  if (!protocol) return null;

  const query = `${toolName} ${protocol}`;
  try {
    const hits = await consult({
      query,
      source: binding.source,
      category: "coverage",
      topK: 3,
      minSimilarity: 0.55,
    });

    const coverageHit = hits.find((h) => {
      const c = h.fact.confidence;
      const isHighConfidence = c === "verified_runtime" || c === "verified_doc";
      const isPromoted = c === "observed_once" && h.fact.observedCount >= 2;
      if (!isHighConfidence && !isPromoted) return false;
      const content = h.fact.content.toLowerCase();
      return (
        (content.includes("no data") ||
          content.includes("not found") ||
          content.includes("not tracked") ||
          content.includes("no tvl") ||
          content.includes("no fees") ||
          content.includes("no revenue")) &&
        content.includes(protocol.toLowerCase())
      );
    });

    if (!coverageHit) return null;

    const altFn = TOOL_ALTERNATIVES[toolName];
    const alternatives = altFn ? altFn(protocol) : "Try an alternative tool or data source.";

    console.log(
      `[DataSourceBrain] Short-circuit: ${toolName}(${protocol}) — brain says "${coverageHit.fact.content.slice(0, 100)}" (confidence=${coverageHit.fact.confidence}, seen=${coverageHit.fact.observedCount}x)`,
    );
    return JSON.stringify({
      error: `[Brain short-circuit] ${coverageHit.fact.content}. This call was SKIPPED — the brain has learned this data is unavailable here. ${alternatives}`,
    });
  } catch (err: any) {
    console.warn(`[DataSourceBrain] shortCircuit check failed for ${toolName}:`, err.message);
    return null;
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

    const protocol = input?.protocol || input?.coinId || input?.slug || input?.ticker || "unknown";
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
