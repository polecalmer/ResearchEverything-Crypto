/**
 * Analyst perspective extraction — ports hermes' 4 extractor scripts
 * (questions / frameworks / signals / style) into a single TS pipeline.
 *
 * For each analyst with HRC posts:
 *   1. Concatenate posts (longest-first, capped at MAX_CORPUS_CHARS)
 *   2. Call Anthropic with the layer-specific extraction prompt
 *   3. Parse JSON → embed (where the table has an embedding column)
 *   4. Upsert into the right table
 *
 * Run:
 *   npx tsx script/extract-analyst-perspectives.ts                    # all 4 layers
 *   npx tsx script/extract-analyst-perspectives.ts --layer questions  # one layer
 *   npx tsx script/extract-analyst-perspectives.ts --analyst chameleon_jeff --layer all
 *   npx tsx script/extract-analyst-perspectives.ts --dry-run          # print what would be inserted, no DB writes
 *
 * Cost: ~24 analysts × 4 layers × Opus 4.7 ≈ $5-20 single run.
 * Re-runs are safe — unique constraints + ON CONFLICT clauses upsert.
 *
 * Depends on:
 *   - analyst_raw_posts populated (run `script/ingest-hermes-corpus.ts` first)
 *   - DATABASE_URL, ANTHROPIC_API_KEY (or OPENROUTER_API_KEY), VOYAGE_API_KEY in .env
 */

import "dotenv/config";
import { pool } from "../server/db";
import { embedBatch } from "../server/data-source-brain/embeddings";
import { callAnthropicViaOpenRouter } from "../server/openrouter-client";
import { MODELS } from "../server/constants";

const MAX_CORPUS_CHARS = 80_000;
const MAX_EXTRACT_TOKENS = 3500;
const EXTRACT_TIMEOUT_MS = 180_000;
type Layer = "questions" | "frameworks" | "signals" | "style";
const ALL_LAYERS: Layer[] = ["questions", "frameworks", "signals", "style"];

interface RosterEntry { slug: string; displayName: string; nPosts: number; words: number }
interface Post { post_id: string; title: string | null; category: string | null; content_md: string | null; word_count: number | null; published_at: string | null }

async function loadRoster(analystFilter?: string): Promise<RosterEntry[]> {
  const client = await pool.connect();
  try {
    const params: any[] = [];
    let where = "";
    if (analystFilter) {
      params.push(analystFilter);
      where = `WHERE a.slug = $1`;
    }
    const r = await client.query(
      `SELECT a.slug,
              a.display_name      AS "displayName",
              count(p.id)::int    AS "nPosts",
              COALESCE(sum(p.word_count), 0)::int AS words
         FROM analysts a
         LEFT JOIN analyst_raw_posts p
                ON p.analyst_slug = a.slug AND p.platform = 'hrc'
         ${where}
         GROUP BY a.slug, a.display_name
         HAVING count(p.id) > 0
         ORDER BY words DESC NULLS LAST`,
      params,
    );
    return r.rows;
  } finally {
    client.release();
  }
}

async function fetchAnalystCorpus(slug: string): Promise<Post[]> {
  const client = await pool.connect();
  try {
    const r = await client.query<Post>(
      `SELECT post_id, title, category, content_md, word_count, published_at
         FROM analyst_raw_posts
        WHERE analyst_slug = $1 AND platform = 'hrc'
        ORDER BY published_at DESC NULLS LAST`,
      [slug],
    );
    return r.rows;
  } finally {
    client.release();
  }
}

function buildCorpusText(posts: Post[]): { text: string; usedPostIds: string[] } {
  const sorted = [...posts].sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0));
  const parts: string[] = [];
  const usedPostIds: string[] = [];
  let used = 0;
  for (const p of sorted) {
    const header = `\n\n=== POST: ${p.title ?? "(untitled)"} (${p.published_at ?? "?"}) [slug=${p.post_id}] ===\n\n`;
    const body = p.content_md ?? "";
    const chunk = header + body;
    if (used + chunk.length > MAX_CORPUS_CHARS) {
      const remaining = MAX_CORPUS_CHARS - used;
      if (remaining > 1000) {
        parts.push(chunk.slice(0, remaining) + "\n\n[truncated]");
        usedPostIds.push(p.post_id);
      }
      break;
    }
    parts.push(chunk);
    used += chunk.length;
    usedPostIds.push(p.post_id);
  }
  return { text: parts.join(""), usedPostIds };
}

