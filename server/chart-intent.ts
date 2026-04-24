// Pure chart-intent detection — no DB, no network, no side effects.
// Extracted from session-research-agent.ts so tests can import it without
// pulling in the whole agent dependency graph.
//
// If you add a pattern here, add positive + negative tests in the .test.ts
// file next door. Short alphanumeric triggers (PE, PS, ARR, etc.) MUST use
// \b word boundaries — see the "bps for" false-positive that leaked
// "P/S for" into this regex set in prod.

export const CHART_INTENT_PATTERNS = [
  /(?:build|make|create|show|pull up|plot|graph|chart|draw|generate|give me)\s+(?:(?:me|a|the)\s+)*(?:chart|graph|plot|visualization)/i,
  /(?:chart|graph|plot)\s+(?:of|for|showing|comparing|that\s+(?:tracks?|shows?|compares?))/i,
  // Word boundary on the leading P — prevents "bps for", "bps over",
  // "bps ratio" from matching as "P/S for" etc.
  /\bP[\/-]?(?:E|S|F)\b\s+(?:chart|ratio|over|for)\b/i,
  /(?:FDV|MCAP|TVL|volume|revenue|fees|market\s*share)\s+(?:chart|graph|over|vs|trend|breakdown)/i,
  /(?:show|pull|get|fetch)\s+(?:me\s+)?(?:the\s+)?(?:daily|weekly|monthly|historical)\s+/i,
  /(?:price\s+(?:chart|history|vs)|compare\s+.*(?:chart|graph))/i,
  /(?:take\s*rate|capital\s*efficiency|revenue\s*growth|fee\s*growth|volume[\s\/]tvl|fdv[\s\/]tvl)\s*(?:chart|trend|over|for|ratio)?/i,
  /(?:build|make|create)\s+(?:(?:me|a|the)\s+)*(?:chart|graph|plot|visualization)\b/i,
];

export function isChartRequest(msg: string): boolean {
  return CHART_INTENT_PATTERNS.some(p => p.test(msg));
}
