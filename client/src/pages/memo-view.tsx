import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import type { SessionMessage, Session } from "@/lib/research-utils";
import { parseContentAndArtifacts, extractMode, CHART_COLORS, inferFormat, formatValue } from "@/lib/research-utils";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  MarkdownText,
  MetricCards,
  InlineChart,
  InlineTable,
  CalloutBlock,
  ComparisonBlock,
  QuoteBlock,
} from "@/components/research-artifacts";

/**
 * Memo view — renders a single prompt + response as a standalone,
 * Bloomberg-article-styled page optimised for print-to-PDF.
 * Auto-triggers window.print() on load (unless ?preview=1 in URL).
 */

/**
 * Split a markdown text part into segments by H2 boundary, tagging the
 * Executive Summary and Sources blocks so they can be styled distinctly
 * from body prose. The exec-summary block is visually elevated (the
 * skim-friendly thesis card the human reviewer asked for) and the
 * sources block is rendered as a discreet provenance footer.
 */
type MemoSegmentKind = "exec_summary" | "sources" | "body";
function splitMemoSegments(text: string): Array<{ kind: MemoSegmentKind; content: string }> {
  const headingRe = /^##\s+(.+?)\s*$/gm;
  const segments: Array<{ kind: MemoSegmentKind; content: string }> = [];
  const matches: Array<{ idx: number; len: number; heading: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text)) !== null) {
    matches.push({ idx: m.index, len: m[0].length, heading: m[1].trim() });
  }
  if (matches.length === 0) {
    return [{ kind: "body", content: text }];
  }
  // Lead-in (before the first H2) is body prose.
  if (matches[0].idx > 0) {
    const lead = text.slice(0, matches[0].idx).trim();
    if (lead) segments.push({ kind: "body", content: lead });
  }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : text.length;
    const heading = matches[i].heading.toLowerCase();
    const kind: MemoSegmentKind =
      /^executive\s+summary\b/.test(heading) ? "exec_summary"
      : /^sources?\b/.test(heading) ? "sources"
      : "body";
    segments.push({ kind, content: text.slice(start, end).trim() });
  }
  return segments;
}

function MemoTextSegments({ text }: { text: string }) {
  const segments = useMemo(() => splitMemoSegments(text), [text]);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === "exec_summary") {
          return (
            <aside key={i} className="memo-exec-summary" data-testid="memo-exec-summary">
              <MarkdownText text={seg.content} />
            </aside>
          );
        }
        if (seg.kind === "sources") {
          return (
            <footer key={i} className="memo-sources" data-testid="memo-sources">
              <MarkdownText text={seg.content} />
            </footer>
          );
        }
        return <MarkdownText key={i} text={seg.content} />;
      })}
    </>
  );
}

