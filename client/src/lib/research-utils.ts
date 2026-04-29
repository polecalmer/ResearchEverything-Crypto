export type ResearchMode = "quick" | "focused" | "deep";

export interface RefreshRecipe {
  protocol: string;
  ticker: string;
  metric: string;
  dataSource: "defillama" | "coingecko" | "derived" | "dune";
  slug?: string;
  coinId?: string;
  timeWindowDays: number;
}

export interface SourceItem {
  name: string;
  detail?: string;
  url?: string;
}

export interface Artifact {
  type: "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote" | "sources";
  title?: string;
  subtitle?: string;
  source?: string;
  data?: any[];
  chartConfig?: {
    chartType: string;
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  refreshRecipe?: RefreshRecipe;
  columns?: string[];
  variant?: "insight" | "risk" | "contrarian" | "catch";
  text?: string;
  attribution?: string;
  left?: { label: string; items: string[] };
  right?: { label: string; items: string[] };
  // sources artifact: structured list (preferred) or raw markdown body fallback
  sources?: SourceItem[];
  body?: string;
}

export interface SessionMessage {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  artifacts?: Artifact[] | null;
  createdAt: string;
}

export interface Session {
  id: number;
  userId: string;
  title: string;
  type: string;
  shareToken?: string | null;
  createdAt: string;
  // Research-journey linkage. Populated when a session was spawned
  // from another session (Build Chart / Double Click). Top-level
  // sessions have both null.
  parentSessionId?: number | null;
  spawnSource?: string | null;
}

export interface ThinkingStep {
  type:
    | "thinking"
    | "tool_start"
    | "tool_result"
    | "analyzing"
    | "complete"
    | "sub_question_started"
    | "sub_question_progress"
    | "sub_question_done"
    | "synthesis_started";
  label: string;
  detail?: string;
  round?: number;
  totalRounds?: number;
  timestamp?: number;
  subQuestionId?: string;
  subQuestionText?: string;
}

export type PartType = "text" | "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote" | "sources";

// Series colors are theme-aware via CSS vars — dark mode keeps the
// existing high-contrast (light grey on dark bg) secondaries; light mode
// replaces them with deep navies / dark greys so series stay legible
// against a white background. Defined in client/src/index.css under
// --color-chart-series-1..8 for both :root (light) and .dark.
export const CHART_COLORS = [
  "var(--color-chart-series-1)",
  "var(--color-chart-series-2)",
  "var(--color-chart-series-3)",
  "var(--color-chart-series-4)",
  "var(--color-chart-series-5)",
  "var(--color-chart-series-6)",
  "var(--color-chart-series-7)",
  "var(--color-chart-series-8)",
];

const CURRENCY_HINTS = /fee|revenue|volume|price|cost|tvl|mcap|market.cap|valuation|profit|income|earn|spend|paid|aum|inflow|outflow|deposit|withdraw|\$/i;
const PRESCALED_UNIT_RE = /\(\s*\$?\s*([KMBkmb])\s*\)|\$([KMBkmb])\b/;
// Word-bounded so tickers that happen to contain "PE" (HY**PE**RLIQUID,
// **PE**ndle, etc.) don't get classified as ratio-format and render
// prices with an "x" suffix.
const RATIO_HINTS = /\b(P[\/-]?E|P[\/-]?S|P[\/-]?F|EV[\/-]|multiple|ratio)\b/i;

// Strong percent signals — the label is unambiguously a rate.
const STRONG_PERCENT_HINTS = /\bpercent\b|%|\bapr\b|\bapy\b|\d+\s*bps\b/i;
// Weak percent signals — words that USUALLY mean a rate but can also
// describe a USD amount ("yield paid out $4.4M", "fee rate breakdown
// in $").
const WEAK_PERCENT_HINTS = /\byield\b|\brate\b|\bmargin\b/i;
// Currency signals strong enough to OVERRIDE weak percent hints.
// `_usd`/`_dollars`/`paid out`/explicit `$` win against bare "yield".
const STRONG_CURRENCY_HINTS = /\$|_usd\b|\busd\b|_dollars\b|paid[\s_]?out|cumulative.+fee|cumulative.+revenue|notional/i;

export function inferFormat(dataKey?: string, label?: string, explicitFmt?: string): string | undefined {
  const combined = `${dataKey || ""} ${label || ""}`;
  const prescaled = PRESCALED_UNIT_RE.exec(combined);
  if (prescaled) {
    const unit = (prescaled[1] || prescaled[2]).toUpperCase();
    return `currency_${unit}`;
  }
  // Label-derived hints take precedence over explicitFmt — the label is
  // the visible source of truth for what the axis represents. Without
  // this, a P/E chart whose yAxis sets `format: "number"` (which the
  // agent often does) silently rendered ticks like "25.5" instead of
  // "25.5x" because explicitFmt short-circuited the ratio check.
  if (RATIO_HINTS.test(combined)) return "ratio";
  // Strong percent first.
  if (STRONG_PERCENT_HINTS.test(combined)) return "percent";
  // Strong currency next — beats weak percent (e.g. "Weekly Yield Paid
  // Out" with dataKey "weekly_yield_usd" → currency, not percent).
  if (STRONG_CURRENCY_HINTS.test(combined)) return "currency";
  // Then explicit fmt. Honor it before falling through to weak hints.
  if (explicitFmt) return explicitFmt;
  // Weak percent fires only when no currency signal beat it.
  if (WEAK_PERCENT_HINTS.test(combined)) return "percent";
  if (CURRENCY_HINTS.test(combined)) return "currency";
  return undefined;
}

// Locale pinned to en-US to avoid the en-IN ("0,00,000B") grouping issue we
// saw on user's status page. Y-axis formatters across the chart don't want
// locale-sensitive grouping anyway — "1,000,000,000" stays "1,000,000,000"
// regardless of where the user is.
const NUM_LOCALE = "en-US";

function compactNumber(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(NUM_LOCALE, { maximumFractionDigits: 2 });
}

// For "currency_K|M|B" formats the magnitude tells us whether the caller
// already scaled the value or accidentally handed us raw dollars. A pre-scaled
// AAVE TVL series has values like 14.2 (billions); a raw-dollars one has
// 14_197_275_351. Auto-rescale when the value is dramatically larger than
// the unit's expected range so the y-axis ticks stay coherent either way.
function rescaleToUnit(n: number, unit: "K" | "M" | "B"): number {
  const abs = Math.abs(n);
  if (unit === "B" && abs >= 1e7) return n / 1e9;
  if (unit === "M" && abs >= 1e4) return n / 1e6;
  if (unit === "K" && abs >= 1e3) return n / 1e3;
  return n;
}

// rescaleAndPromote: combined rescale + auto-promote. After bringing raw
// dollars down to the labeled unit (rescaleToUnit), if the result still
// exceeds the natural range for that unit (e.g. 1,100 in $M is really
// $1.1B), promote up the unit chain. The chart's labeled unit becomes a
// HINT, not a binding — the renderer always picks the right display unit
// based on actual magnitude. This fixes the recurring class of bugs where
// the agent emits a chart with `format: currency_M` but values are in the
// billions, producing y-axis ticks like "$1,100M" / "$2,200M" instead of
// "$1.1B" / "$2.2B". Prompt-rule fixes for this didn't hold because the
// model has training-time habits about embedding units in labels; the
// only durable fix is to make the renderer robust to whatever the agent
// emits.
function rescaleAndPromote(
  n: number,
  unit: "K" | "M" | "B",
): { value: number; effectiveUnit: "K" | "M" | "B" } {
  let v = rescaleToUnit(n, unit);
  let effective: "K" | "M" | "B" = unit;
  // Promote K → M when value ≥ 1000 K (i.e. ≥ $1M shown in K).
  // Promote M → B when value ≥ 1000 M (i.e. ≥ $1B shown in M).
  // No further promotion needed (B is the largest unit we render).
  if (effective === "K" && Math.abs(v) >= 1000) {
    v = v / 1000;
    effective = "M";
  }
  if (effective === "M" && Math.abs(v) >= 1000) {
    v = v / 1000;
    effective = "B";
  }
  return { value: v, effectiveUnit: effective };
}

// Pick decimal precision based on magnitude. For sub-1% values like take rates
// (often 0.01–0.05%), the default `.toFixed(1)` collapses everything to "0.0%".
// This dynamically scales precision so the value retains a digit of signal.
function dynamicDecimals(n: number, baseline: number): number {
  const abs = Math.abs(n);
  if (abs === 0) return 0;
  if (abs >= 10) return baseline;
  if (abs >= 1) return baseline + 1;
  if (abs >= 0.1) return baseline + 2;
  if (abs >= 0.01) return baseline + 3;
  return baseline + 4;
}

// Format a number with at most `maxDecimals` decimals, DROPPING
// trailing zeros. So 10 → "10", 10.0 → "10", 7.5 → "7.5", 1.234 → "1.2".
// Resolves the "$10.0M / $5.0M" axis-label class of bug where
// .toFixed(1) forces a trailing zero on integer ticks. Cleaner ticks
// without losing precision when there IS a non-integer value.
function compactDecimal(value: number, maxDecimals: number = 1): string {
  return value.toLocaleString(NUM_LOCALE, { maximumFractionDigits: maxDecimals });
}

export function formatAxisTick(val: any, fmt?: string): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency_K") {
    const { value, effectiveUnit } = rescaleAndPromote(n, "K");
    return `$${compactDecimal(value, 1)}${effectiveUnit}`;
  }
  if (fmt === "currency_M") {
    const { value, effectiveUnit } = rescaleAndPromote(n, "M");
    return `$${compactDecimal(value, 1)}${effectiveUnit}`;
  }
  if (fmt === "currency_B") {
    const { value, effectiveUnit } = rescaleAndPromote(n, "B");
    return `$${compactDecimal(value, 1)}${effectiveUnit}`;
  }
  if (fmt === "currency") {
    if (Math.abs(n) >= 1e9) return `$${compactDecimal(n / 1e9, 1)}B`;
    if (Math.abs(n) >= 1e6) return `$${compactDecimal(n / 1e6, 1)}M`;
    if (Math.abs(n) >= 1e3) return `$${compactDecimal(n / 1e3, 0)}K`;
    return `$${compactDecimal(n, 0)}`;
  }
  if (fmt === "ratio") return `${compactDecimal(n, 1)}x`;
  if (fmt === "percent") return `${compactDecimal(n, dynamicDecimals(n, 0))}%`;
  if (Math.abs(n) >= 1e9) return `${compactDecimal(n / 1e9, 1)}B`;
  if (Math.abs(n) >= 1e6) return `${compactDecimal(n / 1e6, 1)}M`;
  if (Math.abs(n) >= 1e3) return `${compactDecimal(n / 1e3, 0)}K`;
  return compactDecimal(n, 2);
}

