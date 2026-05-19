/**
 * Local web search + fetch tools.
 *
 * Replaces the Anthropic server-side `web_search_20250305` tool with a
 * provider-agnostic implementation that works for ANY LLM (Claude via
 * Anthropic, Claude via OpenRouter, GPT 5.5, DeepSeek, etc.). Modelled on
 * hermes' `tools/web_tools.py` (Firecrawl/Tavily/Exa/Parallel) but trimmed
 * to the two operations the research agent actually uses:
 *
 *   web_search(query, limit) — discovery: query → [{title, url, snippet}]
 *   web_fetch(urls)          — extraction: urls → [{url, content_md}]
 *
 * Architecture (3 layers, like hermes):
 *
 *   1. Tavily API for search (free tier, fast, OpenAI-shape friendly).
 *      Falls back to Firecrawl / Exa if those keys are present, mirroring
 *      hermes' backend-priority list.
 *
 *   2. Direct fetch() + strip-tags for URL extraction. Cheap, works for
 *      90% of plain HTML / RSS / .md sources.
 *
 *   3. Playwright (Chromium) for JS-heavy or anti-bot pages (X.com, Twitter,
 *      Cloudflare-gated content). Spun up lazily — never imported unless
 *      a fetch falls through to browser path. See `web-tools-browser.ts`.
 *
 *   4. Auxiliary summarisation: pages over `SUMMARISE_THRESHOLD_CHARS`
 *      get piped through Haiku to produce a concise markdown summary.
 *      Caps payload size into the agent's context.
 *
 * Tool execution wiring lives in `executeTool()` in
 * `session-research-agent.ts`. Tool registration shape:
 *
 *   anthropicTools.push({
 *     name: WEB_SEARCH_TOOL_DEF.name,
 *     description: WEB_SEARCH_TOOL_DEF.description,
 *     input_schema: WEB_SEARCH_TOOL_DEF.input_schema,
 *   });
 *
 * Failure modes (return `{ error: "..." }` JSON shape):
 *   - No backend key configured → suggest TAVILY_API_KEY
 *   - Tavily rate-limited → return error, agent retries via brain
 *   - URL fetch 4xx/5xx → returns error AND attempts browser path
 *   - Total content > MAX_RESULT_BYTES → truncates, signals truncation
 */

import { logger } from "./logger";
import { callAnthropicRaw } from "./mpp-client";
import { MODELS } from "./constants";

/* ─────────────────────────── Config ─────────────────────────── */

const TAVILY_API_URL = "https://api.tavily.com";
const SUMMARISE_THRESHOLD_CHARS = 5_000;
const MAX_RESULT_BYTES = 80_000; // Caps per-tool payload returned to agent
const MAX_FETCH_BYTES = 2_000_000; // 2MB hard cap per page (matches hermes)
const FETCH_TIMEOUT_MS = 15_000;
const SUMMARISE_MAX_TOKENS = 1200;

// Domains known to require JavaScript / stealth browser to return content.
// Add as needed. The fetch path detects these and skips straight to browser.
const JS_REQUIRED_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "t.co",
  "www.x.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "linkedin.com",
  "www.linkedin.com",
  "medium.com", // soft paywall + JS rendering
]);

/* ─────────────────────────── Types ─────────────────────────── */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}

export interface WebFetchResult {
  url: string;
  status: "ok" | "summarised" | "error" | "browser_required";
  contentType?: string;
  content?: string;       // markdown-ish text
  summary?: string;       // present when status === "summarised"
  originalChars?: number; // pre-summarisation length
  error?: string;
}

/* ────────────────────── Tool definitions ────────────────────── */

export const WEB_SEARCH_TOOL_DEF = {
  name: "web_search",
  description:
    "Search the web for information. Returns up to `limit` results, each with a title, URL, and short snippet. Use this to discover URLs and recent context. To read the body of a specific URL, follow up with web_fetch. Good for: news, qualitative context, finding primary sources, public announcements, GitHub repos, docs.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Be specific — include entity names, dates, and event keywords. Avoid quoting unless you need an exact phrase.",
      },
      limit: {
        type: "integer",
        description: "Max number of results (default 5, max 10).",
        minimum: 1,
        maximum: 10,
      },
    },
    required: ["query"],
  },
} as const;