// ── prompts ──────────────────────────────────────────────────────────────
// Verbatim from hermes/dune-brain/extract_*.py except for adapting "JSON
// object only" → "JSON object only, inside <json>...</json>" so the
// Anthropic API doesn't need response_format (which is OpenAI-only).
const SUFFIX_JSON_ENVELOPE =
  "\n\nReturn ONLY the JSON object, wrapped in <json>...</json> tags. No prose before or after the tags, no markdown fences inside.";

function questionsPrompt(slug: string, displayName: string, corpus: string): string {
  return `You are reverse-engineering the investigation patterns of a crypto research analyst by reading their published work.

Analyst: ${displayName} (slug: ${slug})

Below is their corpus (HRC posts, concatenated). Your job: surface the GENERALIZABLE QUESTIONS this analyst asks when investigating a topic — patterns that would transfer to topics they haven't written about yet.

CORPUS:
${corpus}

Output a JSON object with key "questions" — a list of 8-15 questions. Each question object has:

- question_text: the canonical generalized question. NOT topic-specific. NOT "What is HIP-4?" (too narrow). YES "What's the new design space this primitive unlocks vs. what came before?" (generalizable).
- question_topic: domain tag, lowercase snake_case. e.g. "market_microstructure", "tokenomics", "lending", "perps", "stablecoin_design", "valuation", "venue_competition", "mechanism_design", "regulatory_risk".
- question_type: one of: "investigation_starter" | "risk_check" | "thesis_validation" | "mechanism_check" | "unit_economics" | "comparative" | "regime_check".
- evidence_quote: a short verbatim snippet (under 200 chars) from the corpus showing this question being asked or implicitly investigated.

Rules:
- Generalize aggressively. Topic-specific questions are useless — we want the underlying pattern.
- Avoid duplicates. If two questions are near-restatements, merge them.
- Avoid trivia. We want analytical patterns, not factual lookups.
- If the analyst's corpus is sparse on a question type, do not invent. Only output what's actually there.${SUFFIX_JSON_ENVELOPE}`;
}

function frameworksPrompt(slug: string, displayName: string, corpus: string): string {
  return `You are extracting NAMED MENTAL MODELS / DECISION RULES that this crypto research analyst applies when interpreting evidence and forming views.

Analyst: ${displayName} (slug: ${slug})

CORPUS:
${corpus}

A FRAMEWORK is different from a question or a fact. It is a reusable interpretive lens — a decision rule, a structural model, an analogy, or a measurement convention — that the analyst applies repeatedly across topics.

Output a JSON object with key "frameworks" — a list of 5-12 frameworks. Each:

- name: human-readable name, 4-10 words. Should be evocative and specific.
- category: one of "mechanism" | "valuation" | "risk" | "measurement" | "thesis" | "design" | "comparative"
- description: 1-3 sentences on what the framework asserts and when it applies
- decision_rule: optional if-then formulation
- scope: when/where this applies
- evidence_quote: short verbatim snippet (under 200 chars) showing the framework in use

Quality bar:
- Only output frameworks the analyst actually demonstrates using. Don't manufacture.
- Frameworks should generalize across topics.
- Aim for distinctiveness — what makes THIS analyst think differently?${SUFFIX_JSON_ENVELOPE}`;
}

function signalsPrompt(slug: string, displayName: string, corpus: string): string {
  return `You are extracting the EMPIRICAL INPUTS / SIGNALS this crypto research analyst defaults to when investigating a topic.

Analyst: ${displayName} (slug: ${slug})

CORPUS:
${corpus}

A SIGNAL is a specific data point, event, dashboard, metric, or rule-of-thumb the analyst reaches for. They are the "look here first" inputs that make their analysis grounded rather than speculative.

Examples of what counts:
- On-chain events: "aave_v3_multichain.pool_evt_mintedtotreasury", "uniswap_v3.UniswapV3Pool_evt_Swap"
- Derived metrics: "funding rate skew", "vault PnL", "perp basis vs spot premium"
- Dashboards / data sources: "Liquid Terminal", "DeFiLlama fees endpoint"
- Spell tables: "dex.trades", "prices.usd", "stablecoins_evm.balances"
- Rules of thumb: "If vault APR > 15% sustained, MM is over-earning"

What does NOT count:
- Generic statements ("look at the data") — too vague
- A specific finding ("Aave made $103M") — that's a result, not a signal source
- Topic claims without a method — no data input named

Output a JSON object with key "signals" — a list of 6-15 signals. Each:

- signal_name: short descriptive name
- signal_kind: one of "on_chain_event" | "derived_metric" | "dashboard" | "data_source" | "spell_table" | "rule_of_thumb"
- source_ref: specific reference — table name, dashboard URL, dataset name, or formula
- use_case: when does the analyst reach for this signal?
- evidence_quote: short verbatim snippet (under 200 chars) showing the signal in use${SUFFIX_JSON_ENVELOPE}`;
}

