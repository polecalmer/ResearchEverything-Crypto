// Coverage for the cadence-aware chart-sampling helpers added in Phase 2.
// If these regress, the chart pipeline silently decimates the user's
// stated cadence (e.g. "daily" → 17 points/year instead of 365).
import { describe, it, expect } from "vitest";

import {
  maxPointsForCadence,
  inferCadenceFromPrompt,
} from "./session-research-agent";

describe("inferCadenceFromPrompt", () => {
  it("detects 'daily' literals", () => {
    expect(inferCadenceFromPrompt("daily TVL last year")).toBe("daily");
    expect(inferCadenceFromPrompt("show me day-by-day fees")).toBe("daily");
    expect(inferCadenceFromPrompt("per day volume")).toBe("daily");
    expect(inferCadenceFromPrompt("every day for the past 12 months")).toBe("daily");
    expect(inferCadenceFromPrompt("day over day change")).toBe("daily");
    expect(inferCadenceFromPrompt("DoD growth")).toBe("daily");
  });

  it("detects 'weekly' literals", () => {
    expect(inferCadenceFromPrompt("weekly active users")).toBe("weekly");
    expect(inferCadenceFromPrompt("per week MAU")).toBe("weekly");
    expect(inferCadenceFromPrompt("week-over-week change")).toBe("weekly");
    expect(inferCadenceFromPrompt("WoW growth")).toBe("weekly");
  });

  it("detects 'monthly' literals", () => {
    expect(inferCadenceFromPrompt("monthly revenue")).toBe("monthly");
    expect(inferCadenceFromPrompt("per month fees")).toBe("monthly");
    expect(inferCadenceFromPrompt("MoM growth")).toBe("monthly");
  });

  it("detects 'quarterly' literals", () => {
    expect(inferCadenceFromPrompt("quarterly earnings")).toBe("quarterly");
    expect(inferCadenceFromPrompt("QoQ growth")).toBe("quarterly");
  });

  it("returns 'auto' when no cadence keyword is present", () => {
    expect(inferCadenceFromPrompt("Build a chart for HYPE")).toBe("auto");
    expect(inferCadenceFromPrompt("TVL over the last year")).toBe("auto");
    expect(inferCadenceFromPrompt("")).toBe("auto");
    expect(inferCadenceFromPrompt(null)).toBe("auto");
    expect(inferCadenceFromPrompt(undefined)).toBe("auto");
  });

  it("specific cadence wins over generic context", () => {
    expect(inferCadenceFromPrompt("daily TVL — show me monthly aggregate too")).toBe("daily");
    expect(inferCadenceFromPrompt("weekly aggregate of daily fees")).toBe("daily");
  });
});

describe("maxPointsForCadence", () => {
  it("daily → 1100 (≥3yr of daily preserved)", () => {
    expect(maxPointsForCadence("daily")).toBe(1100);
  });

  it("weekly → 520 (≥10yr of weekly preserved)", () => {
    expect(maxPointsForCadence("weekly")).toBe(520);
  });

  it("monthly → 240 (≥20yr of monthly preserved)", () => {
    expect(maxPointsForCadence("monthly")).toBe(240);
  });

  it("quarterly → 80 (≥20yr of quarterly preserved)", () => {
    expect(maxPointsForCadence("quarterly")).toBe(80);
  });

  it("auto → 365 (legacy default)", () => {
    expect(maxPointsForCadence("auto")).toBe(365);
  });

  it("daily ceiling is high enough that a 365-day window does not decimate", () => {
    // The bug we're fixing: user asks for 365 days of daily, gets ~17
    // points. Now: ceiling is 1100, so 365 daily rows pass through.
    const ceiling = maxPointsForCadence("daily");
    expect(ceiling).toBeGreaterThanOrEqual(365);
  });
});
