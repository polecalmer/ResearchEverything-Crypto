/**
 * agent_skills retrieval — hybrid vector + BM25 search over the
 * procedural skill packs lifted from hermes. The agent calls
 * `query_agent_skills(query)` to surface the most relevant procedure
 * for a question shape, then follows the returned body.
 *
 * Distinct from `query_analyst_corpus` (passages from analyst writing,
 * for QUALITATIVE perspective) and `query_analyst_frameworks` (named
 * analyst frameworks for SHAPE of reasoning). agent_skills are
 * PROCEDURAL — step-by-step playbooks for tasks like protocol
 * valuation, on-chain forensics, chart construction.
 *
 * Implementation mirrors the analyst-corpus retrieval pattern in
 * server/analyst-corpus.ts: vector ranking (cosine) + BM25 (ts_rank_cd)
 * → reciprocal rank fusion. Returns the FULL skill body so the agent
 * has the whole procedure in context.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { embed } from "./data-source-brain/embeddings";
import { logger } from "./logger";

const VECTOR_CANDIDATES = 6;
const BM25_CANDIDATES = 6;
const RRF_K = 60;
const MIN_SIMILARITY = 0.25;

export interface SkillHit {
  slug: string;
  name: string;
  category: string;
  description: string;
  body: string;
  similarity: number;
  bm25Score: number;
  rrfScore: number;
}

interface RawSkillRow {
  slug: string;
  name: string;
  category: string;
  description: string;
  body: string;
  similarity?: number;
  bm25_score?: number;
}

export async function searchAgentSkills(params: {
  query: string;
  limit?: number;
  category?: "data-science" | "research";
}): Promise<SkillHit[]> {
  const limit = Math.min(Math.max(params.limit || 3, 1), 6);
  if (!params.query || !params.query.trim()) return [];

  let queryVec: number[];
  try {
    queryVec = await embed(params.query, "query");
  } catch (err: any) {
    logger.warn({ err: err?.message, query: params.query }, "agent_skills: embed failed");
    return [];
  }
  const vecStr = `[${queryVec.join(",")}]`;

  // Two parallel candidate pools — vector (cosine) and BM25 (tsvector).
  // Then fuse via reciprocal rank for the final ordering.
  const categoryFilter = params.category
    ? sql`AND category = ${params.category}`
    : sql``;

  const [vectorRows, bm25Rows] = await Promise.all([
    db.execute<RawSkillRow>(sql`
      SELECT slug, name, category, description, body,
             1 - (embedding <=> ${vecStr}::vector) AS similarity
      FROM agent_skills
      WHERE 1=1 ${categoryFilter}
      ORDER BY embedding <=> ${vecStr}::vector
      LIMIT ${VECTOR_CANDIDATES}
    `),
    db.execute<RawSkillRow>(sql`
      SELECT slug, name, category, description, body,
             ts_rank_cd(content_tsv, plainto_tsquery('english', ${params.query})) AS bm25_score
      FROM agent_skills
      WHERE content_tsv @@ plainto_tsquery('english', ${params.query})
        ${categoryFilter}
      ORDER BY bm25_score DESC
      LIMIT ${BM25_CANDIDATES}
    `),
  ]);

  const vecArr: RawSkillRow[] = (vectorRows as any).rows ?? vectorRows;
  const bm25Arr: RawSkillRow[] = (bm25Rows as any).rows ?? bm25Rows;

  // Reciprocal rank fusion. Each result gets 1/(K + rank) from each pool;
  // higher RRF = better.
  const byId = new Map<string, SkillHit>();
  const upsert = (row: RawSkillRow, rank: number, fromVector: boolean) => {
    const existing = byId.get(row.slug);
    const sim = Number(row.similarity ?? existing?.similarity ?? 0);
    const bm = Number(row.bm25_score ?? existing?.bm25Score ?? 0);
    const addRrf = 1 / (RRF_K + rank);
    if (existing) {
      existing.rrfScore += addRrf;
      if (fromVector) existing.similarity = sim;
      else existing.bm25Score = bm;
    } else {
      byId.set(row.slug, {
        slug: row.slug,
        name: row.name,
        category: row.category,
        description: row.description,
        body: row.body,
        similarity: sim,
        bm25Score: bm,
        rrfScore: addRrf,
      });
    }
  };
  vecArr.forEach((r, i) => upsert(r, i, true));
  bm25Arr.forEach((r, i) => upsert(r, i, false));

  // Filter low-similarity skills (the vector index returns SOMETHING for
  // every query, even if cosine ≈ 0.1 — those aren't real hits).
  const hits = Array.from(byId.values())
    .filter((h) => h.similarity >= MIN_SIMILARITY || h.bm25Score > 0)
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, limit);

  logger.info(
    { query: params.query.slice(0, 80), returned: hits.length, slugs: hits.map((h) => h.slug) },
    "agent_skills search",
  );

  return hits;
}

/** Tool def for query_agent_skills — agent calls this when it needs a
 *  procedure for a task type (valuation, forensics, chart-building,
 *  research-mode workflow). */
