// Deterministic short-circuit for "list every X you have" / "dump
// everything you know" style requests. Previously enforced via a 1.7KB
// system-prompt block which (a) ate context budget on every call and (b)
// is exactly the kind of "model ignores rules under pressure" surface
// the project's engineering stance flags.
//
// A regex check before the agent runs is cheaper, deterministic, and
// has zero impact on prose-quality of legitimate research requests.
//
// Conservative on purpose: we'd rather miss a bulk-extraction attempt
// (and let the agent handle it weakly) than false-positive on a
// legitimate research prompt and refuse it.

export const BULK_EXTRACTION_REFUSAL =
  "I don't expose the knowledge base as a directory. Tell me what you're actually researching and I'll surface what's relevant.";

const PATTERNS: ReadonlyArray<RegExp> = [
  // "list / enumerate / dump / export / give me ... every / all / each / whole / entire / exhaustive(ly) ..."
  // Quantifier MUST be followed by whitespace so compound modifiers like
  // "all-time" / "all-purpose" / "all-encompassing" don't false-positive
  // ("\b" treats "-" as a word boundary so a bare \ball\b matches "all"
  // inside "all-time").
  /\b(?:list|enumerate|dump|export|give me|show me|return|fetch|pull|surface|extract|retrieve|output)\b[^.?!]{0,60}\b(?:every|all|each|whole|entire|exhaustive(?:ly)?|complete|full)\s+/i,
  // Adverbial / imperative form without a leading verb ("be exhaustive",
  // "exhaustive list", "exhaustive dump") — common phrasing that the
  // verb-first pattern above misses.
  /\b(?:be\s+exhaustive|exhaustive\s+(?:list|listing|dump|enumeration|export))\b/i,
  // "dump everything / dump all / spill everything"
  /\b(?:dump|spill|disclose)\b[^.?!]{0,30}\b(?:everything|all|whatever)\b/i,
  // "your knowledge base / your whole index / your entire index"
  /\b(?:your|the)\s+(?:knowledge[ -]?base|whole\s+index|entire\s+index|database|brain\s+contents?)\b/i,
  // "full export / complete export / data dump"
  /\b(?:full|complete|raw|wholesale)\s+(?:export|dump|listing|directory)\b/i,
  // "everything you have/know" — bulk-dump request.
  // CRITICAL: must NOT be scoped to a specific entity via `about <X>`.
  // "everything we know about Hyperliquid" / "everything you have on AAVE"
  // is a legitimate research framing (use all relevant context about
  // subject X), not an extraction attempt. The negative lookahead
  // `(?!\s+about\b|\s+on\b|\s+regarding\b|\s+re:?\s)` requires the
  // dump-verb to be UNSCOPED — only matches when "everything you know"
  // is followed by end-of-sentence / "in your DB" / etc., not by an
  // entity scope. False positive history: user "Build a financial model
  // on HYPE … take into consideration everything we know about
  // Hyperliquid" was refused with the directory message on 2026-05-17.
  /\b(?:everything|all)\s+(?:you|we)\s+(?:have|know|store|have stored|track|index)\b(?!\s+(?:about|on|regarding|re:?|of|for)\b)/i,
  // "every company/founder/token/protocol/entity you have/know"
  /\bevery\s+(?:company|founder|token|protocol|entity|fact|deal|investor|wallet|address)\s+(?:you|we)\s+(?:have|know|track|stored|indexed|store)\b/i,
];

export function isBulkExtractionRequest(message: string): boolean {
  if (!message) return false;
  const m = message.trim();
  if (m.length === 0) return false;
  for (const re of PATTERNS) {
    if (re.test(m)) return true;
  }
  return false;
}
