/**
 * HRC (hyperliquidr.xyz) corpus ingestion.
 *
 * Mirrors hermes' /Users/sessions/.hermes/dune-brain/ingest_hrc.py:
 *   - GET /authors        → 24 analysts
 *   - GET /blogs          → ~64 blog post index entries
 *   - GET /blogs/{slug}   → full content per post
 *   - Strips inline base64 images (they bloat HTML 10-100×)
 *   - HTML → markdown-ish text (for embeddings + LLM input)
 *   - Idempotent upsert: analysts by slug, posts by (platform, post_id)
 *
 * Land target: sessions' `analysts` + `analyst_raw_posts` tables
 * (migration 0003 must be applied first).
 *
 * Run:
 *   npx tsx script/ingest-hermes-corpus.ts            # full ingest
 *   npx tsx script/ingest-hermes-corpus.ts --dry-run  # fetch + parse, no DB writes
 *
 * Re-running is safe — the ON CONFLICT clauses update existing rows
 * rather than failing. Post fetched_at + content_md are refreshed each
 * run so the corpus stays current.
 */

import "dotenv/config";
import { pool } from "../server/db";
import { htmlToText } from "../server/web-tools";

const HRC_API = "https://api.hyperliquidr.xyz/api";
const FETCH_DELAY_MS = 100; // polite spacing between per-blog fetches
const FETCH_TIMEOUT_MS = 30_000;

interface HrcAuthor {
  slug: string;
  author?: string;       // display name
  description?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
  image?: string;
}

interface HrcBlogIndexEntry {
  id?: number;
  slug: string;
  title?: string;
  excerpt?: string;
  category?: string;
  author?: string;       // analyst slug
  date?: string;         // ISO timestamp
  image?: string;
  featured?: boolean;
  featured_order?: number;
}

interface HrcBlog extends HrcBlogIndexEntry {
  content?: string;      // raw HTML
}

// Drop inline base64 images (data:image/...;base64,...) and CDN images with
// extreme src lengths. They contribute zero text signal but balloon HTML.
const BASE64_IMG_RE = /<img[^>]*src="data:image\/[^"]*"[^>]*\/?>/gi;
const LONG_SRC_IMG_RE = /<img[^>]*src="[^"]{500,}"[^>]*\/?>/gi;

function cleanHtml(html: string): string {
  if (!html) return "";
  return html.replace(BASE64_IMG_RE, "[image]").replace(LONG_SRC_IMG_RE, "[image]");
}

