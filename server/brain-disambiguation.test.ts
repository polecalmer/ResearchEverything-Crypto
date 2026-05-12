// Precision-first tests for the disambiguation extractor. Anchored on
// the TradeXYZ/TRADE incident — a real prose snippet from a May 6 memo
// that should produce a synthetic brain fact preventing the May 12
// re-occurrence.
import { describe, it, expect } from "vitest";
import { extractDisambiguationFacts } from "./brain-disambiguation";

describe("extractDisambiguationFacts — true positives", () => {
  it("captures 'X has no token' from a TradeXYZ-style passage", () => {
    const text =
      "TradeXYZ does not currently have a separate public token. The protocol is a Hyperliquid HIP-3 deployment.";
    const facts = extractDisambiguationFacts(text);
    expect(facts.length).toBeGreaterThan(0);
    const tokenFact = facts.find((f) => f.source.endsWith(":no-token"));
    expect(tokenFact).toBeDefined();
    expect(tokenFact!.entities).toContain("TradeXYZ");
    expect(tokenFact!.confidence).toBe("verified");
  });

  it("captures 'X has no token' in the simple form", () => {
    const text = "Aave has no token specifically for governance fees.";
    const facts = extractDisambiguationFacts(text);
    expect(facts.some((f) => f.entities.includes("Aave"))).toBe(true);
  });

  it("captures the May 6 TradeXYZ ticker-collision phrasing", () => {
    // Exact prose from the May 6 baseline PDF.
    const text =
      "The \"TRADE\" ticker on CoinGecko ($0.041, $4.2M FDV) is an entirely unrelated token.";
    const facts = extractDisambiguationFacts(text);
    const collision = facts.find((f) => f.source.endsWith(":ticker-collision"));
    expect(collision).toBeDefined();
    expect(collision!.entities).toContain("TRADE");
    expect(collision!.fact).toMatch(/unrelated/i);
  });

  it("captures 'Don't confuse X with Y'", () => {
    const text = "Don't confuse Lido with LDO, since one is the protocol and the other is its token.";
    const facts = extractDisambiguationFacts(text);
    const confuse = facts.find((f) => f.source.endsWith(":dont-confuse"));
    expect(confuse).toBeDefined();
    expect(confuse!.entities).toContain("Lido");
    expect(confuse!.entities).toContain("LDO");
  });

  it("captures 'X is not tokenised' (UK spelling)", () => {
    const text = "Maker is not tokenised in the same way as Aave.";
    const facts = extractDisambiguationFacts(text);
    expect(facts.some((f) => f.source.endsWith(":not-tokenised"))).toBe(true);
  });

  it("captures 'X is not tokenized' (US spelling)", () => {
    const text = "TradeXYZ is not tokenized.";
    const facts = extractDisambiguationFacts(text);
    expect(facts.some((f) => f.source.endsWith(":not-tokenised"))).toBe(true);
  });
});

describe("extractDisambiguationFacts — must NOT false-positive", () => {
  it("returns empty on routine analytical prose", () => {
    const text =
      "TradeXYZ generated $11.4M in deployer revenue over the last 30 days. The take rate is 0.38 bps under growth mode.";
    expect(extractDisambiguationFacts(text)).toEqual([]);
  });

  it("does not match prose about token mechanics generally", () => {
    const text =
      "The token unlocks happen quarterly. Token supply is fully diluted.";
    expect(extractDisambiguationFacts(text)).toEqual([]);
  });

  it("skips artifact code-fence bodies", () => {
    const text = [
      "Normal prose.",
      "```artifact:callout",
      JSON.stringify({ text: "Hyperliquid has no token in this scenario." }),
      "```",
      "More prose.",
    ].join("\n");
    // The 'has no token' inside the artifact body must NOT be extracted —
    // artifact JSON is structured data, not free prose.
    const facts = extractDisambiguationFacts(text);
    expect(facts.every((f) => !f.fact.includes("Hyperliquid"))).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(extractDisambiguationFacts("")).toEqual([]);
    expect(extractDisambiguationFacts("   ")).toEqual([]);
  });
});

describe("extractDisambiguationFacts — dedup + shape", () => {
  it("dedupes when the same disambiguation is repeated", () => {
    const text = [
      "TradeXYZ has no token.",
      "As noted above, TradeXYZ has no token at all.",
    ].join("\n");
    const facts = extractDisambiguationFacts(text);
    const noTokenFacts = facts.filter((f) => f.source.endsWith(":no-token"));
    expect(noTokenFacts.length).toBe(1);
  });

  it("every fact has a sane topic, fact, entities, and ISO date", () => {
    const text =
      "TradeXYZ has no token. The 'TRADE' ticker on CoinGecko is an unrelated token.";
    const facts = extractDisambiguationFacts(text);
    expect(facts.length).toBeGreaterThanOrEqual(2);
    for (const f of facts) {
      expect(typeof f.topic).toBe("string");
      expect(f.topic.length).toBeGreaterThan(0);
      expect(typeof f.fact).toBe("string");
      expect(f.fact.length).toBeGreaterThan(20);
      expect(Array.isArray(f.entities)).toBe(true);
      expect(f.entities.length).toBeGreaterThan(0);
      expect(f.confidence).toBe("verified");
      expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.source).toMatch(/^disambiguation-extractor:/);
    }
  });
});
