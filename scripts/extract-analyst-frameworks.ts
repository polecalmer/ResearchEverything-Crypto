/**
 * Framework Extraction + Temporal Evolution pipeline for analyst corpus.
 *
 * Reads analyst documents from PostgreSQL, sends batches to Claude to extract
 * reusable analytical frameworks, de-duplicates, then writes the evolved
 * frameworks JSON (with version embeddings from Voyage).
 *
 * Two-phase pipeline that replaces the Python extract_frameworks.py +
 * temporal_tracker.py pair, using our existing Anthropic MPP + Voyage
 * embeddings instead of requiring chromadb / sentence-transformers.
 *
 * Usage:
 *   npx tsx scripts/extract-analyst-frameworks.ts [--analyst NAME] [--dry-run]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { ANALYST_NAMES, type AnalystName } from "@shared/schema";
import { embedBatch } from "../server/data-source-brain/embeddings";

const FRAMEWORKS_DIR = join(process.cwd(), "data", "analyst-corpus", "kg", "frameworks_evolved");
const RAW_DIR = join(process.cwd(), "data", "analyst-corpus", "kg", "frameworks_raw");

const args = process.argv.slice(2);
const analystArg = args.includes("--analyst") ? args[args.indexOf("--analyst") + 1] : null;
const dryRun = args.includes("--dry-run");

const BATCH_SIZE = 8;
const MAX_CHARS_PER_DOC = 14_000;
const API_DELAY_MS = 1500;

const SYSTEM_PROMPT = `You are an expert analyst of financial and crypto writing. \
Your job is to identify REUSABLE ANALYTICAL FRAMEWORKS used in the text.

A FRAMEWORK is a reusable mental model or reasoning pattern that could be \
applied to many different situations. Examples:
- "Power Law Distribution" (concentration analysis)
- "Token Unlock Supply Shock" (vesting-schedule price impact)
- "LP Toxicity Analysis" (AMM LP profitability vs. order flow toxicity)
- "Basis Trade" (spot-perp arbitrage)
- "Reflexivity Loop" (price → narrative → capital → price)
- "Fee Switch Analysis" (protocol revenue extraction potential)
- "Cycle Positioning" (macro cycle-based allocation)
- "Second-Order Effects" (deriving downstream consequences)
- "Game Theory of Airdrops" (incentive design analysis)
- "DCF / Discounted Cash Flow" (present-value revenue discounting)
- "Risk-Reward Asymmetry" (convex payoffs)
- "Central Bank Liquidity" (monetary policy driving risk assets)
- "Dollar Milkshake Theory" (USD strength vortex)

NOT frameworks:
- One-off opinions ("ETH will hit 5k")
- Simple observations ("TVL is up")
- Specific entity mentions without a reusable pattern
- Pure news recounts

Rules:
1. Only extract frameworks actually USED in the text (author is applying the \
reasoning, not just name-dropping).
2. Name frameworks in Title Case. Prefer established names when applicable.
3. Each framework application should reference the specific article it came from.
4. Category must be one of: quantitative, qualitative, behavioral, structural, macro.
5. Be strict. Two or three strong frameworks per article is better than ten weak ones.
6. Return ONLY valid JSON matching the requested schema.`;

const EXTRACTION_INSTRUCTION = `Extract the analytical frameworks applied in the \
following articles. Return JSON with this exact schema:

{
  "frameworks": [
    {
      "name": "Title Case Name",
      "description": "1-2 sentence definition of the framework (not the application)",
      "category": "quantitative|qualitative|behavioral|structural|macro",
      "applications": [
        {
          "article_id": "<filename or document_id>",
          "date": "YYYY-MM-DD",
          "context": "1-2 sentence description of how the framework is applied here",
          "entities_involved": ["Entity1", "Entity2"],
          "scope": "narrow|broad",
          "confidence": 0.0-1.0
        }
      ]
    }
  ]
}

If two articles apply the SAME framework, list one framework with two \
applications. Output ONLY the JSON object, no prose.`;

interface DocRow {
  id: string;
  title: string | null;
  date: string | null;
  source: string;
  body: string;
  file_path: string | null;
}

interface FrameworkApp {
  article_id: string;
  date: string;
  context: string;
  entities_involved: string[];
  scope: string;
  confidence: number;
}

interface RawFramework {
  name: string;
  description: string;
  category: string;
  applications: FrameworkApp[];
}

async function loadDocuments(analyst: AnalystName): Promise<DocRow[]> {
  const rows = await db.execute<DocRow>(sql`
    SELECT id, title, date, source, body, file_path
    FROM analyst_documents
    WHERE analyst = ${analyst}
    ORDER BY date ASC NULLS LAST
  `);
  return ((rows as any).rows ?? rows) as DocRow[];
}

function buildUserMessage(batch: DocRow[], analyst: string): string {
  const pieces = [EXTRACTION_INSTRUCTION, "", "=== ARTICLES ==="];
  for (const doc of batch) {
    const body = (doc.body || "").slice(0, MAX_CHARS_PER_DOC);
    const truncated = (doc.body || "").length > MAX_CHARS_PER_DOC ? " [TRUNCATED]" : "";
    pieces.push(
      `\n--- ARTICLE ---\n` +
      `article_id: ${doc.file_path || doc.id}\n` +
      `date: ${doc.date || "unknown"}\n` +
      `source: ${doc.source}\n` +
      `analyst: ${analyst}\n` +
      `title: ${doc.title || "untitled"}\n` +
      `---\n${body}${truncated}\n`
    );
  }
  return pieces.join("\n");
}

function extractJsonObject(s: string): string {
  let cleaned = s.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.includes("\n") ? cleaned.split("\n").slice(1).join("\n") : cleaned;
    if (cleaned.trimEnd().endsWith("```")) {
      cleaned = cleaned.trimEnd().slice(0, -3);
    }
  }
  const start = cleaned.indexOf("{");
  if (start < 0) return cleaned;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return cleaned.slice(start);
}

async function callLLM(batch: DocRow[], analyst: string): Promise<{ frameworks: RawFramework[] }> {
  const { callAnthropicMPP } = await import("../server/ai-clients");
  const userMsg = buildUserMessage(batch, analyst);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await callAnthropicMPP({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      });
      const raw = resp.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      const obj = JSON.parse(extractJsonObject(raw));
      return { frameworks: obj.frameworks || [] };
    } catch (err: any) {
      console.error(`    ! attempt ${attempt} failed: ${err.message?.slice(0, 100)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  return { frameworks: [] };
}

function normalizeName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  return n.split(" ").map(w => {
    if (!w) return "";
    if (w.toUpperCase() === w && w.length <= 5) return w;
    return w[0].toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function mergeFrameworks(allExtractions: { frameworks: RawFramework[] }[]): RawFramework[] {
  const merged = new Map<string, {
    name: string;
    description: string;
    category: string;
    applications: FrameworkApp[];
  }>();

  for (const batch of allExtractions) {
    for (const fw of batch.frameworks || []) {
      const name = normalizeName((fw.name || "").trim());
      if (!name) continue;
      const key = name.toLowerCase();
      let entry = merged.get(key);
      if (!entry) {
        entry = {
          name,
          description: (fw.description || "").trim(),
          category: (fw.category || "qualitative").trim().toLowerCase(),
          applications: [],
        };
        merged.set(key, entry);
      }
      for (const app of fw.applications || []) {
        entry.applications.push({
          article_id: app.article_id || "",
          date: app.date || "",
          context: app.context || "",
          entities_involved: app.entities_involved || [],
          scope: (app.scope || "narrow").toLowerCase(),
          confidence: Number(app.confidence) || 0.7,
        });
      }
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.applications.length - a.applications.length || a.name.localeCompare(b.name));
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "framework";
}

async function buildVersions(fw: RawFramework): Promise<any[]> {
  const apps = [...fw.applications].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
  if (apps.length === 0) return [];

  const texts = apps.map(app => {
    return [fw.name, fw.description, app.context, (app.entities_involved || []).join(" ")].filter(Boolean).join(" | ").slice(0, 1200);
  });

  let embeddings: number[][];
  try {
    embeddings = await embedBatch(texts, "document");
  } catch (err: any) {
    console.error(`    ! embedding failed: ${err.message?.slice(0, 80)}`);
    embeddings = texts.map(() => []);
  }

  function cosine(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    na = Math.sqrt(na);
    nb = Math.sqrt(nb);
    return na > 0 && nb > 0 ? dot / (na * nb) : 0;
  }

  const REFINEMENT = 0.85;
  const SHIFT = 0.60;

  const versions: any[] = [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];
    const ver: any = {
      version: i + 1,
      date: app.date || "",
      description: app.context || "",
      scope: app.scope || "narrow",
      source_article: app.article_id || "",
      entities_involved: app.entities_involved || [],
      confidence: app.confidence || 0.7,
    };

    if (i > 0 && embeddings[i].length > 0 && embeddings[i - 1].length > 0) {
      const sim = cosine(embeddings[i - 1], embeddings[i]);
      ver.similarity_to_prev = Math.round(sim * 10000) / 10000;
      const prevScope = versions[i - 1].scope;
      const curScope = ver.scope;
      if (sim >= REFINEMENT) {
        ver.evolution_type = prevScope !== curScope ? "refinement" : "reiteration";
      } else if (sim >= SHIFT) {
        ver.evolution_type = "shift";
      } else {
        ver.evolution_type = "divergence";
      }
    } else {
      ver.evolution_type = "initial";
    }
    versions.push(ver);
  }
  return versions;
}

async function processAnalyst(analyst: AnalystName): Promise<void> {
  console.log(`\n=== ${analyst} ===`);
  const docs = await loadDocuments(analyst);
  console.log(`  ${docs.length} documents from DB`);
  if (docs.length === 0) return;

  const batches: DocRow[][] = [];
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    batches.push(docs.slice(i, i + BATCH_SIZE));
  }
  console.log(`  ${batches.length} batches of up to ${BATCH_SIZE}`);

  const allExtractions: { frameworks: RawFramework[] }[] = [];
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const names = batch.map(d => (d.file_path || d.id).slice(0, 30)).join(", ");
    console.log(`  [${bi + 1}/${batches.length}] ${batch.length} docs: ${names.slice(0, 80)}…`);
    const result = await callLLM(batch, analyst);
    console.log(`      → ${result.frameworks.length} frameworks`);
    allExtractions.push(result);
    if (bi < batches.length - 1) await new Promise(r => setTimeout(r, API_DELAY_MS));
  }

  const merged = mergeFrameworks(allExtractions);
  console.log(`  merged → ${merged.length} unique frameworks`);

  mkdirSync(RAW_DIR, { recursive: true });
  const rawPath = join(RAW_DIR, `${analyst}_frameworks.json`);
  if (!dryRun) {
    writeFileSync(rawPath, JSON.stringify({
      analyst,
      model: "claude-sonnet-4-20250514",
      extracted_at: new Date().toISOString(),
      article_count: docs.length,
      batch_count: batches.length,
      frameworks: merged,
    }, null, 2));
    console.log(`  raw saved → ${rawPath}`);
  }

  console.log(`  building versioned frameworks with embeddings...`);
  const DORMANCY_DAYS = 183;
  const today = new Date();
  const evolved: any[] = [];
  let refinementCount = 0, shiftCount = 0;

  const EMBED_GROUP = 5;
  for (let g = 0; g < merged.length; g += EMBED_GROUP) {
    const group = merged.slice(g, g + EMBED_GROUP);
    const promises = group.map(async (fw) => {
      const versions = await buildVersions(fw);
      if (versions.length === 0) return null;

      for (const v of versions) {
        if (v.evolution_type === "refinement") refinementCount++;
        else if (v.evolution_type === "shift") shiftCount++;
      }

      const entities = [...new Set(
        (fw.applications || []).flatMap(a => a.entities_involved || []).filter(Boolean)
      )].sort();

      const lastSeen = versions[versions.length - 1]?.date || "";
      let isDormant = false;
      if (lastSeen) {
        const d = new Date(lastSeen);
        isDormant = !isNaN(d.getTime()) && (today.getTime() - d.getTime()) / 86400000 > DORMANCY_DAYS;
      }

      return {
        id: slug(fw.name),
        name: fw.name,
        description: fw.description,
        category: fw.category,
        versions,
        total_applications: fw.applications.length,
        entities_connected: entities,
        status: isDormant ? "dormant" : "active",
        first_seen: fw.applications[0]?.date || "",
        last_seen: lastSeen,
        confidence: Math.round(
          fw.applications.reduce((s, a) => s + (a.confidence || 0.7), 0) / fw.applications.length * 1000
        ) / 1000,
      };
    });
    const results = await Promise.all(promises);
    evolved.push(...results.filter(Boolean));
    console.log(`    versioned ${Math.min(g + EMBED_GROUP, merged.length)}/${merged.length}`);
  }

  const active = evolved.filter(f => f.status === "active").length;
  const dormant = evolved.filter(f => f.status === "dormant").length;

  const payload = {
    analyst,
    generated_at: new Date().toISOString(),
    embed_model: "voyage-3-lite",
    thresholds: { refinement: 0.85, shift: 0.60, dormancy_days: DORMANCY_DAYS },
    frameworks: evolved,
    stats: {
      total_frameworks: evolved.length,
      active,
      dormant,
      refinements_detected: refinementCount,
      shifts_detected: shiftCount,
    },
  };

  console.log(`  → ${evolved.length} frameworks (${active} active, ${dormant} dormant)`);

  if (!dryRun) {
    mkdirSync(FRAMEWORKS_DIR, { recursive: true });
    const outPath = join(FRAMEWORKS_DIR, `${analyst}_frameworks_evolved.json`);
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`  evolved saved → ${outPath}`);
  } else {
    console.log(`  (dry-run: not saving)`);
  }
}

async function main() {
  const NEW_ANALYSTS: AnalystName[] = ["CryptoHayes", "AustinBarack", "defi_monk", "RyanWatkins_", "robbiepetersen_"];
  const targets: AnalystName[] = analystArg && (ANALYST_NAMES as readonly string[]).includes(analystArg)
    ? [analystArg as AnalystName]
    : NEW_ANALYSTS;

  console.log(`Framework extraction pipeline for: ${targets.join(", ")}`);
  for (const analyst of targets) {
    await processAnalyst(analyst);
  }

  console.log("\nAll done. Run the following to ingest frameworks into PostgreSQL:");
  for (const analyst of targets) {
    console.log(`  npx tsx scripts/ingest-analyst-corpus.ts --analyst ${analyst} --frameworks-only`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
