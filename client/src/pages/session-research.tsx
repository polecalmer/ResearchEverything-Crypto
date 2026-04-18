import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Send, Plus, Trash2, Loader2, MessageSquare,
  CheckCircle2, ChevronDown, Brain, Search, BarChart3,
  Share2, Link2, Check, X, Lightbulb, AlertTriangle, Zap, Eye,
  Quote as QuoteIcon, ArrowDown, ArrowUp, RefreshCw, FileText,
  Bookmark, Microscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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

type ResearchMode = "quick" | "focused" | "deep";

interface Artifact {
  type: "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";
  title?: string;
  data?: any[];
  chartConfig?: {
    chartType: string;
    xAxis: { dataKey: string; label?: string; format?: string };
    yAxes: Array<{ dataKey: string; label?: string; format?: string; chartType?: string }>;
  };
  columns?: string[];
  variant?: "insight" | "risk" | "contrarian" | "catch";
  text?: string;
  attribution?: string;
  left?: { label: string; items: string[] };
  right?: { label: string; items: string[] };
}

interface SessionMessage {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  artifacts?: Artifact[] | null;
  createdAt: string;
}

interface Session {
  id: number;
  userId: string;
  title: string;
  type: string;
  shareToken?: string | null;
  createdAt: string;
}

const CURRENCY_HINTS = /fee|revenue|volume|price|cost|tvl|mcap|market.cap|valuation|profit|income|earn|spend|paid|aum|inflow|outflow|deposit|withdraw|\$/i;

