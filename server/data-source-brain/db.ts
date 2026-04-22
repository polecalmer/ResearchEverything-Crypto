import { sql, eq, desc, and } from "drizzle-orm";
import { db } from "../db";
import { dataSourceFacts, type DataSourceFact } from "@shared/schema";
import {
  factEmbeddingText,
  factDedupeKey,
  type SeedFact,
  type Source,
  type Confidence,
} from "./schema";
import { embed } from "./embeddings";

/** Dimension change requires recreating the table — handled by seeder via DROP. */

export interface ConsultResult {
  fact: DataSourceFact;
  /** Cosine similarity (0..1). 0 if the fact came in via text-only match. */
  similarity: number;
  /** Reciprocal-rank-fusion score combining vector + BM25 ranks. */
  rrfScore: number;
  /** 1-indexed rank from the vector search, or null if not in vector top-N. */
  vectorRank: number | null;
  /** 1-indexed rank from the BM25 text search, or null if not in text top-N. */
  textRank: number | null;
}

export interface ObserveInput {
  source: Source;
  scope_ref: string;
  category: string;
  content: string;
  source_of_fact: string;
  confidence?: Confidence;
}

const PROMOTION_THRESHOLD = 5;

/**
 * Consult: semantic search for top-k relevant facts.
 * Returns facts with cosine similarity >= minSimilarity.
 */
export async function consult(params: {
  query: string;
  source?: Source;
  category?: string;
  topK?: number;
  minSimilarity?: number;
}): Promise<ConsultResult[]> {
  const { query, source, category, topK = 3, minSimilarity = 0.4 } = params;
  const queryEmbedding = await embed(query, "query");
  const vec = `[${queryEmbedding.join(",")}]`;

  // Hybrid search: pull candidate sets from both rankers (vector cosine and
  // Postgres BM25-equivalent ts_rank_cd), then fuse with reciprocal-rank
  // fusion (RRF) — score = Σ 1 / (k + rank), k=60 by convention.
  // Candidate pool is intentionally wide (CAND=20) so the fusion can promote
  // documents that one ranker buries but the other surfaces.
  const CAND = 20;
  const RRF_K = 60;

  // Build the source/category filter once as a SQL fragment used in both CTEs.
  const sourceFilter = source ? sql`AND source = ${source}` : sql``;
  const categoryFilter = category ? sql`AND category = ${category}` : sql``;

  const rows = await db.execute<{
    id: string;
    source: string;
    scope: string;
    scope_ref: string;
    category: string;
    content: string;
    confidence: string;
    source_of_fact: string;
    observed_count: number;
    created_at: Date;
    last_seen_at: Date;
    stale_at: Date | null;
    dedupe_key: string;
    embedding: string;
    vector_sim: number | null;
    vector_rank: number | null;
    text_rank: number | null;
    rrf_score: number;
  }>(sql`
    WITH vec AS (
      SELECT id,
             1 - (embedding <=> ${vec}::vector) AS sim,
             ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
      FROM data_source_facts
      WHERE 1=1 ${sourceFilter} ${categoryFilter}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${CAND}
    ),
    txt AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
      FROM data_source_facts, plainto_tsquery('english', ${query}) q
      WHERE content_tsv @@ q ${sourceFilter} ${categoryFilter}
      ORDER BY ts_rank_cd(content_tsv, q) DESC
      LIMIT ${CAND}
    ),
    fused AS (
      SELECT
        COALESCE(v.id, t.id) AS id,
        v.sim AS vector_sim,
        v.rank::int AS vector_rank,
        t.rank::int AS text_rank,
        COALESCE(1.0 / (${RRF_K} + v.rank), 0) +
        COALESCE(1.0 / (${RRF_K} + t.rank), 0) AS rrf_score
      FROM vec v
      FULL OUTER JOIN txt t ON v.id = t.id
    )
    SELECT f.*, fused.vector_sim, fused.vector_rank, fused.text_rank, fused.rrf_score
    FROM fused
    JOIN data_source_facts f ON f.id = fused.id
    ORDER BY fused.rrf_score DESC
    LIMIT ${topK}
  `);

  // Drizzle's db.execute returns { rows: [...] } for raw SQL.
  const raw: any[] = (rows as any).rows ?? rows;

  return raw
    .filter((r: any) => {
      // Keep if it's a strong vector match OR it surfaced via text search.
      const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
      const matchedText = r.text_rank != null;
      return sim >= minSimilarity || matchedText;
    })
    .map((r: any) => ({
      fact: {
        id: r.id,
        source: r.source,
        scope: r.scope,
        scopeRef: r.scope_ref,
        category: r.category,
        content: r.content,
        confidence: r.confidence,
        sourceOfFact: r.source_of_fact,
        observedCount: r.observed_count,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        staleAt: r.stale_at,
        dedupeKey: r.dedupe_key,
        embedding: r.embedding,
      } as DataSourceFact,
      similarity: r.vector_sim != null ? Number(r.vector_sim) : 0,
      rrfScore: Number(r.rrf_score),
      vectorRank: r.vector_rank != null ? Number(r.vector_rank) : null,
      textRank: r.text_rank != null ? Number(r.text_rank) : null,
    }));
}

