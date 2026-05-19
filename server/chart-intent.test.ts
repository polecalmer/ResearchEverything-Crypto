import { describe, it, expect } from "vitest";

import { isChartRequest } from "./chart-intent";

describe("isChartRequest — positive cases", () => {
  const shouldMatch = [
    "Build a P/E chart for HYPE",
    "Show P/S ratio for AAVE",
    "Chart the take rate for Uniswap",
    "What's Uniswap's take rate trend?",
    "Compare HYPE fees vs revenue in a chart",
    "Build me a chart of AAVE TVL",
    "Show me the daily volume for Lido",
    "FDV/TVL ratio for Lido",
    "revenue growth chart for Hyperliquid",
    "P/E over last year",
    "chart PS over the year",
  ];

  for (const q of shouldMatch) {
    it(`matches: "${q}"`, () => {
      expect(isChartRequest(q)).toBe(true);
    });
  }
});

describe("isChartRequest — known misses (document + follow up)", () => {
  // These are phrases that SHOULD route to chart mode but don't under the
  // current regex set. Captured as tests so the gap is tracked.
  // Fix by extending CHART_INTENT_PATTERNS and flipping the assertion.
  const knownMisses = [
    "Plot daily revenue for Jupiter", // "plot <metric>" (no "chart/graph" suffix)
  ];

  for (const q of knownMisses) {
    it.skip(`(known miss, pending fix) "${q}"`, () => {
      expect(isChartRequest(q)).toBe(true);
    });
  }
});

describe("isChartRequest — negative cases (false-positive regressions)", () => {
  const shouldNotMatch = [
    // The one that slipped: "bps for" was matching as "P/S for" because the
    // regex had no word boundary on the leading P.
    "How is Jupiter able to charge 14.5bps for its perps offering?",
    "Competitors charge FAR less, like ~5bps for blended aggregator routing",
    // Plain analytical questions, no chart intent
    "What is Jupiter?",
    "Explain how Hyperliquid's Assistance Fund works",
    "Who are the biggest perp DEX competitors?",
    "Should I buy HYPE?",
    // Narrative-only prompts
    "Write me a memo on Ethena's risks",
    "Summarize the latest DeFi news",
    // 2026-05-17 false-positive: "Fee Growth" / "Revenue Growth" / "take
    // rate" appearing in deep-mode prose used to route to chart pipeline
    // because pattern #7 had an OPTIONAL chart-suffix. These now require
    // an explicit chart/trend/graph/plot/over/breakdown suffix.
    "How are you calculating validator SBC? I think you might be understating it. Also account for Fee Growth from HIP-3 in non growth mode (use tradexyz as proxy for earnings)",
    "model fee growth from HIP-3 as a separate revenue line in the forecast",
    "include revenue growth from priority fees in the next version of the model",
    "factor in fee growth and take rate compression when projecting forward",
    "the take rate assumption looks too aggressive — what's the historical median?",
  ];

  for (const q of shouldNotMatch) {
    it(`does NOT match: "${q}"`, () => {
      expect(isChartRequest(q)).toBe(false);
    });
  }
});
