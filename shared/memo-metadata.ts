/**
 * Extract a memo's display title + description from the raw assistant
 * message content. Shared between the save-to-report endpoint (writes
 * initial rows) and the reports list endpoint (recomputes on read so
 * older memos get the fix without a migration).
 */

const MAX_TITLE = 90;
const MAX_DESCRIPTION = 220;

function truncateOnWord(s: string, limit: number): string {
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit).replace(/\s+\S*$/, "");
  return (cut || s.slice(0, limit)) + "…";
}

function stripMarkdownNoise(s: string): string {
  return s
    // Fenced artifact / code blocks. The assistant emits
    // ```artifact:metric_cards {...}``` that would otherwise dominate the preview.
    .replace(/```[\s\S]*?```/g, " ")
    // Inline markdown tables — pipe rows render as gibberish when flattened.
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    // Heading markers
    .replace(/^#+\s*/gm, "")
    // Bold / italic / inline code markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    // Markdown images / links: keep the label only
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // HTML-style comments (mode markers etc.)
    .replace(/<!--[\s\S]*?-->/g, " ")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface MemoMetadata {
  title: string;
  description: string;
}

/**
 * Given the raw assistant message content (and optionally the session
 * title it lives under), return a display-ready title and description.
 * Prefers the assistant's own H1/H2 over the session title so memos
 * like "Jupiter: Revenue Streams" surface cleanly instead of the
 * conversation's original prompt.
 */
export function extractMemoMetadata(
  rawContent: string,
  conversationTitle?: string | null,
): MemoMetadata {
  const content = (rawContent || "")
    .replace(/^<!--\s*mode:\w+\s*-->\s*\n?/, "")
    .replace(/\s*[\u2013\u2014]\s*/g, " - "); // normalise em/en dashes

  // Assistant-authored headline wins — H1, then H2, then the session
  // title, then a best-effort first-line. Headlines found past char 200
  // are almost always mid-body and shouldn't be treated as the title.
  let assistantTitle: string | null = null;
  const h1 = content.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1 && content.indexOf(h1[0]) < 200) {
    assistantTitle = h1[1].trim();
  } else {
    const h2 = content.match(/^\s*##\s+(.+?)\s*$/m);
    if (h2 && content.indexOf(h2[0]) < 200) assistantTitle = h2[1].trim();
  }

  const sessionTitle = (conversationTitle || "").trim();
  const sessionOk =
    sessionTitle &&
    sessionTitle !== "New Session" &&
    !sessionTitle.endsWith("…") &&
    sessionTitle.length <= 140;

  const fallbackFromContent = (() => {
    const line = content
      .split("\n")
      .map(l => l.trim())
      .find(l => l.length > 0 && !l.startsWith("```"));
    return line ? line.replace(/^#+\s*/, "") : "";
  })();

  const rawTitle =
    assistantTitle || (sessionOk ? sessionTitle : "") || fallbackFromContent || "Research Memo";
  const title = truncateOnWord(rawTitle, MAX_TITLE);

  // For the description, drop the headline line (if we used one from the
  // content) before flattening so the description isn't just the title repeated.
  const withoutHeadline = assistantTitle
    ? content.replace(h1 ? h1[0] : content.match(/^\s*##\s+.+$/m)?.[0] || "", "")
    : content;

  // If the assistant produced an Executive Summary block (per DEEP_RULES),
  // prefer its **Headline:** bullet over a fished-from-prose deck. This
  // gives memos an analyst-grade lead without any heuristic guessing.
  const execSummary = extractExecSummaryHeadline(content);
  if (execSummary) {
    return { title, description: truncateOnWord(execSummary, MAX_DESCRIPTION) };
  }

  const cleaned = stripMarkdownNoise(withoutHeadline);
  const description = truncateOnWord(extractDeckSentence(cleaned), MAX_DESCRIPTION);

  return { title, description };
}

/**
 * Pull the **Headline:** bullet out of an Executive Summary block. The
 * agent's DEEP_RULES require this exact shape:
 *
 *   ## Executive Summary
 *   - **Headline:** <one-sentence thesis>
 *   - **Key numbers:** ...
 *   - **Watchlist:** ...
 *   - **Bottom line:** ...
 *
 * If a Headline bullet is missing, fall through to the next-best bullet
 * (Bottom line) so we still get a thesis-quality deck. Returns null when
 * no Executive Summary section exists at all.
 */
function extractExecSummaryHeadline(content: string): string | null {
  const sectionMatch = content.match(
    /^\s*##\s+Executive\s+Summary\s*\n([\s\S]*?)(?:\n##\s|\n```|$)/im,
  );
  if (!sectionMatch) return null;
  const block = sectionMatch[1];

  const headline = block.match(/^\s*[-*]\s+\*\*Headline:\*\*\s*(.+?)\s*$/im);
  if (headline) return cleanInlineMarkdown(headline[1]);

  const bottomLine = block.match(/^\s*[-*]\s+\*\*Bottom\s+line:\*\*\s*(.+?)\s*$/im);
  if (bottomLine) return cleanInlineMarkdown(bottomLine[1]);

  return null;
}

function cleanInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// A paragraph that's short, single-line, and has no terminating punctuation
// is almost always a heading, a list item header, or a label — skip it when
// choosing the description. Also skip numbered section titles like
// "1. Revenue Streams - Three Distinct Businesses".
function isLikelyHeading(p: string): boolean {
  if (p.length === 0) return true;
  if (/\n/.test(p)) return false; // multi-line → real paragraph
  if (p.length < 90 && !/[.!?]/.test(p)) return true;
  if (/^\d+\.\s+\S+(\s+\S+){0,8}$/.test(p) && !/[.!?]$/.test(p)) return true;
  return false;
}

// Leading sentences that exist only to acknowledge the user or set up the
// real answer ("Yes,", "Now I have …", "Let me revise …", "You were right
// to push back") — these are conversational scaffolding and make a poor
// standalone deck. Drop them when a later sentence carries actual content.
const META_SENTENCE_RE =
  /^(yes[,.]|no[,.]|sure[,.!]|okay[,.!]|ok[,.!]|got it|understood|thanks|thank you|great question|good question|absolutely|exactly|right[,.!]|correct[,.!]|you'?re (right|correct)|you were (right|correct)|you('?ve| have) (been )?right|let me (revise|re-?do|clarify|check|dig|look|walk you|explain)|i('?ll| will) (revise|redo|clarify|check|dig|look|walk you|explain)|here'?s (the|what|why|how|a)|now (i|that|let)|so,?\s)/i;
const META_PHRASE_RE =
  /\b(push(ed)? back|earlier (deep dive|answer|response|message|pass)|my (earlier|previous) (answer|response|take|message)|revised? (answer|response|take|analysis)|reconciliation|walk you through|let'?s revise)\b/i;

function isMetaSentence(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 25) return true; // too short to be a deck
  if (META_SENTENCE_RE.test(trimmed)) return true;
  if (META_PHRASE_RE.test(trimmed)) return true;
  return false;
}

// Sentence splitter that keeps ASCII punctuation but doesn't break on
// decimals ("$1.79B"), initials, or abbreviations in a disruptive way.
function splitSentences(text: string): string[] {
  return text
    .replace(/([.!?])\s+(?=[A-Z0-9$"'])/g, "$1\n")
    .split(/\n/)
    .map(s => s.trim())
    .filter(Boolean);
}

// "Let me revise the earlier deep dive: TradeXYZ's entire $1.79B …"
//  → "TradeXYZ's entire $1.79B …"
// Keeps the original when the prefix isn't a recognised meta phrase.
function trimMetaPrefix(s: string): string {
  // No /s flag (pre-es2018 ts target) — match newlines via [\s\S] instead.
  const match = s.match(/^([^:]{5,80}):\s+([A-Z0-9$"'][\s\S]+)$/);
  if (!match) return s;
  const [, prefix, rest] = match;
  if (META_SENTENCE_RE.test(prefix.trim()) || META_PHRASE_RE.test(prefix)) {
    return rest.trim();
  }
  return s;
}

function extractDeckSentence(cleaned: string): string {
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0 && !isLikelyHeading(p));

  for (const p of paragraphs) {
    const sentences = splitSentences(p);
    // Drop leading meta sentences; keep the rest.
    let i = 0;
    while (i < sentences.length && isMetaSentence(sentences[i])) i++;
    const kept = sentences.slice(i).map(trimMetaPrefix).join(" ").trim();
    if (kept.length >= 40) return kept;

    // Every sentence in this paragraph looked meta. Try salvaging content
    // buried after a colon within the meta sentences themselves, e.g.
    // "Let me revise…: TradeXYZ's $1.79B …".
    const salvaged = sentences
      .map(trimMetaPrefix)
      .filter(s => s.length >= 30 && !isMetaSentence(s))
      .join(" ")
      .trim();
    if (salvaged.length >= 40) return salvaged;
  }

  // Fallback: if every paragraph looked conversational, use the first
  // non-empty paragraph verbatim rather than returning an empty deck.
  const firstNonEmpty = cleaned.split(/\n{2,}/).map(p => p.trim()).find(Boolean) || "";
  return firstNonEmpty;
}
