import type { SeedFact, Source, Scope, Category, Confidence } from "../schema.js";

export function makeFact(params: {
  source: Source;
  scope: Scope;
  scope_ref: string;
  category: Category;
  content: string;
  confidence: Confidence;
  source_of_fact: string;
  stale_at?: Date | null;
}): SeedFact {
  return { ...params };
}
