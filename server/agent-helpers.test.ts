// Pure-function coverage for the agent helpers exported from
// server/session-research-agent.ts. The full agent loop is too entangled
// (Anthropic + Dune + DefiLlama + Voyage + storage + brain) to mock-test
// usefully — that's better covered by integration / staging. What we CAN
// cover, and what gives real signal when it breaks, is the deterministic
// pieces:
//
//   parseArtifacts                   — turns model output into structured
//                                      chart/table/etc. (users don't see
//                                      a chart if this regresses)
//   splitChartIntents                — recognises multi-chart prompts so
//                                      the fan-out planner runs
//   inferRefreshRecipeFromToolHistory— attaches recipes to artifacts so
//                                      "save to library" can refresh them
import { describe, it, expect } from "vitest";
import {
  parseArtifacts,
  splitChartIntents,
  inferRefreshRecipeFromToolHistory,
} from "./session-research-agent";

describe("parseArtifacts", () => {
  it("returns [] when the content has no artifact code fences", () => {
    expect(parseArtifacts("Just plain text, nothing here.")).toEqual([]);
  });

  it("parses a chart artifact with title + data + yAxes", () => {
    const content = [
      "Some preamble.",
      "```artifact:chart",
      JSON.stringify({
        title: "Hyperliquid revenue",
        subtitle: "12-month trend",
        source: "defillama",
        chartType: "line",
        data: [
          { date: "2025-01-01", revenue: 1.2 },
          { date: "2025-02-01", revenue: 1.5 },
        ],
        yAxes: [{ dataKey: "revenue", label: "Revenue ($M)" }],
      }),
      "```",
      "Trailing prose.",
    ].join("\n");

    const artifacts = parseArtifacts(content);
    expect(artifacts).toHaveLength(1);
    const a = artifacts[0] as any;
    expect(a.type).toBe("chart");
    expect(a.title).toBe("Hyperliquid revenue");
    expect(a.subtitle).toBe("12-month trend");
    expect(a.source).toBe("defillama");
    expect(a.data.length).toBe(2);
    expect(a.chartConfig.chartType).toBe("line");
    expect(a.chartConfig.yAxes[0].dataKey).toBe("revenue");
  });

  it("preserves refreshRecipe on chart artifacts when present", () => {
    const content = [
      "```artifact:chart",
      JSON.stringify({
        title: "x",
        data: [],
        refreshRecipe: { dataSource: "defillama", endpoint: "tvl", slug: "aave" },
      }),
      "```",
    ].join("\n");
    const a = parseArtifacts(content)[0] as any;
    expect(a.refreshRecipe?.endpoint).toBe("tvl");
    expect(a.refreshRecipe?.slug).toBe("aave");
  });

  it("parses a table artifact and infers columns from the first row", () => {
    const content = [
      "```artifact:table",
      JSON.stringify({
        title: "Top protocols",
        data: [{ name: "Aave", tvl: 12.3 }, { name: "Lido", tvl: 30.1 }],
      }),
      "```",
    ].join("\n");
    const a = parseArtifacts(content)[0] as any;
    expect(a.type).toBe("table");
    expect(a.columns).toEqual(["name", "tvl"]);
    expect(a.data.length).toBe(2);
  });

  it("parses metric_cards, callout, comparison, and quote", () => {
    const content = [
      "```artifact:metric_cards",
      JSON.stringify({ title: "Snapshot", data: [{ label: "TVL", value: "$5B" }] }),
      "```",
      "```artifact:callout",
      JSON.stringify({ variant: "risk", title: "Heads up", text: "Market thin." }),
      "```",
      "```artifact:comparison",
      JSON.stringify({
        title: "A vs B",
        left: { label: "A", items: ["a1", "a2"] },
        right: { label: "B", items: ["b1"] },
      }),
      "```",
      "```artifact:quote",
      JSON.stringify({ text: "Liquidity is fragile.", attribution: "Hayden" }),
      "```",
    ].join("\n");

    const types = parseArtifacts(content).map((a) => a.type);
    expect(types).toEqual(["metric_cards", "callout", "comparison", "quote"]);
  });

  it("skips a malformed-JSON artifact body without throwing", () => {
    const content = [
      "```artifact:chart",
      "{ not json at all }",
      "```",
      "```artifact:chart",
      JSON.stringify({ title: "Good chart", data: [{ x: 1 }] }),
      "```",
    ].join("\n");
    const artifacts = parseArtifacts(content);
    expect(artifacts).toHaveLength(1);
    expect((artifacts[0] as any).title).toBe("Good chart");
  });

  it("clamps callout variant to a known value", () => {
    const content = [
      "```artifact:callout",
      JSON.stringify({ variant: "made-up-variant", text: "..." }),
      "```",
    ].join("\n");
    const a = parseArtifacts(content)[0] as any;
    // Unknown variants fall back to "insight".
    expect(a.variant).toBe("insight");
  });
});

