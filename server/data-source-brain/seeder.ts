import { sql } from "drizzle-orm";
import { db } from "../db";
import { dataSourceFacts } from "@shared/schema";
import { getAllSeedFacts } from "./seed/index.js";
import { insertSeedFact } from "./db";

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
    const facts = getAllSeedFacts();
    let inserted = 0;
    if (!opts.force) {
      const [{ c }] = await db.select({ c: sql<number>`count(*)::int` }).from(dataSourceFacts);
      if (Number(c) >= facts.length) {
        console.log(`[DataSourceBrain] Seed skipped — table has ${c} facts (>= ${facts.length} seeded).`);
        return { total: facts.length, inserted: 0 };
      }
    }
    for (const fact of facts) {
      try {
        const { inserted: ins } = await insertSeedFact(fact);
        if (ins) inserted++;
      } catch (err: any) {
        console.error(`[DataSourceBrain] Seed failed for ${fact.source}:${fact.scope_ref} — ${err.message}`);
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
