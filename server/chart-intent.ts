// Pure chart-intent detection — no DB, no network, no side effects.
// Extracted from session-research-agent.ts so tests can import it without
// pulling in the whole agent dependency graph.
//
// If you add a pattern here, add positive + negative tests in the .test.ts
// file next door. Short alphanumeric triggers (PE, PS, ARR, etc.) MUST use
// \b word boundaries — see the "bps for" false-positive that leaked
// "P/S for" into this regex set in prod.
//
// FALSE-POSITIVE GUARD (2026-05-17): metric phrases like "fee growth",
// "revenue growth", "take rate" appear naturally in deep-mode prose
// (e.g. "model fee growth from HIP-3 as a separate line"). They MUST
// NOT trigger chart-mode on their own. Pattern #7 originally had an
// OPTIONAL suffix (`?`) which let "Fee Growth" anywhere in a message
// route to the chart pipeline — bricked the validator-SBC follow-up.
// Every metric-phrase pattern now REQUIRES an explicit chart/visual
// suffix.

export const CHART_INTENT_PATTERNS = [
  /(?:build|make|create|show|pull up|plot|graph|chart|draw|generate|give me)\s+(?:(?:me|a|the)\s+)*(?:chart|graph|plot|visualization)/i,
  /(?:chart|graph|plot)\s+(?:of|for|showing|comparing|that\s+(?:tracks?|shows?|compares?))/i,
  // Word boundary on the leading P — prevents "bps for", "bps over",
  // "bps ratio" from matching as "P/S for" etc.
  /\bP[\/-]?(?:E|S|F)\b\s+(?:chart|ratio|over|for)\b/i,
  /(?:FDV|MCAP|TVL|volume|revenue|fees|market\s*share)\s+(?:chart|graph|over|vs|trend|breakdown)/i,
  /(?:show|pull|get|fetch)\s+(?:me\s+)?(?:the\s+)?(?:daily|weekly|monthly|historical)\s+/i,
  /(?:price\s+(?:chart|history|vs)|compare\s+.*(?:chart|graph))/i,
  // Metric-phrase pattern: TWO variants required for match (one of the
  // following must be true). Without one of these, prose like "model fee
  // growth as a revenue line" used to fire and brick deep-mode follow-
  // ups.
  //   (a) metric phrase followed by a chart-shape suffix
  //   (b) metric phrase preceded by a chart-shape verb
  /(?:take\s*rate|capital\s*efficiency|revenue\s*growth|fee\s*growth|volume[\s\/]tvl|fdv[\s\/]tvl)\s+(?:chart|trend|graph|plot|over|breakdown|ratio)\b/i,
  /(?:chart|plot|graph|show|pull|fetch|build|make|create)\s+(?:(?:me|a|the)\s+)*(?:take\s*rate|capital\s*efficiency|revenue\s*growth|fee\s*growth|volume[\s\/]tvl|fdv[\s\/]tvl)\b/i,
  /(?:build|make|create)\s+(?:(?:me|a|the)\s+)*(?:chart|graph|plot|visualization)\b/i,
];

export function isChartRequest(msg: string): boolean {
  return CHART_INTENT_PATTERNS.some(p => p.test(msg));
}