function inferFormat(dataKey?: string, label?: string, explicitFmt?: string): string | undefined {
  if (explicitFmt) return explicitFmt;
  const combined = `${dataKey || ""} ${label || ""}`;
  if (CURRENCY_HINTS.test(combined)) return "currency";
  if (/percent|%|ratio|apr|apy|yield|rate/i.test(combined)) return "percent";
  return undefined;
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
  const { chartConfig, data, title } = artifact;
  if (!chartConfig || !data?.length) return null;

  const { chartType, xAxis, yAxes } = chartConfig;

  const isDate = xAxis.format === "date" || (data[0]?.[xAxis.dataKey] && /^\d{4}-\d{2}/.test(String(data[0][xAxis.dataKey])));

  const xTickFormatter = (val: any) => {
    if (isDate) {
      try { return format(new Date(val), "MMM ''yy"); } catch { return val; }
    }
    return formatValue(val, xAxis.format);
  };

  const tooltipLabelFormatter = (val: any) => {
    if (isDate) {
      try { return format(new Date(val), "MMM d, yyyy"); } catch { return val; }
    }
    return String(val);
  };

  const tooltipFormatter = (value: any, name: string) => {
    const ax = yAxes.find(y => y.dataKey === name);
    const fmt = inferFormat(ax?.dataKey, ax?.label, ax?.format);
    return [formatValue(value, fmt), ax?.label || name.replace(/_/g, " ")];
  };

  const fmt0 = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
  const fmt1 = yAxes.length > 1 ? inferFormat(yAxes[1]?.dataKey, yAxes[1]?.label, yAxes[1]?.format) : fmt0;
  const needsDualAxis = yAxes.length > 1 && fmt0 !== fmt1;

  const renderChart = () => {
    const commonProps = { data, margin: { top: 12, right: needsDualAxis ? 56 : 20, left: 4, bottom: 8 } };
    const grid = <CartesianGrid strokeDasharray="3 8" stroke="var(--color-chart-grid)" vertical={false} />;
    const xAx = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={xTickFormatter}
        tick={{ fontSize: 11, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        tickMargin={8}
      />
    );
    const tip = (
      <Tooltip
        allowEscapeViewBox={{ x: false, y: true }}
        offset={16}
        contentStyle={{
          backgroundColor: "var(--color-tooltip-bg)",
          border: "1px solid var(--color-tooltip-border)",
          borderRadius: "10px", fontSize: "13px", padding: "10px 14px",
          color: "var(--color-tooltip-text)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)",
          pointerEvents: "none",
          lineHeight: "1.5",
        }}
        wrapperStyle={{ pointerEvents: "none", zIndex: 50 }}
        labelFormatter={tooltipLabelFormatter}
        formatter={tooltipFormatter}
        cursor={{ fill: "var(--color-chart-cursor)" }}
      />
    );
    const leg = yAxes.length > 1 ? (
      <Legend verticalAlign="top" align="left" height={28} iconType="plainline" iconSize={12}
        wrapperStyle={{ fontSize: "11px", color: "var(--color-tooltip-text)", paddingBottom: "4px" }}
        formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    if (needsDualAxis || chartType === "composed") {
      return (
        <ComposedChart {...commonProps}>
          {grid}{xAx}
          <YAxis
            yAxisId="left"
            tickFormatter={(v: number) => formatValue(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
            tick={{ fontSize: 11, fill: CHART_COLORS[0] }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickMargin={4}
          />
          {yAxes.length > 1 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => formatValue(v, inferFormat(yAxes[1]?.dataKey, yAxes[1]?.label, yAxes[1]?.format))}
              tick={{ fontSize: 11, fill: CHART_COLORS[1] }}
              axisLine={false}
              tickLine={false}
              width={52}
              tickMargin={4}
            />
          )}
          {tip}{leg}
          {yAxes.map((y, i) => {
            const axisId = i === 0 ? "left" : "right";
            const yChartType = y.chartType || (i === 0 ? "bar" : "line");
            if (yChartType === "bar") {
              return <Bar key={y.dataKey} yAxisId={axisId} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={40} opacity={0.9} />;
            }
            if (yChartType === "area") {
              return <Area key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.1} dot={false} />;
            }
            return <Line key={y.dataKey} yAxisId={axisId} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "#fff", strokeWidth: 2 }} />;
          })}
        </ComposedChart>
      );
    }

    const yAx = (
      <YAxis
        tickFormatter={(v: number) => formatValue(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
        tick={{ fontSize: 11, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={56}
        tickMargin={4}
      />
    );

    if (chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} maxBarSize={40} opacity={0.9} />
          ))}
        </BarChart>
      );
    }
    if (chartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.1} dot={false} />
          ))}
        </AreaChart>
      );
    }
    return (
      <LineChart {...commonProps}>
        {grid}{xAx}{yAx}{tip}{leg}
        {yAxes.map((y, i) => (
          <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "#fff", strokeWidth: 2 }} />
        ))}
      </LineChart>
    );
  };

  return (
    <div className="my-5 rounded-lg border border-border/30 bg-card/40 p-5 shadow-sm" style={{ overflow: "visible" }}>
      {title && <h4 className="text-sm font-semibold text-foreground/90 mb-3 tracking-tight">{title}</h4>}
      <div style={{ overflow: "visible" }}>
        <ResponsiveContainer width="100%" height={300} style={{ overflow: "visible" }}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InlineTable({ artifact }: { artifact: Artifact }) {
  const { data, columns, title } = artifact;
  if (!data?.length) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const resolveCell = (row: any, col: string): any => {
    if (Array.isArray(row)) {
      const idx = (columns || []).indexOf(col);
      return idx >= 0 ? row[idx] : undefined;
    }
    if (row == null || typeof row !== "object") return row;
    if (col in row) return row[col];
    const target = normalize(col);
    for (const k of Object.keys(row)) {
      if (normalize(k) === target) return row[k];
    }
    return undefined;
  };

  const cols = columns || (Array.isArray(data[0]) ? data[0].map((_: any, i: number) => `Col ${i + 1}`) : Object.keys(data[0]));

  return (
    <div className="my-5 rounded-lg border border-border/30 bg-card/40 overflow-hidden shadow-sm">
      {title && <h4 className="text-sm font-semibold text-foreground/90 px-5 pt-4 pb-2 tracking-tight">{title}</h4>}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {cols.map(c => (
                <th key={c} className="px-5 py-2.5 text-left text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">{c.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 50).map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/15 last:border-0 hover:bg-muted/10 transition-colors even:bg-muted/5">
                {cols.map(c => (
                  <td key={c} className="px-5 py-2.5 text-foreground/85 font-mono text-[13px]">{formatValue(resolveCell(row, c))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCards({ artifact }: { artifact: Artifact }) {
  const { data, title } = artifact;
  if (!data?.length) return null;

  return (
    <div className="my-5" data-testid="metric-cards">
      {title && <h4 className="text-sm font-semibold text-foreground/90 mb-3 tracking-tight">{title}</h4>}
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(data.length, 4)}, 1fr)` }}>
        {data.map((card: any, i: number) => (
          <div key={i} className="rounded-lg border border-border/30 bg-card/40 px-4 py-3 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">{card.label}</p>
            <p className="text-lg font-bold text-foreground/95 font-mono tracking-tight">{card.value}</p>
            {card.subtitle && <p className="text-xs text-muted-foreground/50 mt-0.5">{card.subtitle}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

type PartType = "text" | "chart" | "table" | "metric_cards" | "callout" | "comparison" | "quote";

function parseContentAndArtifacts(content: string, artifacts?: Artifact[] | null): Array<{ type: PartType; content?: string; artifact?: Artifact }> {
  const parts: Array<{ type: PartType; content?: string; artifact?: Artifact }> = [];
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
      parts.push({ type, artifact: artifacts[artifactIndex] });
      artifactIndex++;
    } else {
      try {
        const json = JSON.parse(match[2].trim());
        let artifact: Artifact;
        if (type === "chart") {
          artifact = { type: "chart", title: json.title || "Chart", data: json.data || [], chartConfig: { chartType: json.chartType || "line", xAxis: json.xAxis || { dataKey: "date" }, yAxes: json.yAxes || [] } };
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

function CalloutBlock({ artifact }: { artifact: Artifact }) {
  const variant = artifact.variant || "insight";
  const config = {
    insight: { icon: Lightbulb, label: "Insight", colors: "border-blue-400/30 bg-blue-400/5 text-blue-400" },
    risk: { icon: AlertTriangle, label: "Risk", colors: "border-amber-400/30 bg-amber-400/5 text-amber-400" },
    contrarian: { icon: Zap, label: "Contrarian", colors: "border-purple-400/30 bg-purple-400/5 text-purple-400" },
    catch: { icon: Eye, label: "The Catch", colors: "border-rose-400/30 bg-rose-400/5 text-rose-400" },
  }[variant];
  const Icon = config.icon;
  return (
    <div className={`my-5 rounded-lg border ${config.colors} px-5 py-4`} data-testid={`callout-${variant}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs uppercase tracking-wider font-bold">{artifact.title || config.label}</span>
      </div>
      <p className="text-[13px] text-foreground/85 leading-relaxed">{artifact.text}</p>
    </div>
  );
}

function ComparisonBlock({ artifact }: { artifact: Artifact }) {
  const { left, right, title } = artifact;
  if (!left || !right) return null;
  return (
    <div className="my-5 rounded-lg border border-border/30 bg-card/40 overflow-hidden shadow-sm" data-testid="comparison-block">
      {title && <div className="text-sm font-semibold text-foreground/90 px-5 pt-4 pb-2 tracking-tight">{title}</div>}
      <div className="grid grid-cols-2 divide-x divide-border/20">
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-3 font-bold">{left.label}</div>
          <ul className="space-y-2">
            {left.items.map((item, i) => (
              <li key={i} className="text-[13px] text-foreground/80 leading-relaxed flex gap-2">
                <span className="text-muted-foreground/50 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-3 font-bold">{right.label}</div>
          <ul className="space-y-2">
            {right.items.map((item, i) => (
              <li key={i} className="text-[13px] text-foreground/80 leading-relaxed flex gap-2">
                <span className="text-muted-foreground/50 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function QuoteBlock({ artifact }: { artifact: Artifact }) {
  return (
    <div className="my-5 border-l-3 border-primary/40 pl-5 py-3" data-testid="quote-block">
      <div className="flex items-start gap-3">
        <QuoteIcon className="w-4 h-4 mt-0.5 text-primary/50 flex-shrink-0" />
        <div>
          <p className="text-[14px] text-foreground/90 italic leading-relaxed">{artifact.text}</p>
          {artifact.attribution && <p className="text-xs text-muted-foreground/60 mt-2">— {artifact.attribution}</p>}
        </div>
      </div>
    </div>
  );
}

function InlineFormatted({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={j} className="bg-muted/60 px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        return <span key={j}>{part}</span>;
      })}
    </>
  );
}

function parseMarkdownTableCells(line: string): string[] {
  return line.split("|").map(c => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length);
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s\-:|]+\|[\s\-:|]+\|?$/.test(line.trim());
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && (trimmed.startsWith("|") || trimmed.endsWith("|"));
}

function MarkdownTable({ rows }: { rows: string[] }) {
  const headerRow = rows[0];
  const dataRows = rows.filter((_, i) => i > 0 && !isTableSeparator(_));
  const headers = parseMarkdownTableCells(headerRow);

  return (
    <div className="my-4 rounded-lg border border-border/30 overflow-hidden" data-testid="markdown-table">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-muted/30 border-b border-border/30">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-2.5 font-semibold text-foreground/90 whitespace-nowrap">
                <InlineFormatted text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => {
            const cells = parseMarkdownTableCells(row);
            return (
              <tr key={ri} className={`border-b border-border/10 ${ri % 2 === 1 ? "bg-muted/10" : ""} hover:bg-muted/20 transition-colors`}>
                {headers.map((_, ci) => (
                  <td key={ci} className="px-4 py-2.5 text-foreground/80 whitespace-nowrap">
                    <InlineFormatted text={cells[ci] || ""} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");

  const blocks: Array<{ type: "line"; index: number; content: string } | { type: "table"; index: number; rows: string[] }> = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const tableRows: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        tableRows.push(lines[i]);
        i++;
      }
      if (tableRows.length >= 2) {
        blocks.push({ type: "table", index: i, rows: tableRows });
      } else {
        tableRows.forEach((r, ri) => blocks.push({ type: "line", index: i + ri, content: r }));
      }
    } else {
      blocks.push({ type: "line", index: i, content: lines[i] });
      i++;
    }
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, bi) => {
        if (block.type === "table") {
          return <MarkdownTable key={`table-${bi}`} rows={block.rows} />;
        }
        const line = block.content;
        if (line.startsWith("### ")) return (
          <h4 key={bi} className="text-[14px] font-semibold text-foreground mt-5 mb-1">
            <InlineFormatted text={line.slice(4)} />
          </h4>
        );
        if (line.startsWith("## ")) return (
          <h3 key={bi} className="text-base font-bold text-foreground mt-6 mb-2 pb-1.5 border-b border-border/20">
            <InlineFormatted text={line.slice(3)} />
          </h3>
        );
        if (line.startsWith("# ")) return (
          <h2 key={bi} className="text-lg font-bold text-foreground mt-6 mb-2 pb-2 border-b border-border/30">
            <InlineFormatted text={line.slice(2)} />
          </h2>
        );
        if (line.startsWith("- ") || line.startsWith("* ")) return (
          <p key={bi} className="text-[13px] text-foreground/80 pl-4 leading-relaxed flex gap-2">
            <span className="text-muted-foreground/50 shrink-0">•</span>
            <span><InlineFormatted text={line.slice(2)} /></span>
          </p>
        );
        if (line.match(/^\d+\.\s/)) return (
          <p key={bi} className="text-[13px] text-foreground/80 pl-4 leading-relaxed">
            <InlineFormatted text={line} />
          </p>
        );
        if (line.startsWith("> ")) return (
          <p key={bi} className="text-[13px] text-foreground/60 italic border-l-2 border-border/40 pl-4 py-0.5 my-1">
            <InlineFormatted text={line.slice(2)} />
          </p>
        );
        if (line.startsWith("---") || line.startsWith("***")) return <hr key={bi} className="border-border/20 my-4" />;
        if (line.startsWith("**") && line.endsWith("**")) return (
          <p key={bi} className="text-[13px] font-semibold text-foreground/90 mt-1">
            {line.slice(2, -2)}
          </p>
        );
        if (!line.trim()) return <div key={bi} className="h-2" />;

        return (
          <p key={bi} className="text-[13px] text-foreground/80 leading-[1.7]">
            <InlineFormatted text={line} />
          </p>
        );
      })}
    </div>
  );
}

const MODE_RE = /^<!--\s*mode:(quick|focused|deep)\s*-->\s*\n?/;

function extractMode(content: string): { mode: ResearchMode | null; cleaned: string } {
  const m = content.match(MODE_RE);
  if (m) return { mode: m[1] as ResearchMode, cleaned: content.replace(MODE_RE, "") };
  return { mode: null, cleaned: content };
}

function ModeBadge({ mode }: { mode: ResearchMode }) {
  const config = {
    quick: { label: "Quick", className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30" },
    focused: { label: "Focused", className: "bg-blue-400/10 text-blue-400 border-blue-400/30" },
    deep: { label: "Deep Dive", className: "bg-purple-400/10 text-purple-400 border-purple-400/30" },
  }[mode];
  return (
    <span className={`inline-block px-2.5 py-1 rounded-md border text-[10px] uppercase tracking-wider font-semibold ${config.className}`} data-testid={`mode-badge-${mode}`}>
      {config.label}
    </span>
  );
}

function DiveDeepButton({ onDiveDeep }: { onDiveDeep: (text: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setPos(null);
        setSelectedText("");
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 10) {
        setPos(null);
        setSelectedText("");
        return;
      }
      const anchorNode = sel.anchorNode;
      if (!anchorNode) { setPos(null); setSelectedText(""); return; }
      const msgEl = (anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode as Element : anchorNode.parentElement)
        ?.closest("[data-testid^='msg-assistant-']");
      if (!msgEl) { setPos(null); setSelectedText(""); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setSelectedText(text);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  if (!pos || !selectedText) return null;

  return (
    <button
      ref={btnRef}
      className="fixed z-[100] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-all animate-in fade-in zoom-in-95 duration-150"
      style={{ left: pos.x, top: pos.y, transform: "translate(-50%, -100%)" }}
      onMouseDown={(e) => {
        e.preventDefault();
        onDiveDeep(selectedText);
        window.getSelection()?.removeAllRanges();
        setPos(null);
        setSelectedText("");
      }}
      data-testid="button-dive-deeper"
    >
      <Microscope className="w-3.5 h-3.5" />
      Dive Deeper
    </button>
  );
}

function MessageBubble({
  msg,
  onOverride,
  onDiveDeep,
  onAddToReport,
  isLast,
  busy,
  lastUserMessage,
}: {
  msg: SessionMessage;
  onOverride?: (action: { forceMode?: ResearchMode; refreshBrain?: boolean }) => void;
  onDiveDeep?: (text: string) => void;
  onAddToReport?: (msgId: number) => Promise<void>;
  isLast?: boolean;
  busy?: boolean;
  lastUserMessage?: string;
}) {
  const isUser = msg.role === "user";
  const [reportState, setReportState] = useState<"idle" | "saving" | "saved">("idle");

  if (isUser) {
    return (
      <div className="flex justify-end mb-5" data-testid={`msg-user-${msg.id}`}>
        <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
          <p className="text-[13px] text-foreground/90">{msg.content}</p>
        </div>
      </div>
    );
  }

  const { mode, cleaned } = extractMode(msg.content);
  const parts = parseContentAndArtifacts(cleaned, msg.artifacts as Artifact[] | null);

  const showOverrides = isLast && !busy && onOverride && lastUserMessage;
  const canShorter = mode === "deep" || mode === "focused";
  const canDeeper = mode === "quick" || mode === "focused";
  const shorterTo: ResearchMode = mode === "deep" ? "focused" : "quick";
  const deeperTo: ResearchMode = mode === "quick" ? "focused" : "deep";

  return (
    <div className="mb-6 group/msg" data-testid={`msg-assistant-${msg.id}`}>
      <div className="flex items-center gap-2 mb-3">
        {mode && <ModeBadge mode={mode} />}
        <div className="flex-1" />
        {onAddToReport && (
          <button
            disabled={reportState !== "idle"}
            onClick={async () => {
              setReportState("saving");
              try {
                await onAddToReport(msg.id);
                setReportState("saved");
                setTimeout(() => setReportState("idle"), 3000);
              } catch {
                setReportState("idle");
              }
            }}
            className={`opacity-0 group-hover/msg:opacity-100 transition-opacity text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 ${
              reportState === "saved"
                ? "border-emerald-400/40 text-emerald-400 bg-emerald-400/5 !opacity-100"
                : reportState === "saving"
                  ? "border-border/40 text-muted-foreground/40 cursor-wait !opacity-100"
                  : "border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/60 hover:bg-muted/20"
            }`}
            data-testid={`button-add-report-${msg.id}`}
          >
            {reportState === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : reportState === "saved" ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
            {reportState === "saving" ? "Saving..." : reportState === "saved" ? "Saved" : "Add to Reports"}
          </button>
        )}
      </div>
      <div className="max-w-full">
        {parts.map((part, i) => {
          if (part.type === "text" && part.content) {
            return <MarkdownText key={i} text={part.content} />;
          }
          if (part.type === "metric_cards" && part.artifact) {
            return <MetricCards key={i} artifact={part.artifact} />;
          }
          if (part.type === "chart" && part.artifact) {
            return <InlineChart key={i} artifact={part.artifact} />;
          }
          if (part.type === "table" && part.artifact) {
            return <InlineTable key={i} artifact={part.artifact} />;
          }
          if (part.type === "callout" && part.artifact) {
            return <CalloutBlock key={i} artifact={part.artifact} />;
          }
          if (part.type === "comparison" && part.artifact) {
            return <ComparisonBlock key={i} artifact={part.artifact} />;
          }
          if (part.type === "quote" && part.artifact) {
            return <QuoteBlock key={i} artifact={part.artifact} />;
          }
          return null;
        })}
      </div>
      {showOverrides && (
        <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid="mode-overrides">
          {canShorter && (
            <button
              onClick={() => onOverride!({ forceMode: shorterTo })}
              className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
              data-testid="button-shorter"
            >
              <ArrowUp className="w-3 h-3" /> Shorter
            </button>
          )}
          {canDeeper && (
            <button
              onClick={() => onOverride!({ forceMode: deeperTo })}
              className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
              data-testid="button-deeper"
            >
              <ArrowDown className="w-3 h-3" /> Deeper
            </button>
          )}
          <button
            onClick={() => onOverride!({ refreshBrain: true })}
            className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
            data-testid="button-refresh-data"
          >
            <RefreshCw className="w-3 h-3" /> Refresh data
          </button>
        </div>
      )}
    </div>
  );
}

interface ThinkingStep {
  type: "thinking" | "tool_start" | "tool_result" | "analyzing" | "complete";
  label: string;
  detail?: string;
  round?: number;
  totalRounds?: number;
  timestamp?: number;
}

function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const [expanded, setExpanded] = useState(true);
  if (steps.length === 0) return null;

  const latestLabel = steps[steps.length - 1]?.label || "Thinking...";
  const isComplete = steps[steps.length - 1]?.type === "complete";

  return (
    <div className="mb-4 rounded-lg border border-border/30 bg-card/20 overflow-hidden" data-testid="thinking-panel">
      <button
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid="button-toggle-thinking"
      >
        {!isComplete && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary/60" />}
        {isComplete && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />}
        <span className="text-xs text-foreground/60 flex-1 truncate">{latestLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${expanded ? "" : "-rotate-90"}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 py-0.5">
              {step.type === "thinking" && <Brain className="h-3.5 w-3.5 text-blue-400/60 mt-0.5 shrink-0" />}
              {step.type === "tool_start" && <Search className="h-3.5 w-3.5 text-amber-400/60 mt-0.5 shrink-0" />}
              {step.type === "tool_result" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400/60 mt-0.5 shrink-0" />}
              {step.type === "analyzing" && <BarChart3 className="h-3.5 w-3.5 text-purple-400/60 mt-0.5 shrink-0" />}
              {step.type === "complete" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/60 mt-0.5 shrink-0" />}
              <span className="text-[11px] text-foreground/50 leading-relaxed">{step.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ShareBar({ sessionId, session }: { sessionId: number; session?: Session }) {
  const { toast } = useToast();
  const [shareToken, setShareToken] = useState<string | null>(session?.shareToken || null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setShareToken(session?.shareToken || null);
  }, [session?.shareToken, sessionId]);

  const shareUrl = shareToken ? `${window.location.origin}/shared/research/${shareToken}` : null;

  const handleShare = async () => {
    setLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/sessions/${sessionId}/share`, {
        method: "POST",
        headers: { ...authHeaders },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setShareToken(data.shareToken);
      const url = `${window.location.origin}/shared/research/${data.shareToken}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link Copied", description: "Read-only share link copied to clipboard." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUnshare = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/research/sessions/${sessionId}/share`, {
        method: "DELETE",
        headers: { ...authHeaders },
        credentials: "include",
      });
      setShareToken(null);
      toast({ title: "Unshared", description: "Share link has been revoked." });
    } catch {}
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/20 bg-card/10">
      {!shareToken ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[9px] gap-1 text-muted-foreground/60 hover:text-foreground/80"
          onClick={handleShare}
          disabled={loading}
          data-testid="button-share-session"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
          Share
        </Button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3 w-3 text-emerald-500/60" />
          <span className="text-[9px] text-muted-foreground/50 truncate max-w-[200px]">{shareUrl}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={handleCopy}
            data-testid="button-copy-share-link"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Link2 className="h-3 w-3 text-muted-foreground/50" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-destructive"
            onClick={handleUnshare}
            data-testid="button-unshare-session"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function SessionResearch() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"sessions" | "models">("sessions");
  // When a saved-model is clicked we set this so the messages effect can
  // scroll to that specific message after the session's messages load.
  const [targetMessageId, setTargetMessageId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user,
  });

  const savedModelsQuery = useQuery<Array<{
    id: number;
    conversationId: number;
    conversationTitle: string;
    createdAt: string;
    preview: string;
  }>>({
    queryKey: ["/api/research/saved-models"],
    enabled: !!user,
  });

  const messagesQuery = useQuery<SessionMessage[]>({
    queryKey: [`/api/research/sessions/${activeSessionId}/messages`],
    enabled: !!activeSessionId,
  });

  // After loading a session triggered by a saved-model click, scroll to that
  // message and pulse-highlight it briefly. The DOM hook is the existing
  // data-testid="msg-assistant-{id}" attribute on MessageBubble.
  // Important: wait until the query has finished fetching AND the loaded
  // messages actually contain the target — otherwise we could fire against
  // the previous session's stale message list.
  useEffect(() => {
    if (!targetMessageId || messagesQuery.isFetching) return;
    const data = messagesQuery.data;
    if (!data?.some((m) => m.id === targetMessageId)) return;
    const el = document.querySelector(`[data-testid="msg-assistant-${targetMessageId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-purple-400/40", "rounded");
      setTimeout(() => el.classList.remove("ring-2", "ring-purple-400/40", "rounded"), 2000);
      setTargetMessageId(null);
    }
  }, [targetMessageId, messagesQuery.data, messagesQuery.isFetching]);

  const createSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/research/sessions", {});
      return res.json();
    },
    onSuccess: (session: Session) => {
      setActiveSessionId(session.id);
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    },
    onError: (err: any) => {
      setPendingUserMsg(null);
      setIsSending(false);
      toast({ title: "Error", description: "Failed to create session: " + err.message, variant: "destructive" });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/research/sessions/${id}`);
    },
    onSuccess: (_, deletedId) => {
      if (activeSessionId === deletedId) setActiveSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    },
  });

  const sendStreamingMessage = useCallback(async (sessionId: number, message: string, opts?: { forceMode?: ResearchMode; refreshBrain?: boolean }) => {
    setIsSending(true);
    setThinkingSteps([]);

    try {
      const authHeaders = await getAuthHeaders();
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders };

      const res = await fetch(`/api/research/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ message, forceMode: opts?.forceMode, refreshBrain: opts?.refreshBrain }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";
      let gotDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ") && currentEvent) {
            const rawData = line.slice(6);
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === "step") {
                setThinkingSteps(prev => [...prev, { ...data, timestamp: Date.now() }]);
              } else if (currentEvent === "done") {
                gotDone = true;
              } else if (currentEvent === "error") {
                throw new Error(data.message || "Research failed");
              }
            } catch (e: any) {
              if (currentEvent === "error") throw e;
            }
            currentEvent = "";
          } else if (line.startsWith(":")) {
            // SSE comment/keepalive — ignore
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Research failed", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: [`/api/research/sessions/${sessionId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ["/api/research/sessions"] });
    } finally {
      setPendingUserMsg(null);
      setIsSending(false);
    }
  }, [toast]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data, isSending, thinkingSteps]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || isSending) return;

    setPendingUserMsg(msg);
    setInput("");

    if (!activeSessionId) {
      createSessionMutation.mutate(undefined, {
        onSuccess: (session: Session) => {
          setActiveSessionId(session.id);
          setTimeout(() => sendStreamingMessage(session.id, msg), 100);
        },
      });
    } else {
      sendStreamingMessage(activeSessionId, msg);
    }
  }, [input, activeSessionId, isSending, sendStreamingMessage]);

  const handleDiveDeep = useCallback((selectedText: string) => {
    if (!activeSessionId || isSending) return;
    const diveMsg = `Dive deeper into this specific section. Provide more detailed analysis, supporting data, and nuance:\n\n"${selectedText}"`;
    setPendingUserMsg(diveMsg);
    sendStreamingMessage(activeSessionId, diveMsg);
  }, [activeSessionId, isSending, sendStreamingMessage]);

  const handleAddToReport = useCallback(async (msgId: number) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/messages/${msgId}/save-to-report`, {
        method: "POST",
        headers: { ...authHeaders },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed to save" }));
        throw new Error(err.message);
      }
      const data = await res.json();
      toast({ title: "Saved to Reports", description: `Report "${data.title}" created. View it in your reports.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const sessions = sessionsQuery.data || [];
  const savedModels = savedModelsQuery.data || [];
  const messages = messagesQuery.data || [];

  const suggestedQueries = [
    "Compare TVL growth of Aave vs Compound vs Morpho over the last year",
    "Show me Hyperliquid's derivatives volume trend",
    "Which DEXs have the highest revenue in the last 30 days?",
    "What's the P/E ratio trend for Ethereum L2s?",
  ];

  return (
    <div className="flex h-[calc(100vh-48px)]" data-testid="session-research-page">
      <div className="w-56 border-r border-border/30 flex flex-col bg-card/20 shrink-0">
        <div className="p-3 border-b border-border/30">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[10px] h-7 gap-1.5"
            onClick={() => { setActiveSessionId(null); setSidebarTab("sessions"); }}
            data-testid="button-new-session"
          >
            <Plus className="h-3 w-3" />
            New Session
          </Button>
        </div>
        <div className="flex border-b border-border/30 text-[9px] uppercase tracking-wider">
          {(["sessions", "models"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              className={`flex-1 py-2 transition-colors ${
                sidebarTab === tab
                  ? "text-foreground/90 border-b-2 border-primary/60 -mb-px bg-muted/20"
                  : "text-muted-foreground/50 hover:text-foreground/70"
              }`}
              data-testid={`sidebar-tab-${tab}`}
            >
              {tab === "sessions" ? `Sessions (${sessions.length})` : `Models (${savedModels.length})`}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === "sessions" && (
            <>
              {sessions.map(s => (
                <div
                  key={s.id}
                  className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer border-b border-border/10 transition-colors ${
                    activeSessionId === s.id ? "bg-primary/5" : "hover:bg-muted/30"
                  }`}
                  onClick={() => setActiveSessionId(s.id)}
                  data-testid={`session-item-${s.id}`}
                >
                  <MessageSquare className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  <span className="text-[10px] text-foreground/70 truncate flex-1">{s.title}</span>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                    onClick={(e) => { e.stopPropagation(); deleteSessionMutation.mutate(s.id); }}
                    data-testid={`button-delete-session-${s.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {sessions.length === 0 && !sessionsQuery.isLoading && (
                <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">No sessions yet. Start a new research session.</p>
              )}
            </>
          )}
          {sidebarTab === "models" && (
            <>
              {savedModels.map((m) => (
                <button
                  key={m.id}
                  className="group w-full text-left flex items-start gap-1.5 px-3 py-2 cursor-pointer border-b border-border/10 hover:bg-muted/30 transition-colors"
                  onClick={() => {
                    setActiveSessionId(m.conversationId);
                    setTargetMessageId(m.id);
                  }}
                  data-testid={`saved-model-item-${m.id}`}
                >
                  <FileText className="h-3 w-3 text-purple-400/60 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-foreground/85 truncate">{m.preview || m.conversationTitle}</p>
                    <p className="text-[8px] text-muted-foreground/50 mt-0.5">
                      {format(new Date(m.createdAt), "MMM d, yyyy")}
                    </p>
                  </div>
                </button>
              ))}
              {savedModels.length === 0 && !savedModelsQuery.isLoading && (
                <p className="text-[9px] text-muted-foreground/40 text-center py-8 px-3">
                  No saved models yet. Run a deep dive — "build me a model on X" — and it'll show up here.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {activeSessionId && messages.length > 0 && (
          <ShareBar sessionId={activeSessionId} session={sessions.find(s => s.id === activeSessionId)} />
        )}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {!activeSessionId && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
              <h2 className="text-lg font-bold text-foreground/90 mb-2">Session Research</h2>
              <p className="text-sm text-muted-foreground/60 mb-8 text-center leading-relaxed">
                Ask anything about DeFi protocols, on-chain data, or market trends. Charts and tables render inline.
              </p>
              <div className="grid grid-cols-2 gap-3 w-full">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    className="text-left text-[13px] text-foreground/60 hover:text-foreground/90 bg-card/40 hover:bg-card/60 rounded-lg border border-border/30 hover:border-border/50 px-4 py-3 transition-colors leading-relaxed"
                    onClick={() => {
                      setInput(q);
                      inputRef.current?.focus();
                    }}
                    data-testid={`suggested-query-${i}`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              <DiveDeepButton onDiveDeep={handleDiveDeep} />
              {messages.map((msg, idx) => {
                const isLast = idx === messages.length - 1 && msg.role === "assistant";
                const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content;
                return (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    isLast={isLast}
                    busy={isSending}
                    lastUserMessage={lastUserMsg}
                    onDiveDeep={handleDiveDeep}
                    onAddToReport={handleAddToReport}
                    onOverride={(action) => {
                      if (!activeSessionId || !lastUserMsg) return;
                      sendStreamingMessage(activeSessionId, lastUserMsg, action);
                    }}
                  />
                );
              })}
              {pendingUserMsg && isSending && (
                <div className="flex justify-end mb-5" data-testid="msg-user-pending">
                  <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
                    <p className="text-[13px] text-foreground/90">{pendingUserMsg}</p>
                  </div>
                </div>
              )}
              {isSending && <ThinkingPanel steps={thinkingSteps} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-border/30 px-8 py-4 bg-background/80 backdrop-blur">
          <div className="max-w-3xl mx-auto flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about protocols, metrics, or on-chain data..."
              className="flex-1 resize-none rounded-lg border border-border/40 bg-card/30 px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[44px] max-h-[140px]"
              rows={1}
              disabled={isSending}
              data-testid="input-research-message"
            />
            <Button
              size="sm"
              className="h-10 w-10 p-0 shrink-0 rounded-lg"
              onClick={handleSend}
              disabled={!input.trim() || isSending}
              data-testid="button-send-message"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
