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
//   detectDeepFollowupShortCircuit   — deep-mode persistence: methodology
//                                      pushbacks on prior deep work stay
//                                      in deep mode (no LLM call)
import { describe, it, expect } from "vitest";
import {
  parseArtifacts,
  splitChartIntents,
  inferRefreshRecipeFromToolHistory,
  sanitizeInternalSourceLabels,
  detectDeepFollowupShortCircuit,
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

  it("parses a file_download artifact with subtype + filename + url", () => {
    // write_xlsx / write_csv emit a JSON object the agent re-embeds verbatim
    // as ```artifact:file_download```. The parser must land it on
    // msg.artifacts so the client side panel can render the FileChip.
    const content = [
      "```artifact:file_download",
      JSON.stringify({
        type: "file_download",
        subtype: "xlsx",
        filename: "hyperliquid_model_abc123.xlsx",
        url: "/api/research/artifacts/sess-1/hyperliquid_model_abc123.xlsx",
        sizeBytes: 24576,
        sheets: 3,
        title: "Hyperliquid valuation model",
      }),
      "```",
    ].join("\n");
    const a = parseArtifacts(content)[0] as any;
    expect(a.type).toBe("file_download");
    expect(a.subtype).toBe("xlsx");
    expect(a.filename).toBe("hyperliquid_model_abc123.xlsx");
    expect(a.url).toBe("/api/research/artifacts/sess-1/hyperliquid_model_abc123.xlsx");
    expect(a.sizeBytes).toBe(24576);
    expect(a.sheets).toBe(3);
    expect(a.title).toBe("Hyperliquid valuation model");
  });

  it("skips a file_download artifact missing url or filename", () => {
    // No url → nothing to download. No filename → chip has no label.
    // Either way: drop silently rather than poison the artifact list.
    const noUrl = [
      "```artifact:file_download",
      JSON.stringify({ subtype: "csv", filename: "x.csv" }),
      "```",
    ].join("\n");
    const noFilename = [
      "```artifact:file_download",
      JSON.stringify({ subtype: "csv", url: "/api/research/artifacts/s/x.csv" }),
      "```",
    ].join("\n");
    expect(parseArtifacts(noUrl)).toEqual([]);
    expect(parseArtifacts(noFilename)).toEqual([]);
  });
});

describe("sanitizeInternalSourceLabels", () => {
  it("coerces 'Brain' in the Sources H2 line to 'Sessions'", () => {
    const input = [
      "Some prose here.",
      "",
      "## Sources",
      "DeFiLlama, Brain, Dune Analytics",
      "",
    ].join("\n");
    const out = sanitizeInternalSourceLabels(input);
    expect(out).toContain("## Sources\nDeFiLlama, Sessions, Dune Analytics");
    expect(out).not.toMatch(/, Brain[,\s]/);
  });

  it("coerces 'Analyst corpus' to 'Sessions'", () => {
    const input = [
      "## Sources",
      "DeFiLlama, Analyst corpus, CoinGecko",
    ].join("\n");
    const out = sanitizeInternalSourceLabels(input);
    expect(out).toContain("DeFiLlama, Sessions, CoinGecko");
  });

  it("deduplicates Sessions when multiple internal labels collapse together", () => {
    const input = [
      "## Sources",
      "DeFiLlama, Brain, Analyst corpus, Skill packs, Dune Analytics",
    ].join("\n");
    const out = sanitizeInternalSourceLabels(input);
    // All three internal labels collapse to one "Sessions".
    expect(out).toContain("DeFiLlama, Sessions, Dune Analytics");
    expect(out.match(/Sessions/g)?.length).toBe(1);
  });

  it("leaves prose containing 'brain' outside the Sources section alone", () => {
    const input = [
      "The team's brain trust knew the answer.",
      "",
      "## Sources",
      "DeFiLlama",
    ].join("\n");
    const out = sanitizeInternalSourceLabels(input);
    expect(out).toContain("brain trust");
  });

  it("rewrites internal labels inside an artifact:sources JSON block", () => {
    const input = [
      "Some prose.",
      "```artifact:sources",
      JSON.stringify({ sources: ["DeFiLlama", "Brain", "Analyst corpus"] }),
      "```",
    ].join("\n");
    const out = sanitizeInternalSourceLabels(input);
    expect(out).toContain('"Sessions"');
    expect(out).not.toContain('"Brain"');
    expect(out).not.toContain('"Analyst corpus"');
  });

  it("returns the input unchanged when there is no Sources section or artifact block", () => {
    const input = "Just some prose with no sources annotation.";
    expect(sanitizeInternalSourceLabels(input)).toBe(input);
  });
});

