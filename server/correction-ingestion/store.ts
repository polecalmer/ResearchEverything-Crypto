import { db } from "../db";
import { sql } from "drizzle-orm";
import { embed } from "../data-source-brain/embeddings";
import crypto from "node:crypto";

/** A single structured correction extracted from a turn-pair. The shape
 *  mirrors what extractor.ts emits — keep these in lockstep. */
export type ExtractedCorrection =
  | { type: "slug_alias"; tool: string; arg: string; from: string; to: string; evidence: string; confidence?: number }
  | { type: "entity_rebrand"; old_name: string; new_name: string; token_symbol?: string; evidence: string }
  | { type: "source_behavior"; source: string; endpoint?: string; rule: string; evidence: string }
  | { type: "fact"; entity: string; attribute: string; value: string; evidence: string };

export interface WriteResult {
  argOverridesWritten: number;
  brainFactsWritten: number;
}

/** Write extracted corrections to their respective stores. Returns counts.
 *  Best-effort: per-correction failures are logged but never throw. */
export async function writeCorrections(
  userId: string,
  sourceMsgId: number | null,
  corrections: ExtractedCorrection[],
): Promise<WriteResult> {
  let argOverridesWritten = 0;
  let brainFactsWritten = 0;

  for (const c of corrections) {
    try {
      if (c.type === "slug_alias") {
        await writeArgOverride(userId, sourceMsgId, c);
        argOverridesWritten++;
      } else {
        await writeBrainFact(userId, sourceMsgId, c);
        brainFactsWritten++;
      }
    } catch (err: any) {
      console.warn(
        `[CorrectionStore] Failed to write ${c.type}: ${err.message}`,
      );
    }
  }

  return { argOverridesWritten, brainFactsWritten };
}

async function writeArgOverride(
  userId: string,
  sourceMsgId: number | null,
  c: Extract<ExtractedCorrection, { type: "slug_alias" }>,
): Promise<void> {
  // tool='*' means cross-tool — used when a slug rename applies to every
  // call against a data source (e.g. defillama treats both maple-finance
  // and maple as the same protocol; the agent should always normalize).
  const toolName = c.tool || "*";
  const confidence = Math.max(0, Math.min(100, c.confidence ?? 80));
  await db.execute(sql`
    INSERT INTO tool_arg_overrides
      (user_id, tool_name, arg_name, from_value, to_value, source_msg_id, confidence)
    VALUES
      (${userId}, ${toolName}, ${c.arg}, ${c.from}, ${c.to}, ${sourceMsgId}, ${confidence})
    ON CONFLICT (user_id, tool_name, arg_name, from_value)
    DO UPDATE SET
      to_value = EXCLUDED.to_value,
      source_msg_id = EXCLUDED.source_msg_id,
      confidence = GREATEST(tool_arg_overrides.confidence, EXCLUDED.confidence)
  `);
}

async function writeBrainFact(
  userId: string,
  sourceMsgId: number | null,
  c: Exclude<ExtractedCorrection, { type: "slug_alias" }>,
): Promise<void> {
  const { topic, factText, entities } = renderFact(c);
  const factId =
    "corr_" +
    crypto
      .createHash("sha256")
      .update(`${userId}|${c.type}|${topic}|${factText}`)
      .digest("hex")
      .slice(0, 16);

  const embedVec = await embed(`${topic}\n${factText}`, "document");
  const vec = `[${embedVec.join(",")}]`;
  const entitiesPgArray = `{${entities
    .map((e) => `"${String(e).replace(/"/g, '\\"').toLowerCase()}"`)
    .join(",")}}`;

  await db.execute(sql`
    INSERT INTO brain_facts
      (user_id, fact_id, topic, fact, entities, source, date, confidence, embedding, updated_at)
    VALUES (
      ${userId}, ${factId}, ${topic}, ${factText},
      ${entitiesPgArray}::text[],
      'user-correction',
      ${new Date().toISOString().slice(0, 10)},
      'verified',
      ${vec}::vector, now()
    )
    ON CONFLICT (user_id, fact_id) DO UPDATE SET
      topic = EXCLUDED.topic,
      fact = EXCLUDED.fact,
      entities = EXCLUDED.entities,
      embedding = EXCLUDED.embedding,
      updated_at = now()
  `);
}

function renderFact(
  c: Exclude<ExtractedCorrection, { type: "slug_alias" }>,
): { topic: string; factText: string; entities: string[] } {
  if (c.type === "entity_rebrand") {
    const ents = [c.old_name, c.new_name].filter(Boolean);
    if (c.token_symbol) ents.push(c.token_symbol);
    return {
      topic: `Entity alias: ${c.old_name} / ${c.new_name}`,
      factText: `${c.old_name} is the same entity as ${c.new_name}${c.token_symbol ? ` (token symbol: ${c.token_symbol})` : ""}. ${c.evidence}`,
      entities: ents,
    };
  }
  if (c.type === "source_behavior") {
    return {
      topic: `Source behavior: ${c.source}${c.endpoint ? `/${c.endpoint}` : ""}`,
      factText: `${c.rule} (${c.evidence})`,
      entities: [c.source, c.endpoint].filter(Boolean) as string[],
    };
  }
  // c.type === "fact"
  return {
    topic: `Fact: ${c.entity} ${c.attribute}`,
    factText: `${c.entity} ${c.attribute} = ${c.value}. ${c.evidence}`,
    entities: [c.entity],
  };
}
