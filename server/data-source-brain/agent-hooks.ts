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
