/**
 * Agent hooks: wrap tool execution with consult-before / observe-on-error.
 *
 * Bindings are registered by the agent module that owns the tool definitions
 * (via `registerToolBindings` at module init). This keeps the binding next to
 * the tool definition itself — no parallel map to drift out of sync.
 */
import type { Source } from "./schema";
import { consult, observe } from "./db";
import { db } from "../db";
import { systemLearnings } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

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
 * Check if the brain has high-confidence knowledge that a specific tool+protocol
 * call will return no data. If so, return a short-circuit result that includes
 * whatever the brain knows about alternative endpoints/tools — pulling from
 * verified_doc and verified_runtime entries dynamically rather than a hardcoded
 * routing table.
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

    let alternatives = "";
    try {
      const dataType = toolName.includes("tvl") ? "tvl"
        : toolName.includes("fees") || toolName.includes("revenue") ? "fees revenue"
        : toolName.includes("volume") ? "volume"
        : toolName.includes("price") ? "price"
        : "data";
      const altQuery = `alternative endpoint ${dataType} ${protocol} ${binding.source}`;
      const altHits = await consult({
        query: altQuery,
        source: binding.source,
        topK: 5,
        minSimilarity: 0.35,
      });
      const altFacts = altHits
        .filter((h) => h.fact.confidence === "verified_doc" || h.fact.confidence === "verified_runtime")
        .filter((h) => h.fact.id !== coverageHit.fact.id);
      if (altFacts.length > 0) {
        alternatives = "\n\nBrain knowledge about alternatives:\n" +
          altFacts.map((h) => `  - ${h.fact.content}`).join("\n");
      }
    } catch {}

    console.log(
      `[DataSourceBrain] Short-circuit: ${toolName}(${protocol}) — brain says "${coverageHit.fact.content.slice(0, 100)}" (confidence=${coverageHit.fact.confidence}, seen=${coverageHit.fact.observedCount}x)${alternatives ? ` + ${alternatives.split("\n").length - 2} alternative hints` : ""}`,
    );
    return JSON.stringify({
      error: `[Brain short-circuit] ${coverageHit.fact.content}. This call was SKIPPED — the brain has learned this data is unavailable here.${alternatives}`,
    });
  } catch (err: any) {
    console.warn(`[DataSourceBrain] shortCircuit check failed for ${toolName}:`, err.message);
    return null;
  }
}

/**
 * Observe a successful tool call. Records positive coverage facts so the
 * brain learns which data sources work for which protocols. Best-effort —
 * never throws. Rate-limited: only observes once per source+protocol per
 * session to avoid spamming the DB.
 */
const _successObserved = new Set<string>();
export async function observeToolSuccess(
  toolName: string,
  input: any,
  resultSummary: string,
): Promise<void> {
  const binding = getBinding(toolName);
  if (!binding) return;
  const protocol = input?.protocol || input?.coinId || input?.slug || input?.ticker || "";
  if (!protocol) return;
  const key = `${binding.source}:${protocol}:${toolName}`;
  if (_successObserved.has(key)) return;
  _successObserved.add(key);
  try {
    const content =
      `${toolName}(${protocol}) succeeded: ${resultSummary.slice(0, 200)}`;
    await observe({
      source: binding.source,
      scope_ref: binding.scopeRef.replace("{slug}", protocol),
      category: "coverage",
      content,
      source_of_fact: `runtime:${toolName}`,
      confidence: "observed_once",
    });
  } catch (err: any) {
    console.warn(`[DataSourceBrain] observeSuccess failed for ${toolName}:`, err.message);
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

    if (category === "coverage" && protocol !== "unknown") {
      void recordSystemLearning({
        scope: "data_source",
        scopeKey: `${binding.source}:${protocol}`,
        ruleType: "coverage_gap",
        ruleText: `${toolName} has no data for ${protocol}. Try proven_queries or alternative data sources instead of ${binding.source}.`,
        source: `auto:${toolName}`,
        triggeredBy: "runtime_error_observation",
      });
    }
  } catch (err: any) {
    console.warn(`[DataSourceBrain] observe failed for ${toolName}:`, err.message);
  }
}

/**
 * Resolve which data source(s) should serve a given series intent for a protocol.
 *
 * Inputs:
 *   intent — semantic series type ("daily_revenue", "daily_fees", "daily_tvl",
 *            "daily_dex_volume", "daily_derivatives_volume", "price_history")
 *   protocol — protocol slug or name (e.g. "hyperliquid")
 *
 * Returns a ranked list of {source, scopeRef, reason, confidence}. The first
 * entry is the recommended source. Caller fetches in order and falls through
 * on empty.
 *
 * Strategy:
 *   1. Start with a static default ranking per intent (DeFiLlama-first for
 *      most metrics, CoinGecko for price).
 *   2. Consult the data-source brain for known coverage facts about
 *      (source, protocol). Demote any source the brain has flagged as
 *      empty/missing for this protocol; promote sources with positive
 *      verified coverage observations.
 *   3. Drop entries the brain has high confidence are unavailable.
 */
export type SeriesIntent =
  | "daily_revenue"
  | "daily_fees"
  | "daily_tvl"
  | "daily_dex_volume"
  | "daily_derivatives_volume"
  | "price_history";

