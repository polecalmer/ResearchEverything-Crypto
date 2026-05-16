/**
 * synthesis-observer — Phase 1 of the memo-structure self-learning loop.
 *
 * After every memo synthesis (and as a one-shot pass over analyst_documents
 * during bootstrap), this module:
 *
 *   1. Runs a precision-first structural-pattern extractor over the memo body
 *   2. Records presence/absence + supporting evidence as one row in
 *      synthesis_observations
 *   3. Does NOT promote any rules — observation only. Promotion is Phase 3.
 *
 * Why precision-first: false-positive observations would poison the
 * downstream correlation. We'd rather miss a pattern than label something
 * as "scenario_lattice" when it's really a comparison table. Each detector
 * has a tight signature and falls back to "absent" on ambiguity.
 *
 * The pattern catalogue mirrors the structural elements identified in the
 * 2026-05-16 hermes-vs-sessions AQAv2 memo comparison:
 *   - scenario_lattice              (≥3 rows × labeled scenarios)
 *   - baseline_financials_header    (price/mcap/rev/P-E cluster, near-top)
 *   - coverage_ratio_analysis       (emissions + buyback + ratios)
 *   - lens_attribution              (≥3 "a X lens" attributions)
 *   - sources_block_explicit        (tail Sources: block)
 *   - executive_summary_block       (Executive Summary / TL;DR header)
 *   - watchlist_block               (Watchlist / Things to track block)
 *
 * Adding a new detector: write one function returning {present, evidence?}
 * with a heuristic signature, add it to DETECTORS, done. The Phase 3
 * correlator will auto-discover whether it's predictive of outcomes.
 */

import { db } from "./db";
import { synthesisObservations } from "../shared/schema";
import { logger } from "./logger";

/* ─────────────────────────── Types ─────────────────────────── */

export type PatternName =
  | "scenario_lattice"
  | "baseline_financials_header"
  | "coverage_ratio_analysis"
  | "lens_attribution"
  | "sources_block_explicit"
  | "executive_summary_block"
  | "watchlist_block";

export interface PatternHit {
  present: boolean;
  /** Short evidence snippet from the matched region (≤300 chars) */
  evidence?: string;
  /** Detector-specific metadata (row count, var names, distinct lens count, etc.) */
  meta?: Record<string, any>;
}

export type PatternMap = Record<PatternName, PatternHit>;

/* ──────────────────────── Pattern detectors ──────────────────────── */

const SCENARIO_LABEL_RE = /\b(bear|low[- ]?base|low|base[- ]?case|base|high[- ]?base|high|bull|moon|scenario|sensitivity|down|mid|up)\b/i;

/** Markdown table with at least one column header containing a scenario-like
 *  word AND at least 3 data rows. Tolerates both `| ... |` markdown tables
 *  and HTML-ish table syntax. Precision over recall: we want "this is clearly
 *  a multi-scenario table" not "this has a few numbers in rows." */
function detectScenarioLattice(text: string): PatternHit {
  // Find sequences of consecutive `| ... |` lines (markdown tables).
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|.+\|\s*$/.test(lines[i])) { i++; continue; }
    const start = i;
    let j = i;
    while (j < lines.length && /^\s*\|.+\|\s*$/.test(lines[j])) j++;
    const tableLines = lines.slice(start, j);
    i = j;
    if (tableLines.length < 4) continue;  // header + sep + ≥2 data rows minimum

    // First non-separator line is the header row.
    const header = tableLines[0];
    const dataRows = tableLines.slice(2); // skip header + separator
    if (dataRows.length < 3) continue;

    // Either the header column-names or the first column of data rows must
    // contain a scenario-style label.
    const headerHasScenarioWord = SCENARIO_LABEL_RE.test(header);
    const firstColLabels = dataRows.map((r) => {
      const cells = r.split("|").map((c) => c.trim()).filter(Boolean);
      return cells[0] || "";
    });
    const labelMatches = firstColLabels.filter((l) => SCENARIO_LABEL_RE.test(l));

    if (headerHasScenarioWord || labelMatches.length >= 2) {
      return {
        present: true,
        evidence: tableLines.slice(0, Math.min(6, tableLines.length)).join("\n").slice(0, 300),
        meta: {
          rowCount: dataRows.length,
          labels: firstColLabels.slice(0, 8),
          headerScenarioWord: headerHasScenarioWord,
        },
      };
    }
  }
  return { present: false };
}

const FIN_TOKENS_RE = /(price|market\s*cap|mcap|fdv|circulating\s*supply|supply|revenue|fees|arr|ltm|p\s*\/\s*[esr]|p\/e|p\/s)/gi;

