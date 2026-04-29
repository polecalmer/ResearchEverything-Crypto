import { db } from "../db";
import { sql } from "drizzle-orm";

const FLAG_ENABLED = () => process.env.CORRECTION_INGESTION_ENABLED === "1";

export interface AppliedRewrite {
  arg: string;
  from: any;
  to: any;
  toolNameMatched: string; // exact tool_name or '*'
  confidence: number;
}

export interface AppliedOverrides {
  args: Record<string, any>;
  rewrites: AppliedRewrite[];
}

/** Look up captured corrections for this (user, tool, arg, value) and
 *  rewrite the args before the network call. Pass-through when the flag
 *  is disabled, when no row matches, or when the input isn't an object.
 *  Best-effort: any DB failure returns the original args unchanged.
 *
 *  Per-tool override beats wildcard ('*'). Higher confidence wins ties. */
export async function applyArgOverrides(
  userId: string,
  toolName: string,
  input: any,
): Promise<AppliedOverrides> {
  const empty: AppliedOverrides = { args: input, rewrites: [] };
  if (!FLAG_ENABLED()) return empty;
  if (!input || typeof input !== "object" || Array.isArray(input)) return empty;
  if (!userId) return empty;

  try {
    const stringArgs: Array<[string, string]> = [];
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === "string" && v.length > 0 && v.length < 200) {
        stringArgs.push([k, v]);
      }
    }
    if (stringArgs.length === 0) return empty;

    const out: Record<string, any> = { ...input };
    const rewrites: AppliedRewrite[] = [];

    // Tool-name candidates: exact, wildcard, and tokens. The extractor
    // sometimes stores a source name (e.g. "defillama") rather than the
    // exact tool name (e.g. "query_defillama_tvl") — both are legitimate
    // ways to express "this rename applies here". Tokens are filtered to
    // length >= 4 to skip `query`/`get` noise. Specificity is resolved
    // later: exact > token > '*'.
    const toolCandidates = new Set<string>([toolName, "*"]);
    for (const tok of toolName.split(/[_-]/)) {
      if (tok.length >= 4) toolCandidates.add(tok);
    }

    // Single batched query — one round-trip regardless of arg count.
    // Build (arg_name, from_value) pair conditions explicitly because
    // drizzle's sql template doesn't auto-convert JS arrays to PG arrays.
    const pairConditions = stringArgs.map(
      ([k, v]) => sql`(arg_name = ${k} AND from_value = ${v})`,
    );
    const toolConditions = Array.from(toolCandidates).map(
      (n) => sql`tool_name = ${n}`,
    );
    const rows = await db.execute(sql`
      SELECT arg_name, from_value, to_value, tool_name, confidence
      FROM tool_arg_overrides
      WHERE user_id = ${userId}
        AND (${sql.join(toolConditions, sql` OR `)})
        AND (${sql.join(pairConditions, sql` OR `)})
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    if (raw.length === 0) return empty;

    // Group by (arg_name, from_value) and pick the strongest match.
    // Specificity: exact tool name > token match > wildcard. Within a
    // tier, higher confidence wins.
    const specificity = (rowToolName: string): number => {
      if (rowToolName === toolName) return 3;
      if (rowToolName === "*") return 1;
      return 2; // token match (e.g. row 'defillama' for tool 'query_defillama_tvl')
    };
    const best = new Map<string, any>();
    for (const r of raw) {
      const key = `${r.arg_name}::${r.from_value}`;
      const cur = best.get(key);
      const rSpec = specificity(r.tool_name);
      const curSpec = cur ? specificity(cur.tool_name) : -1;
      if (
        !cur ||
        rSpec > curSpec ||
        (rSpec === curSpec && Number(r.confidence) > Number(cur.confidence))
      ) {
        best.set(key, r);
      }
    }

    for (const [argName, val] of stringArgs) {
      const r = best.get(`${argName}::${val}`);
      if (!r) continue;
      out[argName] = r.to_value;
      rewrites.push({
        arg: argName,
        from: val,
        to: r.to_value,
        toolNameMatched: r.tool_name,
        confidence: Number(r.confidence),
      });
    }

    if (rewrites.length === 0) return empty;

    // Update hit counters in the background — never block the call.
    void bumpHits(userId, toolName, rewrites).catch((err) => {
      console.warn(`[ArgOverrides] hit-bump failed: ${err?.message}`);
    });

    return { args: out, rewrites };
  } catch (err: any) {
    console.warn(`[ArgOverrides] lookup failed: ${err.message}`);
    return empty;
  }
}

async function bumpHits(
  userId: string,
  toolName: string,
  rewrites: AppliedRewrite[],
): Promise<void> {
  for (const r of rewrites) {
    await db.execute(sql`
      UPDATE tool_arg_overrides
      SET hit_count = hit_count + 1, last_hit_at = now()
      WHERE user_id = ${userId}
        AND tool_name = ${r.toolNameMatched}
        AND arg_name = ${r.arg}
        AND from_value = ${r.from}
    `);
  }
}