export const WEB_FETCH_TOOL_DEF = {
  name: "web_fetch",
  description:
    "Fetch the content of one or more URLs and return readable text/markdown. Use this to read a specific page after web_search, or when the user pastes a URL. Handles JS-heavy sites (X/Twitter, LinkedIn) via a stealth browser when needed. Pages longer than ~5000 chars are auto-summarised by a cheap model so the output stays compact. Max 5 URLs per call.",
  input_schema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of URLs to fetch (max 5).",
        maxItems: 5,
      },
      raw: {
        type: "boolean",
        description: "If true, skip auto-summarisation and return the full extracted text (still capped at MAX_FETCH_BYTES). Default false.",
      },
    },
    required: ["urls"],
  },
} as const;

/* ─────────────────────── Web search backends ─────────────────────── */

/**
 * Backend priority and fallback chain — mirrors hermes' multi-backend
 * approach (`web_tools.py:121` `_get_backend()`). The first backend with
 * a configured key is tried first; if it errors (network, 429, 5xx)
 * we fall through to the next. This means stacking free-tier keys
 * across providers gives effective ~3-4k searches/month for free
 * before any one quota bites.
 *
 * Order rationale:
 *   1. Tavily — fast, generous free tier (1k/mo), neutral quality
 *   2. Exa — best for technical/crypto/research content (semantic)
 *   3. Firecrawl — generous free tier (500/mo) + has scraping
 *   4. Parallel — narrow but fast; minimal free tier
 *
 * Override priority with WEB_SEARCH_BACKEND=tavily|exa|firecrawl|parallel.
 */

type SearchBackend = "tavily" | "exa" | "firecrawl" | "parallel";

function hasKey(envName: string): boolean {
  const v = process.env[envName];
  return typeof v === "string" && v.trim().length > 0;
}

function envKey(name: string): string {
  return (process.env[name] || "").trim();
}

function backendKeyEnv(b: SearchBackend): string {
  switch (b) {
    case "tavily": return "TAVILY_API_KEY";
    case "exa": return "EXA_API_KEY";
    case "firecrawl": return "FIRECRAWL_API_KEY";
    case "parallel": return "PARALLEL_API_KEY";
  }
}

function availableBackends(): SearchBackend[] {
  const override = (process.env.WEB_SEARCH_BACKEND || "").toLowerCase().trim() as SearchBackend;
  const all: SearchBackend[] = ["tavily", "exa", "firecrawl", "parallel"];
  // If override is set AND keyed, lead with it; everything else trails as fallback.
  if (all.includes(override) && hasKey(backendKeyEnv(override))) {
    return [override, ...all.filter((b) => b !== override && hasKey(backendKeyEnv(b)))];
  }
  return all.filter((b) => hasKey(backendKeyEnv(b)));
}

interface BackendResult {
  ok: boolean;
  results?: WebSearchResult[];
  status?: number;
  errorMessage?: string;
}

