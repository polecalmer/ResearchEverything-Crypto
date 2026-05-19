import { db } from "./db";
import { embed } from "./data-source-brain/embeddings";
import { sql } from "drizzle-orm";
import type { BrainGraph, BrainFact, BrainEntity, BrainRelationship } from "./session-research-agent";

export interface RetrievedContext {
  entities: Record<string, BrainEntity>;
  relationships: BrainRelationship[];
  facts: BrainFact[];
  contradictions: Array<{ factIdOld: string; factIdNew: string; summary: string; date: string }>;
  preferences: Record<string, any>;
  methodology: Array<{ scopeKey: string; ruleText: string; confidence: number }>;
  meta: BrainGraph["meta"] | null;
  retrievalSummary: string;
  // Hermes-parity analyst perspective layers (migration 0003). Surface
  // the top-matching investigation patterns, frameworks, and signals
  // from the ingested HRC corpus, ranked by hybrid vector + BM25 + RRF
  // against the user's query. Empty when no corpus is loaded or no
  // matches clear the similarity floor.
  analystPerspectives: {
    questions: Array<{ analystSlug: string; questionText: string; questionType: string | null; questionTopic: string | null; evidenceQuote: string | null; vectorSim: number | null }>;
    frameworks: Array<{ analyst: string; name: string; description: string; category: string | null; vectorSim: number | null }>;
    signals: Array<{ analystSlug: string; signalName: string; signalKind: string | null; useCase: string | null; sourceRef: string | null; vectorSim: number | null }>;
  };
}