/**
 * Observe: record a runtime observation. If a matching fact already exists
 * (exact dedupe or close semantic match), increment observed_count atomically
 * and update last_seen_at; otherwise insert a new fact.
 *
 * Auto-promotion: when observed_count crosses PROMOTION_THRESHOLD, confidence
 * is upgraded to "verified_runtime".
 */
export async function observe(input: ObserveInput): Promise<{
  status: "inserted" | "merged" | "promoted";
  fact: DataSourceFact;
}> {
  const dedupeKey = factDedupeKey(input.source, input.scope_ref, input.content);
  const baseConfidence: Confidence = input.confidence ?? "observed_once";

  // Try exact dedupe first via atomic upsert
  const embedding = await embed(
    factEmbeddingText({ source: input.source, scope_ref: input.scope_ref, content: input.content }),
    "document",
  );
  const vec = `[${embedding.join(",")}]`;

  const existingByKey = await db
    .select()
    .from(dataSourceFacts)
    .where(eq(dataSourceFacts.dedupeKey, dedupeKey))
    .limit(1);

  if (existingByKey.length > 0) {
    const updated = await db
      .update(dataSourceFacts)
      .set({
        observedCount: sql`${dataSourceFacts.observedCount} + 1`,
        lastSeenAt: sql`now()`,
      })
      .where(eq(dataSourceFacts.dedupeKey, dedupeKey))
      .returning();
    const fact = updated[0];
    if (
      fact.confidence !== "verified_doc" &&
      fact.confidence !== "verified_runtime" &&
      fact.observedCount >= PROMOTION_THRESHOLD
    ) {
      const promoted = await db
        .update(dataSourceFacts)
        .set({ confidence: "verified_runtime" })
        .where(eq(dataSourceFacts.id, fact.id))
        .returning();
      return { status: "promoted", fact: promoted[0] };
    }
    return { status: "merged", fact };
  }

  // Semantic dedupe within same source+scope_ref+category, atomically.
  // The CTE locates the closest match and the UPDATE applies in one statement
  // so concurrent observers can't both decide to insert. If sim < 0.85 the
  // CTE returns nothing and the UPDATE is a no-op (returning empty), and we
  // fall through to insert.
  const updatedSemantic = await db.execute<{ id: string; observed_count: number; confidence: string }>(sql`
    WITH candidate AS (
      SELECT id, 1 - (embedding <=> ${vec}::vector) AS sim
      FROM data_source_facts
      WHERE source = ${input.source}
        AND scope_ref = ${input.scope_ref}
        AND category = ${input.category}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT 1
    )
    UPDATE data_source_facts AS f
       SET observed_count = f.observed_count + 1,
           last_seen_at = now()
      FROM candidate c
     WHERE f.id = c.id AND c.sim >= 0.85
    RETURNING f.id, f.observed_count, f.confidence
  `);

  const semanticRow = (updatedSemantic.rows ?? updatedSemantic as any)[0];
  if (semanticRow) {
    const fact = (
      await db.select().from(dataSourceFacts).where(eq(dataSourceFacts.id, semanticRow.id)).limit(1)
    )[0];
    if (
      fact.confidence !== "verified_doc" &&
      fact.confidence !== "verified_runtime" &&
      fact.observedCount >= PROMOTION_THRESHOLD
    ) {
      const promoted = await db
        .update(dataSourceFacts)
        .set({ confidence: "verified_runtime" })
        .where(eq(dataSourceFacts.id, fact.id))
        .returning();
      return { status: "promoted", fact: promoted[0] };
    }
    return { status: "merged", fact };
  }

  // Insert new
  const inserted = await db
    .insert(dataSourceFacts)
    .values({
      source: input.source,
      scope: "source",
      scopeRef: input.scope_ref,
      category: input.category,
      content: input.content,
      confidence: baseConfidence,
      sourceOfFact: input.source_of_fact,
      dedupeKey,
      embedding,
    })
    .onConflictDoNothing({ target: dataSourceFacts.dedupeKey })
    .returning();

  if (inserted.length === 0) {
    // Race — fall back to merge
    return observe(input);
  }
  return { status: "inserted", fact: inserted[0] };
}

