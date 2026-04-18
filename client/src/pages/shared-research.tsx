import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Loader2, Brain } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { format } from "date-fns";

const CHART_COLORS = [
  "hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(262 83% 58%)",
  "hsl(24 95% 53%)", "hsl(349 89% 60%)", "hsl(47 96% 53%)",
  "hsl(189 94% 43%)", "hsl(322 81% 43%)",
];

interface Artifact {
  type: "chart" | "table" | "metric_cards";
  title: string;
  subtitle?: string;
  source?: string;
  data: any[];
  chartConfig?: {
    chartType: string;
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  columns?: string[];
}

interface SharedMessage {
  id: number;
  role: string;
  content: string;
  artifacts?: Artifact[] | null;
  createdAt: string;
}

interface SharedSession {
  title: string;
  createdAt: string;
  author: string;
  messages: SharedMessage[];
}

function formatValue(val: any, fmt?: string): string {
  if (val == null) return "—";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (fmt === "currency") {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }
  if (fmt === "percent") return `${n.toFixed(2)}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function InlineChart({ artifact }: { artifact: Artifact }) {
  const { chartConfig, data, title, subtitle, source } = artifact;
  if (!chartConfig || !data?.length) return null;
  const { chartType, xAxis, yAxes } = chartConfig;
  const lastRow = data[data.length - 1];
  const primaryKey = yAxes[0]?.dataKey;
  const latestRaw = primaryKey ? lastRow?.[primaryKey] : undefined;
  const latestValue = latestRaw != null ? formatValue(latestRaw, yAxes[0]?.format) : null;
  const isDate = xAxis.format === "date" || (data[0]?.[xAxis.dataKey] && /^\d{4}-\d{2}/.test(String(data[0][xAxis.dataKey])));
  const xTickFormatter = (val: any) => {
    if (isDate) { try { return format(new Date(val), "MMM ''yy"); } catch { return val; } }
    return formatValue(val, xAxis.format);
  };
  const tooltipLabelFormatter = (val: any) => {
    if (isDate) { try { return format(new Date(val), "MMM d, yyyy"); } catch { return val; } }
    return String(val);
  };
  const tooltipFormatter = (value: any, name: string) => {
    const ax = yAxes.find(y => y.dataKey === name);
    return [formatValue(value, ax?.format), ax?.label || name.replace(/_/g, " ")];
  };
  const needsDualAxis = yAxes.length > 1 && yAxes[0]?.format !== yAxes[1]?.format;

  const renderChart = () => {
    const commonProps = { data, margin: { top: 8, right: needsDualAxis ? 52 : 16, left: 0, bottom: 4 } };
    const grid = <CartesianGrid strokeDasharray="2 6" stroke="var(--color-chart-grid)" vertical={false} />;
    const xAx = <XAxis dataKey={xAxis.dataKey} tickFormatter={xTickFormatter} tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }} axisLine={false} tickLine={false} />;
    const tip = <Tooltip allowEscapeViewBox={{ x: false, y: true }} offset={16} contentStyle={{ backgroundColor: "var(--color-tooltip-bg)", border: "1px solid var(--color-tooltip-border)", borderRadius: "8px", fontSize: "12px", padding: "8px 12px", color: "var(--color-tooltip-text)", backdropFilter: "blur(12px)", boxShadow: "0 4px 20px rgba(0,0,0,0.2)", pointerEvents: "none" }} wrapperStyle={{ pointerEvents: "none", zIndex: 50 }} labelFormatter={tooltipLabelFormatter} formatter={tooltipFormatter} cursor={{ fill: "var(--color-chart-cursor)" }} />;
    const leg = yAxes.length > 1 ? <Legend verticalAlign="top" align="left" height={22} iconType="plainline" iconSize={10} wrapperStyle={{ fontSize: "9px", color: "var(--color-tooltip-text)", paddingBottom: "2px" }} formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }} /> : null;

    if (needsDualAxis || chartType === "composed") {
      return (
        <ComposedChart {...commonProps}>
          {grid}{xAx}
          <YAxis yAxisId="left" tickFormatter={(v: number) => formatValue(v, yAxes[0]?.format)} tick={{ fontSize: 9, fill: CHART_COLORS[0] }} axisLine={false} tickLine={false} width={52} />
          {yAxes.length > 1 && <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => formatValue(v, yAxes[1]?.format)} tick={{ fontSize: 9, fill: CHART_COLORS[1] }} axisLine={false} tickLine={false} width={48} />}
          {tip}{leg}
          {yAxes.map((y, i) => {
            const axisId = i === 0 ? "left" : "right";
            const yChartType = y.chartType || (i === 0 ? "bar" : "line");
            if (yChartType === "bar") return <Bar key={y.dataKey} yAxisId={axisId} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={32} opacity={0.85} />;
            if (yChartType === "area") return <Area key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />;
            return <Line key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} activeDot={{ r: 2.5 }} />;
          })}
        </ComposedChart>
      );
    }
    const yAx = <YAxis tickFormatter={(v: number) => formatValue(v, yAxes[0]?.format)} tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }} axisLine={false} tickLine={false} width={52} />;
    if (chartType === "bar") {
      return (<BarChart {...commonProps}>{grid}{xAx}{yAx}{tip}{leg}{yAxes.map((y, i) => <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={32} opacity={0.85} />)}</BarChart>);
    }
    if (chartType === "area") {
      return (<AreaChart {...commonProps}>{grid}{xAx}{yAx}{tip}{leg}{yAxes.map((y, i) => <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />)}</AreaChart>);
    }
    return (<LineChart {...commonProps}>{grid}{xAx}{yAx}{tip}{leg}{yAxes.map((y, i) => <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} activeDot={{ r: 2.5 }} />)}</LineChart>);
  };

  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 p-3" style={{ overflow: "visible" }}>
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          <h4 className="text-[11px] font-medium text-foreground/80">{title}</h4>
          {subtitle && <p className="text-[9px] font-medium text-emerald-400 uppercase tracking-wider mt-0.5 leading-snug">{subtitle}</p>}
        </div>
        {latestValue && (
          <div className="text-right ml-3 shrink-0">
            <p className="text-base font-bold font-mono tabular-nums text-blue-400 leading-none">{latestValue}</p>
            <p className="text-[8px] text-muted-foreground/60 mt-0.5">Latest</p>
          </div>
        )}
      </div>
      <div style={{ overflow: "visible" }}>
        <ResponsiveContainer width="100%" height={220} style={{ overflow: "visible" }}>{renderChart()}</ResponsiveContainer>
      </div>
      {source && (
        <div className="mt-1.5 pt-1.5 border-t border-border/20">
          <p className="text-[9px] text-emerald-400/70 italic">Source: {source}</p>
        </div>
      )}
    </div>
  );
}

function InlineTable({ artifact }: { artifact: Artifact }) {
  const { data, columns, title } = artifact;
  if (!data?.length) return null;
  const cols = columns || Object.keys(data[0]);
  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 overflow-hidden">
      <h4 className="text-[11px] font-medium text-foreground/80 px-3 pt-2 pb-1">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead><tr className="border-b border-border/30">{cols.map(c => <th key={c} className="px-3 py-1.5 text-left font-medium text-muted-foreground/70 uppercase tracking-wider">{c.replace(/_/g, " ")}</th>)}</tr></thead>
          <tbody>{data.slice(0, 50).map((row: any, i: number) => <tr key={i} className="border-b border-border/20 last:border-0">{cols.map(c => <td key={c} className="px-3 py-1.5 text-foreground/80 font-mono">{formatValue(row[c])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCards({ artifact }: { artifact: Artifact }) {
  const { data, title } = artifact;
  if (!data?.length) return null;
  return (
    <div className="my-3 rounded border border-border/40 bg-card/30 overflow-hidden">
      {title && <h4 className="text-[11px] font-medium text-foreground/80 px-3 pt-2 pb-1">{title}</h4>}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
          <thead><tr className="border-b border-border/30">{data.map((card: any, i: number) => <th key={i} className="px-3 py-1.5 text-left font-medium text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">{card.label}</th>)}</tr></thead>
          <tbody>
            <tr className="border-b border-border/20">{data.map((card: any, i: number) => <td key={i} className="px-3 py-1.5 font-mono font-semibold text-foreground/90 whitespace-nowrap">{card.value}</td>)}</tr>
            {data.some((c: any) => c.subtitle) && <tr>{data.map((card: any, i: number) => <td key={i} className="px-3 py-1 text-[8px] text-muted-foreground/50 whitespace-nowrap">{card.subtitle || ""}</td>)}</tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseContentAndArtifacts(content: string, artifacts?: Artifact[] | null): Array<{ type: "text" | "chart" | "table" | "metric_cards"; content?: string; artifact?: Artifact }> {
  const parts: Array<{ type: "text" | "chart" | "table" | "metric_cards"; content?: string; artifact?: Artifact }> = [];
  const regex = /```artifact:(chart|table|metric_cards)\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let artifactIndex = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) parts.push({ type: "text", content: textBefore });
    }
    const type = match[1] as "chart" | "table" | "metric_cards";
    if (artifacts && artifactIndex < artifacts.length) {
      parts.push({ type, artifact: artifacts[artifactIndex] });
      artifactIndex++;
    } else {
      try {
        const json = JSON.parse(match[2].trim());
        let artifact: Artifact;
        if (type === "chart") artifact = { type: "chart", title: json.title || "Chart", data: json.data || [], chartConfig: { chartType: json.chartType || "line", xAxis: json.xAxis || { dataKey: "date" }, yAxes: json.yAxes || [] } };
        else if (type === "metric_cards") artifact = { type: "metric_cards", title: json.title || "Metrics", data: json.data || [] };
        else artifact = { type: "table", title: json.title || "Table", data: json.data || [], columns: json.columns };
        parts.push({ type, artifact });
      } catch {}
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) { const remaining = content.slice(lastIndex).trim(); if (remaining) parts.push({ type: "text", content: remaining }); }
  if (parts.length === 0 && content.trim()) parts.push({ type: "text", content: content.trim() });
  return parts;
}

function InlineFormatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={j} className="font-semibold text-foreground/90">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`")) return <code key={j} className="bg-muted/50 px-1 rounded text-[9px]">{part.slice(1, -1)}</code>;
        return <span key={j}>{part}</span>;
      })}
    </>
  );
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith("### ")) return <h4 key={i} className="text-[11px] font-semibold text-foreground/90 mt-2"><InlineFormatted text={line.slice(4)} /></h4>;
        if (line.startsWith("## ")) return <h3 key={i} className="text-[12px] font-semibold text-foreground/90 mt-3"><InlineFormatted text={line.slice(3)} /></h3>;
        if (line.startsWith("# ")) return <h2 key={i} className="text-[13px] font-bold text-foreground mt-3"><InlineFormatted text={line.slice(2)} /></h2>;
        if (line.startsWith("- ") || line.startsWith("* ")) return <p key={i} className="text-[10px] text-foreground/80 pl-3">• <InlineFormatted text={line.slice(2)} /></p>;
        if (line.match(/^\d+\.\s/)) return <p key={i} className="text-[10px] text-foreground/80 pl-3"><InlineFormatted text={line} /></p>;
        if (line.startsWith("> ")) return <p key={i} className="text-[10px] text-foreground/60 italic border-l-2 border-border/40 pl-2"><InlineFormatted text={line.slice(2)} /></p>;
        if (!line.trim()) return <div key={i} className="h-1" />;
        return <p key={i} className="text-[10px] text-foreground/80 leading-relaxed"><InlineFormatted text={line} /></p>;
      })}
    </div>
  );
}

function MessageBubble({ msg }: { msg: SharedMessage }) {
  const isUser = msg.role === "user";
  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] bg-primary/10 rounded-lg px-3 py-2">
          <p className="text-[10px] text-foreground/90">{msg.content}</p>
        </div>
      </div>
    );
  }
  const parts = parseContentAndArtifacts(msg.content, msg.artifacts as Artifact[] | null);
  return (
    <div className="mb-4">
      <div className="max-w-full">
        {parts.map((part, i) => {
          if (part.type === "text" && part.content) return <MarkdownText key={i} text={part.content} />;
          if (part.type === "metric_cards" && part.artifact) return <MetricCards key={i} artifact={part.artifact} />;
          if (part.type === "chart" && part.artifact) return <InlineChart key={i} artifact={part.artifact} />;
          if (part.type === "table" && part.artifact) return <InlineTable key={i} artifact={part.artifact} />;
          return null;
        })}
      </div>
    </div>
  );
}

export default function SharedResearch() {
  const [, params] = useRoute("/shared/research/:token");
  const token = params?.token;
  const [session, setSession] = useState<SharedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/shared/research/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || "Session not found");
        }
        return res.json();
      })
      .then((data) => { setSession(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <h2 className="text-sm font-semibold text-foreground mb-1">Session Not Found</h2>
          <p className="text-[10px] text-muted-foreground">{error || "This shared link may have expired or been revoked."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border/40">
          <Brain className="w-4 h-4 text-primary/70" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate" data-testid="text-shared-title">{session.title}</h1>
            <p className="text-[9px] text-muted-foreground">
              by {session.author} · {format(new Date(session.createdAt), "MMM d, yyyy")} · Read-only
            </p>
          </div>
        </div>
        <div className="space-y-2" data-testid="shared-messages">
          {session.messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        </div>
        <div className="mt-8 pt-4 border-t border-border/30 text-center">
          <p className="text-[9px] text-muted-foreground/50">
            Powered by Sessions
          </p>
        </div>
      </div>
    </div>
  );
}
