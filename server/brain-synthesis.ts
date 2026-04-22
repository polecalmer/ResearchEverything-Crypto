/**
 * Research-brain → data-source-brain synthesis.
 *
 * Walks a user's `research_brain.preferences` looking for prose that names
 * data sources ("use stonksonchain for HIP-3 metrics") and promotes those
 * mappings into the data-source brain as user-scoped coverage facts. Once
 * promoted, `resolveSeriesSource(intent, protocol, {userId})` will surface
 * the preferred source ahead of generic defaults.
 *
 * Storage convention:
 *   data_source_facts.scope_ref = `userpref:<userId>:<sourceName>`
 *   data_source_facts.content   = `[user pref] <verbatim preference text>`
 *
 * The synthesis is idempotent — `observe()` deduplicates on
 * (source, scope_ref, content) so re-running the pass for an unchanged
 * preferences object is a no-op.
 */

import { observe } from "./data-source-brain/db";
import { DATA_SOURCES, type DataSource } from "@shared/schema";

/** Sources we recognize in user prose. Only those that are also valid
 *  `DataSource` values get promoted; the rest are logged so we can grow
 *  coverage over time. */
const KNOWN_SOURCE_TOKENS: Array<{ token: RegExp; canonical: string }> = [
  { token: /\bstonksonchain(?:\.net)?\b/i, canonical: "stonksonchain" },
  { token: /\bdefillama\b/i, canonical: "defillama" },
  { token: /\bdune(?:\s+analytics)?\b/i, canonical: "dune" },
  { token: /\bcoingecko\b/i, canonical: "coingecko" },
  { token: /\ballium\b/i, canonical: "allium" },
  // Sources we don't (yet) fetch from — logged but not promoted.
  { token: /\bartemis(?:\.xyz)?\b/i, canonical: "artemis" },
  { token: /\btoken[\s-]?terminal\b/i, canonical: "tokenterminal" },
  { token: /\bl2beat\b/i, canonical: "l2beat" },
  { token: /\bnansen\b/i, canonical: "nansen" },
  { token: /\barkham\b/i, canonical: "arkham" },
  { token: /\btoken\s*unlocks?\b/i, canonical: "tokenunlocks" },
];

const VALID_DATA_SOURCES = new Set<string>(DATA_SOURCES);

/** Walk an arbitrary preferences object and yield string leaves. */
function* walkStrings(obj: any, depth = 0): Generator<string> {
  if (depth > 6) return;
  if (obj == null) return;
  if (typeof obj === "string") {
    if (obj.trim().length > 0) yield obj;
    return;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) yield* walkStrings(v, depth + 1);
    return;
  }
  if (typeof obj === "object") {
    for (const v of Object.values(obj)) yield* walkStrings(v, depth + 1);
  }
}

export interface SynthesisResult {
  /** Total preference strings inspected. */
  inspected: number;
  /** Number of (source, preference) facts written/merged. */
  promoted: number;
  /** Sources we detected but cannot fetch from (no DataSource entry). */
  skipped: Array<{ source: string; preview: string }>;
  /** Per-source promoted counts for diagnostics. */
  bySource: Record<string, number>;
}

/**
 * Extract data-source mentions from a user's research-brain preferences and
 * promote each to a user-scoped data-source-brain fact. Best-effort — never
 * throws (logs and returns partial result).
 */
export async function synthesizeUserPreferenceFacts(
  userId: string,
  preferences: Record<string, any> | null | undefined,
): Promise<SynthesisResult> {
  const result: SynthesisResult = { inspected: 0, promoted: 0, skipped: [], bySource: {} };
  if (!userId) return result;
  if (!preferences || typeof preferences !== "object") return result;

  // Per-source dedupe within this pass — the same preference string can
  // mention a source multiple times; we only want to write it once per pass.
  const seen = new Set<string>();

  for (const text of walkStrings(preferences)) {
    result.inspected++;
    const trimmed = text.trim();
    if (trimmed.length < 8) continue; // skip "yes"/"no"/empty values

    for (const { token, canonical } of KNOWN_SOURCE_TOKENS) {
      if (!token.test(trimmed)) continue;

      const dedupeKey = `${canonical}|${trimmed.slice(0, 200).toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!VALID_DATA_SOURCES.has(canonical)) {
        result.skipped.push({ source: canonical, preview: trimmed.slice(0, 120) });
        continue;
      }

      const source = canonical as DataSource;
      const scopeRef = `userpref:${userId}:${canonical}`;
      // The leading `[user pref ${userId}]` token is what the resolver's
      // direct DB scan uses to identify these facts; do not reword it.
      const content = `[user pref ${userId}] ${trimmed.slice(0, 600)}`;

      try {
        await observe({
          source,
          scope_ref: scopeRef,
          category: "coverage",
          content,
          source_of_fact: `synthesis:research_brain:${userId}`,
          confidence: "verified_doc",
        });
        result.promoted++;
        result.bySource[canonical] = (result.bySource[canonical] || 0) + 1;
      } catch (err: any) {
        console.warn(`[BrainSynthesis] observe failed for ${canonical}/${userId}:`, err.message);
      }
    }
  }

  if (result.promoted > 0 || result.skipped.length > 0) {
    console.log(
      `[BrainSynthesis] user=${userId.slice(0, 8)} inspected=${result.inspected} ` +
        `promoted=${result.promoted} (${Object.entries(result.bySource).map(([k, v]) => `${k}:${v}`).join(", ") || "—"}) ` +
        `skipped=${result.skipped.length}${result.skipped.length > 0 ? ` (${result.skipped.map((s) => s.source).join(", ")})` : ""}`,
    );
  }

  return result;
}