export const QUERY_AGENT_SKILLS_TOOL_DEF = {
  name: "query_agent_skills",
  description:
    "Retrieve procedural skill packs (ported from hermes) — step-by-step playbooks for tasks like protocol valuation, on-chain forensics, chart construction, dune query authoring, analyst consultation. Hybrid vector + BM25 search returns the top 1-3 most relevant skills with their FULL bodies — you then FOLLOW the procedure in your work. Use this BEFORE you commit to an approach when the user's question maps to one of these task shapes: financial modeling / valuation, tx-flow tracing / on-chain forensics, building a multi-panel chart, authoring a Dune query, consulting an analyst's perspective. Don't use for retrieving past data (use the brain) or live numbers (use the data tools). Skills available: crypto-protocol-valuation, onchain-flow-forensics, onchain-forensics, onchain-chart-library, dune-query-builder, chart-library, consult-analysts, research-mode.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Natural-language description of the task you're doing. E.g. 'how to build a token valuation model with scenario analysis', 'trace USDC flows after a wallet drain', 'multi-panel chart for protocol revenue + buybacks + emissions'.",
      },
      category: {
        type: "string",
        enum: ["data-science", "research"],
        description: "Optional: restrict to data-science (forensics, valuation, charting, dune) or research (analyst consultation, research workflow) skills.",
      },
      limit: {
        type: "integer",
        description: "Max skills to return (default 3, max 6). Each comes with its full body, so 2-3 is usually plenty.",
        minimum: 1,
        maximum: 6,
      },
    },
    required: ["query"],
  },
} as const;

/** Executor used by the agent's executeTool dispatch. Returns the
 *  serialised result for the model to consume. */
export async function executeQueryAgentSkills(input: any): Promise<string> {
  const hits = await searchAgentSkills({
    query: String(input.query || ""),
    limit: input.limit,
    category: input.category,
  });
  if (hits.length === 0) {
    return JSON.stringify({
      count: 0,
      message:
        "No agent_skills matched. Either the question shape doesn't map to a ported skill (try a different query phrasing), or the skill ingestion hasn't run — check that bootstrap-agent-skills.ts has been executed.",
    });
  }
  return JSON.stringify({
    count: hits.length,
    query: String(input.query || ""),
    skills: hits.map((h) => ({
      slug: h.slug,
      name: h.name,
      category: h.category,
      description: h.description,
      relevance: { similarity: Number(h.similarity.toFixed(3)), bm25: Number(h.bm25Score.toFixed(3)), rrf: Number(h.rrfScore.toFixed(4)) },
      // Truncate to keep total payload reasonable. 12k chars per skill is
      // ~3k tokens — plenty of room for 2-3 skills in agent context.
      body: h.body.length > 12_000 ? h.body.slice(0, 12_000) + "\n\n[...truncated; query for a more specific shape to get full body]" : h.body,
    })),
    usage_note: "Follow the procedure in the most relevant skill's body. The body is authored as if instructing you directly — treat it as a focused system prompt for this task.",
  });
}