export interface ResolvedSource {
  source: Source;
  scopeRef: string;
  reason: string;
  rank: number;
}

const STATIC_DEFAULTS: Record<SeriesIntent, ResolvedSource[]> = {
  daily_revenue: [
    { source: "defillama", scopeRef: "defillama:/summary/fees/{slug}", reason: "primary fees+revenue endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_fees: [
    { source: "defillama", scopeRef: "defillama:/summary/fees/{slug}", reason: "primary fees+revenue endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_tvl: [
    { source: "defillama", scopeRef: "defillama:/protocol/{slug}", reason: "primary protocol TVL endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_dex_volume: [
    { source: "defillama", scopeRef: "defillama:/summary/dexs/{slug}", reason: "primary DEX volume endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_derivatives_volume: [
    { source: "defillama", scopeRef: "defillama:/summary/derivatives/{slug}", reason: "primary derivatives endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", reason: "fallback: proven query library", rank: 1 },
  ],
  price_history: [
    { source: "defillama", scopeRef: "defillama:coins/prices/chart", reason: "DeFiLlama price-history coins endpoint", rank: 0 },
    { source: "coingecko", scopeRef: "coingecko:/coins/{id}/market_chart", reason: "fallback: CoinGecko market chart", rank: 1 },
  ],
};

const NEGATIVE_KEYWORDS: Record<SeriesIntent, string[]> = {
  daily_revenue: ["no revenue", "no fees", "not tracked"],
  daily_fees: ["no fees", "no revenue", "not tracked"],
  daily_tvl: ["no tvl", "not tracked"],
  daily_dex_volume: ["no volume", "no dex", "not tracked"],
  daily_derivatives_volume: ["no derivatives", "no volume", "not tracked"],
  price_history: ["no price", "not listed", "not found"],
};

export async function resolveSeriesSource(
  intent: SeriesIntent,
  protocol: string,
): Promise<ResolvedSource[]> {
  const defaults = STATIC_DEFAULTS[intent].map((d) => ({
    ...d,
    scopeRef: d.scopeRef.replace("{slug}", protocol.toLowerCase()),
  }));
  if (!protocol) return defaults;

  const negKeywords = NEGATIVE_KEYWORDS[intent] || [];
  const protocolLc = protocol.toLowerCase();
  const ranked: ResolvedSource[] = [];

  for (const candidate of defaults) {
    let scoreAdjust = 0;
    let demotionReason = "";
    try {
      const hits = await consult({
        query: `${intent} ${protocol}`,
        source: candidate.source,
        category: "coverage",
        topK: 3,
        minSimilarity: 0.5,
      });
      for (const h of hits) {
        const c = h.fact.content.toLowerCase();
        if (!c.includes(protocolLc)) continue;
        const isStrong = h.fact.confidence === "verified_runtime" || h.fact.confidence === "verified_doc" || (h.fact.confidence === "observed_once" && h.fact.observedCount >= 2);
        const isNegative = negKeywords.some((k) => c.includes(k));
        if (isStrong && isNegative) {
          scoreAdjust += 100;
          demotionReason = `brain: "${h.fact.content.slice(0, 80)}"`;
          break;
        }
        if (isStrong && c.includes("succeeded")) {
          scoreAdjust -= 1;
        }
      }
    } catch (err: any) {
      console.warn(`[DataSourceBrain] resolveSeriesSource consult failed for ${intent}/${candidate.source}:`, err.message);
    }
    if (scoreAdjust < 100) {
      ranked.push({ ...candidate, rank: candidate.rank + scoreAdjust, reason: demotionReason || candidate.reason });
    } else {
      console.log(`[DataSourceBrain] Resolver dropped ${candidate.source} for ${intent}(${protocol}): ${demotionReason}`);
    }
  }

  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.length > 0 ? ranked : defaults;
}

/**
 * Record a system learning — a reusable rule the system has discovered
 * through runtime experience. Deduplicates on scope+scopeKey+ruleType.
 * If a matching learning exists, increments appliedCount and bumps confidence.
 */
export async function recordSystemLearning(input: {
  scope: string;
  scopeKey: string;
  ruleType: string;
  ruleText: string;
  source?: string;
  triggeredBy?: string;
}): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(systemLearnings)
      .where(
        and(
          eq(systemLearnings.scope, input.scope),
          eq(systemLearnings.scopeKey, input.scopeKey),
          eq(systemLearnings.ruleType, input.ruleType),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const newConfidence = Math.min(99, existing[0].confidence + 5);
      await db
        .update(systemLearnings)
        .set({
          appliedCount: sql`${systemLearnings.appliedCount} + 1`,
          confidence: newConfidence,
          updatedAt: new Date(),
        })
        .where(eq(systemLearnings.id, existing[0].id));
    } else {
      await db.insert(systemLearnings).values({
        scope: input.scope,
        scopeKey: input.scopeKey,
        ruleType: input.ruleType,
        ruleText: input.ruleText,
        source: input.source || "auto",
        triggeredBy: input.triggeredBy,
        confidence: 50,
        appliedCount: 1,
      });
    }
  } catch (err: any) {
    console.warn(`[DataSourceBrain] recordLearning failed:`, err.message);
  }
}
