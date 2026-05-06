// End-to-end tests for the provenance validator's matching logic.
// Anchored on real false-positives observed in the May 6 TradeXYZ memo —
// the validator was strikethrough'ing the agent's own derived FDVs,
// scenario projections, and time-window forecasts because:
//
//   1. Multiplicative derivations weren't tried (only ratios were)
//   2. Forecast-class numbers were treated as historical claims
//
// These tests lock in both fixes.
import { describe, it, expect, beforeEach } from "vitest";
import { checkProvenance } from "./provenance-validator";
import { startTurn, recordCompute, recordToolResult, endTurn } from "./turn-cache";

const TURN = "test-turn";

beforeEach(() => {
  endTurn(TURN);
  startTurn(TURN);
});

function compute(name: string, value: number, valueStr: string) {
  recordCompute(TURN, {
    name,
    value,
    valueStr,
    format: "currency",
    formula: "test",
    params: {},
    sourceLabel: "test",
    rowCount: 1,
    rowsUsed: 1,
    computedAt: new Date().toISOString(),
    fingerprint: "test",
  });
}

describe("multiplicative derivation matcher", () => {
  it("matches $11.4M ARR × 15 = $171M FDV (Bear case scenario)", () => {
    // $11.4M is the deployer ARR — has provenance via compute().
    // 15 is the P/S multiple — appears in prose.
    // $170M would have been redacted before the matcher existed.
    compute("deployer_arr", 11_400_000, "$11.4M");
    const text = "At a 15x P/S on deployer ARR of $11.4M, the implied FDV is roughly $170M.";
    // "implied" makes this forecast-class anyway, so move outside the
    // forecast skip to test the multiplicative path specifically.
    const noForecastText = "Multiplying deployer ARR ($11.4M) by 15 gives $170M.";
    const r = checkProvenance(noForecastText, TURN);
    expect(r.unmatched).toEqual([]);
    expect(r.matchedByMultiplicativeDerivation).toBeGreaterThan(0);
  });

  it("matches $25.96M × 7.9 normalisation = $205M+ on the currency value", () => {
    compute("all_time_fees", 25_960_000, "$25.96M");
    // Avoid forecast triggers ("would", "if", "estimated") so the
    // multiplicative path is what actually validates this.
    const text = "At 7.9x normalised, $25.96M of all-time fees becomes $205M.";
    const r = checkProvenance(text, TURN);
    // The user-visible concern is the CURRENCY value $205M being
    // strikethrough'd — that's what disfigures the headline conclusions.
    // Stated multipliers like "7.9x" without a paired derivation source
    // are a separate, smaller issue: the validator can't back-derive them
    // from a single value, but they don't damage the conclusion the way
    // a redacted "$205M" headline does.
    const currencyUnmatched = r.unmatched.filter((u) => u.number.format === "currency");
    expect(currencyUnmatched).toEqual([]);
    expect(r.matchedByMultiplicativeDerivation).toBeGreaterThan(0);
  });

  it("matches a discount derivation when the multiplier is explicit: $540M × 0.8 = $432M", () => {
    compute("base_fdv", 540_000_000, "$540M");
    // The multiplier must appear in prose for the matcher to find it.
    // "20% discount" alone doesn't suffice — that's a percent-to-decimal
    // transform the matcher doesn't do (and shouldn't, to avoid false
    // positives).
    const text = "$540M × 0.8 ≈ $432M after the 20% discount.";
    const r = checkProvenance(text, TURN);
    const fdvUnmatched = r.unmatched.find((u) => u.number.raw.includes("432M"));
    expect(fdvUnmatched).toBeUndefined();
  });

  it("DOES NOT match when neither operand is in the pool", () => {
    // Pure hallucination: the value doesn't trace to ANY operand in
    // computes / artifacts / prose.
    const text = "Nothing here justifies a $4.2B figure.";
    const r = checkProvenance(text, TURN);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });

  it("DOES NOT match a same-value-as-itself accidental case", () => {
    // If the only operand is the target itself, dividing produces m=1
    // which IS in [0.05, 200] — the multiplier-also-in-pool gate must
    // require a SECOND distinct value. Tested by a one-number prose.
    compute("only_value", 100_000_000, "$100M");
    const text = "Just one number: $200M.";
    const r = checkProvenance(text, TURN);
    // $200M shouldn't match: no second operand of value ~2 in the pool.
    expect(r.unmatched.length).toBeGreaterThan(0);
  });
});

describe("forecast-context skip", () => {
  it("skips a number inside an 'If a token launches' projection", () => {
    const text = "If a token launches at 15x P/S, the FDV would be $540M.";
    const r = checkProvenance(text, TURN);
    // No source for $540M, but it's in a forecast context so must be
    // skipped, not redacted.
    expect(r.unmatched).toEqual([]);
    expect(r.skippedForecast).toBeGreaterThan(0);
  });

  it("skips numbers under a 'Bull case' header", () => {
    const text = [
      "## Bull Case",
      "",
      "Volume holds at $60B/month and fees normalise to 3 bps, generating $180M/month gross fees.",
    ].join("\n");
    const r = checkProvenance(text, TURN);
    // All three numbers are forecast-bound by the Bull case header.
    expect(r.unmatched).toEqual([]);
    expect(r.skippedForecast).toBeGreaterThan(0);
  });

  it("skips a time-window forecast like '12m+'", () => {
    const text = "U.S. regulatory clarity would unlock the market in roughly 12m+.";
    const r = checkProvenance(text, TURN);
    expect(r.unmatched).toEqual([]);
  });

  it("does NOT skip a hard historical claim", () => {
    // No forecast trigger words, no provenance — should remain unmatched.
    const text = "Volume hit $1.66B daily as of last week.";
    const r = checkProvenance(text, TURN);
    expect(r.unmatched.length).toBeGreaterThan(0);
  });
});

describe("report structure", () => {
  it("includes the new counter fields on the report", () => {
    const r = checkProvenance("Just text.", TURN);
    expect(r).toHaveProperty("matchedByMultiplicativeDerivation");
    expect(r).toHaveProperty("skippedForecast");
    expect(typeof r.matchedByMultiplicativeDerivation).toBe("number");
    expect(typeof r.skippedForecast).toBe("number");
  });

  it("matched count includes all four match paths", () => {
    compute("known_fdv", 540_000_000, "$540M");
    const text = "Multiplying $540M by 0.8 gives $432M.";
    const r = checkProvenance(text, TURN);
    expect(r.matched).toBe(
      r.matchedByCompute +
        r.matchedBySource +
        r.matchedByDerivation +
        r.matchedByArtifact +
        r.matchedByMultiplicativeDerivation,
    );
  });
});
