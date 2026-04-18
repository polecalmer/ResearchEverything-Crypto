import { db } from "./db";
import { brainFacts, brainEntities } from "@shared/schema";
import { embed, embedBatch } from "./data-source-brain/embeddings";
import { sql } from "drizzle-orm";
import type { BrainUpdate, BrainEntity } from "./session-research-agent";

const BATCH_SIZE = 32;

export async function syncBrainFacts(
  userId: string,
  facts: Array<{ id: string; topic: string; fact: string; entities: string[]; source: string; date?: string; confidence?: string }>,
): Promise<number> {
  if (facts.length === 0) return 0;

  const texts = facts.map(f => `${f.topic}: ${f.fact}`);
  let synced = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchFacts = facts.slice(i, i + BATCH_SIZE);
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(batch, "document");
    } catch (err: any) {
      console.error(`[BrainSync] Failed to embed fact batch ${i}-${i + batch.length}: ${err.message}`);
      continue;
    }

    for (let j = 0; j < batchFacts.length; j++) {
      const f = batchFacts[j];
      const vec = embeddings[j];
      const entitiesArr = Array.isArray(f.entities) ? f.entities : (f.entities ? [String(f.entities)] : []);
      const pgArray = `{${entitiesArr.map((e: string) => `"${String(e).replace(/"/g, '\\"')}"`).join(",")}}`;
      try {
        await db.execute(sql`
          INSERT INTO brain_facts (user_id, fact_id, topic, fact, entities, source, date, confidence, embedding, updated_at)
          VALUES (${userId}, ${f.id}, ${f.topic}, ${f.fact}, ${pgArray}::text[], ${f.source}, ${f.date || null}, ${f.confidence || "verified"}, ${`[${vec.join(",")}]`}::vector, NOW())
          ON CONFLICT (user_id, fact_id)
          DO UPDATE SET
            topic = EXCLUDED.topic,
            fact = EXCLUDED.fact,
            entities = EXCLUDED.entities,
            source = EXCLUDED.source,
            date = EXCLUDED.date,
            confidence = EXCLUDED.confidence,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
        `);
        synced++;
      } catch (err: any) {
        console.error(`[BrainSync] Failed to upsert fact ${f.id}: ${err.message}`);
      }
    }
  }

  return synced;
}

export async function syncBrainEntities(
  userId: string,
  entities: Record<string, BrainEntity>,
): Promise<number> {
  const entries = Object.entries(entities);
  if (entries.length === 0) return 0;

  const texts = entries.map(([name, e]) =>
    `${name} (${e.type}${e.category ? `, ${e.category}` : ""}): ${e.summary || name}`
  );
  let synced = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEntries = entries.slice(i, i + BATCH_SIZE);
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(batch, "document");
    } catch (err: any) {
      console.error(`[BrainSync] Failed to embed entity batch ${i}-${i + batch.length}: ${err.message}`);
      continue;
    }

    for (let j = 0; j < batchEntries.length; j++) {
      const [name, e] = batchEntries[j];
      const vec = embeddings[j];
      try {
        await db.execute(sql`
          INSERT INTO brain_entities (user_id, entity_name, type, category, summary, embedding, updated_at)
          VALUES (${userId}, ${name}, ${e.type}, ${e.category || null}, ${e.summary || null}, ${`[${vec.join(",")}]`}::vector, NOW())
          ON CONFLICT (user_id, entity_name)
          DO UPDATE SET
            type = EXCLUDED.type,
            category = EXCLUDED.category,
            summary = EXCLUDED.summary,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
        `);
        synced++;
      } catch (err: any) {
        console.error(`[BrainSync] Failed to upsert entity ${name}: ${err.message}`);
      }
    }
  }

  return synced;
}

export async function backfillBrainEmbeddings(userId: string, brain: {
  entities: Record<string, any>;
  knowledge: any[];
}): Promise<{ facts: number; entities: number }> {
  const facts = (brain.knowledge || []).map((f: any) => ({
    id: f.id || `bf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    topic: f.topic || "",
    fact: f.fact || "",
    entities: f.entities || [],
    source: f.source || "",
    date: f.date,
    confidence: f.confidence || "verified",
  }));

  const factCount = await syncBrainFacts(userId, facts);
  const entityCount = await syncBrainEntities(userId, brain.entities || {});

  console.log(`[BrainSync] Backfill for user ${userId}: ${factCount} facts, ${entityCount} entities`);
  return { facts: factCount, entities: entityCount };
}
