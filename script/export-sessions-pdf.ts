/**
 * One-shot export: bundle a range of research sessions into a single
 * combined PDF, full transcript + table artifacts inline.
 *
 * Renders each turn (user prompt + assistant response) in chronological
 * order, with `artifact:table` / `artifact:metric_cards` / `artifact:
 * comparison` / `artifact:callout` / `artifact:quote` blocks expanded
 * into inline styled HTML. Charts and file_downloads become small
 * placeholders since they don't render well in PDF.
 *
 * Uses Playwright (already a project dep) to print HTML → PDF.
 *
 * Usage:
 *   npx tsx script/export-sessions-pdf.ts                          # last 4 convs
 *   npx tsx script/export-sessions-pdf.ts --convs 204,205,206      # specific
 *   npx tsx script/export-sessions-pdf.ts --user <id>              # filter
 *   npx tsx script/export-sessions-pdf.ts --out ~/Desktop/foo.pdf  # custom path
 */

import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { pool } from "../server/db";

interface Args {
  convs?: number[];
  userId?: string;
  out?: string;
  sinceIso?: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    convs: get("--convs")?.split(",").map((s) => Number(s.trim())),
    userId: get("--user"),
    out: get("--out"),
    sinceIso: get("--since"),
  };
}

interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  kind: string | null;
  content: string;
  created_at: Date;
  artifacts: any[] | null;
}

interface ConversationRow {
  id: number;
  title: string;
  created_at: Date;
}

function htmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render prose markdown to safe-ish HTML. Lightweight — bold, italic,
 *  headings, lists, code spans, blockquotes, paragraphs. Strips artifact
 *  code fences (handled separately so they render inline as tables). */
function renderMarkdown(md: string): string {
  // Strip artifact blocks first — they're rendered separately
  let text = md.replace(/```artifact:[\s\S]*?```/g, "");
  // Strip the <!-- mode:X --> markers
  text = text.replace(/<!--\s*mode:[a-z]+\s*-->\s*\n?/gi, "");

  const lines = text.split("\n");
  const out: string[] = [];
  let inList = false;
  let listType: "ul" | "ol" | null = null;
  let inBlockquote = false;
  let pendingParagraph: string[] = [];

  const flushParagraph = () => {
    if (pendingParagraph.length === 0) return;
    let joined = pendingParagraph.join(" ").trim();
    if (!joined) { pendingParagraph = []; return; }
    joined = inlineMd(joined);
    out.push(`<p>${joined}</p>`);
    pendingParagraph = [];
  };
  const closeList = () => {
    if (inList && listType) {
      out.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
      listType = null;
    }
  };
  const closeBlockquote = () => {
    if (inBlockquote) {
      out.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeBlockquote();
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flushParagraph();
      closeList();
      closeBlockquote();
      const level = h[1].length;
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line)) {
      flushParagraph();
      closeList();
      closeBlockquote();
      out.push("<hr/>");
      continue;
    }

    // Blockquote
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushParagraph();
      closeList();
      if (!inBlockquote) { out.push("<blockquote>"); inBlockquote = true; }
      out.push(`<p>${inlineMd(bq[1])}</p>`);
      continue;
    } else if (inBlockquote) {
      closeBlockquote();
    }

    // Unordered list
    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      flushParagraph();
      if (!inList || listType !== "ul") {
        closeList();
        out.push("<ul>");
        inList = true;
        listType = "ul";
      }
      out.push(`<li>${inlineMd(li[1])}</li>`);
      continue;
    }

    // Ordered list
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushParagraph();
      if (!inList || listType !== "ol") {
        closeList();
        out.push("<ol>");
        inList = true;
        listType = "ol";
      }
      out.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    } else if (inList) {
      closeList();
    }

    // Plain text — accumulate as paragraph
    pendingParagraph.push(line);
  }
  flushParagraph();
  closeList();
  closeBlockquote();

  return out.join("\n");
}

/** Inline markdown: bold, italic, code, links. Returns HTML. */
function inlineMd(s: string): string {
  let t = htmlEscape(s);
  // **bold**
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic* or _italic_
  t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  t = t.replace(/(?<!_)_([^_\n]+)_(?!_)/g, "<em>$1</em>");
  // `code`
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // [text](url) → link (just render as text + url since PDF prints)
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href=\"$2\">$1</a>");
  return t;
}