async function tavilySearch(query: string, limit: number): Promise<BackendResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(`${TAVILY_API_URL}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: envKey("TAVILY_API_KEY"),
        query,
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, errorMessage: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    const data = await resp.json();
    const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
      title: String(r.title || "").slice(0, 300),
      url: String(r.url || ""),
      snippet: String(r.content || "").slice(0, 500),
      publishedDate: r.published_date || undefined,
    }));
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, errorMessage: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function exaSearch(query: string, limit: number): Promise<BackendResult> {
  // Exa.ai — autoprompt + neural search. Best for technical / research
  // content; semantic embedding-based ranking is qualitatively different
  // from keyword search, often surfaces primary sources Tavily misses.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": envKey("EXA_API_KEY"),
      },
      body: JSON.stringify({
        query,
        numResults: limit,
        useAutoprompt: true,
        contents: { text: { maxCharacters: 500 } },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, errorMessage: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    const data = await resp.json();
    const results: WebSearchResult[] = (data.results || []).map((r: any) => ({
      title: String(r.title || "").slice(0, 300),
      url: String(r.url || ""),
      snippet: String(r.text || r.snippet || "").slice(0, 500),
      publishedDate: r.publishedDate || undefined,
    }));
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, errorMessage: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function firecrawlSearch(query: string, limit: number): Promise<BackendResult> {
  // Firecrawl v1 search — also does scraping in the same flow but we
  // only use the search surface here. Extraction is handled by web_fetch
  // via Playwright + htmlToText (or direct Firecrawl scrape if we hook
  // it in later).
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${envKey("FIRECRAWL_API_KEY")}`,
      },
      body: JSON.stringify({
        query,
        limit,
        lang: "en",
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, errorMessage: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    const data = await resp.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.results) ? data.results : [];
    const results: WebSearchResult[] = list.map((r: any) => ({
      title: String(r.title || "").slice(0, 300),
      url: String(r.url || ""),
      snippet: String(r.description || r.snippet || "").slice(0, 500),
    }));
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, errorMessage: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

async function parallelSearch(query: string, limit: number): Promise<BackendResult> {
  // Parallel.ai — narrower but fast. Reasonable fallback if others
  // are rate-limited. Beta API surface; tolerate response-shape drift.
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch("https://api.parallel.ai/v1/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": envKey("PARALLEL_API_KEY"),
      },
      body: JSON.stringify({
        query,
        max_results: limit,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { ok: false, status: resp.status, errorMessage: (await resp.text().catch(() => "")).slice(0, 200) };
    }
    const data = await resp.json();
    const list: any[] = Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : [];
    const results: WebSearchResult[] = list.map((r: any) => ({
      title: String(r.title || "").slice(0, 300),
      url: String(r.url || ""),
      snippet: String(r.content || r.snippet || r.description || "").slice(0, 500),
      publishedDate: r.published_date || r.publishedDate || undefined,
    }));
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, errorMessage: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

const BACKEND_FNS: Record<SearchBackend, (q: string, n: number) => Promise<BackendResult>> = {
  tavily: tavilySearch,
  exa: exaSearch,
  firecrawl: firecrawlSearch,
  parallel: parallelSearch,
};

export async function webSearch(query: string, limit = 5): Promise<string> {
  const cleanLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
  const backends = availableBackends();
  if (backends.length === 0) {
    return JSON.stringify({
      error:
        "Web search not configured. Set at least one of TAVILY_API_KEY (https://tavily.com), EXA_API_KEY (https://exa.ai), FIRECRAWL_API_KEY (https://firecrawl.dev), or PARALLEL_API_KEY (https://parallel.ai). All four have free tiers — stacking keys gives ~3-4k searches/mo of headroom before any one quota bites.",
    });
  }

  const attempts: string[] = [];
  for (const backend of backends) {
    const r = await BACKEND_FNS[backend](query, cleanLimit);
    if (r.ok && r.results) {
      logger.info(
        { query, backend, count: r.results.length, fellThrough: attempts.length > 0 },
        "web_search ok",
      );
      return JSON.stringify({
        query,
        backend,
        count: r.results.length,
        results: r.results,
        ...(attempts.length > 0 ? { fellThroughFrom: attempts } : {}),
      });
    }
    const reason = r.status ? `${backend} HTTP ${r.status}: ${r.errorMessage || "?"}` : `${backend} ${r.errorMessage || "failed"}`;
    attempts.push(reason);
    logger.warn({ query, backend, status: r.status, err: r.errorMessage }, "web_search backend failed — trying next");
  }

  return JSON.stringify({
    error: `All search backends failed (tried ${backends.length}): ${attempts.join(" | ")}`,
  });
}

/* ─────────────────────── Web fetch (direct + browser) ─────────────────────── */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isJsRequired(url: string): boolean {
  return JS_REQUIRED_HOSTS.has(hostOf(url));
}

/** Strip HTML to a markdown-ish text representation. Cheap and good
 *  enough for plain documentation, news, blog posts. JS-rendered SPAs
 *  return the empty shell — they go through the browser path instead. */
export function htmlToText(html: string): string {
  // Strip script/style/svg blocks (with bodies)
  let s = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Preserve some structure for the LLM: headings, lists, line breaks
  s = s
    .replace(/<h1\b[^>]*>/gi, "\n# ")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<h[4-6]\b[^>]*>/gi, "\n#### ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n");

  // Drop all remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  // Decode the common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

  // Collapse whitespace
  s = s.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

async function fetchDirect(url: string): Promise<{ contentType: string; body: string } | { error: string }> {
  // SSRF guard — refuse fetches to private/loopback/AWS-metadata
  // addresses BEFORE making the HTTP request. Defends against an
  // attacker prompting the agent to hit 169.254.169.254 (AWS metadata
  // → IAM credential leak), localhost, RFC 1918 private space, or
  // DNS-rebinding hostnames. See server/ssrf-guard.ts for the full
  // address-class list. Errors surface as "error" in the structured
  // tool result so the agent reports the failure cleanly.
  try {
    const { rejectIfPrivateAddress } = await import("./ssrf-guard");
    await rejectIfPrivateAddress(url);
  } catch (ssrfErr: any) {
    logger.warn?.({ url, err: ssrfErr?.message }, "web_fetch blocked by SSRF guard");
    return { error: `SSRF block: ${ssrfErr?.message || String(ssrfErr)}` };
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status} ${resp.statusText}` };
    }

    const contentType = (resp.headers.get("content-type") || "").toLowerCase();
    // Read up to MAX_FETCH_BYTES; abort if much larger.
    const reader = resp.body?.getReader();
    if (!reader) return { error: "no body" };
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytes += value.byteLength;
        if (bytes > MAX_FETCH_BYTES) {
          try { await reader.cancel(); } catch {}
          return { error: `Page too large (>${MAX_FETCH_BYTES} bytes)` };
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString("utf-8");
    return { contentType, body };
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

/** Summarise long content via Haiku. Cheap and fast — same pattern as
 *  hermes' auxiliary-summariser layer using Gemini 3 Flash. We use Haiku
 *  because it's already in the pipeline and routes through the same
 *  provider abstraction as the heavy-tier work. */
async function summariseContent(url: string, content: string): Promise<string> {
  const prompt = `You are summarising a web page for a crypto research agent. Be DENSE and SPECIFIC.

Source URL: ${url}

PAGE CONTENT:
${content.slice(0, 60_000)}

Produce a markdown summary in 600-1000 words. Keep:
  - Specific numbers (amounts, dates, percentages, addresses, ticker symbols)
  - Names of people, products, protocols, companies
  - Direct quotes if they're load-bearing
  - Architectural / disambiguation facts ("X has no token", "X is a fork of Y")
Drop:
  - Boilerplate, navigation, footer, cookie banners
  - Hedging adjectives
  - Repeated information

Output ONLY the summary, no preamble.`;

  try {
    const resp = await callAnthropicRaw({
      model: MODELS.HAIKU,
      max_tokens: SUMMARISE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });

    let text = "";
    if (Array.isArray(resp?.content)) {
      for (const b of resp.content) {
        if (b?.type === "text" && typeof b.text === "string") text += b.text;
      }
    }
    return text.trim();
  } catch (err: any) {
    logger.warn({ err: err?.message, url }, "web_fetch.summarise failed — returning truncated raw");
    return content.slice(0, SUMMARISE_THRESHOLD_CHARS) + "\n\n[summarisation failed, truncated]";
  }
}

/** Firecrawl /v1/scrape — managed Playwright with anti-bot + clean markdown
 *  output. Strictly better than our local Playwright path when keyed: handles
 *  JS rendering server-side, returns markdown not HTML, and bypasses
 *  cloudflare/anti-bot at the provider level. Returns markdown body or null
 *  on failure (caller falls through to the next strategy). */
async function firecrawlScrape(url: string): Promise<{ markdown: string } | null> {
  if (!hasKey("FIRECRAWL_API_KEY")) return null;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + 5000); // a bit more — managed browser has cold-start
  try {
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${envKey("FIRECRAWL_API_KEY")}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: 1500,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      logger.warn({ url, status: resp.status }, "firecrawl scrape non-2xx — falling through");
      return null;
    }
    const data: any = await resp.json();
    const md: string | undefined = data?.data?.markdown || data?.markdown;
    if (!md || md.trim().length === 0) {
      logger.warn({ url }, "firecrawl returned empty markdown — falling through");
      return null;
    }
    return { markdown: md };
  } catch (err: any) {
    logger.warn({ url, err: err?.message }, "firecrawl scrape errored — falling through");
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchOne(url: string, raw: boolean): Promise<WebFetchResult> {
  // Route 0: Firecrawl (when keyed) — managed scraping with JS rendering
  // and anti-bot, returns clean markdown. Strictly best when available.
  const fc = await firecrawlScrape(url);
  if (fc) {
    const text = fc.markdown;
    const originalChars = text.length;
    if (!raw && originalChars > SUMMARISE_THRESHOLD_CHARS) {
      const summary = await summariseContent(url, text);
      return { url, status: "summarised", contentType: "text/markdown", summary, originalChars };
    }
    return { url, status: "ok", contentType: "text/markdown", content: text, originalChars };
  }

  // Route 1: known JS-required hosts go straight to browser path
  if (isJsRequired(url)) {
    try {
      const { fetchViaBrowser } = await import("./web-tools-browser");
      const html = await fetchViaBrowser(url, FETCH_TIMEOUT_MS);
      const text = htmlToText(html);
      const originalChars = text.length;
      if (!raw && originalChars > SUMMARISE_THRESHOLD_CHARS) {
        const summary = await summariseContent(url, text);
        return { url, status: "summarised", contentType: "text/html", summary, originalChars };
      }
      return { url, status: "ok", contentType: "text/html", content: text, originalChars };
    } catch (err: any) {
      return {
        url,
        status: "browser_required",
        error: `JS-heavy site (${hostOf(url)}) and browser fallback unavailable: ${err?.message}. Run \`npx playwright install chromium\` to enable.`,
      };
    }
  }

  // Route 2: direct fetch
  const direct = await fetchDirect(url);
  if ("error" in direct) {
    // Last-resort: try browser path for sites that 403/cloudflare us
    try {
      const { fetchViaBrowser } = await import("./web-tools-browser");
      const html = await fetchViaBrowser(url, FETCH_TIMEOUT_MS);
      const text = htmlToText(html);
      const originalChars = text.length;
      if (!raw && originalChars > SUMMARISE_THRESHOLD_CHARS) {
        const summary = await summariseContent(url, text);
        return { url, status: "summarised", contentType: "text/html", summary, originalChars };
      }
      return { url, status: "ok", contentType: "text/html", content: text, originalChars };
    } catch {
      return { url, status: "error", error: direct.error };
    }
  }

  const { contentType, body } = direct;
  let text: string;
  if (contentType.includes("application/json")) {
    text = body.slice(0, MAX_FETCH_BYTES);
  } else if (contentType.includes("text/html")) {
    text = htmlToText(body);
  } else if (contentType.includes("text/")) {
    text = body;
  } else {
    return {
      url,
      status: "error",
      error: `Unsupported content-type "${contentType}". Use web_search for discovery or fetch a different URL.`,
    };
  }

  const originalChars = text.length;
  if (!raw && originalChars > SUMMARISE_THRESHOLD_CHARS) {
    const summary = await summariseContent(url, text);
    return { url, status: "summarised", contentType, summary, originalChars };
  }
  return { url, status: "ok", contentType, content: text, originalChars };
}