// Fetches synthesis-discipline rules from system_learnings. Always-on rules
// (scope='global', ruleType='synthesis_discipline') are loaded unconditionally;
// additional rules whose scopeKey tokens overlap the query are also included.
async function retrieveMethodologyRules(query: string): Promise<Array<{ scopeKey: string; ruleText: string; confidence: number }>> {
  try {
    const rows = await db.execute(sql`
      SELECT scope_key, rule_text, confidence
      FROM system_learnings
      WHERE is_active = true
        AND rule_type = 'synthesis_discipline'
        AND (scope = 'global' OR scope_key = ANY(
          SELECT unnest(string_to_array(lower(${query}), ' '))
        ))
      ORDER BY confidence DESC, applied_count DESC
      LIMIT 8
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw.map((r: any) => ({
      scopeKey: r.scope_key,
      ruleText: r.rule_text,
      confidence: Number(r.confidence || 50),
    }));
  } catch (err: any) {
    console.warn(`[BrainRetrieval] Methodology rule fetch failed: ${err.message}`);
    return [];
  }
}

const MAX_BRAIN_CONTEXT_CHARS = 12000;
const FACT_CANDIDATES = 30;
const ENTITY_CANDIDATES = 15;
const RRF_K = 60;
const MIN_SIMILARITY = 0.35;

interface ScoredFact extends BrainFact {
  rrfScore: number;
  vectorSim: number | null;
}

interface ScoredEntity {
  entityName: string;
  entity: BrainEntity;
  rrfScore: number;
  vectorSim: number | null;
}

async function hybridSearchFacts(
  userId: string,
  queryVec: number[],
  queryText: string,
  topK: number,
): Promise<ScoredFact[]> {
  const vec = `[${queryVec.join(",")}]`;
  try {
    const rows = await db.execute(sql`
      WITH vec AS (
        SELECT fact_id,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM brain_facts
        WHERE user_id = ${userId}
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${FACT_CANDIDATES}
      ),
      txt AS (
        SELECT fact_id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM brain_facts, plainto_tsquery('english', ${queryText}) q
        WHERE user_id = ${userId} AND content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT ${FACT_CANDIDATES}
      ),
      fused AS (
        SELECT
          COALESCE(v.fact_id, t.fact_id) AS fact_id,
          v.sim AS vector_sim,
          v.rank::int AS vector_rank,
          t.rank::int AS text_rank,
          COALESCE(1.0 / (${RRF_K} + v.rank), 0) +
          COALESCE(1.0 / (${RRF_K} + t.rank), 0) AS rrf_score
        FROM vec v
        FULL OUTER JOIN txt t ON v.fact_id = t.fact_id
      )
      SELECT bf.fact_id, bf.topic, bf.fact, bf.entities, bf.source, bf.date, bf.confidence,
             f.vector_sim, f.vector_rank, f.text_rank, f.rrf_score
      FROM fused f
      JOIN brain_facts bf ON bf.fact_id = f.fact_id AND bf.user_id = ${userId}
      ORDER BY f.rrf_score DESC
      LIMIT ${topK}
    `);

    const raw: any[] = (rows as any).rows ?? rows;
    return raw
      .filter((r: any) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        const matchedText = r.text_rank != null;
        return sim >= MIN_SIMILARITY || matchedText;
      })
      .map((r: any) => ({
        id: r.fact_id,
        topic: r.topic || "",
        fact: r.fact || "",
        entities: r.entities || [],
        source: r.source || "",
        date: r.date || "",
        confidence: r.confidence || "verified",
        rrfScore: Number(r.rrf_score),
        vectorSim: r.vector_sim != null ? Number(r.vector_sim) : null,
      }));
  } catch (err: any) {
    console.warn(`[BrainRetrieval] Hybrid fact search failed: ${err.message}`);
    return [];
  }
}

async function hybridSearchEntities(
  userId: string,
  queryVec: number[],
  queryText: string,
  topK: number,
): Promise<ScoredEntity[]> {
  const vec = `[${queryVec.join(",")}]`;
  try {
    const rows = await db.execute(sql`
      WITH vec AS (
        SELECT entity_name,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM brain_entities
        WHERE user_id = ${userId}
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${ENTITY_CANDIDATES}
      ),
      txt AS (
        SELECT entity_name,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM brain_entities, plainto_tsquery('english', ${queryText}) q
        WHERE user_id = ${userId} AND content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT ${ENTITY_CANDIDATES}
      ),
      fused AS (
        SELECT
          COALESCE(v.entity_name, t.entity_name) AS entity_name,
          v.sim AS vector_sim,
          v.rank::int AS vector_rank,
          t.rank::int AS text_rank,
          COALESCE(1.0 / (${RRF_K} + v.rank), 0) +
          COALESCE(1.0 / (${RRF_K} + t.rank), 0) AS rrf_score
        FROM vec v
        FULL OUTER JOIN txt t ON v.entity_name = t.entity_name
      )
      SELECT be.entity_name, be.type, be.category, be.summary,
             f.vector_sim, f.vector_rank, f.text_rank, f.rrf_score
      FROM fused f
      JOIN brain_entities be ON be.entity_name = f.entity_name AND be.user_id = ${userId}
      ORDER BY f.rrf_score DESC
      LIMIT ${topK}
    `);

    const raw: any[] = (rows as any).rows ?? rows;
    return raw
      .filter((r: any) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        return sim >= MIN_SIMILARITY || r.text_rank != null;
      })
      .map((r: any) => ({
        entityName: r.entity_name,
        entity: {
          type: r.type || "unknown",
          category: r.category || undefined,
          summary: r.summary || undefined,
          researchCount: 0,
          lastResearched: "",
        } as BrainEntity,
        rrfScore: Number(r.rrf_score),
        vectorSim: r.vector_sim != null ? Number(r.vector_sim) : null,
      }));
  } catch (err: any) {
    console.warn(`[BrainRetrieval] Hybrid entity search failed: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Analyst-perspective hybrid retrieval (migration 0003)
//
// Same RRF pattern as facts/entities. Cross-analyst — the brain context
// surfaces matches from any analyst whose extracted question/framework/
// signal aligns with the user's query. The agent absorbs the perspective
// without naming the analyst (methodology-opacity rule).
//
// Min similarity floor is intentionally low (0.25 vs 0.35 for facts) —
// these are interpretive cues, not factual claims, so we'd rather pull
// in a related question than miss it entirely. The synthesizer ignores
// noise gracefully.
// ─────────────────────────────────────────────────────────────────────────
const ANALYST_PERSPECTIVE_CANDIDATES = 12;
const ANALYST_PERSPECTIVE_MIN_SIM = 0.25;

interface ScoredQuestion {
  analystSlug: string;
  questionText: string;
  questionType: string | null;
  questionTopic: string | null;
  evidenceQuote: string | null;
  rrfScore: number;
  vectorSim: number | null;
}

interface ScoredFramework {
  analyst: string;
  name: string;
  description: string;
  category: string | null;
  rrfScore: number;
  vectorSim: number | null;
}

interface ScoredSignal {
  analystSlug: string;
  signalName: string;
  signalKind: string | null;
  useCase: string | null;
  sourceRef: string | null;
  rrfScore: number;
  vectorSim: number | null;
}

async function hybridSearchAnalystQuestions(
  queryVec: number[],
  queryText: string,
  topK: number,
): Promise<ScoredQuestion[]> {
  const vec = `[${queryVec.join(",")}]`;
  try {
    const rows = await db.execute(sql`
      WITH vec AS (
        SELECT id,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM analyst_questions
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
      ),
      txt AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM analyst_questions, plainto_tsquery('english', ${queryText}) q
        WHERE content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
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
      SELECT aq.analyst_slug, aq.question_text, aq.question_type, aq.question_topic, aq.evidence_quote,
             f.vector_sim, f.rrf_score
        FROM fused f
        JOIN analyst_questions aq ON aq.id = f.id
       ORDER BY f.rrf_score DESC
       LIMIT ${topK}
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw
      .filter((r: any) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        return sim >= ANALYST_PERSPECTIVE_MIN_SIM || r.text_rank != null;
      })
      .map((r: any) => ({
        analystSlug: r.analyst_slug,
        questionText: r.question_text,
        questionType: r.question_type,
        questionTopic: r.question_topic,
        evidenceQuote: r.evidence_quote,
        rrfScore: Number(r.rrf_score),
        vectorSim: r.vector_sim != null ? Number(r.vector_sim) : null,
      }));
  } catch (err: any) {
    // Table may not exist yet (migration 0003 not applied). Silent.
    if (!/relation .* does not exist/i.test(err.message || "")) {
      console.warn(`[BrainRetrieval] Analyst-question search failed: ${err.message}`);
    }
    return [];
  }
}

async function hybridSearchAnalystFrameworks(
  queryVec: number[],
  queryText: string,
  topK: number,
): Promise<ScoredFramework[]> {
  const vec = `[${queryVec.join(",")}]`;
  try {
    const rows = await db.execute(sql`
      WITH vec AS (
        SELECT id,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM analyst_frameworks
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
      ),
      txt AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM analyst_frameworks, plainto_tsquery('english', ${queryText}) q
        WHERE content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
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
      SELECT af.analyst, af.name, af.description, af.category, f.vector_sim, f.rrf_score
        FROM fused f
        JOIN analyst_frameworks af ON af.id = f.id
       ORDER BY f.rrf_score DESC
       LIMIT ${topK}
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw
      .filter((r: any) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        return sim >= ANALYST_PERSPECTIVE_MIN_SIM || r.text_rank != null;
      })
      .map((r: any) => ({
        analyst: r.analyst,
        name: r.name,
        description: r.description,
        category: r.category,
        rrfScore: Number(r.rrf_score),
        vectorSim: r.vector_sim != null ? Number(r.vector_sim) : null,
      }));
  } catch (err: any) {
    if (!/relation .* does not exist/i.test(err.message || "")) {
      console.warn(`[BrainRetrieval] Analyst-framework search failed: ${err.message}`);
    }
    return [];
  }
}

async function hybridSearchAnalystSignals(
  queryVec: number[],
  queryText: string,
  topK: number,
): Promise<ScoredSignal[]> {
  const vec = `[${queryVec.join(",")}]`;
  try {
    const rows = await db.execute(sql`
      WITH vec AS (
        SELECT id,
               1 - (embedding <=> ${vec}::vector) AS sim,
               ROW_NUMBER() OVER (ORDER BY embedding <=> ${vec}::vector) AS rank
        FROM analyst_signals
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vec}::vector
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
      ),
      txt AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
        FROM analyst_signals, plainto_tsquery('english', ${queryText}) q
        WHERE content_tsv @@ q
        ORDER BY ts_rank_cd(content_tsv, q) DESC
        LIMIT ${ANALYST_PERSPECTIVE_CANDIDATES}
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
      SELECT a.analyst_slug, a.signal_name, a.signal_kind, a.use_case, a.source_ref,
             f.vector_sim, f.rrf_score
        FROM fused f
        JOIN analyst_signals a ON a.id = f.id
       ORDER BY f.rrf_score DESC
       LIMIT ${topK}
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw
      .filter((r: any) => {
        const sim = r.vector_sim != null ? Number(r.vector_sim) : 0;
        return sim >= ANALYST_PERSPECTIVE_MIN_SIM || r.text_rank != null;
      })
      .map((r: any) => ({
        analystSlug: r.analyst_slug,
        signalName: r.signal_name,
        signalKind: r.signal_kind,
        useCase: r.use_case,
        sourceRef: r.source_ref,
        rrfScore: Number(r.rrf_score),
        vectorSim: r.vector_sim != null ? Number(r.vector_sim) : null,
      }));
  } catch (err: any) {
    if (!/relation .* does not exist/i.test(err.message || "")) {
      console.warn(`[BrainRetrieval] Analyst-signal search failed: ${err.message}`);
    }
    return [];
  }
}

async function hasEmbeddedData(userId: string): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM brain_facts WHERE user_id = ${userId} LIMIT 1`
    );
    const raw: any[] = (result as any).rows ?? result;
    return raw.length > 0 && Number(raw[0].cnt) > 0;
  } catch {
    return false;
  }
}

function legacyExtractEntityMentions(query: string, knownEntities: string[]): string[] {
  const queryUpper = query.toUpperCase();
  const words = queryUpper.split(/[\s,;.!?()\[\]{}'"]+/).filter(w => w.length > 1);
  const matched: string[] = [];
  for (const entity of knownEntities) {
    const entityUpper = entity.toUpperCase();
    if (queryUpper.includes(entityUpper)) { matched.push(entity); continue; }
    for (const word of words) {
      if (word === entityUpper || entityUpper.includes(word) || word.includes(entityUpper)) {
        matched.push(entity); break;
      }
    }
  }
  return matched;
}

function legacyKeywordMatchFacts(query: string, facts: BrainFact[]): BrainFact[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored: Array<{ fact: BrainFact; score: number }> = [];
  for (const fact of facts) {
    const text = `${fact.topic} ${fact.fact}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) { if (text.includes(word)) score++; }
    if (score > 0) scored.push({ fact, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 15).map(s => s.fact);
}

function legacyGetRelatedEntities(entityName: string, relationships: BrainRelationship[]): string[] {
  const related = new Set<string>();
  for (const rel of relationships) {
    if (rel.from === entityName) related.add(rel.to);
    if (rel.to === entityName) related.add(rel.from);
  }
  return Array.from(related);
}

async function legacyRetrieve(
  query: string,
  brain: BrainGraph,
): Promise<RetrievedContext> {
  const allEntityNames = Object.keys(brain.entities || {});
  const allRelationships = brain.relationships || [];
  const allFacts = brain.knowledge || [];
  const allContradictions = brain.contradictions || [];

  const directMatches = legacyExtractEntityMentions(query, allEntityNames);
  const relatedEntityNames = new Set<string>();
  for (const entity of directMatches) {
    relatedEntityNames.add(entity);
    for (const r of legacyGetRelatedEntities(entity, allRelationships)) relatedEntityNames.add(r);
  }

  const relevantEntities: Record<string, BrainEntity> = {};
  for (const name of relatedEntityNames) {
    if (brain.entities[name]) relevantEntities[name] = brain.entities[name];
  }

  const relevantFacts: BrainFact[] = [];
  const seenFactIds = new Set<string>();
  for (const fact of allFacts) {
    if (fact.entities.some(e => relatedEntityNames.has(e))) {
      relevantFacts.push(fact); seenFactIds.add(fact.id);
    }
  }
  for (const fact of legacyKeywordMatchFacts(query, allFacts)) {
    if (!seenFactIds.has(fact.id)) {
      relevantFacts.push(fact); seenFactIds.add(fact.id);
      for (const entityName of fact.entities) {
        if (brain.entities[entityName] && !relevantEntities[entityName]) {
          relevantEntities[entityName] = brain.entities[entityName];
          relatedEntityNames.add(entityName);
        }
      }
    }
  }

  const isComparisonQuery = /market\s*share|compar|vs\.?|versus|landscape|competitor|peer|ranking/i.test(query);
  if (isComparisonQuery) {
    const matchedCategories = new Set<string>();
    for (const name of Object.keys(relevantEntities)) {
      const cat = relevantEntities[name]?.category;
      if (cat) matchedCategories.add(cat);
    }
    if (matchedCategories.size > 0) {
      for (const name of allEntityNames) {
        const ent = brain.entities[name];
        if (ent?.category && matchedCategories.has(ent.category) && !relevantEntities[name]) {
          relevantEntities[name] = ent;
          relatedEntityNames.add(name);
        }
      }
    }
  }

  const relevantRelationships = allRelationships.filter(r =>
    relatedEntityNames.has(r.from) || relatedEntityNames.has(r.to)
  );
  const relevantContradictions = allContradictions.filter(c => {
    const oldFact = allFacts.find(f => f.id === c.factIdOld);
    const newFact = allFacts.find(f => f.id === c.factIdNew);
    const entities = [...(oldFact?.entities || []), ...(newFact?.entities || [])];
    return entities.some(e => relatedEntityNames.has(e));
  });

  const methodology = await retrieveMethodologyRules(query);
  return {
    entities: relevantEntities,
    relationships: relevantRelationships,
    facts: relevantFacts.slice(0, 50),
    contradictions: relevantContradictions.slice(0, 10),
    preferences: brain.preferences || {},
    methodology,
    meta: brain.meta || null,
    // Legacy path runs when there's no embedded brain — skip the analyst
    // perspective layer (it depends on embeddings). Empty default keeps
    // the type signature stable.
    analystPerspectives: emptyAnalystPerspectives(),
    retrievalSummary: directMatches.length > 0
      ? `[legacy] Matched: ${directMatches.join(", ")}. ${Object.keys(relevantEntities).length} entities, ${relevantFacts.length} facts, ${methodology.length} rules`
      : `[legacy] Keyword search: ${relevantFacts.length} facts, ${methodology.length} rules`,
  };
}

export async function retrieveRelevantContext(
  query: string,
  brain: BrainGraph | null,
  userId?: string,
): Promise<RetrievedContext> {
  if (!brain) {
    const methodology = await retrieveMethodologyRules(query);
    // Even with no per-user brain, the analyst perspective layer is
    // shared across users (it's the ingested HRC corpus). Try to surface
    // it — it's gated on embeddings, so if Voyage is down we silently
    // return empty.
    let analystPerspectives = emptyAnalystPerspectives();
    try {
      const queryVec = await embed(query, "query");
      const [questions, frameworks, signals] = await Promise.all([
        hybridSearchAnalystQuestions(queryVec, query, 6),
        hybridSearchAnalystFrameworks(queryVec, query, 5),
        hybridSearchAnalystSignals(queryVec, query, 6),
      ]);
      analystPerspectives = {
        questions: questions.map((q) => ({
          analystSlug: q.analystSlug, questionText: q.questionText, questionType: q.questionType,
          questionTopic: q.questionTopic, evidenceQuote: q.evidenceQuote, vectorSim: q.vectorSim,
        })),
        frameworks: frameworks.map((f) => ({
          analyst: f.analyst, name: f.name, description: f.description, category: f.category, vectorSim: f.vectorSim,
        })),
        signals: signals.map((s) => ({
          analystSlug: s.analystSlug, signalName: s.signalName, signalKind: s.signalKind,
          useCase: s.useCase, sourceRef: s.sourceRef, vectorSim: s.vectorSim,
        })),
      };
    } catch { /* embedding failure → skip perspectives */ }
    const apTotal = analystPerspectives.questions.length + analystPerspectives.frameworks.length + analystPerspectives.signals.length;
    return {
      entities: {},
      relationships: [],
      facts: [],
      contradictions: [],
      preferences: {},
      methodology,
      meta: null,
      analystPerspectives,
      retrievalSummary: methodology.length > 0 || apTotal > 0
        ? `No prior research brain, ${methodology.length} rules, ${apTotal} analyst perspectives`
        : "No prior research brain",
    };
  }

  const useEmbeddings = userId && await hasEmbeddedData(userId);

  if (!useEmbeddings) {
    return legacyRetrieve(query, brain);
  }

  let queryVec: number[];
  try {
    queryVec = await embed(query, "query");
  } catch (err: any) {
    console.warn(`[BrainRetrieval] Query embedding failed, falling back to legacy: ${err.message}`);
    return legacyRetrieve(query, brain);
  }

  const [scoredFacts, scoredEntities, apQuestions, apFrameworks, apSignals] = await Promise.all([
    hybridSearchFacts(userId, queryVec, query, FACT_CANDIDATES),
    hybridSearchEntities(userId, queryVec, query, ENTITY_CANDIDATES),
    hybridSearchAnalystQuestions(queryVec, query, 6),
    hybridSearchAnalystFrameworks(queryVec, query, 5),
    hybridSearchAnalystSignals(queryVec, query, 6),
  ]);

  const retrievedEntityNames = new Set(scoredEntities.map(e => e.entityName));
  for (const f of scoredFacts) {
    for (const ent of f.entities) retrievedEntityNames.add(ent);
  }

  const entities: Record<string, BrainEntity> = {};
  for (const se of scoredEntities) {
    if (brain.entities[se.entityName]) {
      entities[se.entityName] = brain.entities[se.entityName];
    } else {
      entities[se.entityName] = se.entity;
    }
  }
  for (const name of retrievedEntityNames) {
    if (!entities[name] && brain.entities[name]) {
      entities[name] = brain.entities[name];
    }
  }

  const isComparisonQuery = /market\s*share|compar|vs\.?|versus|landscape|competitor|peer|ranking/i.test(query);
  if (isComparisonQuery) {
    const matchedCategories = new Set<string>();
    for (const se of scoredEntities) {
      const cat = se.entity.category;
      if (cat) matchedCategories.add(cat);
    }
    if (matchedCategories.size > 0) {
      try {
        const catArray = [...matchedCategories];
        // Drizzle binds a JS array as a composite `record` rather than
        // a `text[]`, which makes `::text[]` fail with "cannot cast type
        // record to text[]". Use IN (...) with a comma-joined list of
        // individually-bound text params instead — drizzle escapes each
        // value safely and Postgres sees `text` not `record`.
        const peerRows = await db.execute(sql`
          SELECT entity_name, type, category, summary
          FROM brain_entities
          WHERE user_id = ${userId}
            AND category IN (${sql.join(catArray.map((c) => sql`${c}`), sql`, `)})
          LIMIT 20
        `);
        const raw: any[] = (peerRows as any).rows ?? peerRows;
        for (const r of raw) {
          if (!entities[r.entity_name]) {
            entities[r.entity_name] = {
              type: r.type || "unknown",
              category: r.category || undefined,
              summary: r.summary || undefined,
              researchCount: 0,
              lastResearched: "",
            } as BrainEntity;
            retrievedEntityNames.add(r.entity_name);
          }
        }
        if (raw.length > 0) {
          console.log(`[BrainRetrieval] Category peer expansion: found ${raw.length} peers in categories [${catArray.join(", ")}]`);
        }
      } catch (err: any) {
        console.warn(`[BrainRetrieval] Category peer expansion failed: ${err.message}`);
      }
    }
  }

  const allRelationships = brain.relationships || [];
  const relationships = allRelationships.filter(r =>
    retrievedEntityNames.has(r.from) || retrievedEntityNames.has(r.to)
  );

  const allContradictions = brain.contradictions || [];
  const allFacts = brain.knowledge || [];
  const contradictions = allContradictions.filter(c => {
    const oldFact = allFacts.find(f => f.id === c.factIdOld);
    const newFact = allFacts.find(f => f.id === c.factIdNew);
    const ents = [...(oldFact?.entities || []), ...(newFact?.entities || [])];
    return ents.some(e => retrievedEntityNames.has(e));
  });

  const topFacts = scoredFacts.map(sf => ({
    id: sf.id,
    topic: sf.topic,
    fact: sf.fact,
    entities: sf.entities,
    source: sf.source,
    date: sf.date,
    confidence: sf.confidence,
  } as BrainFact));

  const methodology = await retrieveMethodologyRules(query);
  const apTotal = apQuestions.length + apFrameworks.length + apSignals.length;
  const summary = `[hybrid] ${scoredFacts.length} facts (top sim: ${scoredFacts[0]?.vectorSim?.toFixed(3) ?? "n/a"}), ${scoredEntities.length} entities, ${relationships.length} rels, ${methodology.length} rules, ${apTotal} analyst perspectives`;

  return {
    entities,
    relationships,
    facts: topFacts,
    contradictions: contradictions.slice(0, 10),
    preferences: brain.preferences || {},
    methodology,
    meta: brain.meta || null,
    analystPerspectives: {
      questions: apQuestions.map((q) => ({
        analystSlug: q.analystSlug, questionText: q.questionText, questionType: q.questionType,
        questionTopic: q.questionTopic, evidenceQuote: q.evidenceQuote, vectorSim: q.vectorSim,
      })),
      frameworks: apFrameworks.map((f) => ({
        analyst: f.analyst, name: f.name, description: f.description, category: f.category, vectorSim: f.vectorSim,
      })),
      signals: apSignals.map((s) => ({
        analystSlug: s.analystSlug, signalName: s.signalName, signalKind: s.signalKind,
        useCase: s.useCase, sourceRef: s.sourceRef, vectorSim: s.vectorSim,
      })),
    },
    retrievalSummary: summary,
  };
}

function emptyAnalystPerspectives(): RetrievedContext["analystPerspectives"] {
  return { questions: [], frameworks: [], signals: [] };
}

export function formatRetrievedContext(ctx: RetrievedContext): string {
  const apCount = (ctx.analystPerspectives?.questions.length || 0)
                + (ctx.analystPerspectives?.frameworks.length || 0)
                + (ctx.analystPerspectives?.signals.length || 0);
  if (
    Object.keys(ctx.entities).length === 0 &&
    ctx.facts.length === 0 &&
    Object.keys(ctx.preferences).length === 0 &&
    (ctx.methodology?.length || 0) === 0 &&
    apCount === 0
  ) {
    return "";
  }

  const sections: string[] = [];
  let charBudget = MAX_BRAIN_CONTEXT_CHARS;

  sections.push(`[Retrieval: ${ctx.retrievalSummary}]`);
  charBudget -= sections[0].length;

  // Methodology rules lead the context — they shape HOW the agent answers,
  // not WHAT it knows. Budget capped so they can't crowd out facts.
  if (ctx.methodology?.length > 0) {
    const methodLines = ctx.methodology.map(m => `- [${m.scopeKey}] ${m.ruleText}`);
    const block = "METHODOLOGY RULES (must follow):\n" + methodLines.join("\n");
    const cap = Math.min(block.length, 1500);
    if (cap <= charBudget) {
      sections.push(block.slice(0, cap));
      charBudget -= cap;
    }
  }

  const prefBlock = formatPreferences(ctx.preferences);
  if (prefBlock) {
    sections.push(prefBlock);
    charBudget -= prefBlock.length;
  }

  const entityNames = Object.keys(ctx.entities);
  if (entityNames.length > 0 && charBudget > 100) {
    const entityLines = entityNames.map(name => {
      const e = ctx.entities[name];
      const parts = [`${name} (${e.type}${e.category ? `, ${e.category}` : ""})`];
      if (e.summary) parts.push(`  → ${e.summary}`);
      if (e.competitors?.length) parts.push(`  Competitors: ${e.competitors.join(", ")}`);
      parts.push(`  Researched ${e.researchCount}x, last: ${e.lastResearched}`);
      return parts.join("\n");
    });
    const block = "KNOWN ENTITIES:\n" + entityLines.join("\n\n");
    if (block.length <= charBudget) {
      sections.push(block);
      charBudget -= block.length;
    } else {
      const safeSlice = Math.max(0, charBudget - 30);
      const truncated = block.slice(0, safeSlice) + "\n... (truncated)";
      sections.push(truncated);
      charBudget = 0;
    }
  }

  if (ctx.relationships.length > 0 && charBudget > 200) {
    const relLines = ctx.relationships.map(r =>
      `${r.from} → ${r.type.replace(/_/g, " ")} → ${r.to}${r.context ? ` (${r.context})` : ""}`
    );
    const block = "ENTITY RELATIONSHIPS:\n" + relLines.join("\n");
    if (block.length <= charBudget) {
      sections.push(block);
      charBudget -= block.length;
    } else {
      const truncated = "ENTITY RELATIONSHIPS:\n" + relLines.slice(0, 10).join("\n") + "\n... (truncated)";
      sections.push(truncated);
      charBudget -= truncated.length;
    }
  }

  if (ctx.facts.length > 0 && charBudget > 200) {
    const LIVE_METRIC_PATTERNS = /\b(price|tvl|mcap|market cap|fdv|fee|fees|revenue|volume|apy|apr|yield|supply|circulating|inflation|holders|active users|dau|wau)\b/i;
    const STALENESS_HOURS = 12;
    const now = Date.now();

    const factLines: string[] = [];
    for (const f of ctx.facts) {
      const factText = `${f.topic} ${f.fact}`;
      const isLiveMetric = LIVE_METRIC_PATTERNS.test(factText);
      let ageHours = Infinity;
      if (f.date) {
        const factTs = new Date(f.date).getTime();
        if (!isNaN(factTs)) ageHours = (now - factTs) / 3600000;
      }
      const isStale = isLiveMetric && ageHours > STALENESS_HOURS;
      const isSuperseded = !!(f as any).supersedes;
      const explicitlyStale = f.confidence === "stale";

      let badge = "";
      if (explicitlyStale || isSuperseded) badge = " [stale — superseded]";
      else if (isStale) badge = " [stale — refetch before citing]";
      else if (f.confidence === "estimated") badge = " [estimated]";
      else badge = " [verified]";

      const line = `- [${f.date || "?"}] ${f.topic}: ${f.fact} (via ${f.source})${badge}`;
      if (factLines.join("\n").length + line.length + 30 > charBudget) break;
      factLines.push(line);
    }

    if (factLines.length > 0) {
      const block = "PRIOR KNOWLEDGE (relevance-ranked):\n" + factLines.join("\n");
      sections.push(block);
      charBudget -= block.length;
    }
  }

  if (ctx.contradictions.length > 0 && charBudget > 100) {
    const block = "RECENT DATA CHANGES:\n" + ctx.contradictions.map(c =>
      `- ${c.summary} (${c.date})`
    ).join("\n");
    sections.push(block.slice(0, Math.max(0, charBudget)));
  }

  if (ctx.meta && charBudget > 50) {
    sections.push(`RESEARCH STATS: ${ctx.meta.totalSessions} sessions, last active: ${ctx.meta.lastActive}` +
      (ctx.meta.topEntities?.length ? `, most researched: ${ctx.meta.topEntities.join(", ")}` : ""));
  }

  // ─── Analyst perspective layer (migration 0003) ────────────────────────
  // Hermes-parity: questions, frameworks, signals matched to the query
  // from the ingested HRC corpus. ABSORBED into reasoning — never
  // name-attributed in output prose (methodology opacity rule). The
  // block carries its own char budget (~4K) so it can't crowd out the
  // primary brain context.
  const apBlock = formatAnalystPerspectives(ctx.analystPerspectives);
  if (apBlock) {
    sections.push(apBlock);
  }

  return "\n\nRESEARCH BRAIN (relevant context from past sessions):\n" + sections.join("\n\n");
}

const MAX_ANALYST_PERSPECTIVE_CHARS = 4000;

function formatAnalystPerspectives(ap: RetrievedContext["analystPerspectives"]): string {
  if (!ap) return "";
  const totalCount = ap.questions.length + ap.frameworks.length + ap.signals.length;
  if (totalCount === 0) return "";

  const parts: string[] = [];
  parts.push(
    "ANALYST PERSPECTIVE LAYER (absorb into reasoning; NEVER cite by analyst name in output prose — methodology opacity rule):",
  );

  if (ap.questions.length > 0) {
    const lines = ap.questions.slice(0, 6).map((q) => {
      const tag = [q.questionType, q.questionTopic].filter(Boolean).join(" / ");
      return `- ${q.questionText}${tag ? ` (${tag})` : ""}`;
    });
    parts.push("Investigation questions worth asking on this topic:\n" + lines.join("\n"));
  }

  if (ap.frameworks.length > 0) {
    const lines = ap.frameworks.slice(0, 5).map((f) => {
      const cat = f.category ? ` [${f.category}]` : "";
      const desc = f.description ? ` — ${f.description.slice(0, 300)}` : "";
      return `- ${f.name}${cat}${desc}`;
    });
    parts.push("Frameworks / decision rules to apply when interpreting evidence:\n" + lines.join("\n"));
  }

  if (ap.signals.length > 0) {
    const lines = ap.signals.slice(0, 6).map((s) => {
      const kind = s.signalKind ? ` [${s.signalKind}]` : "";
      const use = s.useCase ? ` — ${s.useCase.slice(0, 200)}` : "";
      const ref = s.sourceRef ? ` (ref: ${s.sourceRef.slice(0, 120)})` : "";
      return `- ${s.signalName}${kind}${use}${ref}`;
    });
    parts.push("Default data sources / signals analysts reach for on this topic:\n" + lines.join("\n"));
  }

  const joined = parts.join("\n\n");
  return joined.length > MAX_ANALYST_PERSPECTIVE_CHARS
    ? joined.slice(0, MAX_ANALYST_PERSPECTIVE_CHARS - 30) + "\n... (truncated)"
    : joined;
}

function formatPreferences(preferences: Record<string, any>): string {
  if (!preferences || Object.keys(preferences).length === 0) return "";

  const prefLines: string[] = [];

  const dataSources = preferences.data_sources;
  if (Array.isArray(dataSources) && dataSources.length > 0) {
    prefLines.push("MANDATORY DATA SOURCES (user-specified — you MUST follow these):");
    for (const ds of dataSources) {
      if (typeof ds === "string") prefLines.push(`  - ${ds}`);
      else if (ds.name) prefLines.push(`  - ${ds.name}${ds.url ? ` (${ds.url})` : ""}${ds.description ? `: ${ds.description}` : ""}`);
    }
  }

  const researchStyle = preferences.research_style;
  if (Array.isArray(researchStyle) && researchStyle.length > 0) {
    prefLines.push("USER'S RESEARCH STYLE (match this approach):");
    for (const rs of researchStyle) {
      prefLines.push(`  - ${typeof rs === "string" ? rs : rs.description || JSON.stringify(rs)}`);
    }
  }

  const analysisLens = preferences.analysis_lens;
  if (Array.isArray(analysisLens) && analysisLens.length > 0) {
    prefLines.push("ANALYSIS LENS & FRAMEWORKS:");
    for (const al of analysisLens) {
      prefLines.push(`  - ${typeof al === "string" ? al : al.description || JSON.stringify(al)}`);
    }
  }

  const customInstructions = preferences.custom_instructions;
  if (Array.isArray(customInstructions) && customInstructions.length > 0) {
    prefLines.push("CUSTOM INSTRUCTIONS (MUST FOLLOW — these are explicit user rules):");
    for (const ci of customInstructions) {
      prefLines.push(`  - ${typeof ci === "string" ? ci : ci.description || JSON.stringify(ci)}`);
    }
  }

  const otherPrefs = Object.entries(preferences).filter(
    ([k]) => !["data_sources", "research_style", "analysis_lens", "custom_instructions"].includes(k)
  );
  if (otherPrefs.length > 0) {
    prefLines.push("OTHER PREFERENCES:");
    for (const [k, v] of otherPrefs) {
      prefLines.push(`  - ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }

  if (prefLines.length === 0) return "";
  return "USER RULES & PREFERENCES (always apply, regardless of query):\n" + prefLines.join("\n");
}
