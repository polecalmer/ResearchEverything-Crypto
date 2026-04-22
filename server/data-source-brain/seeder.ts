import { sql, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { dataSourceFacts } from "@shared/schema";
import { getAllSeedFacts } from "./seed/index.js";
import { factDedupeKey, factEmbeddingText } from "./schema";
import { embedBatch } from "./embeddings";

let runningPromise: Promise<{ total: number; inserted: number }> | null = null;

/**
 * Idempotent seeder. Only inserts facts that aren't already present (by dedupe_key).
 * Skips entirely when the table already has any rows from a prior seed run if `force=false`.
 */
export async function seedDataSourceBrain(opts: { force?: boolean } = {}): Promise<{
  total: number;
  inserted: number;
}> {
  if (runningPromise) return runningPromise;
  runningPromise = (async () => {
    // Defensive: ensure pgvector extension exists before any vector op runs.
    // Required when the DB is fresh / restored / moved between environments.
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
    } catch (err: any) {
      console.error(`[DataSourceBrain] Failed to ensure vector extension — brain will not function: ${err.message}`);
      return { total: 0, inserted: 0 };
    }

    // Hybrid search: ensure a generated tsvector column + GIN index exist for
    // BM25-style keyword search alongside the vector embedding. This lets
    // exact-token queries (protocol slugs, endpoint paths, ticker symbols)
    // surface even when their semantic similarity is mediocre.
    try {
      await db.execute(sql`
        ALTER TABLE data_source_facts
        ADD COLUMN IF NOT EXISTS content_tsv tsvector
        GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS data_source_facts_content_tsv_idx
        ON data_source_facts USING GIN (content_tsv)
      `);
    } catch (err: any) {
      console.warn(`[DataSourceBrain] tsvector setup failed (hybrid search will fall back to vector-only): ${err.message}`);
    }
    const facts = getAllSeedFacts();
    let inserted = 0;
    // NOTE: we used to short-circuit when `count(*) >= facts.length`, but that
    // prevented newly added seed entries from ever landing once runtime
    // observations grew the table past the initial seed count. Always run the
    // dedupe-key check below — it's a single COUNT + indexed IN-list lookup
    // and costs ~1ms even at 10k facts.
    // Filter out facts already present (by dedupe_key) so reseeds are idempotent.
    const allKeys = facts.map((f) => factDedupeKey(f.source, f.scope_ref, f.content));
    const existingRows = await db
      .select({ k: dataSourceFacts.dedupeKey })
      .from(dataSourceFacts)
      .where(inArray(dataSourceFacts.dedupeKey, allKeys));
    const existing = new Set(existingRows.map((r) => r.k));
    const todo = facts
      .map((f, i) => ({ fact: f, key: allKeys[i] }))
      .filter((x) => !existing.has(x.key));
    if (todo.length === 0) {
      console.log(`[DataSourceBrain] Seed skipped — all ${facts.length} facts already present.`);
      return { total: facts.length, inserted: 0 };
    }

    // Batch-embed in chunks of 64 (well under Voyage's 128 input limit).
    const BATCH = 64;
    for (let i = 0; i < todo.length; i += BATCH) {
      const slice = todo.slice(i, i + BATCH);
      const texts = slice.map((s) =>
        factEmbeddingText({ source: s.fact.source, scope_ref: s.fact.scope_ref, content: s.fact.content }),
      );
      try {
        const vectors = await embedBatch(texts, "document");
        const rows = slice.map((s, j) => ({
          source: s.fact.source,
          scope: s.fact.scope,
          scopeRef: s.fact.scope_ref,
          category: s.fact.category,
          content: s.fact.content,
          confidence: s.fact.confidence,
          sourceOfFact: s.fact.source_of_fact,
          staleAt: s.fact.stale_at ?? null,
          dedupeKey: s.key,
          embedding: vectors[j],
        }));
        const out = await db
          .insert(dataSourceFacts)
          .values(rows)
          .onConflictDoNothing({ target: dataSourceFacts.dedupeKey })
          .returning({ id: dataSourceFacts.id });
        inserted += out.length;
      } catch (err: any) {
        console.error(`[DataSourceBrain] Seed batch ${i}-${i + slice.length} failed — ${err.message}`);
      }
    }
    console.log(`[DataSourceBrain] Seed complete — ${inserted}/${facts.length} new facts inserted.`);
    return { total: facts.length, inserted };
  })();
  try {
    return await runningPromise;
  } finally {
    runningPromise = null;
  }
}
