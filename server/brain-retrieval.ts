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
  meta: BrainGraph["meta"] | null;
  retrievalSummary: string;
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

function legacyRetrieve(
  query: string,
  brain: BrainGraph,
): RetrievedContext {
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

  return {
    entities: relevantEntities,
    relationships: relevantRelationships,
    facts: relevantFacts.slice(0, 50),
    contradictions: relevantContradictions.slice(0, 10),
    preferences: brain.preferences || {},
    meta: brain.meta || null,
    retrievalSummary: directMatches.length > 0
      ? `[legacy] Matched: ${directMatches.join(", ")}. ${Object.keys(relevantEntities).length} entities, ${relevantFacts.length} facts`
      : `[legacy] Keyword search: ${relevantFacts.length} facts`,
  };
}

export async function retrieveRelevantContext(
  query: string,
  brain: BrainGraph | null,
  userId?: string,
): Promise<RetrievedContext> {
  if (!brain) {
    return {
      entities: {},
      relationships: [],
      facts: [],
      contradictions: [],
      preferences: {},
      meta: null,
      retrievalSummary: "No prior research brain",
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

  const [scoredFacts, scoredEntities] = await Promise.all([
    hybridSearchFacts(userId, queryVec, query, FACT_CANDIDATES),
    hybridSearchEntities(userId, queryVec, query, ENTITY_CANDIDATES),
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
        const peerRows = await db.execute(sql`
          SELECT entity_name, type, category, summary
          FROM brain_entities
          WHERE user_id = ${userId}
            AND category = ANY(${catArray}::text[])
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

  const summary = `[hybrid] ${scoredFacts.length} facts (top sim: ${scoredFacts[0]?.vectorSim?.toFixed(3) ?? "n/a"}), ${scoredEntities.length} entities, ${relationships.length} rels`;

  return {
    entities,
    relationships,
    facts: topFacts,
    contradictions: contradictions.slice(0, 10),
    preferences: brain.preferences || {},
    meta: brain.meta || null,
    retrievalSummary: summary,
  };
}

export function formatRetrievedContext(ctx: RetrievedContext): string {
  if (Object.keys(ctx.entities).length === 0 && ctx.facts.length === 0 && Object.keys(ctx.preferences).length === 0) {
    return "";
  }

  const sections: string[] = [];
  let charBudget = MAX_BRAIN_CONTEXT_CHARS;

  sections.push(`[Retrieval: ${ctx.retrievalSummary}]`);
  charBudget -= sections[0].length;

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

  return "\n\nRESEARCH BRAIN (relevant context from past sessions):\n" + sections.join("\n\n");
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