function stylePrompt(slug: string, displayName: string, corpus: string): string {
  return `You are extracting STYLE / OUTPUT-STRUCTURE PATTERNS used by this crypto research analyst.

Analyst: ${displayName} (slug: ${slug})

CORPUS:
${corpus}

A STYLE PATTERN is a reusable structural convention in how the analyst presents work — distinct from WHAT they argue or WHERE they look.

Types of patterns that count:
- Openings: do they lead with a falsifiable claim, a context paragraph, a TL;DR, a chart?
- Methodology disclosure
- Caveat patterns
- Transitions
- Closing patterns
- Format / typographic conventions

Output a JSON object with key "patterns" — a list of 4-10 patterns. Each:

- pattern_name: short descriptive, e.g. "Methodology Note disclosure block"
- pattern_kind: one of "opening" | "closing" | "transition" | "caveat" | "structure" | "format"
- description: 1-3 sentences on the pattern and when/how it's used
- example_quote: short verbatim snippet (under 200 chars)

Quality bar:
- The pattern must be observable across multiple posts when possible.
- Distinctiveness matters: surface patterns that distinguish THIS analyst.${SUFFIX_JSON_ENVELOPE}`;
}

const PROMPT_FACTORIES: Record<Layer, (slug: string, name: string, corpus: string) => string> = {
  questions: questionsPrompt,
  frameworks: frameworksPrompt,
  signals: signalsPrompt,
  style: stylePrompt,
};

const PAYLOAD_KEY: Record<Layer, string> = {
  questions: "questions",
  frameworks: "frameworks",
  signals: "signals",
  style: "patterns",
};

