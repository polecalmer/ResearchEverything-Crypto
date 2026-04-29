/**
 * One-time backfill: compute Voyage 1024-d embeddings for every proven_queries
 * row missing one. Runs after the schema migration that adds the embedding
 * column. Idempotent — safe to re-run; it skips rows that already have
 * embeddings.
 *
 * Run: cd /Users/sessions/ResearchEverything-Crypto && set -a && source ./.env && set +a && tsx scripts/backfill-proven-query-embeddings.ts
 */
import { db } from "../server/db";
import { provenQueries } from "@shared/schema";
import { sql, eq, isNull } from "drizzle-orm";
import { provenQueryEmbeddingText, embedProvenQuery } from "../server/proven-queries-search";

const BATCH_SIZE = 16;
const RATE_LIMIT_MS = 50;

async function main() {
  const rows = await db
    .select()
    .from(provenQueries)
    .where(isNull(provenQueries.embedding));

  console.log(`[Backfill] ${rows.length} proven_queries rows missing embeddings`);
  if (rows.length === 0) {
    console.log("[Backfill] Nothing to do.");
    process.exit(0);
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (q) => {
        try {
          const v = await embedProvenQuery({
            protocol: q.protocol,
            metricType: q.metricType,
            sqlQuery: q.sqlQuery,
          });
          const vec = `[${v.join(",")}]`;
          await db.execute(sql`UPDATE proven_queries SET embedding = ${vec}::vector WHERE id = ${q.id}`);
          done++;
        } catch (err: any) {
          failed++;
          console.warn(`[Backfill] Failed ${q.protocol}/${q.metricType}: ${err.message}`);
        }
      }),
    );
    console.log(`[Backfill] Progress: ${done}/${rows.length} (failed: ${failed})`);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  console.log(`[Backfill] Done. ${done} embedded, ${failed} failed.`);
  console.log(`[Backfill] Sample embedding text for first row:`);
  if (rows[0]) {
    console.log(`  "${provenQueryEmbeddingText({
      protocol: rows[0].protocol,
      metricType: rows[0].metricType,
      sqlQuery: rows[0].sqlQuery,
    }).slice(0, 200)}..."`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[Backfill] Fatal:", err);
  process.exit(1);
});