describe("splitChartIntents", () => {
  it("returns [original] for a single-chart prompt", () => {
    const result = splitChartIntents("Build a TVL chart for Aave");
    expect(result).toEqual(["Build a TVL chart for Aave"]);
  });

  it("splits parenthesised intents joined by 'and'", () => {
    const out = splitChartIntents(
      "Hyperliquid vs Lighter (weekly volume marketshare) and (weekly revenue marketshare) over 6 months",
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("weekly volume marketshare");
    expect(out[0]).toContain("Hyperliquid vs Lighter");
    expect(out[0]).toContain("over 6 months");
    expect(out[1]).toContain("weekly revenue marketshare");
  });

  it("splits 'share of X' patterns into separate prompts with the inferred subject", () => {
    const out = splitChartIntents(
      "Show me Aave's share of total volume and share of total revenue",
    );
    expect(out.length).toBe(2);
    expect(out[0].toLowerCase()).toContain("share of");
    expect(out[0].toLowerCase()).toContain("volume");
    expect(out[1].toLowerCase()).toContain("share of");
    expect(out[1].toLowerCase()).toContain("revenue");
  });
});

describe("inferRefreshRecipeFromToolHistory", () => {
  it("returns null for an empty tool history", () => {
    const recipe = inferRefreshRecipeFromToolHistory({ title: "x" }, []);
    expect(recipe).toBeNull();
  });

  it("matches a DeFiLlama TVL call by protocol token in the title", () => {
    const recipe = inferRefreshRecipeFromToolHistory(
      { title: "Aave TVL — 12 months" },
      [{ name: "query_defillama_tvl", input: { protocol: "aave", daysBack: 365 } }],
    );
    expect(recipe).toEqual({
      dataSource: "defillama",
      endpoint: "tvl",
      slug: "aave",
      protocol: "aave",
      timeWindowDays: 365,
    });
  });

  it("picks the revenue endpoint for query_defillama_fees_revenue when yAxes mention revenue", () => {
    const recipe = inferRefreshRecipeFromToolHistory(
      {
        title: "Hyperliquid revenue",
        chartConfig: { yAxes: [{ dataKey: "revenue", label: "Revenue ($M)" }] },
      },
      [{ name: "query_defillama_fees_revenue", input: { protocol: "hyperliquid" } }],
    );
    expect(recipe?.endpoint).toBe("revenue");
  });

  it("falls back to fees when yAxes don't mention revenue", () => {
    const recipe = inferRefreshRecipeFromToolHistory(
      {
        title: "Hyperliquid fees",
        chartConfig: { yAxes: [{ dataKey: "fees", label: "Fees ($M)" }] },
      },
      [{ name: "query_defillama_fees_revenue", input: { protocol: "hyperliquid" } }],
    );
    expect(recipe?.endpoint).toBe("fees");
  });

  it("returns null when no tool input matches any artifact token", () => {
    const recipe = inferRefreshRecipeFromToolHistory(
      { title: "Some unrelated thing" },
      [{ name: "query_defillama_tvl", input: { protocol: "aave" } }],
    );
    expect(recipe).toBeNull();
  });

  it("walks history newest-first — the most recent matching call wins", () => {
    const recipe = inferRefreshRecipeFromToolHistory(
      { title: "Aave TVL" },
      [
        { name: "query_defillama_tvl", input: { protocol: "aave", daysBack: 30 } },
        { name: "query_defillama_tvl", input: { protocol: "aave", daysBack: 365 } },
      ],
    );
    expect(recipe?.timeWindowDays).toBe(365);
  });
});
