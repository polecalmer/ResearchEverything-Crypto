// Coverage for the Y-axis policy inference. If these regress, the
// "SERV outlier-crush" rendering bug returns: a single $4 spike with
// 199 surrounding $0.02 points pins the linear Y-axis to [0,$4] and
// crushes the real data into a flat line.
import { describe, it, expect } from "vitest";
import { inferYAxisPolicy, enforceChartAxisPolicy } from "./chart-axis-policy";

describe("inferYAxisPolicy — log-scale triggers", () => {
  it("SERV-equivalent: max=4, median=0.02 → log", () => {
    // 199 points around $0.02 + 1 spike at $4 — max/median ≈ 200×
    const values: number[] = [];
    for (let i = 0; i < 199; i++) values.push(0.018 + Math.random() * 0.004);
    values.push(4.0);
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("log");
    expect(policy.reasoning).toMatch(/max\/median/);
  });

  it("token discovery arc: median=$0.005, max=$2 → log", () => {
    // 90% of points live near $0.001-0.01 (early discovery), 10% jump
    // to $1-2 after a parabolic move. Median is in the cluster (~$0.005);
    // max ≥ 50× median → log.
    const cluster = Array.from({ length: 90 }, () => 0.001 + Math.random() * 0.009);
    const breakout = Array.from({ length: 10 }, () => 1 + Math.random());
    const policy = inferYAxisPolicy([...cluster, ...breakout]);
    expect(policy.scale).toBe("log");
  });

  it("single-outlier hypothesis: max/p99 ≥ 5 → log", () => {
    // Mostly clustered, one outlier — max/median ~50 borderline.
    const values: number[] = [];
    for (let i = 0; i < 100; i++) values.push(1 + Math.random() * 0.1);
    values.push(100); // single big outlier
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("log");
  });
});

describe("inferYAxisPolicy — linear-scale defaults", () => {
  it("normal price range: median=$50, max=$80 → linear", () => {
    const values = Array.from({ length: 180 }, () => 30 + Math.random() * 50);
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("linear");
  });

  it("HYPE-like steady-state TVL: tight range → linear", () => {
    const values = Array.from({ length: 365 }, () => 8_000_000_000 + Math.random() * 2_000_000_000);
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("linear");
  });

  it("all-same-value series → linear (no division by tiny median)", () => {
    const values = Array.from({ length: 50 }, () => 100);
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("linear");
  });
});

describe("inferYAxisPolicy — forced linear (cannot use log)", () => {
  it("contains negative values (PnL series) → linear even if range is wide", () => {
    const values = [-1000, -500, -10, 0, 10, 500, 1000, 100000];
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("linear");
    expect(policy.reasoning).toMatch(/negative/);
  });

  it("contains exactly zero → linear", () => {
    const values = [0, 0.01, 0.1, 1, 10, 100];
    const policy = inferYAxisPolicy(values);
    expect(policy.scale).toBe("linear");
    expect(policy.reasoning).toMatch(/zero/);
  });

  it("percent format → linear regardless of range", () => {
    // Even if percentages span 0.01% to 99% (~10000× ratio), log
    // is the wrong choice — percent series should always be linear
    // so the visual scale matches the user's mental model.
    const values = [0.0001, 0.001, 0.01, 0.1, 0.5, 0.99];
    const policy = inferYAxisPolicy(values, "percent");
    expect(policy.scale).toBe("linear");
    expect(policy.reasoning).toMatch(/percent/);
  });

  it("basisPoints format → linear", () => {
    const values = [0.0001, 0.001, 0.01, 0.1];
    const policy = inferYAxisPolicy(values, "basisPoints");
    expect(policy.scale).toBe("linear");
  });
});

describe("inferYAxisPolicy — edge cases", () => {
  it("empty array → linear", () => {
    const policy = inferYAxisPolicy([]);
    expect(policy.scale).toBe("linear");
  });

  it("only NaN / null → linear (no finite values)", () => {
    const policy = inferYAxisPolicy([NaN, null, undefined, NaN]);
    expect(policy.scale).toBe("linear");
    expect(policy.reasoning).toMatch(/no finite/);
  });

  it("single value → linear", () => {
    const policy = inferYAxisPolicy([42]);
    expect(policy.scale).toBe("linear");
  });

  it("respects custom maxOverMedianTrigger threshold", () => {
    // Default threshold is 50. With a 100× ratio at threshold=200, no log.
    const values: number[] = [];
    for (let i = 0; i < 99; i++) values.push(1);
    values.push(100); // 100× the median
    expect(inferYAxisPolicy(values).scale).toBe("log");                // default 50
    expect(inferYAxisPolicy(values, undefined, { maxOverMedianTrigger: 200, maxOverP99Trigger: 200 }).scale).toBe("linear"); // raised
  });
});