// Parse <json>...</json> envelope, falling back to "first {...} block" if the
// model forgot the wrapper. Robust to leading/trailing prose.
function parseJsonEnvelope(content: string): any {
  const m = content.match(/<json>([\s\S]*?)<\/json>/i);
  const body = m ? m[1] : content;
  // Strip markdown fences if present
  const cleaned = body.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // Find first { and last } — robust to noise
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`no JSON object found in response (${content.length} chars)`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callExtractor(layer: Layer, slug: string, displayName: string, corpus: string): Promise<any[]> {
  const prompt = PROMPT_FACTORIES[layer](slug, displayName, corpus);
  const key = PAYLOAD_KEY[layer];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await callAnthropicViaOpenRouter({
        model: MODELS.OPUS,
        max_tokens: MAX_EXTRACT_TOKENS,
        system: "",
        messages: [{ role: "user", content: prompt }],
      });
      const text = (resp.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (!text) {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000)); continue; }
        throw new Error("empty response");
      }
      const obj = parseJsonEnvelope(text);
      const items = obj?.[key] ?? obj?.results ?? [];
      if (!Array.isArray(items)) throw new Error(`expected array, got ${typeof items}`);
      return items;
    } catch (err: any) {
      if (attempt < 2) {
        console.warn(`    retry (${err.message})`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
  return [];
}

function vecLiteral(v: number[]): string {
  // pgvector text literal: '[0.1,0.2,...]'
  return "[" + v.join(",") + "]";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "framework";
}

// ── inserters ────────────────────────────────────────────────────────────

async function insertQuestions(
  analystSlug: string,
  items: any[],
  sourcePostIds: string[],
  dryRun: boolean,
) {
  if (items.length === 0) return 0;
  const embedTexts = items.map(
    (q) => `[${q.question_topic ?? ""}] [${q.question_type ?? ""}] ${q.question_text ?? ""}`,
  );
  const embeddings = await embedBatch(embedTexts, "document");
  if (dryRun) {
    console.log(`    (dry-run) would insert ${items.length} questions`);
    return items.length;
  }
  const client = await pool.connect();
  try {
    for (let i = 0; i < items.length; i++) {
      const q = items[i];
      await client.query(
        `INSERT INTO analyst_questions
           (analyst_slug, question_text, question_topic, question_type, evidence_quote, source_post_ids, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [
          analystSlug,
          String(q.question_text ?? "").slice(0, 1000),
          String(q.question_topic ?? "").slice(0, 200),
          String(q.question_type ?? "").slice(0, 100),
          String(q.evidence_quote ?? "").slice(0, 500),
          sourcePostIds,
          vecLiteral(embeddings[i]),
        ],
      );
    }
    return items.length;
  } finally {
    client.release();
  }
}

async function insertFrameworks(
  analystSlug: string,
  items: any[],
  sourcePostIds: string[],
  dryRun: boolean,
) {
  if (items.length === 0) return 0;
  // Sessions' existing `analyst_frameworks` table has a different shape than
  // hermes' (jsonb versions array, not per-version rows). Adapt:
  //   - framework_slug = slugify(name)
  //   - versions = JSONB array carrying decision_rule + scope + evidence_quote
  //   - version_count = versions.length (initially 1)
  //   - column is `analyst` not `analyst_slug` (legacy naming)
  const embedTexts = items.map((f) => `${f.name ?? ""}\n\n${f.description ?? ""}`);
  const embeddings = await embedBatch(embedTexts, "document");
  if (dryRun) {
    console.log(`    (dry-run) would upsert ${items.length} frameworks`);
    return items.length;
  }
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
        source_post_ids: sourcePostIds,
        extracted_at: new Date().toISOString(),
      }];
      await client.query(
        `INSERT INTO analyst_frameworks
           (analyst, framework_slug, name, description, category, versions, version_count, first_seen_date, last_seen_date, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::vector)
         ON CONFLICT (analyst, framework_slug) DO UPDATE SET
           description    = EXCLUDED.description,
           category       = EXCLUDED.category,
           versions       = analyst_frameworks.versions || EXCLUDED.versions,
           version_count  = analyst_frameworks.version_count + 1,
           last_seen_date = EXCLUDED.last_seen_date,
           embedding      = EXCLUDED.embedding`,
        [
          analystSlug,
          fwSlug,
          name.slice(0, 200),
          String(f.description ?? "").slice(0, 2000),
          String(f.category ?? "").slice(0, 50) || null,
          JSON.stringify(versions),
          1,
          new Date().toISOString().slice(0, 10),
          new Date().toISOString().slice(0, 10),
          vecLiteral(embeddings[i]),
        ],
      );
      n++;
    }
    return n;
  } finally {
    client.release();
  }
}

async function insertSignals(
  analystSlug: string,
  items: any[],
  sourcePostIds: string[],
  dryRun: boolean,
) {
  if (items.length === 0) return 0;
  // Dedupe within analyst by lowercase signal_name.
  const seen = new Set<string>();
  const deduped = items.filter((s) => {
    const n = String(s.signal_name ?? "").trim().toLowerCase();
    if (!n) return false;
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
  if (deduped.length === 0) return 0;

  const embedTexts = deduped.map(
    (s) => `[${s.signal_kind ?? ""}] ${s.signal_name ?? ""} | ${s.use_case ?? ""}`,
  );
  const embeddings = await embedBatch(embedTexts, "document");
  if (dryRun) {
    console.log(`    (dry-run) would upsert ${deduped.length} signals`);
    return deduped.length;
  }
  const client = await pool.connect();
  try {
    for (let i = 0; i < deduped.length; i++) {
      const s = deduped[i];
      await client.query(
        `INSERT INTO analyst_signals
           (analyst_slug, signal_name, signal_kind, source_ref, use_case, source_post_ids, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
         ON CONFLICT (analyst_slug, signal_name) DO UPDATE SET
           signal_kind = EXCLUDED.signal_kind,
           source_ref  = EXCLUDED.source_ref,
           use_case    = EXCLUDED.use_case,
           embedding   = EXCLUDED.embedding,
           updated_at  = now()`,
        [
          analystSlug,
          String(s.signal_name ?? "").slice(0, 300),
          String(s.signal_kind ?? "").slice(0, 50),
          String(s.source_ref ?? "").slice(0, 500),
          String(s.use_case ?? "").slice(0, 1000),
          sourcePostIds,
          vecLiteral(embeddings[i]),
        ],
      );
    }
    return deduped.length;
  } finally {
    client.release();
  }
}

async function insertStylePatterns(
  analystSlug: string,
  items: any[],
  sourcePostIds: string[],
  dryRun: boolean,
) {
  if (items.length === 0) return 0;
  if (dryRun) {
    console.log(`    (dry-run) would upsert ${items.length} style patterns`);
    return items.length;
  }
  const client = await pool.connect();
  try {
    let n = 0;
    for (const p of items) {
      const name = String(p.pattern_name ?? "").trim();
      if (!name) continue;
      await client.query(
        `INSERT INTO analyst_style_patterns
           (analyst_slug, pattern_name, pattern_kind, description, example_quote, source_post_ids)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (analyst_slug, pattern_name) DO UPDATE SET
           pattern_kind   = EXCLUDED.pattern_kind,
           description    = EXCLUDED.description,
           example_quote  = EXCLUDED.example_quote,
           source_post_ids = EXCLUDED.source_post_ids,
           updated_at      = now()`,
        [
          analystSlug,
          name.slice(0, 300),
          String(p.pattern_kind ?? "").slice(0, 50),
          String(p.description ?? "").slice(0, 2000),
          String(p.example_quote ?? "").slice(0, 500),
          sourcePostIds,
        ],
      );
      n++;
    }
    return n;
  } finally {
    client.release();
  }
}

const INSERTERS: Record<Layer, (slug: string, items: any[], postIds: string[], dryRun: boolean) => Promise<number>> = {
  questions: insertQuestions,
  frameworks: insertFrameworks,
  signals: insertSignals,
  style: insertStylePatterns,
};

// ── main ─────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const layerArg = get("--layer") ?? "all";
  const layers: Layer[] = layerArg === "all" ? ALL_LAYERS : layerArg.split(",").map(s => s.trim() as Layer);
  for (const l of layers) {
    if (!ALL_LAYERS.includes(l)) throw new Error(`Unknown --layer "${l}". Must be one of: ${ALL_LAYERS.join(", ")}, or all`);
  }
  return {
    layers,
    analyst: get("--analyst"),
    dryRun: args.includes("--dry-run"),
    maxAnalysts: get("--max-analysts") ? parseInt(get("--max-analysts")!, 10) : undefined,
  };
}

async function main() {
  const { layers, analyst, dryRun, maxAnalysts } = parseArgs();
  console.log(`[extract] layers=${layers.join(",")} analyst=${analyst ?? "ALL"} dryRun=${dryRun} maxAnalysts=${maxAnalysts ?? "ALL"}`);

  const roster = await loadRoster(analyst);
  const target = maxAnalysts ? roster.slice(0, maxAnalysts) : roster;
  console.log(`[extract] roster: ${target.length} analyst(s)`);
  if (target.length === 0) {
    console.error("[extract] no analysts with HRC posts found. Run script/ingest-hermes-corpus.ts first.");
    await pool.end();
    process.exit(1);
  }

  const totals: Record<Layer, number> = { questions: 0, frameworks: 0, signals: 0, style: 0 };

  for (let i = 0; i < target.length; i++) {
    const a = target[i];
    console.log(`\n[${i + 1}/${target.length}] ${a.slug} — ${a.displayName} (${a.nPosts} posts, ${a.words} words)`);
    const posts = await fetchAnalystCorpus(a.slug);
    const { text: corpus, usedPostIds } = buildCorpusText(posts);
    console.log(`  corpus: ${corpus.length} chars, ${usedPostIds.length} posts used`);
    if (corpus.length < 1000) {
      console.log("  corpus too thin, skipping");
      continue;
    }

    for (const layer of layers) {
      try {
        console.log(`  → ${layer}`);
        const items = await Promise.race([
          callExtractor(layer, a.slug, a.displayName, corpus),
          new Promise<any[]>((_, reject) =>
            setTimeout(() => reject(new Error(`extractor timeout (${EXTRACT_TIMEOUT_MS}ms)`)), EXTRACT_TIMEOUT_MS),
          ),
        ]);
        console.log(`    extracted ${items.length} items`);
        const inserted = await INSERTERS[layer](a.slug, items, usedPostIds, dryRun);
        totals[layer] += inserted;
        console.log(`    ${dryRun ? "would-insert" : "inserted"} ${inserted}`);
      } catch (err: any) {
        console.warn(`    FAILED on ${layer}: ${err.message}`);
      }
    }
  }

  console.log("\n[extract] totals:");
  for (const l of layers) console.log(`  ${l.padEnd(11)} ${totals[l]}`);

  // Snapshot summary from the DB (skip on dry run)
  if (!dryRun) {
    const client = await pool.connect();
    try {
      for (const t of ["analyst_questions", "analyst_frameworks", "analyst_signals", "analyst_style_patterns"]) {
        const r = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
        console.log(`  ${t.padEnd(22)} ${r.rows[0].n} rows total`);
      }
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log("\n[extract] DONE");
}

main().catch((err) => {
  console.error("[extract] failed:", err);
  pool.end().finally(() => process.exit(1));
});