/**
 * Insert a verified-doc fact (used by seeder). Idempotent via dedupe_key.
 */
export async function insertSeedFact(seed: SeedFact): Promise<{ inserted: boolean }> {
  const dedupeKey = factDedupeKey(seed.source, seed.scope_ref, seed.content);
  const existing = await db
    .select({ id: dataSourceFacts.id })
    .from(dataSourceFacts)
    .where(eq(dataSourceFacts.dedupeKey, dedupeKey))
    .limit(1);
  if (existing.length > 0) return { inserted: false };

  const embedding = await embed(
    factEmbeddingText({ source: seed.source, scope_ref: seed.scope_ref, content: seed.content }),
    "document",
  );
  await db
    .insert(dataSourceFacts)
    .values({
      source: seed.source,
      scope: seed.scope,
      scopeRef: seed.scope_ref,
      category: seed.category,
      content: seed.content,
      confidence: seed.confidence,
      sourceOfFact: seed.source_of_fact,
      staleAt: seed.stale_at ?? null,
      dedupeKey,
      embedding,
    })
    .onConflictDoNothing({ target: dataSourceFacts.dedupeKey });
  return { inserted: true };
}

/**
 * Direct DB lookup of user-preference facts. User prefs are stored as regular
 * data_source_facts with `scope_ref` namespaced as `userpref:<userId>:...`,
 * so this is a deterministic prefix scan rather than an embedding search.
 *
 * Returns the per-user coverage facts the synthesis pass has promoted from
 * the research brain. Empty array on error or when the user has no prefs.
 */
export async function getUserPreferenceFacts(userId: string): Promise<DataSourceFact[]> {
  if (!userId) return [];
  try {
    const rows = await db.execute<DataSourceFact>(sql`
      SELECT id, source, scope, scope_ref AS "scopeRef", category, content,
             confidence, source_of_fact AS "sourceOfFact",
             observed_count AS "observedCount",
             created_at AS "createdAt", last_seen_at AS "lastSeenAt",
             stale_at AS "staleAt", dedupe_key AS "dedupeKey", embedding
      FROM data_source_facts
      WHERE scope_ref LIKE ${`userpref:${userId}:%`}
    `);
    return ((rows as any).rows ?? rows) as DataSourceFact[];
  } catch (err: any) {
    console.warn(`[DataSourceBrain] getUserPreferenceFacts failed for ${userId}:`, err.message);
    return [];
  }
}

/**
 * Stats for the admin panel.
 */
export async function getStats(): Promise<{
  total: number;
  bySource: Record<string, number>;
  byCategory: Record<string, number>;
  byConfidence: Record<string, number>;
  recent: DataSourceFact[];
}> {
  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dataSourceFacts);

  const sourceRows = await db
    .select({ k: dataSourceFacts.source, c: sql<number>`count(*)::int` })
    .from(dataSourceFacts)
    .groupBy(dataSourceFacts.source);

  const catRows = await db
    .select({ k: dataSourceFacts.category, c: sql<number>`count(*)::int` })
    .from(dataSourceFacts)
    .groupBy(dataSourceFacts.category);

  const confRows = await db
    .select({ k: dataSourceFacts.confidence, c: sql<number>`count(*)::int` })
    .from(dataSourceFacts)
    .groupBy(dataSourceFacts.confidence);

  const recent = await db
    .select()
    .from(dataSourceFacts)
    .orderBy(desc(dataSourceFacts.lastSeenAt))
    .limit(20);

  const toRec = (rows: { k: string; c: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.k, Number(r.c)]));

  return {
    total: Number(totalRow?.c ?? 0),
    bySource: toRec(sourceRows),
    byCategory: toRec(catRows),
    byConfidence: toRec(confRows),
    recent,
  };
}