describe("detectDeepFollowupShortCircuit (deep-mode persistence)", () => {
  const deepPrior = [
    { role: "user", content: "build me a financial model" },
    { role: "assistant", content: "<!-- mode:deep -->\n# Model...", kind: "deep_model" },
  ];
  const focusedPrior = [
    { role: "user", content: "show me TVL chart" },
    { role: "assistant", content: "chart here", kind: undefined },
  ];

  it("returns null when there is no prior assistant turn", () => {
    expect(detectDeepFollowupShortCircuit("how are you calculating SBC?", [])).toBeNull();
  });

  it("returns null when the prior assistant turn was not deep_model", () => {
    expect(
      detectDeepFollowupShortCircuit("how are you calculating SBC? It seems understated", focusedPrior),
    ).toBeNull();
  });

  it("catches methodology pushback ('how are you calculating X')", () => {
    // The exact failure mode that motivated the fix.
    const out = detectDeepFollowupShortCircuit(
      "How are you calculating validator SBC? I think you might be understating it",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
    expect(out?.reason).toContain("methodology pushback");
  });

  it("catches under/overstatement corrections", () => {
    const out = detectDeepFollowupShortCircuit(
      "you might be understating revenue here — refresh the forecast",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
  });

  it("catches explicit re-run requests", () => {
    const out = detectDeepFollowupShortCircuit(
      "rerun the model with the corrected SBC line",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
    expect(out?.reason).toContain("re-run");
  });

  it("catches extension requests ('also include X')", () => {
    const out = detectDeepFollowupShortCircuit(
      "include HIP-3 priority fees in the forecast as a separate revenue line",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
    expect(out?.reason).toContain("extension");
  });

  it("catches scenario changes ('what if X')", () => {
    const out = detectDeepFollowupShortCircuit(
      "what if base case revenue assumes 30% growth instead of 50%",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
    expect(out?.reason).toContain("scenario");
  });

  it("catches direct critiques ('your model is wrong / off')", () => {
    const out = detectDeepFollowupShortCircuit(
      "your model is off — the validator emissions number looks stale",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
  });

  it("respects explicit downgrade ('quick question')", () => {
    expect(
      detectDeepFollowupShortCircuit(
        "quick question: how are you calculating SBC?",
        deepPrior,
      ),
    ).toBeNull();
  });

  it("respects explicit downgrade ('tldr')", () => {
    expect(
      detectDeepFollowupShortCircuit(
        "tldr — what's the punchline of the forecast?",
        deepPrior,
      ),
    ).toBeNull();
  });

  it("respects explicit downgrade ('in one line')", () => {
    expect(
      detectDeepFollowupShortCircuit(
        "in one line, what's the base case P/E target you derived?",
        deepPrior,
      ),
    ).toBeNull();
  });

  it("returns null for very short clarifications (<25 chars)", () => {
    expect(detectDeepFollowupShortCircuit("nice, thx", deepPrior)).toBeNull();
    expect(detectDeepFollowupShortCircuit("what's MAU?", deepPrior)).toBeNull();
  });

  it("catches substantive iteration via soft signal (numeric pushback + length)", () => {
    // No hard refinement pattern but has a numeric reference + >80 chars +
    // prior was deep. Should still stay deep.
    const out = detectDeepFollowupShortCircuit(
      "the FDV multiple in the bull case implies a 12x P/E by November — that seems aggressive given current 23% APR validator yields",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
    expect(out?.reason).toContain("substantive");
  });

  it("catches data-source references as soft signal", () => {
    const out = detectDeepFollowupShortCircuit(
      "can you pull the validator stake amounts from the Hyperliquid info API and feed them into the SBC line",
      deepPrior,
    );
    expect(out?.mode).toBe("deep");
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
