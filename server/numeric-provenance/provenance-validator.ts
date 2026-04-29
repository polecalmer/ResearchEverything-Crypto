/**
 * Post-emission provenance check.
 *
 * Walks the agent's final prose, extracts every fact-bearing numeric
 * token (currency / percent / ratio / multiple), and verifies each one
 * traces to either:
 *   (a) a compute() call from this turn (formal provenance), or
 *   (b) a number present in any raw tool_result from this turn (direct
 *       readout — e.g. price from coingecko, TVL from defillama).
 *
 * Numbers that match neither are "unprovenanced" — the strongest signal
 * that the LLM did mental math or invented a number. Returns a list of
 * issues for the validator to surface as a warning callout (and, when
 * NUMERIC_PROVENANCE_STRICT=1 is set, to reject the response).
 *
 * What's intentionally NOT checked:
 *   - Years (4-digit numbers without M/B/K/$/% suffix)
 *   - Round example numbers ("at $20", "if revenue grows 33%") — the
 *     extractor still picks them up, but tolerance + direct-readout
 *     match catches most legitimate cases. False positives are a soft
 *     warning, not a reject.
 *   - Counts / ranks ("3 sources", "top 5") — small integers are skipped.
 */

import { getTurn } from "./turn-cache";

export interface ProseNumber {
  raw: string;          // the matched text, e.g. "$329.9M"
  value: number;        // the parsed numeric value, e.g. 329900000
  format: "currency" | "percent" | "ratio" | "number";
  context: string;      // ~80 chars around the match for log output
  index: number;        // position in source text
}

export interface ProvenanceIssue {
  number: ProseNumber;
  reason: "no_compute_match" | "no_source_match" | "no_match";
  candidates: Array<{ value: number; from: string }>; // closest candidates considered
}

export interface ProvenanceReport {
  totalNumbers: number;
  matched: number;
  matchedByCompute: number;
  matchedBySource: number;
  matchedByDerivation: number;
  unmatched: ProvenanceIssue[];
  computesAvailable: number;
  toolResultsAvailable: number;
}

/**
 * Run provenance check. Returns a report. Does NOT throw or mutate
 * anything; caller decides whether to inject a warning or reject.
 */
export function checkProvenance(
  finalText: string,
  turnId: string,
): ProvenanceReport {
  const turn = getTurn(turnId);
  const computes = turn?.computes || [];
  const toolResults = turn?.toolResults || [];

  const numbers = extractProseNumbers(finalText);
  const unmatched: ProvenanceIssue[] = [];
  let matchedByCompute = 0;
  let matchedBySource = 0;
  let matchedByDerivation = 0;

  for (const n of numbers) {
    const computeMatch = matchAgainstComputes(n, computes);
    if (computeMatch) {
      matchedByCompute++;
      continue;
    }
    const sourceMatch = matchAgainstSources(n, toolResults);
    if (sourceMatch) {
      matchedBySource++;
      continue;
    }
    // Derivation match: percent/ratio numbers are often the explicit
    // ratio of two adjacent prose numbers ("$3.1M revenue / $6.2M fees,
    // a 50% take rate"). The 50% is mentally derived but trivially
    // verifiable from text. Accept these as legitimate.
    const derivationMatch = matchAgainstDerivation(n, numbers);
    if (derivationMatch) {
      matchedByDerivation++;
      continue;
    }
    unmatched.push({
      number: n,
      reason: "no_match",
      candidates: collectClosest(n, computes, toolResults),
    });
  }

  return {
    totalNumbers: numbers.length,
    matched: matchedByCompute + matchedBySource + matchedByDerivation,
    matchedByCompute,
    matchedBySource,
    matchedByDerivation,
    unmatched,
    computesAvailable: computes.length,
    toolResultsAvailable: toolResults.length,
  };
}

/* ───────────────────── extractors ───────────────────── */

const CURRENCY_RE = /(\$|US\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?([KMBT])?/gi;
const PERCENT_RE = /(\d+(?:\.\d+)?)\s?%/g;
const RATIO_RE = /(\d+(?:\.\d+)?)\s?[xX](?=\b|\s|[.,;:])/g;
// Bare big number with magnitude suffix (no $) — e.g. "9.5M HYPE", "405.6M staked".
// Lookbehind also excludes "." so "$292.51M" doesn't double-match its decimal
// portion as a separate "51M".
const BIG_NUMBER_RE = /(?<![\w$%.])(\d+(?:\.\d+)?)\s?([KMBT])(?:\s|$|[.,;:)])/gi;

