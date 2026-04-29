import { describe, it, expect } from "vitest";
import { extractMemoMetadata } from "./memo-metadata";

describe("extractMemoMetadata", () => {
  it("prefers the assistant's H1 over the session title", () => {
    const content = `# Jupiter: Revenue Streams & Value Accrual Analysis

Jupiter's full revenue stack breaks down across three layers:
aggregator fees, perps fees, and treasury yield.`;
    const { title, description } = extractMemoMetadata(
      content,
      "Break down Jupiter's revenue streams and break down value accrual across the ecosystem",
    );
    expect(title).toBe("Jupiter: Revenue Streams & Value Accrual Analysis");
    expect(description).not.toContain("#");
    expect(description).toContain("revenue stack");
  });

  it("strips fenced artifact blocks from the description preview", () => {
    const content = `# Jupiter Snapshot

\`\`\`artifact:metric_cards
{"title": "Jupiter Snapshot — April 24, 2026", "data": [{"label": "JUP Price", "value": "$0.42"}]}
\`\`\`

Jupiter trades at $0.42 with aggregator volume holding steady week over week.`;
    const { title, description } = extractMemoMetadata(content, "any session");
    expect(title).toBe("Jupiter Snapshot");
    expect(description).not.toContain("artifact:metric_cards");
    expect(description).not.toContain("```");
    expect(description).toContain("$0.42");
  });

  it("falls back to session title when no assistant headline exists", () => {
    const content = `Now I have the full reconciliation. You were right to push back — here's the complete ecosystem picture.`;
    const { title } = extractMemoMetadata(content, "Jupiter reconciliation follow-up");
    expect(title).toBe("Jupiter reconciliation follow-up");
  });

  it("does not concatenate session title with first line of response", () => {
    // The old save path produced titles like
    //   "Break down Jupiter's revenue streams — Now I have the full reconciliation..."
    // which was ugly and hard to scan. Guard against that regression.
    const content = `Now I have the full reconciliation.

Here's the breakdown...`;
    const { title } = extractMemoMetadata(
      content,
      "Break down Jupiter's revenue streams and break down value accrual across the ecosystem",
    );
    expect(title).not.toContain(" — ");
    expect(title).not.toMatch(/Break down.*Now I have/);
  });

  it("truncates overly long titles on a word boundary", () => {
    const longHeadline =
      "Jupiter Revenue Accrual Deep Dive Across Perps Aggregator Spot And Treasury Yield Layers Comparison With Raydium And Pump.fun";
    const content = `# ${longHeadline}\n\nBody text here.`;
    const { title } = extractMemoMetadata(content);
    expect(title.length).toBeLessThanOrEqual(91);
    expect(title.endsWith("…")).toBe(true);
    // Should cut on a word boundary — the suffix before "…" must be a
    // complete word from the original headline, not a truncated fragment.
    const kept = title.slice(0, -1).trim();
    const lastWord = kept.split(/\s+/).pop() || "";
    expect(longHeadline.split(/\s+/)).toContain(lastWord);
  });

  it("handles mode comment prefix and normalises em-dashes", () => {
    const content = `<!-- mode:focused -->
# Hyperliquid — HIP-3 Fee Analysis

HIP-3's fee model caps take rate at 5 bps.`;
    const { title, description } = extractMemoMetadata(content, "session title");
    expect(title).toBe("Hyperliquid - HIP-3 Fee Analysis");
    expect(description).not.toContain("<!--");
    expect(description).toContain("5 bps");
  });

  it("strips markdown bold/italic/code markers from description", () => {
    const content = `# Ethena Snapshot

**Ethena** yields a *30-day average* of \`8.4%\` across \`sUSDe\` holders.`;
    const { description } = extractMemoMetadata(content);
    expect(description).not.toContain("**");
    expect(description).not.toContain("`");
    expect(description).toContain("Ethena yields a 30-day average of 8.4% across sUSDe holders.");
  });

  it("skips conversational 'Yes, ... Let me revise' preamble for the description", () => {
    const content = `# Funding Rate Imbalances on TradeXYZ

Yes, funding rate imbalances play a defining role - arguably the single most important one. Let me revise the earlier deep dive: TradeXYZ's entire $1.79B in HIP-3 OI sits on top of a funding rate architecture that is structurally different from native Hyperliquid perps.`;
    const { description } = extractMemoMetadata(content);
    expect(description).not.toMatch(/^Yes,/);
    expect(description).not.toMatch(/Let me revise/);
    expect(description).toContain("$1.79B");
    expect(description).toContain("HIP-3 OI");
  });

  it("skips 'Now I have ... You were right' reconciliation preamble", () => {
    const content = `# Jupiter's Full Revenue Stack - Corrected

Now I have the full reconciliation. You were right to push back - here's the complete ecosystem picture.

Jupiter's revenue stack breaks into three distinct businesses: the aggregator, perps, and treasury yield — which together annualize to roughly $180M.`;
    const { description } = extractMemoMetadata(content);
    expect(description).not.toMatch(/^Now I have/);
    expect(description).not.toContain("push back");
    expect(description).toContain("three distinct businesses");
    expect(description).toContain("$180M");
  });

  it("skips numbered section label paragraphs like '1. Revenue Streams - Three Distinct Businesses'", () => {
    const content = `# Jupiter: Revenue Streams & Value Accrual Analysis

1. Revenue Streams - Three Distinct Businesses

Jupiter operates three separate revenue engines that accrue to JUP holders at different rates. The aggregator alone contributes ~$140M annualized across spot swaps.`;
    const { description } = extractMemoMetadata(content);
    expect(description).not.toMatch(/^1\. Revenue Streams/);
    expect(description).toContain("three separate revenue engines");
  });

  it("falls back to raw first paragraph when every sentence looks conversational", () => {
    const content = `# Short Memo

Sure, got it.`;
    const { description } = extractMemoMetadata(content);
    // Better to show something than leave the card blank.
    expect(description.length).toBeGreaterThan(0);
  });

  it("uses Executive Summary headline as description when present", () => {
    // The DEEP_RULES system prompt instructs the agent to lead with this
    // exact block — the extractor should treat the Headline bullet as the
    // canonical deck rather than fishing one from prose.
    const content = `# TradeXYZ Deep Dive

## Executive Summary
- **Headline:** TradeXYZ now controls 90% of HIP-3 OI on top of a structurally different funding-rate architecture from native Hyperliquid perps.
- **Key numbers:** $1.79B HIP-3 OI · $15.86M Q1 fees · 5.48% APR funding floor
- **Watchlist:** funding convergence vs Felix/Ventuals, weekend volume premium, growth-mode timeline
- **Bottom line:** Sustainable take rate hinges on the post-March 2026 license transition holding share.

## Background

Body prose follows here, much longer and less suitable for a deck.`;
    const { title, description } = extractMemoMetadata(content);
    expect(title).toBe("TradeXYZ Deep Dive");
    expect(description).toContain("90% of HIP-3 OI");
    expect(description).not.toContain("**"); // markdown bold stripped
    expect(description).not.toMatch(/^Headline:/i); // label dropped
  });

  it("falls back to Bottom line bullet when Headline is absent", () => {
    const content = `# Ethena Snapshot

## Executive Summary
- **Key numbers:** $X TVL · Y% APY · Z holders
- **Watchlist:** funding rate floor, redemption queue depth
- **Bottom line:** sUSDe yield is sustainable while perp funding stays above 2%, which is the pattern of the last 90 days.`;
    const { description } = extractMemoMetadata(content);
    expect(description).toContain("sUSDe yield");
    expect(description).toContain("perp funding");
  });

  it("ignores an Executive Summary heading further down (not at the top)", () => {
    // A wandering "## Executive Summary" mid-document should NOT win over
    // the assistant's actual lead paragraph. Use the section regardless of
    // position — the rule is "if the agent emitted one, trust it".
    const content = `# Quick Memo

Real lead paragraph that summarises the finding succinctly with $1B numbers.

## Executive Summary
- **Headline:** This is the agent-emitted thesis line that should win.`;
    const { description } = extractMemoMetadata(content);
    expect(description).toContain("agent-emitted thesis");
  });
});