// Snapshot a live recharts SVG to a PNG data URL. Inlines a minimal <style>
// block so fonts/fills render correctly when the SVG is read back via Image.
async function svgToPng(svg: SVGSVGElement): Promise<string> {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(rect.width || 0, 600);
  const h = Math.max(rect.height || 0, 280);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("viewBox", `0 0 ${w} ${h}`);

  // Embed font + fill defaults so the rasterised image matches the memo.
  const styleNs = "http://www.w3.org/2000/svg";
  const styleEl = document.createElementNS(styleNs, "style");
  styleEl.textContent = `
    text, tspan { font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif; font-size: 10px; fill: #333; }
    .recharts-cartesian-axis-tick text { fill: #333 !important; }
    .recharts-legend-item-text { fill: #3D5A9E !important; font-size: 10px; }
    .recharts-label, .recharts-text { fill: #333; }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  // Use utf-8 encoded data URL (handles non-ASCII chars in data labels).
  const dataUrl =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 2x DPI for crisp print
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas ctx unavailable"));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL("image/png"));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("SVG image failed to load"));
    img.src = dataUrl;
  });
}
export default function MemoView() {
  const { sessionId, msgId } = useParams<{ sessionId: string; msgId: string }>();

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
  });
  const session = useMemo(
    () => (sessionsQuery.data || []).find(s => s.id === Number(sessionId)),
    [sessionsQuery.data, sessionId],
  );

  const messagesQuery = useQuery<SessionMessage[]>({
    queryKey: [`/api/research/sessions/${sessionId}/messages`],
    enabled: !!sessionId,
  });

  // Find the target assistant message and the user prompt that preceded it.
  const { userMsg, assistantMsg } = useMemo(() => {
    const messages = messagesQuery.data || [];
    const targetId = Number(msgId);
    const idx = messages.findIndex(m => m.id === targetId);
    if (idx === -1) return { userMsg: null, assistantMsg: null };
    const assistantMsg = messages[idx];
    let userMsg: SessionMessage | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") { userMsg = messages[i]; break; }
    }
    return { userMsg, assistantMsg };
  }, [messagesQuery.data, msgId]);

  // Snapshot each live recharts SVG to a PNG data URL, then swap the live
  // chart component for a static <img> via React state. No DOM mutation,
  // no React-DOM conflict. This is how we guarantee PDF-clean charts.
  const [frozenCharts, setFrozenCharts] = useState<Record<number, string>>({});
  const printedRef = useRef(false);

  useEffect(() => {
    if (!assistantMsg) return;
    if (Object.keys(frozenCharts).length > 0) return;
    const ctrl = { cancelled: false };
    const t = setTimeout(async () => {
      const slots = document.querySelectorAll<HTMLElement>(".memo-chart-slot");
      const updates: Record<number, string> = {};
      for (const slot of Array.from(slots)) {
        const idx = Number(slot.dataset.chartIdx);
        const svg = slot.querySelector("svg");
        if (!svg) continue;
        try {
          const png = await svgToPng(svg as SVGSVGElement);
          updates[idx] = png;
        } catch (err) {
          console.warn(`[Memo] Chart ${idx} freeze failed:`, err);
        }
      }
      if (ctrl.cancelled) return;
      if (Object.keys(updates).length > 0) setFrozenCharts(updates);
      // Fire print once charts are frozen (or the attempt is done).
      const params = new URLSearchParams(window.location.search);
      if (params.get("preview") === "1") return;
      if (printedRef.current) return;
      printedRef.current = true;
      setTimeout(() => window.print(), 400);
    }, 900);
    return () => { ctrl.cancelled = true; clearTimeout(t); };
  }, [assistantMsg]);

  // All hooks must run unconditionally — derive memoised values BEFORE any
  // early returns. Guards on null message are handled inside the memos.
  // Strip em/en dashes — hard house style rule. Applied before any other
  // processing so every downstream render (headline, deck, body, artifacts)
  // sees clean text.
  const stripDashes = (s: string): string =>
    s
      .replace(/\s*\u2014\s*/g, " - ") // em dash with optional surrounding whitespace
      .replace(/\s*\u2013\s*/g, " - ") // en dash — same treatment
      .replace(/ +/g, " ");            // collapse any double-spaces the replace introduced

  const assistantCleaned = useMemo(() => {
    if (!assistantMsg) return "";
    return stripDashes(extractMode(assistantMsg.content).cleaned);
  }, [assistantMsg]);

  // Prefer the assistant's own H1 as the memo headline, and strip it from
  // the body so it doesn't render twice. Falls back to the first H2, then
  // the session title, then a truncated prompt.
  const { headline, bodyContent } = useMemo(() => {
    const content = assistantCleaned;
    // Match a leading # Title on the first non-empty line.
    const h1Match = content.match(/^\s*#\s+(.+?)\s*$/m);
    if (h1Match && content.indexOf(h1Match[0]) < 200) {
      const stripped = content.replace(h1Match[0], "").replace(/^\n+/, "");
      return { headline: h1Match[1].trim(), bodyContent: stripped };
    }
    const h2Match = content.match(/^\s*##\s+(.+?)\s*$/m);
    if (h2Match && content.indexOf(h2Match[0]) < 200) {
      const stripped = content.replace(h2Match[0], "").replace(/^\n+/, "");
      return { headline: h2Match[1].trim(), bodyContent: stripped };
    }
    const sessionTitle = stripDashes(session?.title?.trim() || "");
    if (sessionTitle && sessionTitle !== "New Session" && !sessionTitle.endsWith("…") && sessionTitle.length <= 140) {
      return { headline: sessionTitle, bodyContent: content };
    }
    // Last resort: clip prompt.
    const firstLine = content.split("\n").find(l => l.trim())?.replace(/^#+\s*/, "") || "Research Memo";
    return { headline: firstLine.slice(0, 120) + (firstLine.length > 120 ? "…" : ""), bodyContent: content };
  }, [session?.title, assistantCleaned]);

  const parts = useMemo(() => {
    if (!assistantMsg) return [];
    // Deep-strip em/en dashes from artifact string fields so titles,
    // subtitles, labels, and values render clean too.
    const cleanArtifacts = assistantMsg.artifacts
      ? JSON.parse(stripDashes(JSON.stringify(assistantMsg.artifacts)))
      : assistantMsg.artifacts;
    return parseContentAndArtifacts(bodyContent, cleanArtifacts);
  }, [assistantMsg, bodyContent]);

  // Browser's Save-as-PDF default filename comes from document.title.
  // Declared AFTER the `headline` memo so its dependency is initialised.
  useEffect(() => {
    if (!headline || !assistantMsg) return;
    const prev = document.title;
    const safe = headline
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    const datePart = assistantMsg.createdAt
      ? format(new Date(assistantMsg.createdAt), "yyyy-MM-dd")
      : "";
    const titleStr = [safe, datePart].filter(Boolean).join(" - ");
    document.title = titleStr || prev;
    return () => { document.title = prev; };
  }, [headline, assistantMsg]);

  const isLoading = sessionsQuery.isLoading || messagesQuery.isLoading;

  if (isLoading) {
    return (
      <div className="memo-loading">
        <Loader2 className="animate-spin" style={{ width: 24, height: 24 }} />
      </div>
    );
  }

  if (!assistantMsg) {
    return (
      <div className="memo-loading">
        <p>Message not found.</p>
        <a href="/research" className="memo-link-back">
          <ArrowLeft size={14} /> Back
        </a>
      </div>
    );
  }

  // Deck: the user's actual prompt, truncated and normalised.
  const deck = stripDashes((userMsg?.content || "").trim()).slice(0, 320);

  const issueDate = assistantMsg.createdAt
    ? format(new Date(assistantMsg.createdAt), "MMMM d, yyyy")
    : "";

  return (
    <>
      <MemoStyles />
      <div className="memo-wrap">
        {/* Screen-only toolbar; hidden in print */}
        <div className="memo-toolbar" aria-hidden>
          <a href="/library" className="memo-link-back">
            <ArrowLeft size={14} /> Back to library
          </a>
          <button
            className="memo-print-btn"
            onClick={() => window.print()}
            data-testid="button-memo-print"
          >
            <Printer size={14} />
            Print / Save as PDF
          </button>
        </div>

        <article className="memo" data-testid="memo-article">
          <header className="memo-masthead">
            <div className="memo-masthead-brand">
              <span className="memo-dot" />
              <span className="memo-brand-name">SESSIONS</span>
              <span className="memo-brand-sep">·</span>
              <span className="memo-brand-kicker">THE PERSPECTIVE LAYER</span>
            </div>
            <div className="memo-masthead-issue">
              <span className="memo-issue-label">RESEARCH MEMO</span>
              {issueDate && <span className="memo-issue-date">{issueDate}</span>}
            </div>
          </header>

          <div className="memo-rule-thick" />

          <div className="memo-kicker">INTERNAL RESEARCH NOTE</div>
          <h1 className="memo-headline">{headline}</h1>
          {deck && <p className="memo-deck">{deck}</p>}

          <div className="memo-byline">
            <span>By <strong>Sessions Research</strong></span>
            <span className="memo-byline-sep">·</span>
            <span>AI-synthesised · human-verified</span>
            {issueDate && (
              <>
                <span className="memo-byline-sep">·</span>
                <time>{issueDate}</time>
              </>
            )}
          </div>

          <div className="memo-body" data-testid="memo-body">
            {parts.map((part, i) => {
              const renderPart = () => {
              if (part.type === "text" && part.content) return <MemoTextSegments key={i} text={part.content} />;
              if (part.type === "metric_cards" && part.artifact) return <MetricCards key={i} artifact={part.artifact} />;
              if (part.type === "chart" && part.artifact) {
                // Frozen: render a memo-native card with the snapshot image.
                if (frozenCharts[i]) {
                  const art = part.artifact as any;
                  const yAxes: any[] = art.chartConfig?.yAxes || [];
                  const data: any[] = art.data || [];
                  const latestRow = data[data.length - 1];
                  // Pick the first series' latest value for the top-right callout.
                  const primaryKey = yAxes[0]?.dataKey;
                  const primaryFmt = inferFormat(primaryKey, yAxes[0]?.label, yAxes[0]?.format);
                  const latestVal =
                    latestRow && primaryKey != null ? latestRow[primaryKey] : undefined;
                  const latestStr =
                    latestVal !== undefined && latestVal !== null
                      ? formatValue(latestVal, primaryFmt)
                      : null;
                  return (
                    <figure key={i} className="memo-chart-card">
                      <figcaption className="memo-chart-caption">
                        <div className="memo-chart-caption-text">
                          {art.title && <div className="memo-chart-title">{art.title}</div>}
                          {art.subtitle && <div className="memo-chart-subtitle">{art.subtitle}</div>}
                        </div>
                        {latestStr && (
                          <div className="memo-chart-latest">
                            <span className="memo-chart-latest-value">{latestStr}</span>
                            <span className="memo-chart-latest-label">Latest</span>
                          </div>
                        )}
                      </figcaption>
                      <img
                        src={frozenCharts[i]}
                        alt={art.title || "chart"}
                        className="memo-chart-img"
                      />
                      {yAxes.length > 0 && (
                        <div className="memo-chart-legend">
                          {yAxes.map((y: any, li: number) => (
                            <div key={li} className="memo-chart-legend-item">
                              <span
                                className="memo-chart-legend-swatch"
                                style={{ background: CHART_COLORS[li % CHART_COLORS.length] }}
                              />
                              <span className="memo-chart-legend-label">
                                {y.label || y.dataKey}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {art.source && (
                        <div className="memo-chart-source">Source: {art.source}</div>
                      )}
                    </figure>
                  );
                }
                // Not yet frozen: render the live recharts in a slot we can find.
                return (
                  <div key={i} className="memo-chart-slot" data-chart-idx={i}>
                    <InlineChart artifact={part.artifact} hideSave compact />
                  </div>
                );
              }
              if (part.type === "table" && part.artifact) return <InlineTable key={i} artifact={part.artifact} />;
              if (part.type === "callout" && part.artifact) return <CalloutBlock key={i} artifact={part.artifact} />;
              if (part.type === "comparison" && part.artifact) return <ComparisonBlock key={i} artifact={part.artifact} />;
              if (part.type === "quote" && part.artifact) return <QuoteBlock key={i} artifact={part.artifact} />;
              return null;
              };
              const rendered = renderPart();
              return rendered == null
                ? null
                : <ErrorBoundary key={`eb-${i}`} label={part.type}>{rendered}</ErrorBoundary>;
            })}
          </div>

          <footer className="memo-colophon">
            <div className="memo-rule-thin" />
            <div className="memo-colophon-row">
              <span className="memo-colophon-brand">SESSIONS</span>
              <span className="memo-colophon-note">
                Compiled from one research session · every figure sourced from live data tools ·
                methodology rules enforced via brain
              </span>
            </div>
          </footer>
        </article>
      </div>
    </>
  );
}

function MemoStyles() {
  return (
    <style>{`
      /* Carlito is metric-compatible with Calibri — renders identically on
         machines without Calibri and matches perfectly on Windows/Office.
         Italic + 400/700 covers our needs. */
      @import url('https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,700;1,400;1,700&display=swap');

      /* ───── Memo design tokens ───── */
      .memo-wrap {
        --ink: #111;
        --ink-soft: #444;
        --ink-mute: #777;
        --rule: #d4d4d4;
        --rule-strong: #111;
        --paper: #ffffff;
        --wash: #f6f5f2;
        --accent: #3D5A9E;      /* dark chart blue — use for text */
        --accent-light: #6B8DE3; /* primary chart blue — use for rules/fills */
        --accent-wash: #eef2fb;  /* very pale tint — subtle backgrounds */
      }

      /* ───── Screen layout ───── */
      .memo-loading {
        display: flex; flex-direction: column; gap: 12px;
        align-items: center; justify-content: center;
        min-height: 60vh; color: #666;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
      }

      .memo-wrap {
        background: #e8e6e0;
        min-height: 100vh;
        padding: 24px 16px 80px;
        overflow-y: auto;
      }

      .memo-toolbar {
        max-width: 720px;
        margin: 0 auto 16px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 12px;
      }
      .memo-link-back {
        color: #6b6458;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
      }
      .memo-link-back:hover { color: #1a1a1a; }
      .memo-print-btn {
        background: #1a1a1a;
        color: #fafafa;
        border: none;
        padding: 8px 14px;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 2px;
      }
      .memo-print-btn:hover { background: #000; }

      /* ───── The memo itself ───── */
      .memo {
        max-width: 720px;
        margin: 0 auto;
        background: #ffffff;
        padding: 48px 56px 40px;
        color: #111;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 10.5pt;
        line-height: 1.55;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.05), 0 8px 28px rgba(0,0,0,0.08);
      }

      .memo-masthead {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9.5pt;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #444;
        margin-bottom: 6px;
      }
      .memo-masthead-brand {
        display: flex; align-items: baseline; gap: 8px;
      }
      .memo-dot { display: none; }
      .memo-brand-name { font-weight: 700; letter-spacing: 0.18em; color: #111; }
      .memo-brand-sep { color: #aaa; }
      .memo-brand-kicker { color: #777; }
      .memo-issue-label {
        font-weight: 700;
        color: #3D5A9E;
        margin-right: 10px;
      }
      .memo-issue-date { color: #777; letter-spacing: 0.04em; text-transform: none; font-variant: all-small-caps; letter-spacing: 0.08em; }

      .memo-rule-thick {
        height: 1.5px;
        background: #111;
        margin: 4px 0 20px;
      }
      .memo-rule-thin {
        height: 1px;
        background: #d4d4d4;
        margin: 20px 0;
      }

      .memo-kicker {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #3D5A9E;
        margin-bottom: 10px;
      }
      .memo-headline {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-weight: 700;
        font-size: 24pt;
        line-height: 1.18;
        letter-spacing: -0.005em;
        color: #0a0a0a;
        margin: 0 0 12px;
      }
      .memo-deck {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-style: italic;
        font-weight: 400;
        font-size: 12pt;
        line-height: 1.5;
        color: #444;
        margin: 0 0 18px;
        max-width: 95%;
      }
      .memo-byline {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt;
        letter-spacing: 0.03em;
        color: #777;
        display: flex;
        gap: 8px;
        align-items: baseline;
        flex-wrap: wrap;
      }
      .memo-byline strong { color: #111; font-weight: 600; }
      .memo-byline-sep { color: #bbb; }

      /* ───── Executive summary block ─────
         The skim-friendly thesis card. Distinct from body prose so a
         busy reader gets the headline + key numbers + watchlist + bottom
         line in one glance. */
      .memo-exec-summary {
        background: #f6f5f2;
        border-left: 3px solid #3D5A9E;
        padding: 14px 18px 10px;
        margin: 18px 0 22px;
        page-break-inside: avoid;
      }
      .memo-exec-summary h2 {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #3D5A9E !important;
        margin: 0 0 8px !important;
        padding-bottom: 0 !important;
        border-bottom: none !important;
      }
      .memo-exec-summary ul {
        margin: 0 !important;
        padding-left: 0 !important;
        list-style: none !important;
      }
      .memo-exec-summary li {
        margin: 4px 0 !important;
        padding-left: 0 !important;
        font-size: 10.5pt;
        line-height: 1.45;
        color: #111 !important;
      }
      .memo-exec-summary li::marker { content: ""; }
      .memo-exec-summary li strong { color: #3D5A9E; font-weight: 700; }

      /* ───── Sources / audit trail ───── */
      .memo-sources {
        margin-top: 28px;
        padding-top: 14px;
        border-top: 1px solid #d4d4d4;
        font-size: 9pt;
        line-height: 1.5;
        color: #555;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
      }
      .memo-sources h2 {
        font-size: 8.5pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: #777 !important;
        margin: 0 0 8px !important;
        padding-bottom: 0 !important;
        border-bottom: none !important;
      }
      .memo-sources ul {
        margin: 0 !important;
        padding-left: 16px !important;
      }
      .memo-sources li {
        margin: 2px 0 !important;
        font-size: 9pt !important;
        color: #555 !important;
        line-height: 1.5 !important;
      }
      .memo-sources li strong { color: #333; }

      /* ───── Body copy ───── */
      .memo-body {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 10.5pt;
        line-height: 1.5;
        color: #111;
      }
      /* Consistent rhythm between blocks */
      .memo-body > * { margin-top: 0; }
      .memo-body > * + * { margin-top: 10px; }
      .memo-body > * + h1,
      .memo-body > * + h2,
      .memo-body > * + h3 { margin-top: 18px; }
      .memo-body h1, .memo-body h2, .memo-body h3 {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        color: #0a0a0a;
        page-break-after: avoid;
      }
      .memo-body h1 {
        font-size: 14pt; font-weight: 700;
        margin: 22px 0 6px;
        color: #0a0a0a !important;
      }
      .memo-body h2 {
        font-size: 12pt; font-weight: 700;
        margin: 20px 0 6px;
        padding-bottom: 3px;
        border-bottom: 1px solid #3D5A9E;
        color: #3D5A9E !important;
      }
      .memo-body h3 {
        font-size: 10.5pt; font-weight: 700;
        margin: 16px 0 4px;
        color: #3D5A9E !important;
        text-transform: none;
      }
      .memo-body h4, .memo-body h5, .memo-body h6 {
        font-size: 10pt; font-weight: 700;
        margin: 14px 0 4px;
        color: #0a0a0a !important;
      }
      .memo-body p { margin: 0 0 9px; orphans: 3; widows: 3; color: #111 !important; }
      /* Kill any Tailwind alpha-fade classes that bleed through MarkdownText */
      .memo-body :is(p, li, span, h1, h2, h3, h4, h5, h6)[class*="text-foreground/"],
      .memo-body :is(p, li, span, h1, h2, h3, h4, h5, h6)[class*="text-muted-foreground"] {
        color: #111 !important;
        opacity: 1 !important;
      }
      .memo-body strong { font-weight: 700; color: #000; }
      .memo-body em { color: #222; }
      .memo-body ul, .memo-body ol {
        margin: 4px 0 10px;
        padding-left: 18px;
      }
      .memo-body li {
        margin: 2px 0;
        color: #111 !important;
        font-size: 10.5pt;
        line-height: 1.5;
      }
      .memo-body li::marker { color: #888; }
      .memo-body li > strong { color: #000 !important; }
      /* Kill accidental double margins from consecutive blocks */
      .memo-body > div > *:first-child { margin-top: 0 !important; }
      .memo-body a { color: #3D5A9E; text-decoration: underline; text-decoration-color: #a7b8d9; }
      .memo-body code {
        font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
        font-size: 9.5pt;
        background: #f2f1ec;
        padding: 1px 4px;
        border-radius: 1px;
        color: #111;
      }

      /* ───── TABLES — single unified format for the entire memo ─────
         Applies identically to markdown tables and InlineTable artifacts.
         One font, one padding, one rule weight. No zebra, no card chrome. */
      .memo-body table,
      .memo-body [data-testid="inline-table"] table {
        all: revert;
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 14px 0 !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 9.5pt !important;
        background: transparent !important;
        border-top: 1.5px solid #111 !important;
        border-bottom: 1.5px solid #111 !important;
      }
      .memo-body thead th {
        text-align: left !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 9pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.04em !important;
        text-transform: uppercase !important;
        color: #3D5A9E !important;
        padding: 6px 10px !important;
        background: transparent !important;
        border-bottom: 1px solid #3D5A9E !important;
        vertical-align: bottom !important;
      }
      .memo-body tbody td {
        padding: 6px 10px !important;
        border-bottom: 1px solid #e5e5e5 !important;
        vertical-align: top !important;
        color: #111 !important;
        background: transparent !important;
        font-size: 9.5pt !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-weight: 400 !important;
      }
      .memo-body tbody tr:last-child td { border-bottom: none !important; }
      .memo-body tbody tr:nth-child(even) td { background: transparent !important; }
      .memo-body tbody tr:hover td { background: transparent !important; }
      .memo-body tbody td:first-child { font-weight: 600 !important; color: #0a0a0a !important; }
      .memo-body td, .memo-body th { font-variant-numeric: tabular-nums !important; }
      /* Tighten the InlineTable's max-height (no internal scroll in a static memo) */
      .memo-body div[class*="overflow-x-auto"],
      .memo-body div[class*="overflow-y-auto"] {
        overflow: visible !important;
        max-height: none !important;
      }

      /* ═════════════════════════════════════════════════════════════
         ARTIFACT RESTYLES — force dark-UI components to memo light-mode
         Every rule uses !important because upstream components set
         Tailwind class colors that otherwise bleed through.
         ═════════════════════════════════════════════════════════════ */

      /* ───── MetricCards — rendered as a simple 3-col memo table ───── */
      .memo-body [data-testid="metric-cards"] { margin: 14px 0 18px; }
      .memo-body [data-testid="metric-cards"] > h4 {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 9pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.04em !important;
        text-transform: uppercase !important;
        color: #3D5A9E !important;
        margin: 0 0 6px !important;
        padding-bottom: 3px !important;
        border-bottom: 1px solid #3D5A9E !important;
      }
      /* Override the grid — make each card a table row */
      .memo-body [data-testid="metric-cards"] > div:last-child {
        all: unset !important;
        display: table !important;
        width: 100% !important;
        border-collapse: collapse !important;
        border-top: 1.5px solid #111 !important;
        border-bottom: 1.5px solid #111 !important;
        grid-template-columns: unset !important;
      }
      .memo-body [data-testid="metric-cards"] > div:last-child > div {
        all: unset !important;
        display: table-row !important;
        background: transparent !important;
      }
      .memo-body [data-testid="metric-cards"] > div:last-child > div > p {
        all: unset !important;
        display: table-cell !important;
        padding: 6px 10px !important;
        border-bottom: 1px solid #e5e5e5 !important;
        vertical-align: middle !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        color: #111 !important;
      }
      /* Last row — no bottom rule, parent table handles it */
      .memo-body [data-testid="metric-cards"] > div:last-child > div:last-child > p {
        border-bottom: none !important;
      }
      /* Label cell (left) */
      .memo-body [data-testid="metric-cards"] > div:last-child > div > p:nth-child(1) {
        width: 38% !important;
        font-size: 9pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.04em !important;
        text-transform: uppercase !important;
        color: #3D5A9E !important;
      }
      /* Value cell (middle) */
      .memo-body [data-testid="metric-cards"] > div:last-child > div > p:nth-child(2) {
        width: 28% !important;
        font-size: 10.5pt !important;
        font-weight: 700 !important;
        color: #0a0a0a !important;
        font-variant-numeric: tabular-nums !important;
      }
      /* Subtitle cell (right) */
      .memo-body [data-testid="metric-cards"] > div:last-child > div > p:nth-child(3) {
        width: 34% !important;
        font-size: 9.5pt !important;
        font-style: italic !important;
        color: #555 !important;
      }

      /* ───── InlineChart — white card, thin border, dark text ───── */
      .memo-body .recharts-wrapper { margin: 6px 0 0 !important; }
      .memo-body .recharts-surface { overflow: visible !important; }
      /* Outermost chart wrapper (has rounded-lg + bg-card/40 classes) */
      .memo-body [data-slot="card"],
      .memo-body :is(div).rounded-lg.border {}
      .memo-body :is(div:has(> [data-testid="text-chart-title"])) {
        /* ensure title area uses memo typography */
      }
      .memo-body [data-testid="text-chart-title"] {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 11pt !important;
        font-weight: 700 !important;
        color: #3D5A9E !important;
        letter-spacing: 0 !important;
      }
      /* Chart subtitle — accent, uppercase, smaller */
      .memo-body [data-testid="text-chart-title"] + p,
      .memo-body p.text-emerald-400 {
        color: #6B8DE3 !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-weight: 600 !important;
        letter-spacing: 0.06em !important;
      }
      /* Recharts text — ticks / legend / labels */
      .memo-body .recharts-cartesian-axis-tick text,
      .memo-body .recharts-legend-item-text,
      .memo-body .recharts-text {
        fill: #333 !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 9px !important;
      }
      .memo-body .recharts-cartesian-grid-horizontal line,
      .memo-body .recharts-cartesian-grid-vertical line {
        stroke: #e5e5e5 !important;
      }
      .memo-body .recharts-cartesian-axis-line,
      .memo-body .recharts-cartesian-axis-tick-line {
        stroke: #bbb !important;
      }
      /* The whole chart wrapper card */
      .memo-body div[style*="overflow: visible"].rounded-lg,
      .memo-body div.rounded-lg.border.shadow-sm {
        background: #fff !important;
        border: 1px solid #111 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
        padding: 14px 14px 10px !important;
      }
      /* Latest value in top-right — force dark */
      .memo-body p.font-bold.font-mono {
        color: #0a0a0a !important;
      }
      /* Hide Save button + chart-type toggle in the memo */
      .memo-body [data-testid="button-save-chart"],
      .memo-body [data-testid="chart-type-toggle"] {
        display: none !important;
      }

      /* ───── InlineTable — strip card chrome, add memo ruling ───── */
      .memo-body div.rounded-lg.border.shadow-sm:has(> div > table),
      .memo-body div.rounded-lg.border.overflow-hidden:has(> div > table) {
        background: #fff !important;
        border: none !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .memo-body div:has(> div > table) > h4 {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 10.5pt !important;
        font-weight: 700 !important;
        color: #0a0a0a !important;
        margin: 10px 0 4px !important;
        padding: 0 !important;
      }
      .memo-body table {
        border-top: 1.5px solid #111 !important;
        border-bottom: 1.5px solid #111 !important;
      }
      .memo-body thead tr,
      .memo-body tbody tr {
        background: transparent !important;
      }
      .memo-body thead th {
        background: transparent !important;
        color: #555 !important;
        border-bottom: 1px solid #111 !important;
      }
      .memo-body tbody td {
        color: #111 !important;
        border-bottom: 1px solid #eee !important;
      }
      .memo-body tbody tr:nth-child(even) {
        background: transparent !important;
      }
      .memo-body tbody tr:hover { background: transparent !important; }

      /* ───── Callout — memo aside, restrained ───── */
      .memo-body [data-testid^="callout-"] {
        all: unset !important;
        display: block !important;
        margin: 14px 0 !important;
        padding: 10px 14px !important;
        border-left: 2px solid #111 !important;
        background: #f6f5f2 !important;
        color: #111 !important;
      }
      .memo-body [data-testid^="callout-"] > div:first-child {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin-bottom: 4px !important;
      }
      .memo-body [data-testid^="callout-"] > div:first-child svg {
        color: #111 !important; width: 11px !important; height: 11px !important;
      }
      .memo-body [data-testid^="callout-"] > div:first-child span {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 8.5pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.14em !important;
        text-transform: uppercase !important;
        color: #111 !important;
      }
      .memo-body [data-testid^="callout-"] > p {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 10pt !important;
        color: #111 !important;
        line-height: 1.5 !important;
        margin: 0 !important;
      }

      /* ───── Comparison — two-column, black rules ───── */
      .memo-body [data-testid="comparison-block"] {
        all: unset !important;
        display: block !important;
        margin: 16px 0 !important;
        border-top: 1.5px solid #111 !important;
        border-bottom: 1.5px solid #111 !important;
        background: transparent !important;
      }
      .memo-body [data-testid="comparison-block"] > div:first-child {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 10pt !important;
        font-weight: 700 !important;
        color: #0a0a0a !important;
        padding: 6px 0 6px !important;
        border-bottom: 1px solid #111 !important;
      }
      .memo-body [data-testid="comparison-block"] > div:last-child {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 0 !important;
      }
      .memo-body [data-testid="comparison-block"] > div:last-child > div {
        padding: 10px 12px 10px 0 !important;
        border-right: 1px solid #e5e5e5 !important;
      }
      .memo-body [data-testid="comparison-block"] > div:last-child > div + div {
        padding-left: 12px !important;
        padding-right: 0 !important;
        border-right: none !important;
      }
      .memo-body [data-testid="comparison-block"] > div:last-child > div > div:first-child {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 8pt !important;
        font-weight: 700 !important;
        letter-spacing: 0.1em !important;
        text-transform: uppercase !important;
        color: #3D5A9E !important;
        margin-bottom: 6px !important;
      }
      .memo-body [data-testid="comparison-block"] ul { list-style: none !important; padding: 0 !important; margin: 0 !important; }
      .memo-body [data-testid="comparison-block"] li {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-size: 9.5pt !important;
        color: #111 !important;
        line-height: 1.45 !important;
        padding: 2px 0 !important;
        display: flex !important;
        gap: 6px !important;
      }
      .memo-body [data-testid="comparison-block"] li > span:first-child {
        color: #888 !important;
      }

      /* ───── Quote — restrained serif pull-quote ───── */
      .memo-body [data-testid="quote-block"],
      .memo-body blockquote {
        all: unset !important;
        display: block !important;
        margin: 16px 0 !important;
        padding: 2px 0 2px 14px !important;
        border-left: 2px solid #111 !important;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif !important;
        font-style: italic !important;
        font-size: 11pt !important;
        line-height: 1.45 !important;
        color: #222 !important;
      }

      /* ───── Memo-native chart card (used once chart is frozen to PNG) ───── */
      .memo-chart-card {
        margin: 18px 0 22px;
        padding: 0;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .memo-chart-caption {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 0 0 6px;
        border-bottom: 1px solid #3D5A9E;
        margin-bottom: 10px;
      }
      .memo-chart-caption-text { flex: 1; min-width: 0; }
      .memo-chart-title {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 11.5pt;
        font-weight: 700;
        color: #3D5A9E;
        margin: 0;
        line-height: 1.25;
      }
      .memo-chart-subtitle {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 8.5pt;
        font-weight: 600;
        color: #6B8DE3;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        margin: 3px 0 0;
      }
      .memo-chart-latest {
        text-align: right;
        shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        line-height: 1;
      }
      .memo-chart-latest-value {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 14pt;
        font-weight: 700;
        color: #0a0a0a;
        font-variant-numeric: tabular-nums;
      }
      .memo-chart-latest-label {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 8pt;
        color: #777;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        margin-top: 2px;
      }
      .memo-chart-img {
        display: block;
        width: 100%;
        max-width: 100%;
        height: auto;
      }
      .memo-chart-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px 18px;
        padding: 6px 0 0;
        border-top: 1px solid #e5e5e5;
        margin-top: 6px;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 9pt;
        color: #333;
      }
      .memo-chart-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .memo-chart-legend-swatch {
        display: inline-block;
        width: 14px;
        height: 2px;
        background: #6B8DE3;
        border-radius: 1px;
      }
      .memo-chart-legend-label {
        font-weight: 500;
        color: #333;
      }
      .memo-chart-source {
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 8pt;
        color: #888;
        font-style: italic;
        margin-top: 6px;
      }
      /* Live-chart slot (shown briefly before freeze completes) */
      .memo-chart-slot { min-height: 280px; }

      .memo-colophon { margin-top: 36px; }
      .memo-colophon-row {
        display: flex; gap: 12px; align-items: baseline;
        font-family: 'Calibri', 'Carlito', 'Helvetica Neue', Arial, sans-serif;
        font-size: 8.5pt;
        color: #777;
      }
      .memo-colophon-brand {
        font-weight: 700;
        letter-spacing: 0.16em;
        color: #111;
      }
      .memo-colophon-note { flex: 1; font-size: 8pt; }

      /* ───── Print ───── */
      @page {
        size: Letter;
        margin: 0.75in;
      }

      @media print {
        /* Stop every ancestor from clipping or reserving sidebar space */
        html, body, #root, #root > div, #root > div > div,
        main, .memo-wrap,
        [class*="flex h-screen"], [class*="flex flex-col"] {
          background: #fff !important;
          overflow: visible !important;
          height: auto !important;
          max-height: none !important;
          min-height: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          position: static !important;
          display: block !important;
          flex: initial !important;
          grid-template-columns: none !important;
        }
        /* Neutralise the SidebarProvider's width reservation */
        :root, [style*="--sidebar-width"] {
          --sidebar-width: 0 !important;
          --sidebar-width-icon: 0 !important;
        }
        /* Hide app chrome when printing. shadcn/ui sidebar uses data-slot
           (not data-sidebar) on the outer wrappers, and data-slot="sidebar-
           container" has a border-r that was bleeding through as a vertical
           line on every page — catch all of them. */
        [data-sidebar],
        [data-slot="sidebar"],
        [data-slot="sidebar-gap"],
        [data-slot="sidebar-container"],
        [data-slot="sidebar-inset"],
        [data-testid="button-sidebar-toggle"],
        .memo-toolbar,
        header:not(.memo-masthead) {
          display: none !important;
          border: none !important;
        }
        .memo-wrap {
          padding: 0 !important;
          margin: 0 !important;
        }
        .memo {
          max-width: 100% !important;
          width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          outline: none !important;
          border: none !important;
          background: #fff !important;
          font-size: 10pt;
        }
        /* Strip any border/shadow/outline from every element inside the memo
           in print — vertical rules on the page edge come from stray card
           wrappers (border-left on charts, tables, callouts) being left over. */
        .memo * {
          box-shadow: none !important;
          outline: none !important;
        }
        /* Keep only the borders/rules we explicitly want in print */
        .memo-body :is(div, section, article):not(table):not(thead):not(tbody):not(tr):not(td):not(th):not([data-testid^="callout-"]):not([data-testid="comparison-block"]):not([data-testid="metric-cards"] > div):not(blockquote) {
          border: none !important;
        }
        .memo-chart-img { max-width: 100% !important; height: auto !important; break-inside: avoid; }
        /* Chart print size — full page width, taller now that each chart
           lands on its own page section (cover page absorbs whitespace). */
        .memo-body .recharts-responsive-container {
          width: 100% !important;
          min-width: 0 !important;
          height: 280px !important;
          overflow: hidden !important;
          page-break-inside: avoid !important;
        }
        .memo-body .recharts-wrapper,
        .memo-body .recharts-surface {
          width: 100% !important;
          height: 280px !important;
          overflow: hidden !important;
        }
        /* Clip any SVG element that would otherwise overflow its container
           and bleed into page margins (the "mystery vertical line" source). */
        .memo-body svg { overflow: hidden !important; }
        /* Every major block stays whole. Cover page absorbs the "wasted"
           space from charts jumping to their own page, so no ugly gaps. */
        .memo-body [data-testid="metric-cards"],
        .memo-body [data-testid^="callout-"],
        .memo-body [data-testid="comparison-block"],
        .memo-body table,
        .memo-body div.rounded-lg {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        /* Cover page: masthead, kicker, headline, deck, byline only.
           Body content starts on page 2. */
        .memo-body {
          break-before: page !important;
          page-break-before: always !important;
        }
        /* Tables can legitimately span pages if they're very long — repeat
           the header row on each subsequent page */
        .memo-body thead { display: table-header-group !important; }
        .memo-body tr { page-break-inside: avoid !important; }
        .memo-headline {
          font-size: 22pt;
          line-height: 1.18;
        }
        .memo-deck { font-size: 11pt; }
        .memo-body h1 { font-size: 13pt; }
        .memo-body h2 { font-size: 12pt; }
        .memo-body h3 { font-size: 10.5pt; }
        .memo-body img, .memo-body svg,
        .memo-body .recharts-wrapper,
        .memo-body table {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      }
    `}</style>
  );
}
