/**
 * Embed + insert pre-extracted analyst perspectives.
 *
 * Companion to extract-analyst-perspectives.ts — that script does the
 * full pipeline (LLM extraction + embed + insert). This one accepts
 * already-extracted JSON (authored in-conversation, no LLM call) and
 * just handles the Voyage embed + DB insert tail.
 *
 * Input shape: JSONL file, one object per line:
 *   {"analyst_slug": "...", "layer": "questions"|"frameworks"|"signals"|"style",
 *    "items": [ ... ], "source_post_ids": ["..."] }
 *
 * Idempotent — uses the same ON CONFLICT clauses as the LLM extractor.
 *
 * Run:
 *   npx tsx script/insert-analyst-perspectives.ts /tmp/extractions.jsonl
 */

import "dotenv/config";
import * as fs from "node:fs";
import { pool } from "../server/db";
import { embedBatch } from "../server/data-source-brain/embeddings";

type Layer = "questions" | "frameworks" | "signals" | "style";

interface Batch {
  analyst_slug: string;
  layer: Layer;
  items: any[];
  source_post_ids: string[];
}

function vecLiteral(v: number[]): string {
  return "[" + v.join(",") + "]";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "framework";
}

async function insertQuestions(slug: string, items: any[], postIds: string[]) {
  if (items.length === 0) return 0;
  const embedTexts = items.map((q) => `[${q.question_topic ?? ""}] [${q.question_type ?? ""}] ${q.question_text ?? ""}`);
  const embeddings = await embedBatch(embedTexts, "document");
  const client = await pool.connect();
  try {
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      await client.query(
        `INSERT INTO analyst_questions
           (analyst_slug, question_text, question_topic, question_type, evidence_quote, source_post_ids, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7::vector)`,
        [
          slug,
          String(q.question_text ?? "").slice(0, 1000),
          String(q.question_topic ?? "").slice(0, 200),
          String(q.question_type ?? "").slice(0, 100),
          String(q.evidence_quote ?? "").slice(0, 500),
          postIds,
          vecLiteral(embeddings[i]),
        ],
      );
    }
    return items.length;
  } finally { client.release(); }
}

async function insertFrameworks(slug: string, items: any[], postIds: string[]) {
  if (items.length === 0) return 0;
  const embedTexts = items.map((f) => `${f.name ?? ""}\n\n${f.description ?? ""}`);
  const embeddings = await embedBatch(embedTexts, "document");
  const client = await pool.connect();
  try {
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const name = String(f.name ?? "").trim();
      if (!name) continue;
      const fwSlug = slugify(name);
      const versions = [{
        decision_rule: f.decision_rule ?? null,
        scope: f.scope ?? null,
        evidence_quote: f.evidence_quote ?? null,
        source_post_ids: postIds,
        extracted_at: new Date().toISOString(),
      }];
      await client.query(
        `INSERT INTO analyst_frameworks
           (analyst, framework_slug, name, description, category, versions, version_count, first_seen_date, last_seen_date, embedding)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::vector)
         ON CONFLICT (analyst, framework_slug) DO UPDATE SET
           description    = EXCLUDED.description,
           category       = EXCLUDED.category,
           versions       = analyst_frameworks.versions || EXCLUDED.versions,
           version_count  = analyst_frameworks.version_count + 1,
           last_seen_date = EXCLUDED.last_seen_date,
           embedding      = EXCLUDED.embedding`,
        [
          slug, fwSlug, name.slice(0, 200),
          String(f.description ?? "").slice(0, 2000),
          String(f.category ?? "").slice(0, 50) || null,
          JSON.stringify(versions), 1,
          new Date().toISOString().slice(0, 10),
          new Date().toISOString().slice(0, 10),
          vecLiteral(embeddings[i]),
        ],
      );
      n++;
    }
    return n;
  } finally { client.release(); }
}

async function insertSignals(slug: string, items: any[], postIds: string[]) {
  if (items.length === 0) return 0;
  const seen = new Set<string>();
  const deduped = items.filter((s) => {
    const n = String(s.signal_name ?? "").trim().toLowerCase();
    if (!n || seen.has(n)) return false;
    seen.add(n); return true;
  });
  if (deduped.length === 0) return 0;
  const embedTexts = deduped.map((s) => `[${s.signal_kind ?? ""}] ${s.signal_name ?? ""} | ${s.use_case ?? ""}`);
  const embeddings = await embedBatch(embedTexts, "document");
  const client = await pool.connect();
  try {
    for (let i = 0; i < deduped.length; i++) {
      const s = deduped[i];
      await client.query(
        `INSERT INTO analyst_signals
           (analyst_slug, signal_name, signal_kind, source_ref, use_case, source_post_ids, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
         ON CONFLICT (analyst_slug, signal_name) DO UPDATE SET
           signal_kind=EXCLUDED.signal_kind, source_ref=EXCLUDED.source_ref,
           use_case=EXCLUDED.use_case, embedding=EXCLUDED.embedding, updated_at=now()`,
        [
          slug,
          String(s.signal_name ?? "").slice(0, 300),
          String(s.signal_kind ?? "").slice(0, 50),
          String(s.source_ref ?? "").slice(0, 500),
          String(s.use_case ?? "").slice(0, 1000),
          postIds,
          vecLiteral(embeddings[i]),
        ],
      );
    }
    return deduped.length;
  } finally { client.release(); }
}

async function insertStyle(slug: string, items: any[], postIds: string[]) {
  if (items.length === 0) return 0;
  const client = await pool.connect();
  try {
    let n = 0;
    for (const p of items) {
      const name = String(p.pattern_name ?? "").trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO analyst_style_patterns
           (analyst_slug, pattern_name, pattern_kind, description, example_quote, source_post_ids)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (analyst_slug, pattern_name) DO UPDATE SET
           pattern_kind=EXCLUDED.pattern_kind, description=EXCLUDED.description,
           example_quote=EXCLUDED.example_quote, source_post_ids=EXCLUDED.source_post_ids, updated_at=now()`,
        [
          slug, name.slice(0, 300),
          String(p.pattern_kind ?? "").slice(0, 50),
          String(p.description ?? "").slice(0, 2000),
          String(p.example_quote ?? "").slice(0, 500),
          postIds,
        ],
      );
      n++;
    }
    return n;
  } finally { client.release(); }
}

const INSERTERS: Record<Layer, (s: string, items: any[], ids: string[]) => Promise<number>> = {
  questions: insertQuestions,
  frameworks: insertFrameworks,
  signals: insertSignals,
  style: insertStyle,
};

async function main() {
  const path = process.argv[2];
  if (!path) { console.error("usage: insert-analyst-perspectives.ts <jsonl-file>"); process.exit(1); }
  const lines = fs.readFileSync(path, "utf8").split("\n").filter(Boolean);
  console.log(`[insert] ${lines.length} batches to apply`);
  const totals: Record<Layer, number> = { questions: 0, frameworks: 0, signals: 0, style: 0 };
  for (const line of lines) {
    const b: Batch = JSON.parse(line);
    try {
      const n = await INSERTERS[b.layer](b.analyst_slug, b.items, b.source_post_ids);
      totals[b.layer] += n;
      console.log(`  ${b.analyst_slug.padEnd(30)} ${b.layer.padEnd(11)} ${n}`);
    } catch (err: any) {
      console.error(`  FAIL ${b.analyst_slug} ${b.layer}: ${err.message}`);
    }
  }
  console.log("\n[insert] totals:");
  for (const l of Object.keys(totals) as Layer[]) console.log(`  ${l.padEnd(11)} ${totals[l]}`);
  await pool.end();
}

main().catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
