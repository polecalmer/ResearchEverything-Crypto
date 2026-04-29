/**
 * Output requirements: brain-stored rules that say "for prompt-shape X
 * (e.g. financial_statement, valuation_dashboard), the agent MUST
 * include these specific charts/tables/sections in the output."
 *
 * Surfaced in the system prompt when the matching prompt-shape detector
 * fires (FS-router, etc.). Lets the agent learn output norms without
 * code changes — add a row, restart, the next FS prompt sees the new
 * requirement.
 *
 * Pattern mirrors canonical-aggregations: small in-memory cache, simple
 * prompt-block builder, additive-only at runtime.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface OutputRequirementRow {
  id: string;
  promptShape: string;
  entity: string;
  title: string;
  requirement: string;
  ordering: number;
  source: string;
}

let _cache: { at: number; rows: OutputRequirementRow[] } | null = null;
const CACHE_TTL_MS = 60_000;

async function loadAllActive(): Promise<OutputRequirementRow[]> {
  try {
    const rows = await db.execute(sql`
      SELECT id, prompt_shape, entity, title, requirement, ordering, source
      FROM output_requirements
      WHERE is_active = true
      ORDER BY prompt_shape, entity, ordering
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw.map((r) => ({
      id: r.id,
      promptShape: String(r.prompt_shape),
      entity: String(r.entity),
      title: String(r.title),
      requirement: String(r.requirement),
      ordering: Number(r.ordering ?? 100),
      source: String(r.source ?? "seed"),
    }));
  } catch (err: any) {
    console.warn(`[OutputRequirements] load failed: ${err.message}`);
    return [];
  }
}

export async function getRequirements(): Promise<OutputRequirementRow[]> {
  const now = Date.now();
  if (_cache && now - _cache.at < CACHE_TTL_MS) return _cache.rows;
  const rows = await loadAllActive();
  _cache = { at: now, rows };
  return rows;
}

/** Filter to rules that apply to (promptShape, entities). entity='*' is
 *  always included; specific-entity rules only apply when the entity
 *  is in scope. */
export function pickRelevant(
  all: OutputRequirementRow[],
  promptShape: string,
  resolvedEntities: string[],
): OutputRequirementRow[] {
  const ents = new Set(resolvedEntities.map((e) => e.toLowerCase()));
  return all.filter((r) => {
    if (r.promptShape !== promptShape) return false;
    if (r.entity === "*") return true;
    return ents.has(r.entity.toLowerCase());
  });
}

/** Build the system-prompt block for a given prompt shape + entity set. */
export async function buildOutputRequirementsBlock(
  promptShape: string,
  resolvedEntities: string[],
): Promise<string> {
  const all = await getRequirements();
  const relevant = pickRelevant(all, promptShape, resolvedEntities);
  if (relevant.length === 0) return "";
  const lines: string[] = [];
  lines.push(`REQUIRED OUTPUT (${promptShape.replace(/_/g, " ")}):`);
  lines.push("");
  lines.push("The following sections / charts / tables MUST appear in your response. These are not suggestions; outputs missing required sections are incomplete by definition.");
  lines.push("");
  for (const r of relevant) {
    lines.push(`• ${r.title}`);
    // Indent the requirement body 4 spaces for readability.
    for (const line of r.requirement.split("\n")) {
      lines.push(`    ${line}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