export function extractProseNumbers(text: string): ProseNumber[] {
  if (!text) return [];
  // Strip code-fenced sections — they're tool outputs, charts, JSON,
  // not prose. Reduces false positives massively.
  const stripped = text.replace(/```[\s\S]*?```/g, " ");
  const out: ProseNumber[] = [];
  pushMatches(stripped, CURRENCY_RE, "currency", out, parseCurrency);
  pushMatches(stripped, PERCENT_RE, "percent", out, parsePercent);
  pushMatches(stripped, RATIO_RE, "ratio", out, parseRatio);
  pushMatches(stripped, BIG_NUMBER_RE, "number", out, parseBigNumber);
  // Sort by index so log output reads in document order.
  out.sort((a, b) => a.index - b.index);
  return out;
}

function pushMatches(
  text: string,
  re: RegExp,
  format: ProseNumber["format"],
  out: ProseNumber[],
  parser: (m: RegExpExecArray) => number | null,
): void {
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const value = parser(m);
    if (value == null || !Number.isFinite(value)) continue;
    // Skip trivially small numbers that are almost always counts/dates/round examples.
    if (format === "currency" && Math.abs(value) < 100) continue;
    if (format === "percent" && Math.abs(value) > 10000) continue;
    if (format === "ratio" && Math.abs(value) < 0.1) continue;
    out.push({
      raw: m[0],
      value,
      format,
      context: contextAround(text, m.index, m[0].length),
      index: m.index,
    });
  }
}

function parseCurrency(m: RegExpExecArray): number | null {
  // m[2] is the integer part (with optional commas), m[3] decimals, m[4] suffix
  const intPart = (m[2] || "").replace(/,/g, "");
  const dec = m[3] || "";
  const suffix = (m[4] || "").toUpperCase();
  let n = Number(`${intPart}${dec ? "." + dec : ""}`);
  if (!Number.isFinite(n)) return null;
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  else if (suffix === "T") n *= 1e12;
  return n;
}

