import { inArray } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { founders as foundersTable, STAGE_LABELS } from "@shared/schema";
import type { Company, Founder } from "@shared/schema";

interface BrainEntity {
  type: "protocol" | "token" | "chain" | "person" | "fund" | "concept";
  category?: string;
  chains?: string[];
  competitors?: string[];
  relatedEntities?: string[];
  tags?: string[];
  summary?: string;
  lastResearched: string;
  researchCount: number;
}

interface BrainRelationship {
  from: string;
  to: string;
  type: string;
  context?: string;
  date: string;
}

interface BrainFact {
  id: string;
  topic: string;
  fact: string;
  entities: string[];
  source: string;
  date: string;
  confidence: "verified" | "estimated" | "stale";
}

interface PipelineBrainData {
  entities: Record<string, BrainEntity>;
  relationships: BrainRelationship[];
  knowledge: BrainFact[];
  contradictions: never[];
  preferences: Record<string, never>;
  meta: {
    totalSessions: number;
    lastActive: string | null;
    topEntities: string[];
  };
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return new Date().toISOString().slice(0, 10);
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function uniqKey(name: string, taken: Set<string>): string {
  let key = name.trim();
  if (!taken.has(key)) {
    taken.add(key);
    return key;
  }
  let i = 2;
  while (taken.has(`${key} (${i})`)) i++;
  const final = `${key} (${i})`;
  taken.add(final);
  return final;
}

export async function derivePipelineBrain(userId: string): Promise<PipelineBrainData> {
  const companies: Company[] = await storage.getCompanies(userId);

  const companyIds = companies.map(c => c.id);
  const allFounders: Founder[] = companyIds.length
    ? await db.select().from(foundersTable).where(inArray(foundersTable.companyId, companyIds))
    : [];
  const foundersByCompany: Record<string, Founder[]> = {};
  for (const f of allFounders) (foundersByCompany[f.companyId] ||= []).push(f);

  const entities: Record<string, BrainEntity> = {};
  const relationships: BrainRelationship[] = [];
  const knowledge: BrainFact[] = [];
  const taken = new Set<string>();

  const sectorBuckets: Record<string, string[]> = {};
  const chainBuckets: Record<string, string[]> = {};
  const stageBuckets: Record<string, string[]> = {};

  let lastActive: string | null = null;
  let factCounter = 0;

  const companyKeys: Record<string, string> = {};
  for (const c of companies) {
    const baseName = c.tokenTicker && c.hasLiquidToken ? `${c.name} ($${c.tokenTicker})` : c.name;
    const key = uniqKey(baseName, taken);
    companyKeys[c.id] = key;

    const founders: Founder[] = foundersByCompany[c.id] || [];

    const tags = (c.tags || []).slice(0, 8);
    const stageLabel = STAGE_LABELS[c.pipelineStage as keyof typeof STAGE_LABELS] || c.pipelineStage;
    const createdISO = fmtDate(c.createdAt);

    entities[key] = {
      type: c.hasLiquidToken ? "token" : "protocol",
      category: c.sector || undefined,
      chains: c.tokenChain ? [c.tokenChain] : undefined,
      tags: [...tags, stageLabel].filter(Boolean) as string[],
      summary: c.oneLiner || c.description?.slice(0, 200) || undefined,
      lastResearched: createdISO,
      researchCount: 1 + Math.min(founders.length, 4) + (c.excitementScore && c.excitementScore >= 80 ? 2 : 0),
    };

    if (!lastActive || createdISO > lastActive) lastActive = createdISO;

    if (c.sector) (sectorBuckets[c.sector] ||= []).push(key);
    if (c.tokenChain && c.hasLiquidToken) (chainBuckets[c.tokenChain] ||= []).push(key);
    (stageBuckets[stageLabel] ||= []).push(key);

    knowledge.push({
      id: `f${++factCounter}`,
      topic: "One-liner",
      fact: c.oneLiner || "—",
      entities: [key],
      source: "pipeline",
      date: createdISO,
      confidence: "verified",
    });

    knowledge.push({
      id: `f${++factCounter}`,
      topic: "Pipeline Stage",
      fact: stageLabel,
      entities: [key],
      source: "pipeline",
      date: createdISO,
      confidence: "verified",
    });

    if (c.excitementScore != null) {
      knowledge.push({
        id: `f${++factCounter}`,
        topic: "Conviction",
        fact: `${c.excitementScore}/100${c.excitementReason ? ` — ${c.excitementReason}` : ""}`,
        entities: [key],
        source: "pipeline",
        date: createdISO,
        confidence: c.excitementScore >= 70 ? "verified" : "estimated",
      });
    }

    if (c.businessModel) {
      knowledge.push({
        id: `f${++factCounter}`,
        topic: "Business Model",
        fact: c.businessModel,
        entities: [key],
        source: "pipeline",
        date: createdISO,
        confidence: "verified",
      });
    }

    if (c.fundingHistory) {
      knowledge.push({
        id: `f${++factCounter}`,
        topic: "Funding",
        fact: c.fundingHistory,
        entities: [key],
        source: "pipeline",
        date: createdISO,
        confidence: "verified",
      });
    }

    if (c.hasLiquidToken && c.tokenTicker) {
      knowledge.push({
        id: `f${++factCounter}`,
        topic: "Token",
        fact: `$${c.tokenTicker}${c.tokenChain ? ` on ${c.tokenChain}` : ""}${c.tokenTier ? ` · ${c.tokenTier}` : ""}`,
        entities: [key],
        source: "pipeline",
        date: createdISO,
        confidence: "verified",
      });
    }

    for (const f of founders) {
      const fName = f.name.trim();
      if (!fName) continue;
      const existing = entities[fName];
      let fKey: string;
      if (existing && existing.type === "person") {
        fKey = fName;
        existing.researchCount += 1;
      } else {
        fKey = uniqKey(existing ? `${fName} (founder)` : fName, taken);
        entities[fKey] = {
          type: "person",
          summary: f.role ? `${f.role}${f.bio ? ` — ${f.bio.slice(0, 140)}` : ""}` : f.bio?.slice(0, 180) || undefined,
          tags: f.priorCompanies ? [`prior: ${f.priorCompanies.split(",")[0].trim()}`] : undefined,
          lastResearched: createdISO,
          researchCount: 1,
        };
      }
      relationships.push({
        from: fKey,
        to: key,
        type: "founded",
        context: f.role || undefined,
        date: createdISO,
      });
    }
  }

  for (const [sector, members] of Object.entries(sectorBuckets)) {
    const sKey = uniqKey(entities[sector] ? `${sector} (sector)` : sector, taken);
    entities[sKey] = {
      type: "concept",
      category: "sector",
      summary: `${members.length} ${members.length === 1 ? "company" : "companies"} in this sector`,
      relatedEntities: members,
      lastResearched: lastActive || fmtDate(new Date()),
      researchCount: Math.min(members.length, 8),
    };
    taken.add(sKey);
    for (const m of members) {
      relationships.push({ from: m, to: sKey, type: "in_sector", date: lastActive || fmtDate(new Date()) });
    }
    if (members.length > 1) {
      const sortedMembers = [...members];
      for (let i = 0; i < sortedMembers.length; i++) {
        const e = entities[sortedMembers[i]];
        if (e) e.competitors = sortedMembers.filter((_, j) => j !== i).slice(0, 5);
      }
      for (let i = 0; i < sortedMembers.length - 1; i++) {
        relationships.push({
          from: sortedMembers[i],
          to: sortedMembers[i + 1],
          type: "competes_with",
          context: sector,
          date: lastActive || fmtDate(new Date()),
        });
      }
    }
  }

  for (const [chain, members] of Object.entries(chainBuckets)) {
    const cKey = uniqKey(entities[chain] ? `${chain} (chain)` : chain, taken);
    entities[cKey] = {
      type: "chain",
      summary: `${members.length} tokenized ${members.length === 1 ? "company" : "companies"} on ${chain}`,
      relatedEntities: members,
      lastResearched: lastActive || fmtDate(new Date()),
      researchCount: Math.min(members.length, 8),
    };
    taken.add(cKey);
    for (const m of members) {
      relationships.push({ from: m, to: cKey, type: "built_on", date: lastActive || fmtDate(new Date()) });
    }
  }

  for (const [stage, members] of Object.entries(stageBuckets)) {
    if (members.length < 2) continue;
    const sKey = uniqKey(`Stage: ${stage}`, taken);
    entities[sKey] = {
      type: "concept",
      category: "stage",
      summary: `${members.length} ${members.length === 1 ? "deal" : "deals"} currently ${stage.toLowerCase()}`,
      relatedEntities: members,
      lastResearched: lastActive || fmtDate(new Date()),
      researchCount: Math.min(members.length, 8),
    };
    for (const m of members) {
      relationships.push({ from: m, to: sKey, type: "in_stage", date: lastActive || fmtDate(new Date()) });
    }
  }

  const topEntities = Object.entries(entities)
    .sort((a, b) => b[1].researchCount - a[1].researchCount)
    .slice(0, 10)
    .map(([k]) => k);

  return {
    entities,
    relationships,
    knowledge,
    contradictions: [],
    preferences: {},
    meta: {
      totalSessions: companies.length,
      lastActive,
      topEntities,
    },
  };
}