function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const cleaned = cleanHtml(html);
  // Reuse sessions' existing htmlToText helper — it preserves headings,
  // lists, paragraph breaks. Good enough for embeddings + LLM input. The
  // raw HTML is also stored in content_html for re-processing if we want
  // a higher-fidelity markdown later.
  return htmlToText(cleaned)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeTwitter(input?: string | null): { handle: string | null; url: string | null } {
  if (!input) return { handle: null, url: null };
  const s = String(input).trim();
  if (!s) return { handle: null, url: null };
  if (s.startsWith("@")) {
    return { handle: s, url: `https://x.com/${s.slice(1)}` };
  }
  const m = s.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/i);
  if (m) {
    const handle = "@" + m[1];
    return { handle, url: `https://x.com/${m[1]}` };
  }
  // Plain string with no @ and no URL — treat as handle.
  return { handle: s, url: null };
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${HRC_API}${path}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (!r.ok) {
      throw new Error(`${url} → ${r.status} ${r.statusText}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function upsertAuthors(authors: HrcAuthor[]): Promise<number> {
  if (authors.length === 0) return 0;
  const client = await pool.connect();
  try {
    let n = 0;
    for (const a of authors) {
      if (!a.slug) continue;
      const { handle, url } = normalizeTwitter(a.twitter);
      await client.query(
        `INSERT INTO analysts (slug, display_name, bio, twitter_handle, twitter_url, website, telegram, image_url, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET
           display_name   = EXCLUDED.display_name,
           bio            = EXCLUDED.bio,
           twitter_handle = COALESCE(EXCLUDED.twitter_handle, analysts.twitter_handle),
           twitter_url    = COALESCE(EXCLUDED.twitter_url,    analysts.twitter_url),
           website        = COALESCE(EXCLUDED.website,        analysts.website),
           telegram       = COALESCE(EXCLUDED.telegram,       analysts.telegram),
           image_url      = COALESCE(EXCLUDED.image_url,      analysts.image_url),
           updated_at     = now()`,
        [
          a.slug,
          a.author || a.slug,
          a.description ?? null,
          handle,
          url,
          a.website ?? null,
          a.telegram ?? null,
          a.image ?? null,
          "hrc",
        ],
      );
      n++;
    }
    return n;
  } finally {
    client.release();
  }
}

async function upsertPost(blog: HrcBlog): Promise<{ inserted: boolean; words: number }> {
  if (!blog.slug) return { inserted: false, words: 0 };
  const rawHtml = blog.content || "";
  const contentMd = htmlToMarkdown(rawHtml);
  const wordCount = contentMd.split(/\s+/).filter(Boolean).length;
  const url = `https://www.hyperliquidr.xyz/blogs/${blog.slug}`;
  const metadata = {
    hrc_id: blog.id,
    featured: blog.featured ?? null,
    featured_order: blog.featured_order ?? null,
    image: blog.image ?? null,
    raw_html_chars: rawHtml.length,
  };

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO analyst_raw_posts
         (analyst_slug, platform, post_id, url, title, excerpt, category,
          content_html, content_md, word_count, content_type,
          published_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (platform, post_id) DO UPDATE SET
         title        = EXCLUDED.title,
         excerpt      = EXCLUDED.excerpt,
         category     = EXCLUDED.category,
         content_html = EXCLUDED.content_html,
         content_md   = EXCLUDED.content_md,
         word_count   = EXCLUDED.word_count,
         published_at = EXCLUDED.published_at,
         metadata     = EXCLUDED.metadata,
         fetched_at   = now()`,
      [
        blog.author,
        "hrc",
        blog.slug,
        url,
        blog.title ?? null,
        blog.excerpt ?? null,
        blog.category ?? null,
        rawHtml || null,
        contentMd || null,
        wordCount,
        "post",
        blog.date ?? null,
        JSON.stringify(metadata),
      ],
    );
    return { inserted: true, words: wordCount };
  } finally {
    client.release();
  }
}

async function summarize() {
  const client = await pool.connect();
  try {
    const a = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM analysts`);
    const p = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM analyst_raw_posts WHERE platform = 'hrc'`);
    const top = await client.query<{ analyst_slug: string; n_posts: string; total_words: string }>(
      `SELECT analyst_slug, count(*)::text AS n_posts, COALESCE(sum(word_count), 0)::text AS total_words
         FROM analyst_raw_posts
        WHERE platform = 'hrc'
        GROUP BY analyst_slug
        ORDER BY count(*) DESC
        LIMIT 10`,
    );
    console.log(`\nanalysts in DB:  ${a.rows[0]?.n ?? "?"}`);
    console.log(`hrc posts in DB: ${p.rows[0]?.n ?? "?"}`);
    console.log("\ntop authors by post count:");
    for (const r of top.rows) {
      console.log(`  ${r.n_posts.padStart(3)} posts  ${r.total_words.padStart(7)} words  ${r.analyst_slug}`);
    }
  } finally {
    client.release();
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  console.log("[hrc] fetching authors...");
  const authors = await fetchJson<HrcAuthor[]>("/authors");
  console.log(`[hrc]   ${authors.length} authors`);

  console.log("[hrc] fetching blog index...");
  const index = await fetchJson<HrcBlogIndexEntry[]>("/blogs");
  console.log(`[hrc]   ${index.length} blogs in index`);

  const blogs: HrcBlog[] = [];
  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    if (!entry.slug) continue;
    try {
      const full = await fetchJson<HrcBlog>(`/blogs/${entry.slug}`);
      blogs.push(full);
      if ((i + 1) % 10 === 0 || i + 1 === index.length) {
        console.log(`[hrc]   fetched ${i + 1}/${index.length}`);
      }
    } catch (err: any) {
      console.warn(`[hrc]   ERR on ${entry.slug}: ${err?.message || err}`);
    }
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
  }

  console.log(`\n[hrc] ${blogs.length} blogs fetched`);

  if (dryRun) {
    console.log("[hrc] --dry-run: skipping DB writes");
    const totalWords = blogs.reduce((acc, b) => acc + htmlToMarkdown(b.content || "").split(/\s+/).filter(Boolean).length, 0);
    console.log(`[hrc] would upsert ${authors.length} authors + ${blogs.length} posts (~${totalWords} words total)`);
    await pool.end();
    return;
  }

  const nAuthors = await upsertAuthors(authors);
  console.log(`[hrc] upserted ${nAuthors} authors`);

  let nPosts = 0;
  let totalWords = 0;
  for (const b of blogs) {
    const { inserted, words } = await upsertPost(b);
    if (inserted) {
      nPosts++;
      totalWords += words;
    }
  }
  console.log(`[hrc] upserted ${nPosts} posts (${totalWords} words total)`);

  await summarize();
  await pool.end();
  console.log("\n[hrc] DONE");
}

main().catch((err) => {
  console.error("[hrc] failed:", err);
  pool.end().finally(() => process.exit(1));
});
