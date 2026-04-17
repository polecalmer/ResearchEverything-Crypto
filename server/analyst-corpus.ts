/**
 * Analyst Corpus — query layer for the third-party analyst lenses.
 *
 * Two retrieval surfaces:
 *   1. searchAnalystCorpus: hybrid (vector + tsvector) over chunked documents.
 *   2. searchAnalystFrameworks: vector over the analyst's evolved frameworks
 *      (named, versioned reasoning patterns extracted from their writing).
 *
 * Results are scoped per-analyst so a deep query can fan out across all three
 * lenses in parallel and the agent can attribute claims to the source analyst.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { embed } from "./data-source-brain/embeddings";
import { ANALYST_NAMES, type AnalystName } from "@shared/schema";

export interface CorpusHit {
  analyst: AnalystName;
  source: string;
  date: string | null;
  title: string | null;
  url: string | null;
  documentId: string;
  chunkIndex: number;
  content: string;
  similarity: number;
  rrfScore: number;
}

export interface FrameworkHit {
  analyst: AnalystName;
  frameworkSlug: string;
  name: string;
  description: string;
  category: string | null;
  versionCount: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  versions: Array<{
    version: number;
    date: string;
    description: string;
    scope?: string;
    source_article?: string;
    confidence?: number;
  }>;
  similarity: number;
}

export type AnalystFilter = AnalystName | "all";

function isAnalyst(name: string): name is AnalystName {
  return (ANALYST_NAMES as readonly string[]).includes(name);
}

function normalizeAnalyst(filter?: string): AnalystFilter {
  if (!filter || filter === "all") return "all";
  if (isAnalyst(filter)) return filter;
  return "all";
}

export async function searchAnalystCorpus(params: {
  query: string;
  analyst?: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<CorpusHit[]> {
  const { query, limit = 6, minSimilarity = 0.35 } = params;
  const analyst = normalizeAnalyst(params.analyst);

  const queryEmbedding = await embed(query, "query");
  const vec = `[${queryEmbedding.join(",")}]`;

  const analystFilter = analyst === "all" ? sql`` : sql`AND analyst = ${analyst}`;
  const CAND = 24;
  const RRF_K = 60;

  const rows = await db.execute<any>(sql`
    WITH vec AS (
      SELECT id,
             1 - (embedding <=> ${vec}::vector) AS sim,
             ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
      FROM analyst_chunks
      WHERE 1=1 ${analystFilter}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${CAND}
    ),
    txt AS (
      SELECT id,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
      FROM analyst_chunks, plainto_tsquery('english', ${query}) q
      WHERE content_tsv @@ q ${analystFilter}
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
    SELECT c.analyst, c.source, c.date, c.title, c.url, c.document_id,
           c.chunk_index, c.content,
           fused.vector_sim, fused.rrf_score
    FROM fused
    JOIN analyst_chunks c ON c.id = fused.id
    ORDER BY fused.rrf_score DESC
    LIMIT ${limit}
  `);

  const raw: any[] = (rows as any).rows ?? rows;
  return raw
    .filter((r) => {
      const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
      return sim >= minSimilarity || r.vector_sim == null; // accept tsvector hits regardless
    })
    .map((r) => ({
      analyst: r.analyst as AnalystName,
      source: r.source,
      date: r.date,
      title: r.title,
      url: r.url,
      documentId: r.document_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      similarity: r.vector_sim != null ? Number(r.vector_sim) : 0,
      rrfScore: Number(r.rrf_score),
    }));
}

export async function searchAnalystFrameworks(params: {
  query: string;
  analyst?: string;
  limit?: number;
  minSimilarity?: number;
}): Promise<FrameworkHit[]> {
  const { query, limit = 5, minSimilarity = 0.35 } = params;
  const analyst = normalizeAnalyst(params.analyst);

  const queryEmbedding = await embed(query, "query");
  const vec = `[${queryEmbedding.join(",")}]`;
  const analystFilter = analyst === "all" ? sql`` : sql`AND analyst = ${analyst}`;

  const rows = await db.execute<any>(sql`
    SELECT analyst, framework_slug, name, description, category,
           version_count, first_seen_date, last_seen_date, versions,
           1 - (embedding <=> ${vec}::vector) AS sim
    FROM analyst_frameworks
    WHERE 1=1 ${analystFilter}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${limit}
  `);

  const raw: any[] = (rows as any).rows ?? rows;
  return raw
    .map((r) => ({
      analyst: r.analyst as AnalystName,
      frameworkSlug: r.framework_slug,
      name: r.name,
      description: r.description,
      category: r.category,
      versionCount: Number(r.version_count),
      firstSeenDate: r.first_seen_date,
      lastSeenDate: r.last_seen_date,
      versions: Array.isArray(r.versions) ? r.versions : [],
      similarity: Number(r.sim),
    }))
    .filter((h) => h.similarity >= minSimilarity);
}

export async function getAnalystCorpusStats(): Promise<{
  documents: Record<string, number>;
  chunks: Record<string, number>;
  frameworks: Record<string, number>;
}> {
  const docRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c FROM analyst_documents GROUP BY analyst
  `);
  const chunkRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c FROM analyst_chunks GROUP BY analyst
  `);
  const fwRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c FROM analyst_frameworks GROUP BY analyst
  `);
  const toRec = (rows: any) => {
    const r: any[] = (rows as any).rows ?? rows;
    return Object.fromEntries(r.map((x: any) => [x.analyst, Number(x.c)]));
  };
  return {
    documents: toRec(docRows),
    chunks: toRec(chunkRows),
    frameworks: toRec(fwRows),
  };
}
