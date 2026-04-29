/**
 * Brain-grounded proven-query lookup. Replaces the regex-and-closed-list
 * routing wall that used to gate access to the proven_queries library
 * (see HANDOFF-chart-quality.local.md for the sUSDe-APY incident: a perfectly
 * good cached query existed but neither tryCacheHit's hardcoded protocol/metric
 * regex nor search_proven_queries' ILIKE substring match could reach it).
 *
 * The proven_queries table is now vector-indexed. Any intent semantically
 * close to a stored query — even one whose wording the system has never
 * seen before — finds the right SQL via hybrid (vector + BM25) retrieval
 * with reciprocal-rank fusion, the same pattern brain-retrieval.ts and
 * data-source-brain/db.ts already use.
 *
 * No I/O beyond pg + Voyage embed. Pure read path.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { embed } from "./data-source-brain/embeddings";
import type { ProvenQuery } from "@shared/schema";

export interface ProvenQueryMatch {
  query: ProvenQuery;
  /** Cosine similarity (0..1). Null when only the BM25 ranker matched. */
  similarity: number | null;
  rrfScore: number;
  vectorRank: number | null;
  textRank: number | null;
}

/** Embedding text for a proven query. Concatenates the routing-relevant
 *  fields. Trimming the SQL prevents the embedding from being dominated by
 *  boilerplate (CTE names, comments) but keeps enough signal that a query
 *  about "stETH staking yield" matches another about "lido staking rewards"
 *  even when protocol/metric strings diverge. */
export function provenQueryEmbeddingText(q: {
  protocol: string;
  metricType: string;
  sqlQuery?: string | null;
}): string {
  const sqlSnippet = (q.sqlQuery || "").replace(/\s+/g, " ").slice(0, 600);
  return `[${q.protocol}] [${q.metricType}] ${sqlSnippet}`.trim();
}

/** Embed a proven query. Throws on Voyage failure — callers wrap. */
export async function embedProvenQuery(q: {
  protocol: string;
  metricType: string;
  sqlQuery?: string | null;
}): Promise<number[]> {
  return embed(provenQueryEmbeddingText(q), "document");
}

export interface FindByIntentOptions {
  /** Cosine-similarity floor for considering a vector hit. Default 0.45 —
   *  Voyage returns relatively compressed similarities on this corpus
   *  (180 short, structurally similar SQL queries), so a high floor
   *  rejects valid matches. The CACHE-HIT decision uses a stricter
   *  threshold (default 0.65). */
  minSimilarity?: number;
  /** Hard cutoff for "this is the cached query for this intent". Above this
   *  similarity, callers should execute the cached SQL directly. Below,
   *  callers may use the matches as few-shot context. Calibrated against
   *  the actual proven_queries corpus: top-rank vector matches between
   *  paraphrases of the same intent score 0.65-0.75; cross-domain matches
   *  (e.g. AAVE TVL vs sUSDe APY) score below 0.5. */
  cacheHitSimilarity?: number;
  /** Top-K to return after RRF fusion. */
  topK?: number;
  /** When true, only return is_active rows. Default true. */
  activeOnly?: boolean;
  /** Require the protocol substring to appear somewhere in the matched
   *  query's protocol or metric_type fields. Use sparingly — defeats the
   *  point of vector search. Default false. */
  protocolFilter?: string;
}

/**
 * Hybrid search over proven_queries. Returns RRF-ranked matches up to
 * topK, filtered to vector-similarity >= minSimilarity OR text-rank
 * present. Empty result = no semantic match (caller should fall through
 * to fresh authoring).
 *
 * The hybrid pattern (vector cosine + ts_rank_cd, fused via RRF) is
 * identical to consult() in data-source-brain/db.ts and
 * hybridSearchFacts() in brain-retrieval.ts — kept that way deliberately
 * so all three lookup paths produce comparable rankings.
 */
