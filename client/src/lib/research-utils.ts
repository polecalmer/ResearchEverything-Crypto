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

export interface Artifact {
  type: "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";
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
}

export interface ThinkingStep {
  type: "thinking" | "tool_start" | "tool_result" | "analyzing" | "complete";
  label: string;
  detail?: string;
  round?: number;
  totalRounds?: number;
  timestamp?: number;
}

export type PartType = "text" | "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";

export const CHART_COLORS = [
  "#6B8DE3", "#A0B4E0", "#3D5A9E",
  "#8FAAE8", "#4A6BB5", "#C2D1F0",
  "#526EAA", "#7C9CDD",
];

const CURRENCY_HINTS = /fee|revenue|volume|price|cost|tvl|mcap|market.cap|valuation|profit|income|earn|spend|paid|aum|inflow|outflow|deposit|withdraw|\$/i;
const PRESCALED_UNIT_RE = /\(\s*\$?\s*([KMBkmb])\s*\)|\$([KMBkmb])\b/;
const RATIO_HINTS = /P[\/-]?E|P[\/-]?S|P[\/-]?F|EV[\/-]|multiple|ratio/i;

export function inferFormat(dataKey?: string, label?: string, explicitFmt?: string): string | undefined {
  const combined = `${dataKey || ""} ${label || ""}`;
  const prescaled = PRESCALED_UNIT_RE.exec(combined);
  if (prescaled) {
    const unit = (prescaled[1] || prescaled[2]).toUpperCase();
    return `currency_${unit}`;
  }
  if (explicitFmt) return explicitFmt;
  if (RATIO_HINTS.test(combined)) return "ratio";
  if (CURRENCY_HINTS.test(combined)) return "currency";
  if (/percent|%|apr|apy|yield|rate/i.test(combined)) return "percent";
  return undefined;
}

function compactNumber(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatAxisTick(val: any, fmt?: string): string {
  if (val == null) return "";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency_K") return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}K`;
  if (fmt === "currency_M") return `$${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (fmt === "currency_B") return `$${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}B`;
  if (fmt === "currency") {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  if (fmt === "ratio") return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}x`;
  if (fmt === "percent") return `${n.toFixed(1)}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatValue(val: any, fmt?: string): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency") {
    return `$${compactNumber(n)}`;
  }
  if (fmt === "currency_K") {
    const full = n * 1e3;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "currency_M") {
    const full = n * 1e6;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "currency_B") {
    const full = n * 1e9;
    return `$${compactNumber(full)}`;
  }
  if (fmt === "ratio") {
    if (Math.abs(n) >= 1e3) return `${compactNumber(n)}x`;
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}x`;
  }
  if (fmt === "percent") return `${n.toFixed(2)}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const MODE_RE = /^<!--\s*mode:(quick|focused|deep)\s*-->\s*\n?/;
const CONTINUATION_RE = /<!--\s*needs_continuation\s*-->\s*\n?/;

export function extractMode(content: string): { mode: ResearchMode | null; cleaned: string; needsContinuation: boolean } {
  const needsContinuation = CONTINUATION_RE.test(content);
  let cleaned = content.replace(CONTINUATION_RE, "");
  const m = cleaned.match(MODE_RE);
  if (m) return { mode: m[1] as ResearchMode, cleaned: cleaned.replace(MODE_RE, ""), needsContinuation };
  return { mode: null, cleaned, needsContinuation };
}

export function parseContentAndArtifacts(content: string, artifacts?: Artifact[] | null): Array<{ type: PartType; content?: string; artifact?: Artifact; artifactIdx?: number }> {
  const parts: Array<{ type: PartType; content?: string; artifact?: Artifact; artifactIdx?: number }> = [];
  const regex = /```artifact:(chart|table|metric_cards|callout|comparison|quote)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let artifactIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) parts.push({ type: "text", content: textBefore });
    }

    const type = match[1] as PartType;
    if (artifacts && artifactIndex < artifacts.length) {
      parts.push({ type, artifact: artifacts[artifactIndex], artifactIdx: artifactIndex });
      artifactIndex++;
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
        } else {
          artifact = { type: "quote", text: json.text || "", attribution: json.attribution };
        }
        parts.push({ type, artifact });
      } catch {}
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