/** A tight cluster (≤14 lines) within the first ~1800 chars containing ≥4
 *  distinct baseline-financial tokens. Most often appears as a bullet list
 *  or a key-value block under the executive summary. */
function detectBaselineFinancialsHeader(text: string): PatternHit {
  const head = text.slice(0, 1800);
  // Slide a 14-line window. For each, count distinct token kinds.
  const lines = head.split("\n");
  for (let start = 0; start < lines.length; start++) {
    const window = lines.slice(start, start + 14).join("\n");
    if (window.length < 60) continue;
    const matches = window.match(FIN_TOKENS_RE) || [];
    const distinct = new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, "")));
    if (distinct.size >= 4) {
      // Also require that the block contains $ or % signs — pure prose
      // mentioning "the price and market cap" doesn't count.
      if (!/\$|%/.test(window)) continue;
      return {
        present: true,
        evidence: window.slice(0, 300),
        meta: { distinctMetrics: distinct.size, kinds: [...distinct] },
      };
    }
  }
  return { present: false };
}

/** Co-occurrence of {emissions OR unlocks} + {buyback OR burn} + ≥2 numeric
 *  ratios within ~600 chars of each other. This is the structural shape of
 *  a "coverage ratio" analysis. */
function detectCoverageRatioAnalysis(text: string): PatternHit {
  const lower = text.toLowerCase();
  const emissionIdx = lower.search(/\b(emission|unlock|inflation)/);
  if (emissionIdx < 0) return { present: false };
  const buybackIdx = lower.search(/\b(buy[- ]?back|burn)/);
  if (buybackIdx < 0) return { present: false };
  if (Math.abs(emissionIdx - buybackIdx) > 1500) return { present: false };

  const start = Math.min(emissionIdx, buybackIdx);
  const end = Math.min(text.length, Math.max(emissionIdx, buybackIdx) + 600);
  const window = text.slice(start, end);
  // Need ≥2 numeric ratios / percentages / "X/day" mentions in window
  const nums = window.match(/\d+(\.\d+)?\s*(%|\/\s*day|\/\s*d\b|k\b|m\b)/gi) || [];
  if (nums.length < 2) return { present: false };

  // And at least one explicit ratio framing
  if (!/coverage|net\s+uncovered|uncovered\s+emissions|covers?|covering/i.test(window)) {
    return { present: false };
  }
  return {
    present: true,
    evidence: window.slice(0, 300),
    meta: { numericMentions: nums.length },
  };
}

const LENS_RE = /\b(?:from\s+)?(?:an?\s+|the\s+)?([\w-]+(?:\s+[\w-]+){0,2})\s+lens\b/gi;

/** ≥3 distinct "X lens" attributions in the memo. */
function detectLensAttribution(text: string): PatternHit {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  LENS_RE.lastIndex = 0;
  while ((m = LENS_RE.exec(text)) !== null) {
    const lens = m[1].trim().toLowerCase();
    if (lens.length < 3 || lens.length > 40) continue;
    if (/^(the|a|an|that|this|same|other|new|old)$/.test(lens)) continue;
    matches.push(lens);
  }
  const distinct = new Set(matches);
  if (distinct.size < 3) return { present: false };
  return {
    present: true,
    evidence: matches.slice(0, 6).join(" / "),
    meta: { distinctLenses: distinct.size, examples: [...distinct].slice(0, 8) },
  };
}

/** A tail block containing `Sources:` or `References:` listing source names.
 *  Must be in the final ~600 chars to qualify (a Sources block in the middle
 *  is probably citing one item, not the memo's full source roll-up). */