export async function findProvenQueryByIntent(
  intent: string,
  opts: FindByIntentOptions = {},
): Promise<ProvenQueryMatch[]> {
  const minSim = opts.minSimilarity ?? 0.45;
  const topK = opts.topK ?? 5;
  const activeOnly = opts.activeOnly !== false;
  const CAND = 20;
  const RRF_K = 60;

  let queryVec: number[];
  try {
    queryVec = await embed(intent, "query");
  } catch (err: any) {
    console.warn(`[ProvenQuerySearch] Embed failed (${err.message}) — falling back to text-only`);
    return findByTextOnly(intent, { topK, activeOnly, protocolFilter: opts.protocolFilter });
  }
  const vec = `[${queryVec.join(",")}]`;

  const activeFilter = activeOnly ? sql`AND is_active = true` : sql``;
  const protoFilter = opts.protocolFilter
    ? sql`AND (protocol ILIKE ${'%' + opts.protocolFilter.toLowerCase() + '%'} OR metric_type ILIKE ${'%' + opts.protocolFilter.toLowerCase() + '%'})`
    : sql``;

  try {
    const rows: any = await db.execute(sql`
      WITH vec AS (
        SELECT id,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM proven_queries
        WHERE embedding IS NOT NULL ${activeFilter} ${protoFilter}
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${CAND}
      ),
      txt AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM proven_queries, plainto_tsquery('english', ${intent}) q
        WHERE content_tsv @@ q ${activeFilter} ${protoFilter}
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
      SELECT pq.*, f.vector_sim, f.vector_rank, f.text_rank, f.rrf_score
      FROM fused f
      JOIN proven_queries pq ON pq.id = f.id
      ORDER BY f.rrf_score DESC
      LIMIT ${CAND}
    `);
    const raw: any[] = rows.rows ?? rows;
    let candidates: ProvenQueryMatch[] = raw
      .filter((r) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        const matchedText = r.text_rank != null;
        return sim >= minSim || matchedText;
      })
      .map((r) => ({
        query: rowToProvenQuery(r),
        similarity: r.vector_sim != null ? Number(r.vector_sim) : null,
        rrfScore: Number(r.rrf_score),
        vectorRank: r.vector_rank != null ? Number(r.vector_rank) : null,
        textRank: r.text_rank != null ? Number(r.text_rank) : null,
      }));
    candidates = applyCadenceRerank(intent, candidates);
    return candidates.slice(0, topK);
  } catch (err: any) {
    console.warn(`[ProvenQuerySearch] Hybrid search failed (${err.message}) — falling back to text-only`);
    return findByTextOnly(intent, { topK, activeOnly, protocolFilter: opts.protocolFilter });
  }
}

/** Detect cadence ("daily" | "weekly" | "monthly") from free text. Used both
 *  for parsing the user's intent string and for inspecting candidate
 *  proven_queries rows (their protocol/metric_type/SQL). The regex uses
 *  word boundaries so "30-day moving average" doesn't accidentally match
 *  "daily" — that's a smoothing window, not a sample rate. */
export function detectCadence(text: string): "daily" | "weekly" | "monthly" | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\bdaily\b|\bday[- ]over[- ]day\b|\bper.?day\b/.test(t)) return "daily";
  if (/\bweekly\b|\bweek[- ]over[- ]week\b|\bper.?week\b/.test(t)) return "weekly";
  if (/\bmonthly\b|\bmonth[- ]over[- ]month\b|\bper.?month\b/.test(t)) return "monthly";
  return null;
}

/** Cadence-aware rerank: when the user's intent specifies a sample rate
 *  ("daily"/"weekly"/"monthly"), penalize cached queries whose own text
 *  declares a different cadence. This stops the "vague intent matches
 *  the wrong-cadence cached query" failure mode (e.g. "sUSDe APY (Daily)"
 *  hitting the weekly proven query because both share the susde+apy
 *  tokens). When the intent has no cadence, leave rankings alone — the
 *  ambiguity is real and the agent can disambiguate downstream. */
function applyCadenceRerank(intent: string, candidates: ProvenQueryMatch[]): ProvenQueryMatch[] {
  const intentCadence = detectCadence(intent);
  if (!intentCadence || candidates.length === 0) return candidates;
  const PENALTY_SIM = 0.18; // similarity drop when cadence mismatches
  const PENALTY_RRF = 0.6;  // RRF multiplier (cuts to 60%)
  const adjusted = candidates.map((m) => {
    const queryText = `${m.query.protocol} ${m.query.metricType} ${(m.query.sqlQuery || "").slice(0, 1500)}`;
    const queryCadence = detectCadence(queryText);
    if (!queryCadence || queryCadence === intentCadence) return m;
    return {
      ...m,
      similarity: m.similarity != null ? Math.max(0, m.similarity - PENALTY_SIM) : m.similarity,
      rrfScore: m.rrfScore * PENALTY_RRF,
    };
  });
  adjusted.sort((a, b) => b.rrfScore - a.rrfScore);
  return adjusted;
}

/** Last-resort text-only fallback when the vector path errors. Same RRF
 *  shape minus the vec branch. */
