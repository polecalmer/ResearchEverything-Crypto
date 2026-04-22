/**
 * Agent hooks: wrap tool execution with consult-before / observe-on-error.
 *
 * Bindings are registered by the agent module that owns the tool definitions
 * (via `registerToolBindings` at module init). This keeps the binding next to
 * the tool definition itself — no parallel map to drift out of sync.
 */
import type { Source } from "./schema";
import { consult, observe, getUserPreferenceFacts } from "./db";
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

/**
 * The concrete `DataSourceKey` (mirrors the union in derived-metrics.ts) that
 * `fetchSourceData` will switch on. Kept as a string here to avoid a
 * circular import; callers cast to the union at use-time.
 */
export type DataSourceKey = string;

export interface ResolvedSource {
  source: Source;
  scopeRef: string;
  /** Concrete fetch key for derived-metrics.fetchSourceData. */
  dataSourceKey: DataSourceKey;
  reason: string;
  rank: number;
}

const STATIC_DEFAULTS: Record<SeriesIntent, ResolvedSource[]> = {
  daily_revenue: [
    { source: "defillama", scopeRef: "defillama:/summary/fees/{slug}", dataSourceKey: "defillama.revenue", reason: "primary fees+revenue endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", dataSourceKey: "defillama.revenue", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_fees: [
    { source: "defillama", scopeRef: "defillama:/summary/fees/{slug}", dataSourceKey: "defillama.fees", reason: "primary fees+revenue endpoint", rank: 0 },
    { source: "stonksonchain", scopeRef: "stonksonchain:/api/v1/fees/history", dataSourceKey: "stonksonchain.deployer_fees", reason: "specialist: HIP-3 deployer fees on Hyperliquid", rank: 5 },
    { source: "dune", scopeRef: "dune:proven_queries", dataSourceKey: "defillama.fees", reason: "fallback: proven query library", rank: 10 },
  ],
  daily_tvl: [
    { source: "defillama", scopeRef: "defillama:/protocol/{slug}", dataSourceKey: "defillama.tvl", reason: "primary protocol TVL endpoint", rank: 0 },
    { source: "dune", scopeRef: "dune:proven_queries", dataSourceKey: "defillama.tvl", reason: "fallback: proven query library", rank: 1 },
  ],
  daily_dex_volume: [
    { source: "defillama", scopeRef: "defillama:/summary/dexs/{slug}", dataSourceKey: "defillama.dex_volume", reason: "primary DEX volume endpoint", rank: 0 },
    { source: "stonksonchain", scopeRef: "stonksonchain:/api/v1/fees/history", dataSourceKey: "stonksonchain.deployer_volume", reason: "specialist: HIP-3 deployer notional volume on Hyperliquid", rank: 5 },
    { source: "dune", scopeRef: "dune:proven_queries", dataSourceKey: "defillama.dex_volume", reason: "fallback: proven query library", rank: 10 },
  ],
  daily_derivatives_volume: [
    { source: "defillama", scopeRef: "defillama:/summary/derivatives/{slug}", dataSourceKey: "defillama.derivatives_volume", reason: "primary derivatives endpoint", rank: 0 },
    { source: "stonksonchain", scopeRef: "stonksonchain:/api/v1/fees/history", dataSourceKey: "stonksonchain.deployer_volume", reason: "specialist: HIP-3 deployer notional volume on Hyperliquid", rank: 5 },
    { source: "dune", scopeRef: "dune:proven_queries", dataSourceKey: "defillama.derivatives_volume", reason: "fallback: proven query library", rank: 10 },
  ],
  price_history: [
    { source: "defillama", scopeRef: "defillama:coins/prices/chart", dataSourceKey: "coingecko.price", reason: "DeFiLlama price-history coins endpoint", rank: 0 },
    { source: "coingecko", scopeRef: "coingecko:/coins/{id}/market_chart", dataSourceKey: "coingecko.price", reason: "fallback: CoinGecko market chart", rank: 1 },
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

export interface ResolveOptions {
  /** When provided, user-preference facts (scope_ref `userpref:<userId>:...`)
   *  for this user can promote a source to the top of the ranking. */
  userId?: string;
}

export async function resolveSeriesSource(
  intent: SeriesIntent,
  protocol: string,
  opts: ResolveOptions = {},
): Promise<ResolvedSource[]> {
  const defaults = STATIC_DEFAULTS[intent].map((d) => ({
    ...d,
    scopeRef: d.scopeRef.replace("{slug}", protocol.toLowerCase()),
  }));
  if (!protocol) return defaults;

  const negKeywords = NEGATIVE_KEYWORDS[intent] || [];
  const protocolLc = protocol.toLowerCase();
  const ranked: ResolvedSource[] = [];

  // SPECIALIST GATE: candidates that don't have explicit positive coverage
  // for this protocol get dropped if they're flagged as specialist sources
  // (e.g. stonksonchain only applies to HIP-3 deployers — never serve it
  // for "ethereum daily fees"). We detect this by checking whether the
  // candidate has any verified coverage fact mentioning the protocol.
  const SPECIALIST_SOURCES: Source[] = ["stonksonchain"];

  // Pre-fetch user-preference facts once so both the specialist gate AND the
  // ranking pass can reference them. The gate uses them to KEEP a specialist
  // source when the user explicitly named it for a related family
  // (e.g. user said "stonksonchain for HIP-3 / Hyperliquid" → keep
  // stonksonchain even for tradexyz, lighter, felix, etc.).
  let userFacts: Awaited<ReturnType<typeof getUserPreferenceFacts>> = [];
  if (opts.userId) {
    try {
      userFacts = await getUserPreferenceFacts(opts.userId);
    } catch (err: any) {
      console.warn(`[DataSourceBrain] user-pref prefetch failed for ${opts.userId}:`, err.message);
    }
  }
  // For the Hyperliquid family (HIP-3 deployers etc.), any user-pref fact
  // that names a specialist source AND mentions hyperliquid/hype/hip-3 is
  // sufficient evidence to keep the specialist source in the running.
  const HYPERLIQUID_FAMILY_KEYWORDS = ["hyperliquid", "hype", "hip-3", "hip3"];
  const userPrefSpecialistAllow = new Set<Source>();
  for (const fact of userFacts) {
    const c = fact.content.toLowerCase();
    if (HYPERLIQUID_FAMILY_KEYWORDS.some((k) => c.includes(k))) {
      userPrefSpecialistAllow.add(fact.source as Source);
    }
  }

  for (const candidate of defaults) {
    let scoreAdjust = 0;
    let demotionReason = "";
    let hasPositiveCoverage = false;
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
        if (isStrong && !isNegative) {
          hasPositiveCoverage = true;
        }
      }
    } catch (err: any) {
      console.warn(`[DataSourceBrain] resolveSeriesSource consult failed for ${intent}/${candidate.source}:`, err.message);
    }

    // Drop specialist sources without explicit positive coverage for this
    // protocol. Without this gate, every "X fees" call would route to
    // stonksonchain regardless of whether X is a HIP-3 deployer.
    // EXCEPTION: a user-pref fact that names this specialist for the
    // hyperliquid/HIP-3 family counts as user-supplied positive coverage —
    // keep the source so it can compete in ranking (and get user-pref
    // promoted below).
    if (SPECIALIST_SOURCES.includes(candidate.source) && !hasPositiveCoverage) {
      if (userPrefSpecialistAllow.has(candidate.source)) {
        console.log(`[DataSourceBrain] Resolver kept specialist ${candidate.source} for ${intent}(${protocol}): user-pref overrides absent brain coverage`);
      } else {
        console.log(`[DataSourceBrain] Resolver dropped specialist ${candidate.source} for ${intent}(${protocol}): no positive coverage fact`);
        continue;
      }
    }

    if (scoreAdjust < 100) {
      ranked.push({ ...candidate, rank: candidate.rank + scoreAdjust, reason: demotionReason || candidate.reason });
    } else {
      console.log(`[DataSourceBrain] Resolver dropped ${candidate.source} for ${intent}(${protocol}): ${demotionReason}`);
    }
  }

  // USER-PREFERENCE PROMOTION: if a user-pref fact explicitly names a source
  // for this intent/protocol, promote it to the top (rank = -100). Direct DB
  // lookup is more reliable than embedding-based consult for this case —
  // we know exactly the prefix to scan for. Reuses the userFacts prefetched
  // above for the specialist gate.
  if (opts.userId && userFacts.length > 0) {
    try {
      for (const fact of userFacts) {
        const factSource = fact.source as Source;
        const c = fact.content.toLowerCase();
        // The pref applies only if it mentions the protocol (or a known
        // alias) AND is plausibly about this kind of metric. We allow either
        // an exact protocol-name match or a topic keyword that matches the
        // intent family ("hyperliquid"/"hype"/"hip-3" all imply the
        // hyperliquid family for the stonksonchain case).
        const mentionsProtocol = c.includes(protocolLc);
        const mentionsHyperliquidFamily =
          (protocolLc === "hyperliquid" || protocolLc === "hype") &&
          (c.includes("hyperliquid") || c.includes("hype") || c.includes("hip-3") || c.includes("hip3"));
        if (!mentionsProtocol && !mentionsHyperliquidFamily) continue;

        const target = ranked.find((r) => r.source === factSource);
        if (target) {
          // GUARD: stonksonchain's deployer_* endpoints only accept HIP-3
          // deployer slugs (xyz, felix, …) — they fail/return empty for the
          // base "hyperliquid"/"hype" protocol itself. Don't promote a
          // deployer-specific key for the base chain even when the user
          // pref technically matches the family keyword. The denominator
          // path needs to fall back to defillama for hyperliquid totals.
          const isBaseHL = protocolLc === "hyperliquid" || protocolLc === "hype";
          const isDeployerSpecificKey =
            typeof target.dataSourceKey === "string" &&
            target.dataSourceKey.startsWith("stonksonchain.deployer_");
          if (isBaseHL && isDeployerSpecificKey) {
            console.log(`[DataSourceBrain] Resolver SKIPPED stonksonchain ${target.dataSourceKey} promotion for base ${protocol} (deployer-only endpoint)`);
            continue;
          }
          const oldRank = target.rank;
          target.rank = -100;
          target.reason = `user-pref: ${fact.content.slice(0, 100)}`;
          console.log(`[DataSourceBrain] Resolver USER-PREF promoted ${factSource} for ${intent}(${protocol}) from rank=${oldRank} → -100 (userId=${opts.userId.slice(0, 8)})`);
        } else {
          // Source named in user pref but not in defaults for this intent —
          // skip silently (e.g. user mentioned an unrelated source).
        }
      }

      // FAMILY-TRANSITIVE PROMOTION: if a specialist source is allowed by a
      // family-level user pref ("use stonksonchain for HIP-3/Hyperliquid")
      // AND the data brain confirms the protocol is part of that family
      // (e.g. tradexyz is seeded as a HIP-3 deployer), promote the specialist
      // even when the pref text doesn't name the protocol slug verbatim.
      // Without this, the user would have to enumerate every deployer.
      for (const candidate of ranked) {
        if (!SPECIALIST_SOURCES.includes(candidate.source)) continue;
        if (!userPrefSpecialistAllow.has(candidate.source)) continue;
        if (candidate.rank <= -100) continue; // already promoted by direct match
        // Same guard as direct promotion: deployer-specific stonksonchain
        // keys must not be promoted for the base hyperliquid protocol —
        // those endpoints require a HIP-3 deployer slug as the coin param.
        const isBaseHL = protocolLc === "hyperliquid" || protocolLc === "hype";
        const isDeployerSpecificKey =
          typeof candidate.dataSourceKey === "string" &&
          candidate.dataSourceKey.startsWith("stonksonchain.deployer_");
        if (isBaseHL && isDeployerSpecificKey) continue;
        // hasPositiveCoverage was computed per candidate above; recompute
        // cheaply here by re-checking the brain. Cache-friendly because the
        // earlier consult already warmed everything.
        try {
          const hits = await consult({
            query: `${intent} ${protocol}`,
            source: candidate.source,
            category: "coverage",
            topK: 3,
            minSimilarity: 0.5,
          });
          const familyHit = hits.some((h) => {
            const c = h.fact.content.toLowerCase();
            return c.includes(protocolLc) && HYPERLIQUID_FAMILY_KEYWORDS.some((k) => c.includes(k));
          });
          if (familyHit) {
            const oldRank = candidate.rank;
            candidate.rank = -100;
            candidate.reason = `user-pref (family-transitive: ${candidate.source} for HIP-3/Hyperliquid; brain confirms ${protocol} is in family)`;
            console.log(`[DataSourceBrain] Resolver USER-PREF FAMILY-PROMOTED ${candidate.source} for ${intent}(${protocol}) from rank=${oldRank} → -100`);
          }
        } catch (err: any) {
          console.warn(`[DataSourceBrain] family-transitive consult failed for ${candidate.source}/${protocol}:`, err.message);
        }
      }
    } catch (err: any) {
      console.warn(`[DataSourceBrain] user-pref lookup failed for ${opts.userId}/${intent}:`, err.message);
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