export function formatValue(val: any, fmt?: string): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency") {
    return `$${compactNumber(n)}`;
  }
  // For prescaled-currency formats, multiply BY the unit only when the
  // value looks pre-scaled (small magnitude). When raw dollars sneak in
  // (e.g. post-refresh data that wasn't normalized), passing through to
  // compactNumber on the raw value already yields the right output.
  // Multiply pre-scaled values back to absolute, then let compactNumber
  // pick the right display unit. Same self-correcting pattern as
  // rescaleAndPromote for axis ticks: even if the agent labeled the
  // chart with a wrong unit, the displayed value is right.
  if (fmt === "currency_K") {
    const full = Math.abs(n) < 1e3 ? n * 1e3 : n;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "currency_M") {
    const full = Math.abs(n) < 1e4 ? n * 1e6 : n;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "currency_B") {
    const full = Math.abs(n) < 1e7 ? n * 1e9 : n;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "ratio") {
    if (Math.abs(n) >= 1e3) return `${compactNumber(n)}x`;
    return `${n.toLocaleString(NUM_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`;
  }
  if (fmt === "percent") return `${n.toFixed(dynamicDecimals(n, 1))}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(NUM_LOCALE, { maximumFractionDigits: 4 });
}

// Tolerate the close tag showing up as literal `-->`, a unicode right arrow
// `→`, or any other stray whitespace — we've seen the agent/renderer produce
// variants and the rule comment should always be stripped from the display.
// The mode value matches any word so server-side mode additions (e.g. "chart")
// don't leak through as visible HTML comments. Global flag because the server
// prepends one mode tag AND the model sometimes emits its own — both must go.
const MODE_RE = /<!--\s*mode:([a-z]+)\s*(?:-->|→|—>)?\s*\n?/gi;
const CONTINUATION_RE = /<!--\s*needs_continuation\s*-->\s*\n?/;

export function extractMode(content: string): { mode: ResearchMode | null; cleaned: string; needsContinuation: boolean } {
  const needsContinuation = CONTINUATION_RE.test(content);
  let firstMode: ResearchMode | null = null;
  const cleaned = content
    .replace(CONTINUATION_RE, "")
    .replace(MODE_RE, (_full, mode) => {
      if (!firstMode) firstMode = mode as ResearchMode;
      return "";
    });
  return { mode: firstMode, cleaned, needsContinuation };
}

function parseSourcesPayload(raw: string): { sources?: SourceItem[]; body?: string } {
  const trimmed = raw.trim();
  // JSON shapes the model commonly emits.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const items = parsed
        .map((s: any): SourceItem | null => {
          if (typeof s === "string") {
            const [name, ...rest] = s.split(/\s*[-—:]\s*/);
            return { name: name.trim(), detail: rest.join(" — ").trim() || undefined };
          }
          if (s && typeof s === "object" && (s.name || s.tag)) {
            return { name: String(s.name || s.tag), detail: s.detail || s.description, url: s.url };
          }
          return null;
        })
        .filter(Boolean) as SourceItem[];
      return items.length ? { sources: items } : { body: trimmed };
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.sources)) {
        return parseSourcesPayload(JSON.stringify(parsed.sources));
      }
    }
  } catch {}
  return { body: trimmed };
}

export function parseContentAndArtifacts(content: string, artifacts?: Artifact[] | null): Array<{ type: PartType; content?: string; artifact?: Artifact; artifactIdx?: number }> {
  const parts: Array<{ type: PartType; content?: string; artifact?: Artifact; artifactIdx?: number }> = [];
  const regex = /```artifact:(chart|table|metric_cards|callout|comparison|quote|sources)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  // Track which artifact-column entries have been consumed already so
  // each one matches at most one inline block.
  const consumed = new Set<number>();

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) parts.push({ type: "text", content: textBefore });
    }

    const type = match[1] as PartType;
    // Type-aware matching. Inline blocks are matched to artifact-column
    // entries by TYPE (not by position). This is robust to server-side
    // mutations that prepend extra callouts to the artifacts array (chart-
    // validator warnings, NPL error callouts) without also injecting them
    // into inline content. With positional matching, an extra callout in
    // artifacts[0] would silently capture the chart inline-block's slot,
    // hiding the chart entirely. Type-aware matching finds the next
    // unconsumed artifact whose type matches the inline block.
    let matchedIdx = -1;
    if (type !== "sources" && artifacts) {
      for (let i = 0; i < artifacts.length; i++) {
        if (consumed.has(i)) continue;
        if ((artifacts[i] as any)?.type === type) {
          matchedIdx = i;
          break;
        }
      }
    }
    if (matchedIdx >= 0 && artifacts) {
      consumed.add(matchedIdx);
      parts.push({ type, artifact: artifacts[matchedIdx], artifactIdx: matchedIdx });
    } else {
      try {
        const json = JSON.parse(match[2].trim());
        let artifact: Artifact;
        if (type === "chart") {
          artifact = { type: "chart", title: json.title || "Chart", data: json.data || [], chartConfig: { chartType: json.chartType || "line", xAxis: json.xAxis || { dataKey: "date" }, yAxes: json.yAxes || [], ...(json.annotations ? { annotations: json.annotations } : {}), ...(json.smoothing ? { smoothing: json.smoothing } : {}), ...(json.axisLayout ? { axisLayout: json.axisLayout } : {}) }, ...(json.refreshRecipe ? { refreshRecipe: json.refreshRecipe } : {}) };
        } else if (type === "metric_cards") {
          artifact = { type: "metric_cards", title: json.title || "Metrics", data: json.data || [] };
        } else if (type === "table") {
          artifact = { type: "table", title: json.title || "Table", data: json.data || [], columns: json.columns };
        } else if (type === "callout") {
          artifact = { type: "callout", variant: json.variant || "insight", title: json.title, text: json.text || "" };
        } else if (type === "comparison") {
          artifact = { type: "comparison", title: json.title, left: json.left || { label: "Left", items: [] }, right: json.right || { label: "Right", items: [] } };
        } else if (type === "quote") {
          artifact = { type: "quote", text: json.text || "", attribution: json.attribution };
        } else {
          // sources — accept structured list, list of strings, or raw markdown body
          const sources = parseSourcesPayload(match[2]);
          artifact = { type: "sources", title: json.title, ...sources };
        }
        parts.push({ type, artifact });
      } catch {
        if (type === "sources") {
          // Model emitted prose / bulleted markdown rather than JSON — render as body.
          parts.push({ type, artifact: { type: "sources", body: match[2].trim() } });
        }
      }
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) parts.push({ type: "text", content: remaining });
  }

  if (parts.length === 0 && content.trim()) {
    parts.push({ type: "text", content: content.trim() });
  }

  return parts;
}

export function parseMarkdownTableCells(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
}

export function isTableSeparator(line: string): boolean {
  return /^\|?[\s\-:|]+\|[\s\-:|]+\|?$/.test(line.trim());
}

export function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && (trimmed.startsWith("|") || trimmed.endsWith("|"));
}

export const SUGGESTED_QUERIES = [
  "Compare TVL growth of Aave vs Compound vs Morpho over the last year",
  "Show me Hyperliquid's derivatives volume trend",
  "Which DEXs have the highest revenue in the last 30 days?",
  "What's the P/E ratio trend for Ethereum L2s?",
];

export const SUGGESTED_DATA_QUERIES = [
  "Chart Hyperliquid 30D MA ARR vs price over the last 6 months",
  "Build a fees and revenue comparison: Uniswap vs Aave vs Lido",
  "Show me Ethereum L2 TVL breakdown as a stacked area chart",
  "Compare daily active users across top 5 DEXs",
];
