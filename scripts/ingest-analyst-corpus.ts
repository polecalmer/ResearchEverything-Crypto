/**
 * One-shot ingest of the analyst corpus into Postgres + pgvector.
 *
 * Walks data/analyst-corpus/{analyst}/content/*.md, parses YAML frontmatter,
 * inserts documents, chunks bodies (~600 tokens with 80-token overlap, char-
 * approximated at 4 chars/token), embeds chunks via Voyage in batches, then
 * loads kg/frameworks_evolved/*.json (re-embedding with Voyage at 1024-d,
 * discarding the original 384-d MiniLM vectors).
 *
 * Idempotent — re-running skips files already present (by file_path) and
 * frameworks already present (by analyst+slug dedupe key).
 *
 * Usage: tsx scripts/ingest-analyst-corpus.ts [--analyst NAME] [--frameworks-only] [--dry-run]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import {
  analystDocuments,
  analystChunks,
  analystFrameworks,
  ANALYST_NAMES,
  type AnalystName,
} from "@shared/schema";
import { embedBatch } from "../server/data-source-brain/embeddings";
import crypto from "node:crypto";

const CORPUS_ROOT = join(process.cwd(), "data", "analyst-corpus");
const FRAMEWORKS_DIR = join(CORPUS_ROOT, "kg", "frameworks_evolved");

const args = process.argv.slice(2);
const analystArg = args.includes("--analyst") ? args[args.indexOf("--analyst") + 1] : null;
const frameworksOnly = args.includes("--frameworks-only");
const documentsOnly = args.includes("--documents-only");
const dryRun = args.includes("--dry-run");

// Chunking parameters — char-based approx of ~600 tokens with ~80 token overlap.
const CHUNK_CHARS = 2400;
const OVERLAP_CHARS = 320;
const EMBED_BATCH = 32;

interface Frontmatter {
  source?: string;
  author?: string;
  date?: string;
  url?: string;
  title?: string;
  type?: string;
  tags?: string[];
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  if (!raw.startsWith("---")) return { fm: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { fm: {}, body: raw };
  const fmRaw = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, "");
  const fm: Frontmatter = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as keyof Frontmatter;
    let val: any = m[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    }
    (fm as any)[key] = val;
  }
  return { fm, body };
}

function chunkBody(body: string): string[] {
  // Strip image markdown bloat and dense URL artifacts that don't add semantic value.
  const cleaned = body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= CHUNK_CHARS) return [cleaned];

  const chunks: string[] = [];
  let pos = 0;
  while (pos < cleaned.length) {
    const end = Math.min(pos + CHUNK_CHARS, cleaned.length);
    let slice = cleaned.slice(pos, end);
    // Try to break on paragraph or sentence boundary near the end
    if (end < cleaned.length) {
      const para = slice.lastIndexOf("\n\n");
      const sent = slice.lastIndexOf(". ");
      const breakAt = para > CHUNK_CHARS * 0.6 ? para : sent > CHUNK_CHARS * 0.6 ? sent + 1 : -1;
      if (breakAt > 0) slice = slice.slice(0, breakAt);
    }
    chunks.push(slice.trim());
    if (end >= cleaned.length) break;
    pos += slice.length - OVERLAP_CHARS;
    if (pos < 0) pos = end;
  }
  return chunks.filter((c) => c.length > 50);
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  function walk(d: string) {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const p = join(d, e);
      let s;
      try { s = statSync(p); } catch { continue; }
      if (s.isDirectory()) walk(p);
      else if (e.endsWith(".md")) out.push(p);
    }
  }
  walk(dir);
  return out;
}

async function ingestDocuments(targetAnalysts: AnalystName[]): Promise<void> {
  console.log(`[ingest] Scanning corpus for analysts: ${targetAnalysts.join(", ")}`);

  // A document is considered "complete" only when it has at least one chunk.
  // This way, if a previous run crashed mid-document (doc inserted, chunks
  // partially inserted or none), we re-process it on the next run and the
  // unique (document_id, chunk_index) constraint absorbs duplicate chunks.
  const completeRows = await db.execute<any>(sql`
    SELECT d.file_path AS p, d.id AS id
    FROM analyst_documents d
    WHERE EXISTS (SELECT 1 FROM analyst_chunks c WHERE c.document_id = d.id)
  `);
  const completePaths = new Set<string>(((completeRows as any).rows ?? completeRows).map((r: any) => r.p));

  // Docs in DB that are missing chunks — we'll re-process them by reusing the existing doc id.
  const incompleteRows = await db.execute<any>(sql`
    SELECT d.file_path AS p, d.id AS id
    FROM analyst_documents d
    WHERE NOT EXISTS (SELECT 1 FROM analyst_chunks c WHERE c.document_id = d.id)
  `);
  const incompleteByPath = new Map<string, string>(
    ((incompleteRows as any).rows ?? incompleteRows).map((r: any) => [r.p, r.id])
  );
  if (incompleteByPath.size > 0) {
    console.log(`[ingest] ${incompleteByPath.size} previously-inserted docs missing chunks — will backfill`);
  }
  console.log(`[ingest] ${completePaths.size} complete documents already in DB`);

  type DocTask = {
    relPath: string;
    absPath: string;
    analyst: AnalystName;
    fm: Frontmatter;
    body: string;
    chunks: string[];
  };

  const tasks: DocTask[] = [];

  for (const analyst of targetAnalysts) {
    const contentDir = join(CORPUS_ROOT, analyst, "content");
    const files = walkMarkdown(contentDir);
    console.log(`[ingest] ${analyst}: ${files.length} files on disk`);
    for (const abs of files) {
      const rel = abs.slice(CORPUS_ROOT.length + 1);
      if (completePaths.has(rel)) continue;
      let raw: string;
      try { raw = readFileSync(abs, "utf8"); } catch { continue; }
      const { fm, body } = parseFrontmatter(raw);
      const chunks = chunkBody(body);
      if (chunks.length === 0) continue;
      tasks.push({ relPath: rel, absPath: abs, analyst, fm, body, chunks });
    }
  }

  console.log(`[ingest] ${tasks.length} new documents to ingest`);
  if (dryRun) {
    console.log(`[ingest] DRY RUN — exiting`);
    return;
  }
  if (tasks.length === 0) return;

  // Process in groups so we don't hold the entire embedding queue in memory.
  const DOC_GROUP = 50;
  let processedDocs = 0;
  let processedChunks = 0;
  const startTime = Date.now();

  for (let g = 0; g < tasks.length; g += DOC_GROUP) {
    const group = tasks.slice(g, g + DOC_GROUP);

    // 1) Insert documents (idempotent on file_path). Inserts return new rows
    //    only; for docs that already existed (i.e. were "incomplete" in our
    //    earlier scan), reuse the previously-stored id so we can backfill chunks.
    const docInserts = group.map((t) => ({
      analyst: t.analyst,
      source: (t.fm.source || "unknown") as string,
      url: t.fm.url || null,
      date: t.fm.date || null,
      title: t.fm.title || null,
      body: t.body.slice(0, 200_000),
      type: t.fm.type || null,
      tags: Array.isArray(t.fm.tags) ? t.fm.tags : [],
      filePath: t.relPath,
    }));

    const insertedDocs = await db
      .insert(analystDocuments)
      .values(docInserts)
      .onConflictDoNothing({ target: analystDocuments.filePath })
      .returning({ id: analystDocuments.id, filePath: analystDocuments.filePath });

    const filePathToId = new Map<string, string>(insertedDocs.map((d) => [d.filePath, d.id]));
    // Fold in any pre-existing ids for backfill paths.
    for (const t of group) {
      if (filePathToId.has(t.relPath)) continue;
      const existingId = incompleteByPath.get(t.relPath);
      if (existingId) filePathToId.set(t.relPath, existingId);
    }

    // 2) Build chunk records flat across the group, embed in EMBED_BATCH-sized API calls.
    type ChunkTask = { docId: string; task: DocTask; index: number; content: string };
    const chunkTasks: ChunkTask[] = [];
    for (const t of group) {
      const docId = filePathToId.get(t.relPath);
      if (!docId) continue; // race or already-existed (shouldn't happen since we filtered)
      t.chunks.forEach((content, index) => chunkTasks.push({ docId, task: t, index, content }));
    }

    for (let b = 0; b < chunkTasks.length; b += EMBED_BATCH) {
      const slice = chunkTasks.slice(b, b + EMBED_BATCH);
      const texts = slice.map((c) => {
        const head = c.task.fm.title ? `${c.task.fm.title}\n\n` : "";
        return head + c.content;
      });
      let vectors: number[][];
      try {
        vectors = await embedBatch(texts, "document");
      } catch (err: any) {
        console.error(`[ingest] embed batch failed (${err.message}) — sleeping 30s and retrying`);
        await new Promise((r) => setTimeout(r, 30_000));
        vectors = await embedBatch(texts, "document");
      }
      const rows = slice.map((c, j) => ({
        documentId: c.docId,
        analyst: c.task.analyst,
        source: (c.task.fm.source || "unknown") as string,
        date: c.task.fm.date || null,
        title: c.task.fm.title || null,
        url: c.task.fm.url || null,
        chunkIndex: c.index,
        content: c.content,
        embedding: vectors[j],
      }));
      await db.insert(analystChunks).values(rows).onConflictDoNothing({
        target: [analystChunks.documentId, analystChunks.chunkIndex],
      });
      processedChunks += rows.length;
    }

    processedDocs += insertedDocs.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const pct = ((g + group.length) / tasks.length * 100).toFixed(1);
    console.log(`[ingest] progress ${pct}% — ${processedDocs} docs / ${processedChunks} chunks / ${elapsed}s elapsed`);
  }

  console.log(`[ingest] DONE — ${processedDocs} documents, ${processedChunks} chunks`);
}

async function ingestFrameworks(targetAnalysts: AnalystName[]): Promise<void> {
  console.log(`[ingest] Loading frameworks from ${FRAMEWORKS_DIR}`);

  type FwTask = {
    analyst: AnalystName;
    slug: string;
    name: string;
    description: string;
    category: string | null;
    versions: any[];
    versionCount: number;
    firstSeenDate: string | null;
    lastSeenDate: string | null;
    embedText: string;
  };
  const tasks: FwTask[] = [];

  for (const analyst of targetAnalysts) {
    const path = join(FRAMEWORKS_DIR, `${analyst}_frameworks_evolved.json`);
    let raw: string;
    try { raw = readFileSync(path, "utf8"); } catch (err: any) {
      console.warn(`[ingest] no framework file for ${analyst}: ${err.message}`);
      continue;
    }
    const parsed = JSON.parse(raw);
    const frameworks: any[] = parsed.frameworks || [];
    for (const fw of frameworks) {
      const slug = fw.id || fw.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || crypto.randomUUID();
      const versions: any[] = (fw.versions || []).map((v: any) => {
        const { embedding: _drop, ...rest } = v;
        return rest;
      });
      const dates = versions.map((v) => v.date).filter(Boolean).sort();
      const embedText = [
        `${fw.name || slug}`,
        fw.description || "",
        ...versions.slice(-3).map((v) => v.description || ""),
      ].filter(Boolean).join("\n\n");
      tasks.push({
        analyst,
        slug,
        name: fw.name || slug,
        description: fw.description || "",
        category: fw.category || null,
        versions,
        versionCount: versions.length,
        firstSeenDate: dates[0] || null,
        lastSeenDate: dates[dates.length - 1] || null,
        embedText,
      });
    }
  }

  console.log(`[ingest] ${tasks.length} frameworks to upsert`);
  if (dryRun || tasks.length === 0) return;

  for (let i = 0; i < tasks.length; i += EMBED_BATCH) {
    const slice = tasks.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(slice.map((t) => t.embedText), "document");
    const rows = slice.map((t, j) => ({
      analyst: t.analyst,
      frameworkSlug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
      versions: t.versions,
      versionCount: t.versionCount,
      firstSeenDate: t.firstSeenDate,
      lastSeenDate: t.lastSeenDate,
      embedding: vectors[j],
    }));
    // True upsert on (analyst, framework_slug): overwrite all snapshot fields
    // so re-running picks up newer versions / updated descriptions.
    await db
      .insert(analystFrameworks)
      .values(rows)
      .onConflictDoUpdate({
        target: [analystFrameworks.analyst, analystFrameworks.frameworkSlug],
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          versions: sql`excluded.versions`,
          versionCount: sql`excluded.version_count`,
          firstSeenDate: sql`excluded.first_seen_date`,
          lastSeenDate: sql`excluded.last_seen_date`,
          embedding: sql`excluded.embedding`,
        },
      });
  }
  console.log(`[ingest] frameworks done — ${tasks.length} upserted`);
}

async function main() {
  const targets: AnalystName[] = analystArg && (ANALYST_NAMES as readonly string[]).includes(analystArg)
    ? [analystArg as AnalystName]
    : [...ANALYST_NAMES];

  // Ensure pgvector exists (defensive).
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  if (!frameworksOnly) await ingestDocuments(targets);
  if (!documentsOnly) await ingestFrameworks(targets);

  // GIN index for tsvector hybrid search (safe to re-run).
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS analyst_chunks_content_tsv_idx
    ON analyst_chunks USING GIN (content_tsv)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS analyst_frameworks_content_tsv_idx
    ON analyst_frameworks USING GIN (content_tsv)
  `);

  console.log(`[ingest] all done`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[ingest] FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
