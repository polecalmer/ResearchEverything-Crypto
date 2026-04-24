import { describe, it, expect } from "vitest";
import {
  extractMode,
  inferFormat,
  formatValue,
  formatAxisTick,
} from "./research-utils";

describe("extractMode", () => {
  it("strips a standard <!-- mode:focused --> prefix", () => {
    const input = "<!-- mode:focused -->\nHello world";
    const { mode, cleaned } = extractMode(input);
    expect(mode).toBe("focused");
    expect(cleaned).toBe("Hello world");
  });

  it("strips all three modes", () => {
    for (const m of ["quick", "focused", "deep"] as const) {
      const { mode, cleaned } = extractMode(`<!-- mode:${m} -->\nX`);
      expect(mode).toBe(m);
      expect(cleaned).toBe("X");
    }
  });

  it("tolerates a unicode right arrow instead of ASCII -->", () => {
    // Regression: renderer sometimes converts --> to a rightward arrow,
    // which broke extractMode and leaked the comment into the chat body.
    const { mode, cleaned } = extractMode("<!-- mode:focused →\nBody");
    expect(mode).toBe("focused");
    expect(cleaned).toBe("Body");
  });

  it("returns null mode when the prefix is absent", () => {
    const { mode, cleaned } = extractMode("No mode marker here.");
    expect(mode).toBeNull();
    expect(cleaned).toBe("No mode marker here.");
  });

  it("detects needsContinuation flag", () => {
    const { needsContinuation, cleaned } = extractMode(
      "<!-- mode:deep -->\n<!-- needs_continuation -->\nStuff",
    );
    expect(needsContinuation).toBe(true);
    expect(cleaned).toBe("Stuff");
  });
});

describe("inferFormat", () => {
  it("returns undefined for non-informative input", () => {
    expect(inferFormat(undefined, undefined)).toBeUndefined();
  });

  it("infers currency for revenue/fees/tvl/volume labels", () => {
    expect(inferFormat("revenue")).toBe("currency");
    expect(inferFormat(undefined, "Fees ($)")).toBe("currency");
    expect(inferFormat("tvl")).toBe("currency");
    expect(inferFormat("volume")).toBe("currency");
  });

  it("infers ratio for P/E and multiples", () => {
    expect(inferFormat(undefined, "P/E ratio")).toBe("ratio");
    expect(inferFormat(undefined, "multiple")).toBe("ratio");
  });

  it("infers percent for yield/apr/apy", () => {
    expect(inferFormat("apy")).toBe("percent");
    expect(inferFormat("apr")).toBe("percent");
    expect(inferFormat("yield")).toBe("percent");
  });

  it("prescaled unit detection for ($M), ($B), ($K)", () => {
    expect(inferFormat(undefined, "Revenue ($M)")).toBe("currency_M");
    expect(inferFormat(undefined, "FDV ($B)")).toBe("currency_B");
    expect(inferFormat(undefined, "TVL ($K)")).toBe("currency_K");
  });

  it("explicit format wins over inference when prescaled is absent", () => {
    expect(inferFormat("foo", "bar", "percent")).toBe("percent");
  });
});

describe("formatValue", () => {
  it("formats currency with compact suffixes", () => {
    expect(formatValue(1_500_000_000, "currency")).toBe("$1.50B");
    expect(formatValue(42_500_000, "currency")).toBe("$42.50M");
    expect(formatValue(1234, "currency")).toBe("$1.2K");
  });

  it("formats ratios with trailing x", () => {
    expect(formatValue(12.5, "ratio")).toBe("12.5x");
  });

  it("falls back safely on nullish input", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
  });
});

describe("formatAxisTick", () => {
  it("scales large numbers to K/M/B", () => {
    expect(formatAxisTick(1234)).toBe("1K");
    expect(formatAxisTick(1_500_000)).toBe("1.5M");
    expect(formatAxisTick(2_500_000_000)).toBe("2.5B");
  });

  it("currency with explicit K/M/B suffixes", () => {
    expect(formatAxisTick(42, "currency_K")).toBe("$42K");
    expect(formatAxisTick(100, "currency_M")).toBe("$100M");
  });

  it("percent format", () => {
    expect(formatAxisTick(5.5, "percent")).toBe("5.5%");
  });

  it("ratio format", () => {
    expect(formatAxisTick(15, "ratio")).toBe("15x");
  });
});
