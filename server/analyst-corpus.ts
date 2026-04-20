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

export interface AnalystOverview {
  analyst: AnalystName;
  documents: number;
  chunks: number;
  frameworks: number;
  dateRange: { earliest: string | null; latest: string | null };
  topSources: Array<{ source: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
}

export async function getAnalystOverviews(): Promise<AnalystOverview[]> {
  const docRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c,
           MIN(NULLIF(date, '')) AS earliest,
           MAX(NULLIF(date, '')) AS latest
    FROM analyst_documents GROUP BY analyst
  `);
  const chunkRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c FROM analyst_chunks GROUP BY analyst
  `);
  const fwRows = await db.execute<any>(sql`
    SELECT analyst, COUNT(*)::int AS c FROM analyst_frameworks GROUP BY analyst
  `);
  const sourceRows = await db.execute<any>(sql`
    SELECT analyst, source, COUNT(*)::int AS c
    FROM analyst_documents GROUP BY analyst, source
    ORDER BY c DESC
  `);
  const tagRows = await db.execute<any>(sql`
    SELECT analyst, tag, COUNT(*)::int AS c
    FROM (SELECT analyst, unnest(tags) AS tag FROM analyst_documents) t
    WHERE tag IS NOT NULL AND tag <> ''
    GROUP BY analyst, tag
    ORDER BY c DESC
  `);
  const catRows = await db.execute<any>(sql`
    SELECT analyst, category, COUNT(*)::int AS c
    FROM analyst_frameworks
    WHERE category IS NOT NULL AND category <> ''
    GROUP BY analyst, category
    ORDER BY c DESC
  `);

  const unpack = (rows: any): any[] => (rows as any).rows ?? rows;
  const byAnalyst = <T>(rows: any[], map: (r: any) => T): Record<string, T[]> => {
    const out: Record<string, T[]> = {};
    for (const r of rows) {
      const key = r.analyst;
      if (!out[key]) out[key] = [];
      out[key].push(map(r));
    }
    return out;
  };

  const docCounts = Object.fromEntries(unpack(docRows).map((r: any) => [r.analyst, r]));
  const chunkCounts = Object.fromEntries(unpack(chunkRows).map((r: any) => [r.analyst, Number(r.c)]));
  const fwCounts = Object.fromEntries(unpack(fwRows).map((r: any) => [r.analyst, Number(r.c)]));
  const sources = byAnalyst(unpack(sourceRows), (r) => ({ source: r.source, count: Number(r.c) }));
  const tags = byAnalyst(unpack(tagRows), (r) => ({ tag: r.tag, count: Number(r.c) }));
  const cats = byAnalyst(unpack(catRows), (r) => ({ category: r.category, count: Number(r.c) }));

  return ANALYST_NAMES.map((name) => ({
    analyst: name,
    documents: Number(docCounts[name]?.c ?? 0),
    chunks: chunkCounts[name] ?? 0,
    frameworks: fwCounts[name] ?? 0,
    dateRange: {
      earliest: docCounts[name]?.earliest ?? null,
      latest: docCounts[name]?.latest ?? null,
    },
    topSources: (sources[name] ?? []).slice(0, 8),
    topTags: (tags[name] ?? []).slice(0, 20),
    topCategories: (cats[name] ?? []).slice(0, 10),
  }));
}

export async function listAnalystFrameworks(analyst: string): Promise<Array<{
  frameworkSlug: string;
  name: string;
  description: string;
  category: string | null;
  versionCount: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  versions: any[];
}>> {
  const a = normalizeAnalyst(analyst);
  if (a === "all") return [];
  const rows = await db.execute<any>(sql`
    SELECT framework_slug, name, description, category, version_count,
           first_seen_date, last_seen_date, versions
    FROM analyst_frameworks
    WHERE analyst = ${a}
    ORDER BY version_count DESC, name ASC
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  return raw.map((r) => ({
    frameworkSlug: r.framework_slug,
    name: r.name,
    description: r.description,
    category: r.category,
    versionCount: Number(r.version_count),
    firstSeenDate: r.first_seen_date,
    lastSeenDate: r.last_seen_date,
    versions: Array.isArray(r.versions) ? r.versions : [],
  }));
}

export async function listAnalystDocuments(params: {
  analyst: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Array<{
  id: string;
  source: string;
  url: string | null;
  date: string | null;
  title: string | null;
  type: string | null;
  tags: string[];
  preview: string;
}>; total: number; }> {
  const a = normalizeAnalyst(params.analyst);
  if (a === "all") return { items: [], total: 0 };
  const limit = Math.min(params.limit ?? 30, 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const q = (params.q ?? "").trim();

  const textFilter = q
    ? sql`AND (title ILIKE ${'%' + q + '%'} OR body ILIKE ${'%' + q + '%'} OR source ILIKE ${'%' + q + '%'})`
    : sql``;

  const countRows = await db.execute<any>(sql`
    SELECT COUNT(*)::int AS c FROM analyst_documents
    WHERE analyst = ${a} ${textFilter}
  `);
  const total = Number(((countRows as any).rows ?? countRows)[0]?.c ?? 0);

  const rows = await db.execute<any>(sql`
    SELECT id, source, url, date, title, type, tags,
           LEFT(body, 280) AS preview
    FROM analyst_documents
    WHERE analyst = ${a} ${textFilter}
    ORDER BY COALESCE(NULLIF(date, ''), '0000') DESC, created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const raw: any[] = (rows as any).rows ?? rows;
  return {
    items: raw.map((r) => ({
      id: r.id,
      source: r.source,
      url: r.url,
      date: r.date,
      title: r.title,
      type: r.type,
      tags: Array.isArray(r.tags) ? r.tags : [],
      preview: r.preview ?? "",
    })),
    total,
  };
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
