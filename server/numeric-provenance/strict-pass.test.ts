// Targeted tests for the redactor's prose-only invariant.
//
// Bug we're locking out: the previous version did a global regex replace
// across the WHOLE response text, which wrapped numbers inside artifact
// JSON titles + quote text in markdown strikethrough — corrupting the
// data the renderer + downstream tools (refresh-recipe inference,
// embedding sync) consume.
import { describe, it, expect } from "vitest";
import { redactUnmatchedNumbers } from "./strict-pass";

// Minimal ProseNumber shape — the function only reads .raw + .value
// off each entry. format/context aren't touched in redaction.
const num = (raw: string, value = 0) =>
  ({ raw, value, format: "currency", context: "", index: 0 }) as any;

describe("redactUnmatchedNumbers", () => {
  it("wraps an unmatched number in prose with ~~…~~", () => {
    const out = redactUnmatchedNumbers(
      "Revenue was $300M last quarter.",
      [num("$300M")],
    );
    expect(out).toContain("~~$300M~~");
  });

  it("consumes an approximation prefix so the wrap doesn't double-tilde", () => {
    // Without the prefix-consumption, "~$300M" becomes "~~~$300M~~" which
    // the markdown renderer parses as triple-tilde and breaks rendering.
    const out = redactUnmatchedNumbers(
      "Revenue was ~$300M last quarter.",
      [num("$300M")],
    );
    expect(out).toContain("~~$300M~~");
    expect(out).not.toContain("~~~$300M~~");
  });

  it("does NOT touch numbers inside artifact code-fence bodies", () => {
    // The same number appears in prose AND in an artifact title — the
    // prose copy must be redacted, the artifact copy must be left alone
    // so the JSON consumed by the renderer / downstream tools stays
    // clean.
    const text = [
      "Insider concentration is 56% per the cap table.",
      "",
      "```artifact:callout",
      JSON.stringify({
        variant: "risk",
        title: "56% Insider Concentration = $183.9M overhang",
        text: "Heavy concentration risks long-tail dilution.",
      }),
      "```",
      "",
      "More prose mentioning 56% again.",
    ].join("\n");

    const out = redactUnmatchedNumbers(text, [num("56%")]);

    // First prose occurrence wrapped.
    expect(out).toMatch(/concentration is ~~56%~~/);
    // Second prose occurrence wrapped.
    expect(out).toMatch(/More prose mentioning ~~56%~~/);
    // Artifact title untouched — exact substring "56% Insider Concentration"
    // must still be present without ~~ wrapping. (JSON.stringify without
    // indentation emits "title":"…" with no space after the colon.)
    expect(out).toContain('"title":"56% Insider Concentration = $183.9M overhang"');
    expect(out).not.toContain('"title":"~~56%~~ Insider Concentration');
  });

  it("does NOT touch numbers inside multiple artifact types in sequence", () => {
    const text = [
      "Volume is $1.66B daily.",
      "```artifact:metric_cards",
      JSON.stringify({ data: [{ label: "24H Volume", value: "$1.66B" }] }),
      "```",
      "More text. Volume hit $1.66B again.",
      "```artifact:chart",
      JSON.stringify({ title: "$1.66B daily", data: [] }),
      "```",
      "Final mention of $1.66B.",
    ].join("\n");

    const out = redactUnmatchedNumbers(text, [num("$1.66B")]);

    // Every artifact body kept clean. (Compact JSON.stringify — no
    // spaces after colons.)
    expect(out).toContain('"value":"$1.66B"');
    expect(out).toContain('"title":"$1.66B daily"');
    // Every prose occurrence wrapped — count three.
    const matches = out.match(/~~\$1\.66B~~/g) || [];
    expect(matches.length).toBe(3);
  });

  it("dedups identical raw tokens across the unmatched list", () => {
    const text = "$300M and $300M and $300M.";
    const out = redactUnmatchedNumbers(text, [
      num("$300M"),
      num("$300M"),
      num("$300M"),
    ]);
    // Even with 3 entries in the list, prose should have exactly 3
    // wraps (one per occurrence), not 9 (3 entries × 3 occurrences =
    // double-wraps from re-running the same regex).
    expect(out).toBe("~~$300M~~ and ~~$300M~~ and ~~$300M~~.");
  });

  it("returns text unchanged when the unmatched list is empty", () => {
    const text = "All fine here. $300M is sourced.";
    expect(redactUnmatchedNumbers(text, [])).toBe(text);
  });

  it("handles trailing prose after the last fence", () => {
    const text = [
      "```artifact:chart",
      JSON.stringify({ title: "ok" }),
      "```",
      "Trailing line with $7.5B mentioned.",
    ].join("\n");
    const out = redactUnmatchedNumbers(text, [num("$7.5B")]);
    expect(out).toMatch(/Trailing line with ~~\$7\.5B~~/);
  });
});