describe("enforceChartAxisPolicy — end-to-end text transform", () => {
  const buildText = (chartJson: any) =>
    `Prose here.\n\n\`\`\`artifact:chart\n${JSON.stringify(chartJson, null, 2)}\n\`\`\`\n\nMore prose.`;

  it("applies scale=log to chart with SERV-style data", () => {
    const data = Array.from({ length: 199 }, (_, i) => ({
      date: `2026-01-${(i % 28) + 1}`,
      price: 0.018 + Math.random() * 0.004,
    }));
    data.push({ date: "2026-05-01", price: 4.0 });
    const json = {
      title: "SERV Price",
      data,
      yAxes: [{ dataKey: "price", label: "Price", format: "currency" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const out = enforceChartAxisPolicy(text);
    expect(out).not.toBe(text);
    const match = out.match(/```artifact:chart\s*\n([\s\S]*?)```/);
    const newJson = JSON.parse(match![1].trim());
    expect(newJson.yAxes[0].scale).toBe("log");
    // Other fields preserved
    expect(newJson.title).toBe("SERV Price");
    expect(newJson.yAxes[0].format).toBe("currency");
  });

  it("no-op when chart has normal-range data", () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      date: `2026-01-${(i % 28) + 1}`,
      price: 50 + Math.random() * 30,
    }));
    const json = {
      title: "Normal Price",
      data,
      yAxes: [{ dataKey: "price", label: "Price", format: "currency" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const out = enforceChartAxisPolicy(text);
    expect(out).toBe(text); // unchanged
  });

  it("respects agent-provided scale=linear (does not override)", () => {
    const data = Array.from({ length: 200 }, (_, i) => ({
      date: `2026-01-${(i % 28) + 1}`,
      price: i === 0 ? 4 : 0.02,
    }));
    const json = {
      title: "SERV (agent forced linear)",
      data,
      yAxes: [{ dataKey: "price", label: "Price", scale: "linear" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const out = enforceChartAxisPolicy(text);
    // Even though data triggers log, agent-provided linear wins.
    const match = out.match(/```artifact:chart\s*\n([\s\S]*?)```/);
    const newJson = JSON.parse(match![1].trim());
    expect(newJson.yAxes[0].scale).toBe("linear");
  });

  it("no-op when text has no chart fence", () => {
    const text = "Just narrative, no chart here.";
    expect(enforceChartAxisPolicy(text)).toBe(text);
  });

  it("survives malformed JSON in fence", () => {
    const text = "Prose:\n\n```artifact:chart\nbroken {{{ json\n```\n";
    expect(enforceChartAxisPolicy(text)).toBe(text);
  });

  it("handles multiple chart fences in one response", () => {
    const wideRange = {
      title: "Wide",
      data: Array.from({ length: 100 }, (_, i) => ({ d: i, v: i === 0 ? 100 : 1 })),
      yAxes: [{ dataKey: "v", label: "V" }],
      chartType: "line",
      xAxis: { dataKey: "d" },
    };
    const normal = {
      title: "Normal",
      data: Array.from({ length: 100 }, (_, i) => ({ d: i, v: 50 + i * 0.1 })),
      yAxes: [{ dataKey: "v", label: "V" }],
      chartType: "line",
      xAxis: { dataKey: "d" },
    };
    const text = `${buildText(wideRange)}\n\n${buildText(normal)}`;
    const out = enforceChartAxisPolicy(text);
    const matches = [...out.matchAll(/```artifact:chart\s*\n([\s\S]*?)```/g)];
    expect(matches).toHaveLength(2);
    const first = JSON.parse(matches[0][1].trim());
    const second = JSON.parse(matches[1][1].trim());
    expect(first.yAxes[0].scale).toBe("log");
    expect(second.yAxes[0].scale).toBeUndefined();
  });
});