function parsePercent(m: RegExpExecArray): number | null {
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseRatio(m: RegExpExecArray): number | null {
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseBigNumber(m: RegExpExecArray): number | null {
  let n = Number(m[1]);
  const suffix = (m[2] || "").toUpperCase();
  if (!Number.isFinite(n)) return null;
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  else if (suffix === "T") n *= 1e12;
  // Skip if too small to be a real metric (years, counts).
  if (Math.abs(n) < 1e3) return null;
  return n;
}

function contextAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + len + 40);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/* ───────────────────── matchers ───────────────────── */

import type { ComputeRecord, ToolResultRecord } from "./turn-cache";

/** Two values are considered equal if they round to the same value at
 *  3 significant figures (matches our prose formatting). */
function approxEqual(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  if (a === 0 || b === 0) return Math.abs(a - b) < 1e-9;
  // Within 0.5% — accommodates "$329.9M" matching 329,941,287 or 329,888,000.
  const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
  return rel <= 0.005;
}

function matchAgainstComputes(n: ProseNumber, computes: ComputeRecord[]): ComputeRecord | null {
  for (const c of computes) {
    // Exact value_str match wins immediately.
    if (c.valueStr && n.raw && c.valueStr.replace(/\s/g, "") === n.raw.replace(/\s/g, "")) return c;
    if (approxEqual(c.value, n.value)) return c;
  }
  return null;
}

function matchAgainstSources(n: ProseNumber, results: ToolResultRecord[]): ToolResultRecord | null {
  for (const r of results) {
    for (const v of r.numericTokens) {
      if (approxEqual(v, n.value)) return r;
    }
  }
  return null;
}

/** Derivation matcher. A percent/ratio number in prose often IS the
 *  explicit ratio (or growth %) of two other numbers mentioned just
 *  before it — "fees $6.2M, revenue $3.1M, a 50% take rate." The 50%
 *  is mentally computed but trivially verifiable from adjacent text.
 *  Accept these to avoid the false-positive class that mugs up clean
 *  prose. Tolerance is wide (±10% relative) because the agent rounds
 *  ("49.99%" → "50%" or "≈50%"). Only fires for percent and ratio
 *  formats — currency derivations are too ambiguous. */
function matchAgainstDerivation(n: ProseNumber, all: ProseNumber[]): boolean {
  if (n.format !== "percent" && n.format !== "ratio") return false;
  // Window: numbers preceding this one in the prose, within ~800 chars
  // (typical paragraph), capped at the last 8 candidates.
  const preceding = all.filter((m) => m.index < n.index && (n.index - m.index) < 800);
  if (preceding.length < 2) return false;
  const window = preceding.slice(-8);
  // Target value normalized: percent stored as 50 (not 0.5); ratio stored
  // as 9.2 (not 9.2x). For percent we compare against ratios * 100; for
  // ratio we compare directly.
  // Tolerance is ABSOLUTE (not relative) to avoid the "100% within 10% of
  // 95%" false-positive class — relative tolerance is too forgiving once
  // values get larger. Percents: within 1 percentage point. Ratios: within
  // 0.1x. These are tight enough to reject hallucinations like "95% take
  // rate" when the real ratio is 50%, and forgiving enough to accept
  // rounding ("49.98% → 50%").
  const target = n.value;
  const absTolerance = n.format === "percent" ? 1.0 : 0.1;
  // Growth/change derivations only fire when the prose context near `n`
  // suggests change ("grew", "increased", "from X to Y", "up", "down").
  // Without that gate, growth math creates false positives.
  const ctx = n.context.toLowerCase();
  const growthContext = /\b(from|to|grew|growth|increased|decreased|up|down|change|delta|yoy|mom|qoq|wow)\b/.test(ctx);
  for (let i = 0; i < window.length; i++) {
    for (let j = 0; j < window.length; j++) {
      if (i === j) continue;
      const a = window[i].value;
      const b = window[j].value;
      if (b === 0 || !Number.isFinite(a) || !Number.isFinite(b)) continue;
      const candidates: number[] = [];
      // Direct ratio a/b — always tried (the take-rate / multiple case).
      const r = a / b;
      candidates.push(n.format === "percent" ? r * 100 : r);
      if (growthContext) {
        // Growth / change %: (a - b) / b — only tried when prose
        // signals growth, to avoid false positives.
        const g = (a - b) / Math.abs(b);
        candidates.push(n.format === "percent" ? g * 100 : g);
      }
      for (const c of candidates) {
        if (!Number.isFinite(c)) continue;
        if (Math.abs(c - target) <= absTolerance) return true;
      }
    }
  }
  return false;
}

function collectClosest(
  n: ProseNumber,
  computes: ComputeRecord[],
  toolResults: ToolResultRecord[],
): Array<{ value: number; from: string }> {
  const all: Array<{ value: number; from: string }> = [];
  for (const c of computes) all.push({ value: c.value, from: `compute:${c.name}` });
  for (const r of toolResults) {
    for (const v of r.numericTokens) all.push({ value: v, from: `tool:${r.toolName}` });
  }
  // Top 3 by absolute distance.
  const target = n.value;
  return all
    .map((x) => ({ ...x, dist: Math.abs(x.value - target) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map(({ value, from }) => ({ value, from }));
}

/* ───────────────────── reporting ───────────────────── */

/** Build a short callout-text summary for surfacing to the user. */
export function summarizeReport(report: ProvenanceReport): string {
  if (report.unmatched.length === 0) return "";
  const lines: string[] = [];
  const matchPct = report.totalNumbers === 0 ? 100 : Math.round((report.matched / report.totalNumbers) * 100);
  lines.push(
    `${report.unmatched.length} prose number${report.unmatched.length === 1 ? "" : "s"} could not be traced to either a compute() call or a tool result (${matchPct}% of ${report.totalNumbers} total numbers matched).`,
  );
  for (const issue of report.unmatched.slice(0, 5)) {
    const closest = issue.candidates[0];
    const closestStr = closest
      ? ` Closest match: ${formatNum(closest.value)} from ${closest.from}.`
      : "";
    lines.push(`  • "${issue.number.raw}" in: …${issue.number.context}…${closestStr}`);
  }
  if (report.unmatched.length > 5) {
    lines.push(`  • …and ${report.unmatched.length - 5} more.`);
  }
  return lines.join("\n");
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}
