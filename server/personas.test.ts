import { describe, it, expect } from "vitest";
import { ANALYST_NAMES } from "@shared/schema";
import { ANALYST_PERSONAS, hasPersona, getPersona } from "./personas";

describe("ANALYST_PERSONAS", () => {
  // This test is specifically here to prevent the silent-failure regression
  // we found in prod: 5 of 8 slugs declared in ANALYST_NAMES had no matching
  // persona, so `analyst_perspective` returned {error: "Unknown analyst"}
  // for them and the agent quietly dropped those lenses.
  it("has a persona for every declared analyst name", () => {
    const missing = ANALYST_NAMES.filter(n => !hasPersona(n));
    expect(missing).toEqual([]);
  });

  it("every persona has a role and style string", () => {
    for (const [slug, p] of Object.entries(ANALYST_PERSONAS)) {
      expect(typeof p.role).toBe("string");
      expect(p.role.length).toBeGreaterThan(20);
      expect(typeof p.style).toBe("string");
      expect(p.style.length).toBeGreaterThan(50);
      expect(p.role, `${slug} role`).not.toContain("—"); // em-dash ban
      expect(p.style, `${slug} style`).not.toContain("—");
    }
  });

  it("getPersona returns undefined for unknown slug", () => {
    expect(getPersona("nonexistent_analyst")).toBeUndefined();
  });

  it("getPersona returns the persona for a known slug", () => {
    const p = getPersona("TopherGMI");
    expect(p).toBeDefined();
    expect(p?.role.length).toBeGreaterThan(0);
  });
});