/** Render an artifact block (parsed JSON object) to HTML. */
function renderArtifact(art: any): string {
  if (!art || typeof art !== "object") return "";
  const type = art.type;
  const title = art.title ? `<div class="art-title">${htmlEscape(art.title)}</div>` : "";
  const subtitle = art.subtitle ? `<div class="art-subtitle">${htmlEscape(String(art.subtitle))}</div>` : "";

  if (type === "callout") {
    const variant = art.variant || "insight";
    const heading = art.title ? `<div class="callout-title">${htmlEscape(art.title)}</div>` : "";
    return `<div class="callout callout-${variant}">${heading}<div class="callout-text">${inlineMd(String(art.text || ""))}</div></div>`;
  }

  if (type === "comparison") {
    const left = art.left || {};
    const right = art.right || {};
    const leftItems = (left.items || []).map((i: string) => `<li>${inlineMd(i)}</li>`).join("");
    const rightItems = (right.items || []).map((i: string) => `<li>${inlineMd(i)}</li>`).join("");
    return `
      <div class="comparison">
        ${title}
        <div class="comparison-grid">
          <div class="comparison-col">
            <div class="comparison-label">${htmlEscape(left.label || "Left")}</div>
            <ul>${leftItems}</ul>
          </div>
          <div class="comparison-col">
            <div class="comparison-label">${htmlEscape(right.label || "Right")}</div>
            <ul>${rightItems}</ul>
          </div>
        </div>
      </div>`;
  }

  if (type === "quote") {
    const attr = art.attribution ? `<div class="quote-attr">— ${htmlEscape(String(art.attribution))}</div>` : "";
    return `<blockquote class="pull-quote">"${htmlEscape(String(art.text || ""))}"${attr}</blockquote>`;
  }

  if (type === "table" || type === "metric_cards") {
    const rows: any[] = Array.isArray(art.data) ? art.data : [];
    if (rows.length === 0) {
      return `<div class="art-empty">${title}${subtitle}<em>(no data)</em></div>`;
    }
    const cols: string[] = art.columns && Array.isArray(art.columns)
      ? art.columns
      : Object.keys(rows[0] || {});
    const head = cols.map((c) => `<th>${htmlEscape(c)}</th>`).join("");
    const body = rows.slice(0, 200).map((r) => {
      return "<tr>" + cols.map((c) => {
        const v = r?.[c];
        const cell = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return `<td>${htmlEscape(cell)}</td>`;
      }).join("") + "</tr>";
    }).join("");
    const more = rows.length > 200 ? `<div class="art-meta">… ${rows.length - 200} more rows omitted</div>` : "";
    const source = art.source ? `<div class="art-meta">Source: ${htmlEscape(String(art.source))}</div>` : "";
    return `<div class="art-table">${title}${subtitle}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${more}${source}</div>`;
  }

  if (type === "chart") {
    const points = Array.isArray(art.data) ? art.data.length : 0;
    const chartType = art.chartConfig?.chartType || art.chartType || "line";
    const source = art.source ? ` · Source: ${htmlEscape(String(art.source))}` : "";
    return `<div class="art-chart-placeholder">[ Chart: <strong>${htmlEscape(art.title || "Untitled")}</strong> — ${chartType}, ${points} data points${source} ]</div>`;
  }

  if (type === "file_download") {
    const size = art.sizeBytes ? ` — ${(art.sizeBytes / 1024).toFixed(1)} KB` : "";
    return `<div class="art-file-placeholder">[ Downloadable file: <strong>${htmlEscape(art.filename || art.title || "file")}</strong>${size} ]</div>`;
  }

  if (type === "sources") {
    if (Array.isArray(art.sources)) {
      const items = art.sources.map((s: any) => `<li>${htmlEscape(typeof s === "string" ? s : (s?.name || JSON.stringify(s)))}</li>`).join("");
      return `<div class="art-sources"><div class="art-title">Sources</div><ul>${items}</ul></div>`;
    }
    if (art.body) {
      return `<div class="art-sources"><div class="art-title">Sources</div><div>${inlineMd(String(art.body))}</div></div>`;
    }
    return "";
  }

  return "";
}

