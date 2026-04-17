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

export interface ConsultResult {
  fact: DataSourceFact;
  similarity: number;
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
  const queryEmbedding = await embed(query);
  const vec = `[${queryEmbedding.join(",")}]`;

  const conditions: any[] = [];
  if (source) conditions.push(eq(dataSourceFacts.source, source));
  if (category) conditions.push(eq(dataSourceFacts.category, category));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // 1 - cosine_distance = cosine_similarity
  const rows = await db
    .select({
      fact: dataSourceFacts,
      similarity: sql<number>`1 - (${dataSourceFacts.embedding} <=> ${vec}::vector)`,
    })
    .from(dataSourceFacts)
    .where(whereClause)
    .orderBy(sql`${dataSourceFacts.embedding} <=> ${vec}::vector`)
    .limit(topK);

  return rows
    .filter((r) => Number(r.similarity) >= minSimilarity)
    .map((r) => ({ fact: r.fact, similarity: Number(r.similarity) }));
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
