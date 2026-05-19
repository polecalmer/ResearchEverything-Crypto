// Coverage for applyAxisPolicyToText — the text-splice helper that
// pushes the validator's auto-applied scale/domain back into the
// artifact code fence inside the response text. Without this, the
// validator mutates a JS object that nobody downstream looks at.
import { describe, it, expect } from "vitest";
import { applyAxisPolicyToText } from "./chart-validator";

const buildText = (chartJson: any) => {
  return `Here is the chart:\n\n\`\`\`artifact:chart\n${JSON.stringify(chartJson, null, 2)}\n\`\`\`\n\nNarrative follows.`;
};

describe("applyAxisPolicyToText", () => {
  it("splices scale='log' into the chart fence when policy was applied", () => {
    const json = {
      title: "SERV Price",
      data: [{ date: "2026-01-01", price: 0.02 }, { date: "2026-01-02", price: 4 }],
      yAxes: [{ dataKey: "price", label: "Price", format: "currency" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    // Parsed chart that the validator mutated:
    const mutatedChart = {
      chartConfig: {
        yAxes: [{ dataKey: "price", label: "Price", format: "currency", scale: "log" }],
      },
    };
    const out = applyAxisPolicyToText(text, mutatedChart);
    expect(out).not.toBe(text);
    // The fenced JSON should now contain scale: "log" on yAxes[0]
    const match = out.match(/```artifact:chart\s*\n([\s\S]*?)```/);
    expect(match).toBeTruthy();
    const newJson = JSON.parse(match![1].trim());
    expect(newJson.yAxes[0].scale).toBe("log");
    // Other fields preserved
    expect(newJson.title).toBe("SERV Price");
    expect(newJson.yAxes[0].format).toBe("currency");
  });

  it("no-op when no yAxis has scale/domain set", () => {
    const json = {
      title: "Normal Chart",
      data: [{ date: "2026-01-01", value: 50 }],
      yAxes: [{ dataKey: "value", label: "Value" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const cleanChart = {
      chartConfig: { yAxes: [{ dataKey: "value", label: "Value" }] },
    };
    const out = applyAxisPolicyToText(text, cleanChart);
    expect(out).toBe(text); // unchanged
  });

  it("no-op when text has no chart fence", () => {
    const text = "Just prose, no chart artifact here.";
    const mutatedChart = {
      chartConfig: { yAxes: [{ dataKey: "x", scale: "log" }] },
    };
    expect(applyAxisPolicyToText(text, mutatedChart)).toBe(text);
  });

  it("preserves dual-axis configuration: only mutated yAxes get scale", () => {
    const json = {
      title: "Dual",
      data: [],
      yAxes: [
        { dataKey: "a", label: "A" },
        { dataKey: "b", label: "B", format: "percent" },
      ],
      chartType: "composed",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const mutatedChart = {
      chartConfig: {
        yAxes: [
          { dataKey: "a", scale: "log" },
          { dataKey: "b", format: "percent" }, // no scale set on this one
        ],
      },
    };
    const out = applyAxisPolicyToText(text, mutatedChart);
    const match = out.match(/```artifact:chart\s*\n([\s\S]*?)```/);
    const newJson = JSON.parse(match![1].trim());
    expect(newJson.yAxes[0].scale).toBe("log");
    expect(newJson.yAxes[1].scale).toBeUndefined();
  });

  it("includes optional domain field when present", () => {
    const json = {
      title: "Clipped",
      data: [],
      yAxes: [{ dataKey: "x", label: "X" }],
      chartType: "line",
      xAxis: { dataKey: "date" },
    };
    const text = buildText(json);
    const mutatedChart = {
      chartConfig: {
        yAxes: [{ dataKey: "x", scale: "log", domain: [0.001, 10] }],
      },
    };
    const out = applyAxisPolicyToText(text, mutatedChart);
    const match = out.match(/```artifact:chart\s*\n([\s\S]*?)```/);
    const newJson = JSON.parse(match![1].trim());
    expect(newJson.yAxes[0].scale).toBe("log");
    expect(newJson.yAxes[0].domain).toEqual([0.001, 10]);
  });

  it("survives malformed JSON in fence (returns input unchanged)", () => {
    const text = "Here:\n\n```artifact:chart\nnot valid json {{{\n```\n";
    const mutatedChart = { chartConfig: { yAxes: [{ scale: "log" }] } };
    expect(applyAxisPolicyToText(text, mutatedChart)).toBe(text);
  });
});
