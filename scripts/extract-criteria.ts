/**
 * One-shot: decompose every benchmark_quality_cases.rubric into a structured
 * `criteria` array using Opus 4.7. Idempotent — only runs on cases where
 * criteria IS NULL. Re-run safe.
 *
 * Output shape per case (written to the criteria jsonb column):
 *   [{ id: "memo.exec_deck", description: "...", points: 2 }, ...]
 *
 * IDs follow `<dimension_short>.<slug>` (e.g. "memo.exec_deck",
 * "chart.lookback", "compound.quantified_link"). The LLM is instructed to
 * use stable, human-readable slugs that can be referenced as scope keys
 * in any future rule generation.
 */
import "dotenv/config";
import { db } from "../server/db";
import { benchmarkQualityCases } from "@shared/schema";
import { isNull, and, eq } from "drizzle-orm";
import { callAnthropicServer } from "../server/mpp-client";

const EXTRACTION_MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You decompose benchmark rubric text into structured scoring criteria.

INPUT: a rubric (freeform text) and the case dimension.
OUTPUT: a JSON array of criterion objects.

Each criterion object MUST have:
  - id: stable slug, format "<dim_short>.<slug>" where dim_short maps as:
      compound -> "compound"
      chart_form -> "chart"
      memo_quality -> "memo"
      refinement -> "refine"
      verification -> "verify"
      quick -> "quick"
    The slug is a 1-3 word lowercase identifier for the criterion (e.g. "lookback", "exec_deck", "title", "axis_format", "quantified_link", "no_breaker").
  - description: a concise restatement of what the criterion checks (one sentence, no question mark — declarative).
  - points: integer point value the rubric assigns this criterion. If the rubric says "(2 pts)" use 2; "(1 pt)" use 1.

Rules:
- Extract ONLY criteria that have explicit point values in the rubric. Skip "negative markers" sections (those are penalties, not scored criteria).
- Skip the "Return JSON" instruction lines.
- IDs must be unique within a case.
- Output ONLY the JSON array. No prose, no markdown fences.

Example input:
  Score this response on chart-form correctness:
  - Lookback window resolved to ~365 days (NOT 12 days)? (2 pts)
  - chartType is "line" (NOT "bar" or "composed")? (1 pt)
  - Smoothing set to "7dma" or "30dma"? (1 pt)
  Return JSON: score, verdict, critique.

Example output:
  [
    {"id":"chart.lookback","description":"Lookback window resolved to ~365 days, not ~12","points":2},
    {"id":"chart.line_type","description":"chartType is line, not bar or composed","points":1},
    {"id":"chart.smoothing","description":"Smoothing set to 7dma or 30dma given length and volatility","points":1}
  ]`;

function buildUserPrompt(dimension: string, rubric: string): string {
  return `Dimension: ${dimension}\n\nRubric:\n${rubric}\n\nReturn the JSON array of criteria now.`;
}

function parseJsonArray(text: string): any[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateCriteria(arr: any[], dimension: string): { ok: boolean; reason?: string } {
  if (!Array.isArray(arr) || arr.length === 0) return { ok: false, reason: "empty" };
  const ids = new Set<string>();
  const dimMap: Record<string, string> = {
    compound: "compound",
    chart_form: "chart",
    memo_quality: "memo",
    refinement: "refine",
    verification: "verify",
    quick: "quick",
  };
  const expectedPrefix = dimMap[dimension];
  for (const c of arr) {
    if (!c || typeof c !== "object") return { ok: false, reason: "non-object entry" };
    if (typeof c.id !== "string" || !c.id.includes(".")) return { ok: false, reason: `bad id: ${JSON.stringify(c.id)}` };
    if (typeof c.description !== "string" || c.description.length < 5) return { ok: false, reason: `bad description for ${c.id}` };
    if (typeof c.points !== "number" || c.points <= 0) return { ok: false, reason: `bad points for ${c.id}` };
    if (ids.has(c.id)) return { ok: false, reason: `duplicate id: ${c.id}` };
    ids.add(c.id);
    if (expectedPrefix && !c.id.startsWith(expectedPrefix + ".")) {
      // Warn but don't fail — LLM may pick a different prefix that's still meaningful.
      console.warn(`  ⚠ ${c.id} does not start with "${expectedPrefix}." (continuing)`);
    }
  }
  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const force = args.includes("--force"); // re-extract even cases that already have criteria

  const baseQuery = force
    ? db.select().from(benchmarkQualityCases).where(eq(benchmarkQualityCases.isActive, true))
    : db
        .select()
        .from(benchmarkQualityCases)
        .where(and(eq(benchmarkQualityCases.isActive, true), isNull(benchmarkQualityCases.criteria)));

  const cases = await baseQuery;
  console.log(`Found ${cases.length} active case(s) ${force ? "(force re-extract)" : "needing criteria"}.\n`);
  if (cases.length === 0) return;

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const promptHead = c.prompt.slice(0, 60).replace(/\n/g, " ");
    console.log(`[${i + 1}/${cases.length}] [${c.dimension}] ${promptHead}...`);

    try {
      const resp = await callAnthropicServer({
        model: EXTRACTION_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(c.dimension, c.rubric) }],
      });
      const arr = parseJsonArray(resp.text);
      if (!arr) {
        console.error(`  ✗ Could not parse JSON from response. First 200 chars: ${resp.text.slice(0, 200)}`);
        failed++;
        continue;
      }
      const v = validateCriteria(arr, c.dimension);
      if (!v.ok) {
        console.error(`  ✗ Invalid criteria: ${v.reason}`);
        failed++;
        continue;
      }
      console.log(`  ✓ ${arr.length} criteria · ${arr.map((x: any) => x.id).join(", ")}`);
      if (!dryRun) {
        await db
          .update(benchmarkQualityCases)
          .set({ criteria: arr })
          .where(eq(benchmarkQualityCases.id, c.id));
      }
      ok++;
    } catch (err: any) {
      console.error(`  ✗ Error: ${err?.message || err}`);
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} failed=${failed}${dryRun ? " (DRY RUN — no DB writes)" : ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