/** Render artifacts attached to a message. */
function renderArtifacts(artifacts: any[] | null): string {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "";
  const blocks = artifacts.map(renderArtifact).filter(Boolean);
  if (blocks.length === 0) return "";
  return `<div class="artifacts-block">${blocks.join("\n")}</div>`;
}

function renderMessage(m: MessageRow, idx: number): string {
  const ts = new Date(m.created_at).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  if (m.role === "user") {
    return `
      <div class="turn-user">
        <div class="turn-meta">USER · ${ts} · msg ${m.id}</div>
        <div class="turn-content">${inlineMd(m.content).replace(/\n/g, "<br/>")}</div>
      </div>`;
  }
  const kindBadge = m.kind ? `<span class="badge">${htmlEscape(m.kind)}</span>` : "";
  return `
    <div class="turn-assistant">
      <div class="turn-meta">ASSISTANT · ${ts} · msg ${m.id} ${kindBadge}</div>
      <div class="turn-content">
        ${renderMarkdown(m.content)}
        ${renderArtifacts(m.artifacts)}
      </div>
    </div>`;
}

async function loadConversations(convIds: number[] | undefined, userId: string | undefined, sinceIso: string | undefined) {
  const client = await pool.connect();
  try {
    let where: string[] = [];
    let params: any[] = [];
    if (convIds && convIds.length > 0) {
      params.push(convIds);
      where.push(`id = ANY($${params.length}::int[])`);
    } else {
      // Default: last 4 conversations that have at least 2 messages
      params.push(sinceIso || "2026-05-17 00:00:00");
      where.push(`created_at >= $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      where.push(`user_id = $${params.length}`);
    }
    const convs = await client.query<ConversationRow>(
      `SELECT id, title, created_at FROM conversations WHERE ${where.join(" AND ")} ORDER BY id ASC`,
      params,
    );
    const out: Array<{ conv: ConversationRow; msgs: MessageRow[] }> = [];
    for (const c of convs.rows) {
      const msgs = await client.query<MessageRow>(
        `SELECT id, conversation_id, role, kind, content, created_at, artifacts
           FROM messages
          WHERE conversation_id = $1
          ORDER BY id ASC`,
        [c.id],
      );
      // Skip empty conversations
      if (msgs.rows.length === 0) continue;
      out.push({ conv: c, msgs: msgs.rows.map((r: any) => ({ ...r, artifacts: Array.isArray(r.artifacts) ? r.artifacts : null })) });
    }
    return out;
  } finally {
    client.release();
  }
}

function buildHtml(sessions: Array<{ conv: ConversationRow; msgs: MessageRow[] }>): string {
  const generatedAt = new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC";
  const totalTurns = sessions.reduce((acc, s) => acc + s.msgs.filter((m) => m.role === "assistant").length, 0);
  const totalArtifacts = sessions.reduce(
    (acc, s) => acc + s.msgs.reduce((a, m) => a + (Array.isArray(m.artifacts) ? m.artifacts.length : 0), 0),
    0,
  );

  const toc = sessions
    .map((s, i) => `<li><a href="#session-${s.conv.id}">${i + 1}. ${htmlEscape(s.conv.title)} <span class="toc-meta">(conv ${s.conv.id}, ${s.msgs.filter((m) => m.role === "assistant").length} responses)</span></a></li>`)
    .join("");

  const body = sessions
    .map((s) => {
      const sessionDate = new Date(s.conv.created_at).toISOString().slice(0, 10);
      const assistantCount = s.msgs.filter((m) => m.role === "assistant").length;
      const artifactCount = s.msgs.reduce((a, m) => a + (Array.isArray(m.artifacts) ? m.artifacts.length : 0), 0);
      const turns = s.msgs.map(renderMessage).join("\n");
      return `
        <section class="session" id="session-${s.conv.id}">
          <header class="session-header">
            <h1>${htmlEscape(s.conv.title)}</h1>
            <div class="session-meta">
              Conversation ${s.conv.id} · Started ${sessionDate} · ${assistantCount} assistant responses · ${artifactCount} artifacts
            </div>
          </header>
          ${turns}
        </section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Sessions research export — ${generatedAt}</title>
  <style>
    @page { size: Letter; margin: 0.6in 0.7in 0.8in 0.7in; }
    @page :first { margin: 1.5in 0.7in 0.8in 0.7in; }
    html { font-family: "Calibri", "Carlito", system-ui, -apple-system, sans-serif; font-size: 11pt; color: #1f2937; }
    body { margin: 0; padding: 0; line-height: 1.45; }
    h1 { font-size: 20pt; font-weight: 600; color: #0f172a; margin: 0 0 0.25em; line-height: 1.2; }
    h2 { font-size: 14pt; font-weight: 600; color: #0f172a; margin: 1.5em 0 0.4em; }
    h3 { font-size: 12pt; font-weight: 600; color: #0f172a; margin: 1.1em 0 0.3em; }
    h4 { font-size: 11pt; font-weight: 600; color: #1e293b; margin: 0.9em 0 0.25em; }
    p { margin: 0.4em 0; }
    a { color: #1d4ed8; text-decoration: none; }
    code { font-family: "Menlo", "Consolas", monospace; font-size: 10pt; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }
    blockquote { margin: 0.6em 0; padding: 0.3em 0.8em; border-left: 3px solid #cbd5e1; color: #475569; }
    ul, ol { margin: 0.4em 0 0.4em 1.4em; padding: 0; }
    li { margin: 0.2em 0; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 1em 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }

    .cover { page-break-after: always; padding: 1.5in 0 0; }
    .cover-title { font-size: 28pt; font-weight: 700; color: #0f172a; line-height: 1.15; margin: 0 0 0.3em; }
    .cover-sub { font-size: 12pt; color: #475569; margin: 0; }
    .cover-stats { margin: 2em 0 0; font-size: 10pt; color: #475569; }
    .cover-stats span { display: inline-block; margin-right: 1.5em; }

    .toc { page-break-after: always; }
    .toc h2 { font-size: 16pt; margin-bottom: 0.6em; }
    .toc ol { margin-left: 1.2em; }
    .toc li { margin: 0.4em 0; font-size: 11pt; }
    .toc a { color: #0f172a; }
    .toc-meta { color: #94a3b8; font-size: 9pt; }

    .session { page-break-before: always; }
    .session-header { border-bottom: 2px solid #cbd5e1; padding-bottom: 0.6em; margin-bottom: 1em; }
    .session-meta { font-size: 9pt; color: #64748b; margin-top: 0.4em; letter-spacing: 0.02em; }

    .turn-user, .turn-assistant { margin: 1.2em 0; }
    .turn-meta { font-size: 8.5pt; color: #94a3b8; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 0.4em; }
    .turn-user .turn-content {
      background: #f8fafc; border-left: 3px solid #94a3b8; padding: 0.5em 0.8em; font-style: italic; color: #334155;
    }
    .turn-assistant .turn-content { color: #1f2937; }
    .badge { display: inline-block; background: #e2e8f0; color: #475569; font-size: 7.5pt; padding: 1px 6px; border-radius: 8px; margin-left: 0.5em; letter-spacing: 0; text-transform: none; }

    .artifacts-block { margin-top: 0.8em; }
    .art-title { font-weight: 600; font-size: 10.5pt; color: #0f172a; margin: 0.8em 0 0.2em; }
    .art-subtitle { font-size: 9pt; color: #64748b; margin-bottom: 0.4em; }
    .art-meta { font-size: 8.5pt; color: #94a3b8; margin-top: 0.3em; }

    .art-table table { border-collapse: collapse; width: 100%; font-size: 10pt; font-variant-numeric: tabular-nums; margin: 0.4em 0; }
    .art-table th { background: #f1f5f9; font-weight: 600; text-align: left; padding: 4px 8px; border: 1px solid #e2e8f0; color: #1e293b; }
    .art-table td { padding: 4px 8px; border: 1px solid #e2e8f0; color: #334155; vertical-align: top; }

    .callout { margin: 0.7em 0; padding: 0.6em 0.9em; border-radius: 4px; }
    .callout-insight  { background: #eff6ff; border-left: 3px solid #2563eb; }
    .callout-risk     { background: #fef2f2; border-left: 3px solid #dc2626; }
    .callout-contrarian { background: #fefce8; border-left: 3px solid #ca8a04; }
    .callout-catch    { background: #f0fdf4; border-left: 3px solid #16a34a; }
    .callout-title { font-weight: 600; color: #0f172a; margin-bottom: 0.3em; }
    .callout-text { color: #334155; font-size: 10.5pt; }

    .comparison-grid { display: table; width: 100%; border-collapse: separate; border-spacing: 12px 0; margin-top: 0.4em; }
    .comparison-col { display: table-cell; width: 50%; padding: 0.5em 0.8em; background: #f8fafc; border-radius: 4px; vertical-align: top; }
    .comparison-label { font-weight: 600; font-size: 10pt; color: #0f172a; margin-bottom: 0.4em; padding-bottom: 0.3em; border-bottom: 1px solid #e2e8f0; }

    .pull-quote { font-style: italic; color: #475569; padding: 0.6em 0.9em; border-left: 3px solid #94a3b8; background: #f8fafc; }
    .quote-attr { margin-top: 0.4em; font-size: 9pt; color: #64748b; font-style: normal; }

    .art-chart-placeholder, .art-file-placeholder { font-size: 9.5pt; color: #64748b; background: #f8fafc; padding: 0.4em 0.7em; margin: 0.4em 0; border-radius: 3px; border: 1px dashed #cbd5e1; }
    .art-sources ul { font-size: 10pt; }

    /* Avoid breaking inside small artifacts */
    .callout, .comparison, .pull-quote, .art-chart-placeholder, .art-file-placeholder { page-break-inside: avoid; }
    .art-table { page-break-inside: auto; }
  </style>
</head>
<body>
  <div class="cover">
    <p class="cover-sub">Sessions Research</p>
    <h1 class="cover-title">Combined Research Export</h1>
    <p class="cover-sub">Generated ${generatedAt}</p>
    <div class="cover-stats">
      <span><strong>${sessions.length}</strong> conversations</span>
      <span><strong>${totalTurns}</strong> assistant turns</span>
      <span><strong>${totalArtifacts}</strong> artifacts</span>
    </div>
  </div>

  <nav class="toc">
    <h2>Contents</h2>
    <ol>${toc}</ol>
  </nav>

  ${body}
</body>
</html>`;
}

async function main() {
  const args = parseArgs();
  console.log("[export] loading conversations…");
  const sessions = await loadConversations(args.convs, args.userId, args.sinceIso);
  if (sessions.length === 0) {
    console.error("[export] No conversations matched the filter.");
    await pool.end();
    process.exit(1);
  }
  const totalMsgs = sessions.reduce((a, s) => a + s.msgs.length, 0);
  console.log(`[export] ${sessions.length} conversations, ${totalMsgs} messages total`);

  const html = buildHtml(sessions);
  const tmpHtml = path.join(os.tmpdir(), `sessions-export-${Date.now()}.html`);
  await fs.writeFile(tmpHtml, html, "utf8");
  console.log(`[export] HTML written: ${tmpHtml} (${(html.length / 1024).toFixed(1)} KB)`);

  // Default output to ~/Desktop with a timestamped name
  const defaultOut = path.join(os.homedir(), "Desktop", `Sessions-Research-Export-${new Date().toISOString().slice(0, 10)}.pdf`);
  const outPath = args.out ? path.resolve(args.out.replace("~", os.homedir())) : defaultOut;

  console.log(`[export] launching Playwright Chromium → ${outPath}`);
  // Dynamic import so this script can dry-run the HTML without needing
  // browser binaries installed when only HTML output is desired.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("file://" + tmpHtml, { waitUntil: "load" });
  await page.pdf({
    path: outPath,
    format: "Letter",
    printBackground: true,
    margin: { top: "0.6in", bottom: "0.8in", left: "0.7in", right: "0.7in" },
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8pt; color:#94a3b8; width:100%; text-align:right; padding-right:0.7in;">Sessions Research</div>`,
    footerTemplate: `<div style="font-size:8pt; color:#94a3b8; width:100%; text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
  });
  await browser.close();

  const stats = await fs.stat(outPath);
  console.log(`[export] PDF written: ${outPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

  await pool.end();
}

main().catch((e) => { console.error("[export] failed:", e); pool.end().finally(() => process.exit(1)); });
