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

function extractEntityMentions(query: string, knownEntities: string[]): string[] {
  const queryUpper = query.toUpperCase();
  const words = queryUpper.split(/[\s,;.!?()\[\]{}'"]+/).filter(w => w.length > 1);

  const matched: string[] = [];
  for (const entity of knownEntities) {
    const entityUpper = entity.toUpperCase();
    if (queryUpper.includes(entityUpper)) {
      matched.push(entity);
      continue;
    }
    for (const word of words) {
      if (word === entityUpper || entityUpper.includes(word) || word.includes(entityUpper)) {
        matched.push(entity);
        break;
      }
    }
  }

  return matched;
}

function getRelatedEntities(entityName: string, relationships: BrainRelationship[], depth: number = 1): string[] {
  const related = new Set<string>();
  let frontier = [entityName];

  for (let d = 0; d < depth; d++) {
    const nextFrontier: string[] = [];
    for (const name of frontier) {
      for (const rel of relationships) {
        if (rel.from === name && !related.has(rel.to)) {
          related.add(rel.to);
          nextFrontier.push(rel.to);
        }
        if (rel.to === name && !related.has(rel.from)) {
          related.add(rel.from);
          nextFrontier.push(rel.from);
        }
      }
    }
    frontier = nextFrontier;
  }

  return Array.from(related);
}

function keywordMatchFacts(query: string, facts: BrainFact[]): BrainFact[] {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored: Array<{ fact: BrainFact; score: number }> = [];

  for (const fact of facts) {
    const text = `${fact.topic} ${fact.fact}`.toLowerCase();
    let score = 0;
    for (const word of queryWords) {
      if (text.includes(word)) score++;
    }
    if (score > 0) {
      scored.push({ fact, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 15).map(s => s.fact);
}

export function retrieveRelevantContext(
  query: string,
  brain: BrainGraph | null,
): RetrievedContext {
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

  const allEntityNames = Object.keys(brain.entities || {});
  const allRelationships = brain.relationships || [];
  const allFacts = brain.knowledge || [];
  const allContradictions = brain.contradictions || [];

  const directMatches = extractEntityMentions(query, allEntityNames);

  const relatedEntityNames = new Set<string>();
  for (const entity of directMatches) {
    relatedEntityNames.add(entity);
    const related = getRelatedEntities(entity, allRelationships, 1);
    for (const r of related) relatedEntityNames.add(r);
  }

  const relevantEntities: Record<string, BrainEntity> = {};
  for (const name of relatedEntityNames) {
    if (brain.entities[name]) {
      relevantEntities[name] = brain.entities[name];
    }
  }

  const relevantFacts: BrainFact[] = [];
  const seenFactIds = new Set<string>();

  for (const fact of allFacts) {
    const hasRelevantEntity = fact.entities.some(e => relatedEntityNames.has(e));
    if (hasRelevantEntity) {
      relevantFacts.push(fact);
      seenFactIds.add(fact.id);
    }
  }

  const keywordFacts = keywordMatchFacts(query, allFacts);
  for (const fact of keywordFacts) {
    if (!seenFactIds.has(fact.id)) {
      relevantFacts.push(fact);
      seenFactIds.add(fact.id);

      for (const entityName of fact.entities) {
        if (brain.entities[entityName] && !relevantEntities[entityName]) {
          relevantEntities[entityName] = brain.entities[entityName];
          relatedEntityNames.add(entityName);
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
    if (!oldFact && !newFact) return false;
    const entities = [...(oldFact?.entities || []), ...(newFact?.entities || [])];
    return entities.some(e => relatedEntityNames.has(e));
  });

  const totalEntities = allEntityNames.length;
  const totalFacts = allFacts.length;
  const retrievedEntities = Object.keys(relevantEntities).length;
  const retrievedFacts = relevantFacts.length;

  const hasPrefs = Object.values(brain.preferences || {}).some(
    (v: any) => Array.isArray(v) && v.length > 0
  );
  const summary = directMatches.length > 0
    ? `Matched entities: ${directMatches.join(", ")}. Retrieved ${retrievedEntities}/${totalEntities} entities, ${retrievedFacts}/${totalFacts} facts (+ ${relevantRelationships.length} relationships)`
    : totalFacts > 0
      ? `No direct entity match — keyword search returned ${retrievedFacts}/${totalFacts} facts`
      : hasPrefs
        ? "No entities/facts yet — preferences loaded"
        : "Brain is empty — first research session";

  return {
    entities: relevantEntities,
    relationships: relevantRelationships,
    facts: relevantFacts.slice(0, 50),
    contradictions: relevantContradictions.slice(0, 10),
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
  sections.push(`[Retrieval: ${ctx.retrievalSummary}]`);

  const entityNames = Object.keys(ctx.entities);
  if (entityNames.length > 0) {
    const entityLines = entityNames.map(name => {
      const e = ctx.entities[name];
      const parts = [`${name} (${e.type}${e.category ? `, ${e.category}` : ""})`];
      if (e.summary) parts.push(`  → ${e.summary}`);
      if (e.competitors?.length) parts.push(`  Competitors: ${e.competitors.join(", ")}`);
      if (e.tags?.length) parts.push(`  Tags: ${e.tags.join(", ")}`);
      parts.push(`  Researched ${e.researchCount}x, last: ${e.lastResearched}`);
      return parts.join("\n");
    });
    sections.push("KNOWN ENTITIES:\n" + entityLines.join("\n\n"));
  }

  if (ctx.relationships.length > 0) {
    const relLines = ctx.relationships.map(r =>
      `${r.from} → ${r.type.replace(/_/g, " ")} → ${r.to}${r.context ? ` (${r.context})` : ""}`
    );
    sections.push("ENTITY RELATIONSHIPS:\n" + relLines.join("\n"));
  }

  if (ctx.facts.length > 0) {
    const byEntity: Record<string, BrainFact[]> = {};
    for (const fact of ctx.facts) {
      for (const ent of fact.entities) {
        if (!byEntity[ent]) byEntity[ent] = [];
        byEntity[ent].push(fact);
      }
    }
    const factLines: string[] = [];
    for (const [ent, facts] of Object.entries(byEntity)) {
      factLines.push(`${ent}:`);
      for (const f of facts.slice(-5)) {
        const conf = f.confidence === "estimated" ? " ⚠️ estimated" : "";
        const stale = f.supersedes ? " (updated)" : "";
        factLines.push(`  - [${f.date}] ${f.fact} (via ${f.source})${conf}${stale}`);
      }
    }
    sections.push("PRIOR KNOWLEDGE:\n" + factLines.join("\n"));
  }

  if (ctx.contradictions.length > 0) {
    sections.push("RECENT DATA CHANGES:\n" + ctx.contradictions.map(c =>
      `- ${c.summary} (${c.date})`
    ).join("\n"));
  }

  if (Object.keys(ctx.preferences).length > 0) {
    const prefLines: string[] = [];

    const dataSources = ctx.preferences.data_sources;
    if (Array.isArray(dataSources) && dataSources.length > 0) {
      prefLines.push("TRUSTED DATA SOURCES (user-specified — follow these):");
      for (const ds of dataSources) {
        if (typeof ds === "string") prefLines.push(`  - ${ds}`);
        else if (ds.name) prefLines.push(`  - ${ds.name}${ds.url ? ` (${ds.url})` : ""}${ds.description ? `: ${ds.description}` : ""}`);
      }
    }

    const researchStyle = ctx.preferences.research_style;
    if (Array.isArray(researchStyle) && researchStyle.length > 0) {
      prefLines.push("USER'S RESEARCH STYLE (match this approach):");
      for (const rs of researchStyle) {
        prefLines.push(`  - ${typeof rs === "string" ? rs : rs.description || JSON.stringify(rs)}`);
      }
    }

    const analysisLens = ctx.preferences.analysis_lens;
    if (Array.isArray(analysisLens) && analysisLens.length > 0) {
      prefLines.push("ANALYSIS LENS & FRAMEWORKS:");
      for (const al of analysisLens) {
        prefLines.push(`  - ${typeof al === "string" ? al : al.description || JSON.stringify(al)}`);
      }
    }

    const customInstructions = ctx.preferences.custom_instructions;
    if (Array.isArray(customInstructions) && customInstructions.length > 0) {
      prefLines.push("CUSTOM INSTRUCTIONS:");
      for (const ci of customInstructions) {
        prefLines.push(`  - ${typeof ci === "string" ? ci : ci.description || JSON.stringify(ci)}`);
      }
    }

    const otherPrefs = Object.entries(ctx.preferences).filter(
      ([k]) => !["data_sources", "research_style", "analysis_lens", "custom_instructions"].includes(k)
    );
    if (otherPrefs.length > 0) {
      prefLines.push("OTHER PREFERENCES:");
      for (const [k, v] of otherPrefs) {
        prefLines.push(`  - ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
      }
    }

    if (prefLines.length > 0) {
      sections.push("USER PREFERENCES & STYLE:\n" + prefLines.join("\n"));
    }
  }

  if (ctx.meta) {
    sections.push(`RESEARCH STATS: ${ctx.meta.totalSessions} sessions, last active: ${ctx.meta.lastActive}` +
      (ctx.meta.topEntities?.length ? `, most researched: ${ctx.meta.topEntities.join(", ")}` : ""));
  }

  return "\n\nRESEARCH BRAIN (relevant context from past sessions):\n" + sections.join("\n\n");
}
