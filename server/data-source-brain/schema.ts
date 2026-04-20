import {
  DATA_SOURCES,
  FACT_SCOPES,
  FACT_CATEGORIES,
  FACT_CONFIDENCE,
  type DataSource,
  type FactScope,
  type FactCategory,
  type FactConfidence,
} from "@shared/schema";
import crypto from "node:crypto";

export const SOURCES = DATA_SOURCES;
export const SCOPES = FACT_SCOPES;
export const CATEGORIES = FACT_CATEGORIES;
export const CONFIDENCE_LEVELS = FACT_CONFIDENCE;

export type Source = DataSource;
export type Scope = FactScope;
export type Category = FactCategory;
export type Confidence = FactConfidence;

export type Fact = SeedFact;

export interface SeedFact {
  source: Source;
  scope: Scope;
  scope_ref: string;
  category: Category;
  content: string;
  confidence: Confidence;
  source_of_fact: string;
  stale_at?: Date | null;
}

export function factEmbeddingText(f: { source: string; scope_ref: string; content: string }): string {
  return `[${f.source}] [${f.scope_ref}] ${f.content}`;
}

export function factDedupeKey(source: string, scopeRef: string, content: string): string {
  const normalized = `${source}|${scopeRef}|${content.trim().toLowerCase()}`;
  return "dedup_" + crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}