export async function webFetch(urls: string[], raw = false): Promise<string> {
  if (!Array.isArray(urls) || urls.length === 0) {
    return JSON.stringify({ error: "web_fetch requires a non-empty `urls` array." });
  }
  const cleanUrls = urls.slice(0, 5).map(String).filter((u) => /^https?:\/\//i.test(u));
  if (cleanUrls.length === 0) {
    return JSON.stringify({ error: "No valid http(s) URLs in `urls`." });
  }

  const results = await Promise.all(cleanUrls.map((u) => fetchOne(u, raw)));

  const payload = { count: results.length, results };
  let serialised = JSON.stringify(payload);
  // Hard cap on total bytes returned to the agent — if exceeded, truncate
  // the LONGEST result(s) until under cap. Mirrors hermes' size discipline.
  while (serialised.length > MAX_RESULT_BYTES && results.some((r) => (r.content?.length || r.summary?.length || 0) > 1000)) {
    const idx = results.reduce((maxIdx, r, i) => {
      const len = (r.content?.length || r.summary?.length || 0);
      const cur = (results[maxIdx].content?.length || results[maxIdx].summary?.length || 0);
      return len > cur ? i : maxIdx;
    }, 0);
    const r = results[idx];
    if (r.content) r.content = r.content.slice(0, Math.floor(r.content.length * 0.7));
    if (r.summary) r.summary = r.summary.slice(0, Math.floor(r.summary.length * 0.7));
    serialised = JSON.stringify(payload);
  }

  return serialised;
}