async function findByTextOnly(
  intent: string,
  opts: { topK: number; activeOnly: boolean; protocolFilter?: string },
): Promise<ProvenQueryMatch[]> {
  const activeFilter = opts.activeOnly ? sql`AND is_active = true` : sql``;
  const protoFilter = opts.protocolFilter
    ? sql`AND (protocol ILIKE ${'%' + opts.protocolFilter.toLowerCase() + '%'} OR metric_type ILIKE ${'%' + opts.protocolFilter.toLowerCase() + '%'})`
    : sql``;
  try {
    const rows: any = await db.execute(sql`
      SELECT pq.*,
             ts_rank_cd(content_tsv, plainto_tsquery('english', ${intent})) AS text_score,
             ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, plainto_tsquery('english', ${intent})) DESC) AS rank
      FROM proven_queries pq
      WHERE content_tsv @@ plainto_tsquery('english', ${intent}) ${activeFilter} ${protoFilter}
      ORDER BY text_score DESC
      LIMIT ${opts.topK}
    `);
    const raw: any[] = rows.rows ?? rows;
    return raw.map((r) => ({
      query: rowToProvenQuery(r),
      similarity: null,
      rrfScore: Number(r.text_score),
      vectorRank: null,
      textRank: Number(r.rank),
    }));
  } catch (err: any) {
    console.warn(`[ProvenQuerySearch] Text-only fallback failed: ${err.message}`);
    return [];
  }
}

/** Convenience: top semantic match for an intent, only if cosine
 *  similarity exceeds the cache-hit threshold. Returns null when the
 *  best match isn't confident enough to serve as a cache hit. */
export async function findCacheHitForIntent(
  intent: string,
  opts: { cacheHitSimilarity?: number; protocolFilter?: string } = {},
): Promise<ProvenQueryMatch | null> {
  // Threshold tuned against the actual proven_queries corpus (180 rows of
  // tightly-related crypto/DeFi SQL where Voyage similarities compress
  // around 0.55-0.75). 0.6 catches user phrasings like "sUSDe APY (Daily)
  // over the last year" (0.648) and "sUSDe APY 30DMA Last 12 Months"
  // (0.628) without going so loose that totally cross-domain matches
  // sneak in. Defense-in-depth: the chart-validator's narrative-data
  // check catches any wrong-domain cache hit at emission time.
  const threshold = opts.cacheHitSimilarity ?? 0.6;
  const matches = await findProvenQueryByIntent(intent, {
    minSimilarity: threshold,
    topK: 1,
    protocolFilter: opts.protocolFilter,
  });
  if (matches.length === 0) return null;
  const top = matches[0];
  // Vector match required for cache-hit decision (not just BM25 — text-only
  // matches are way too lenient to serve as a "use this exact SQL" signal).
  if (top.similarity == null || top.similarity < threshold) return null;
  return top;
}

/** Map a raw pg row (snake_case columns) to the camelCase ProvenQuery
 *  shape Drizzle's .select() returns. Raw db.execute(sql) bypasses
 *  Drizzle's column-name remapping, so we do it here. */
function rowToProvenQuery(r: any): ProvenQuery {
  return {
    id: r.id,
    protocol: r.protocol,
    metricType: r.metric_type,
    sqlQuery: r.sql_query,
    dataSource: r.data_source,
    chartType: r.chart_type,
    chartConfig: r.chart_config,
    xAxisKey: r.x_axis_key,
    yAxisKey: r.y_axis_key,
    yAxisLabel: r.y_axis_label,
    yAxisFormat: r.y_axis_format,
    successCount: r.success_count,
    failCount: r.fail_count,
    isActive: r.is_active,
    lastUsed: r.last_used,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    embedding: r.embedding ?? null,
    contentTsv: r.content_tsv ?? null,
  } as ProvenQuery;
}

/** Persist or refresh a proven_query embedding. Best-effort — writes
 *  directly via SQL because Drizzle's update typing for the vector column
 *  isn't worth the ceremony for a single-column write. */
export async function writeProvenQueryEmbedding(
  id: string,
  q: { protocol: string; metricType: string; sqlQuery?: string | null },
): Promise<void> {
  try {
    const v = await embedProvenQuery(q);
    const vec = `[${v.join(",")}]`;
    await db.execute(sql`UPDATE proven_queries SET embedding = ${vec}::vector WHERE id = ${id}`);
  } catch (err: any) {
    console.warn(`[ProvenQuerySearch] writeEmbedding failed for ${id}: ${err.message}`);
  }
}