function detectSourcesBlockExplicit(text: string): PatternHit {
  const tail = text.slice(-1200);
  const m = tail.match(/(?:^|\n)\s*(?:#+\s*)?(?:sources?|references?|citations?)\s*[:\n][^\n]{8,400}/i);
  if (!m) return { present: false };
  // Must contain ≥2 comma-separated items OR ≥2 newline-separated bullets
  const body = m[0].replace(/^.*?[:\n]/, "").trim();
  const items = body.split(/,|\n\s*[-*•]/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (items.length < 2) return { present: false };
  return {
    present: true,
    evidence: m[0].slice(0, 300),
    meta: { itemCount: items.length, items: items.slice(0, 8) },
  };
}

/** "Executive Summary" / "TL;DR" / "Bottom line up front" header. Indicates
 *  the memo follows a structured intro pattern rather than launching straight
 *  into prose. */
function detectExecutiveSummaryBlock(text: string): PatternHit {
  const head = text.slice(0, 2000);
  const m = head.match(/(?:^|\n)\s*(?:#+\s*)?(executive\s+summary|tl;?\s*dr|bottom\s+line(?:\s+up\s+front)?|key\s+takeaways?|headline|summary)\s*(?::|\n|$)/i);
  if (!m) return { present: false };
  return {
    present: true,
    evidence: head.slice(Math.max(0, (m.index || 0) - 20), Math.min(head.length, (m.index || 0) + 280)),
    meta: { headerLabel: m[1].trim() },
  };
}

/** "Watchlist" / "What to track" / "Things to monitor" block — signals the
 *  memo gives the reader concrete forward-looking signals. */
function detectWatchlistBlock(text: string): PatternHit {
  const m = text.match(/(?:^|\n)\s*(?:#+\s*)?(watchlist|what\s+to\s+(?:watch|track|monitor)|things?\s+to\s+(?:watch|track|monitor)|forward\s+(?:signals|indicators|signposts)|signposts?)\s*(?::|\n)/i);
  if (!m) return { present: false };
  const start = m.index || 0;
  const window = text.slice(start, start + 600);
  // Need ≥2 bullets / items
  const bullets = (window.match(/(?:^|\n)\s*[-*•]/g) || []).length;
  if (bullets < 2) return { present: false };
  return {
    present: true,
    evidence: window.slice(0, 280),
    meta: { headerLabel: m[1].trim(), bulletCount: bullets },
  };
}

const DETECTORS: Array<[PatternName, (t: string) => PatternHit]> = [
  ["scenario_lattice", detectScenarioLattice],
  ["baseline_financials_header", detectBaselineFinancialsHeader],
  ["coverage_ratio_analysis", detectCoverageRatioAnalysis],
  ["lens_attribution", detectLensAttribution],
  ["sources_block_explicit", detectSourcesBlockExplicit],
  ["executive_summary_block", detectExecutiveSummaryBlock],
  ["watchlist_block", detectWatchlistBlock],
];

/* ──────────────────────── Public API ──────────────────────── */

/** Pure function. Runs every detector over the memo body and returns the
 *  full pattern map. No DB, no side effects. */
export function extractStructuralPatterns(text: string): PatternMap {
  const out: Partial<PatternMap> = {};
  if (!text || typeof text !== "string") {
    for (const [name] of DETECTORS) out[name] = { present: false };
    return out as PatternMap;
  }
  for (const [name, fn] of DETECTORS) {
    try {
      out[name] = fn(text);
    } catch (err: any) {
      logger.warn({ pattern: name, err: err?.message }, "synthesis-observer detector threw");
      out[name] = { present: false };
    }
  }
  return out as PatternMap;
}

export interface ObserveArgs {
  sessionId?: string | null;
  messageId?: string | null;
  userId?: string | null;
  mode?: string | null;
  playbookId?: string | null;
  memoBody: string;
  subjectEntities?: string[];
  provenance: "sessions:runtime" | "analyst-corpus:bootstrap" | "manual";
  provenanceRef?: string | null;
}

/** Runs the extractor on the memo body and persists one row to
 *  synthesis_observations. Returns the row written (or null on failure —
 *  swallows errors because observation should never break synthesis). */
export async function observeSynthesisOutput(args: ObserveArgs): Promise<{ id: string; patterns: PatternName[] } | null> {
  if (!args.memoBody || args.memoBody.trim().length < 200) {
    // Too short to be a memo. Skip.
    return null;
  }

  try {
    const patternMap = extractStructuralPatterns(args.memoBody);
    const present: PatternName[] = [];
    const detail: Record<string, any> = {};
    for (const [name, hit] of Object.entries(patternMap) as Array<[PatternName, PatternHit]>) {
      detail[name] = hit;
      if (hit.present) present.push(name);
    }

    const row = await db.insert(synthesisObservations).values({
      sessionId: args.sessionId ?? null,
      messageId: args.messageId ?? null,
      userId: args.userId ?? "default",
      mode: args.mode ?? null,
      playbookId: args.playbookId ?? null,
      memoChars: args.memoBody.length,
      subjectEntities: args.subjectEntities ?? [],
      patterns: present,
      patternsDetail: detail,
      provenance: args.provenance,
      provenanceRef: args.provenanceRef ?? null,
    }).returning({ id: synthesisObservations.id });

    logger.info(
      { sessionId: args.sessionId, patterns: present, count: present.length, provenance: args.provenance },
      "synthesis_observation recorded",
    );

    return { id: row[0].id, patterns: present };
  } catch (err: any) {
    logger.warn({ err: err?.message, sessionId: args.sessionId }, "synthesis-observer write failed (swallowed)");
    return null;
  }
}
