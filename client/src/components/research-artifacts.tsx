import { useState, useRef, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { format } from "date-fns";
import {
  Loader2, CheckCircle2, ChevronDown, Brain, Search, BarChart3,
  Share2, Link2, Check, X, Lightbulb, AlertTriangle, Zap, Eye,
  Quote as QuoteIcon, ArrowDown, ArrowUp, RefreshCw,
  Bookmark, Microscope, Table2, TrendingUp, PieChart as PieChartIcon,
  AreaChart as AreaChartIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { ArtifactActions } from "@/components/artifact-actions";
import {
  type Artifact, type SessionMessage, type Session,
  type ResearchMode, type ThinkingStep,
  CHART_COLORS, inferFormat, formatValue, formatAxisTick,
  extractMode, parseContentAndArtifacts,
  parseMarkdownTableCells, isTableSeparator, isTableRow,
} from "@/lib/research-utils";

type ChartViewMode = "line" | "bar" | "area" | "cumulative" | "pie";

const CHART_VIEW_OPTIONS: { mode: ChartViewMode; icon: typeof TrendingUp; tip: string }[] = [
  { mode: "line", icon: TrendingUp, tip: "Line" },
  { mode: "bar", icon: BarChart3, tip: "Bar" },
  { mode: "area", icon: AreaChartIcon, tip: "Area" },
  { mode: "cumulative", icon: ArrowUp, tip: "Cumulative" },
  { mode: "pie", icon: PieChartIcon, tip: "Breakdown" },
];

export function InlineChart({ artifact, hideSave, compact }: { artifact: Artifact; hideSave?: boolean; compact?: boolean }) {
  const { chartConfig, data, title, subtitle, source, refreshRecipe } = artifact;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!chartConfig || !data?.length) return null;

  const { chartType: defaultChartType, xAxis, yAxes } = chartConfig;
  const hasExplicitDualAxis = yAxes.length > 1 && yAxes.some((y: any) => y?.yAxisId === "right" || y?.orientation === "right");
  const isComposedOrDualAxis = defaultChartType === "composed" || hasExplicitDualAxis || (yAxes.length > 1 && inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format) !== inferFormat(yAxes[1]?.dataKey, yAxes[1]?.label, yAxes[1]?.format));

  const allFormats = yAxes.map(y => inferFormat(y.dataKey, y.label, y.format));
  const hasRateOrPercent = allFormats.some(f => f === "percent" || f === "ratio");

  const [viewMode, setViewMode] = useState<ChartViewMode>(
    (["line", "bar", "area"].includes(defaultChartType) ? defaultChartType : "line") as ChartViewMode
  );

  const cumulativeData = useMemo(() => {
    if (viewMode !== "cumulative") return data;
    const result = data.map((row: any) => ({ ...row }));
    for (const y of yAxes) {
      let running = 0;
      for (const row of result) {
        const val = Number(row[y.dataKey]);
        if (!isNaN(val)) running += val;
        row[y.dataKey] = running;
      }
    }
    return result;
  }, [data, yAxes, viewMode]);

  const pieData = useMemo(() => {
    if (viewMode !== "pie" || !data.length) return [];
    const primaryKey = yAxes[0]?.dataKey;
    if (!primaryKey) return [];
    if (yAxes.length > 1) {
      const lastRow = data[data.length - 1];
      return yAxes.map((y, i) => ({
        name: y.label || y.dataKey.replace(/_/g, " "),
        value: Math.abs(Number(lastRow?.[y.dataKey]) || 0),
        color: CHART_COLORS[i % CHART_COLORS.length],
      })).filter(d => d.value > 0);
    }
    const recentSlice = data.slice(-Math.min(10, data.length));
    return recentSlice.map((row: any, i: number) => ({
      name: String(row[xAxis.dataKey] || `Item ${i}`),
      value: Math.abs(Number(row[primaryKey]) || 0),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })).filter(d => d.value > 0);
  }, [data, yAxes, xAxis, viewMode]);

  const activeData = viewMode === "cumulative" ? cumulativeData : data;

  const isDate = xAxis.format === "date" || (data[0]?.[xAxis.dataKey] && /^\d{4}-\d{2}/.test(String(data[0][xAxis.dataKey])));

  const lastRow = activeData[activeData.length - 1];
  const primaryKey = yAxes[0]?.dataKey;
  const latestRaw = primaryKey ? lastRow?.[primaryKey] : undefined;
  const latestFmt = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
  const latestValue = latestRaw != null ? formatValue(latestRaw, viewMode === "cumulative" ? "number" : latestFmt) : null;

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
    if (viewMode === "pie") {
      if (pieData.length === 0) {
        return (
          <BarChart data={[]} margin={{ top: 12, right: 20, left: 4, bottom: 8 }}>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.35)" fontSize={13}>
              No breakdown available for this data
            </text>
          </BarChart>
        );
      }
      const pieFmt = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(1)}%`}
            labelLine={{ stroke: "rgba(255,255,255,0.3)", strokeWidth: 1 }}
          >
            {pieData.map((entry: any, i: number) => (
              <Cell key={i} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-tooltip-bg)",
              border: "1px solid var(--color-tooltip-border)",
              borderRadius: "10px", fontSize: "13px", padding: "10px 14px",
              color: "var(--color-tooltip-text)",
              backdropFilter: "blur(16px)",
            }}
            formatter={(value: any) => [formatValue(value, pieFmt), ""]}
          />
          {pieData.length > 1 && (
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.55)" }}
            />
          )}
        </PieChart>
      );
    }

    const effectiveChartType = viewMode === "cumulative" ? "area" : viewMode;
    const commonProps = { data: activeData, margin: { top: 12, right: needsDualAxis ? 56 : 20, left: 4, bottom: 8 } };
    const grid = <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.06)" vertical={false} />;
    const xAx = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={xTickFormatter}
        tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
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
        wrapperStyle={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", paddingBottom: "4px" }}
        formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    if (isComposedOrDualAxis) {
      return (
        <ComposedChart {...commonProps}>
          {grid}{xAx}
          <YAxis
            yAxisId="left"
            tickFormatter={(v: number) => formatAxisTick(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
            tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
            axisLine={false}
            tickLine={false}
            width={60}
            tickMargin={4}
          />
          {yAxes.length > 1 && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => formatAxisTick(v, inferFormat(yAxes[1]?.dataKey, yAxes[1]?.label, yAxes[1]?.format))}
              tick={{ fontSize: 11, fill: "rgba(255,255,255,0.35)" }}
              axisLine={false}
              tickLine={false}
              width={56}
              tickMargin={4}
            />
          )}
          {tip}{leg}
          {yAxes.map((y, i) => {
            const axisId = i === 0 ? "left" : "right";
            const yChartType = y.chartType || (i === 0 ? "bar" : "line");
            if (yChartType === "bar") {
              return <Bar key={y.dataKey} yAxisId={axisId} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} maxBarSize={48} />;
            }
            if (yChartType === "area") {
              return <Area key={y.dataKey} yAxisId={axisId} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.03} dot={false} />;
            }
            return <Line key={y.dataKey} yAxisId={axisId} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} activeDot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "#fff", strokeWidth: 1 }} />;
          })}
        </ComposedChart>
      );
    }

    const yAx = (
      <YAxis
        tickFormatter={(v: number) => formatAxisTick(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
        tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
        axisLine={false}
        tickLine={false}
        width={60}
        tickMargin={4}
      />
    );

    if (effectiveChartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      );
    }
    if (effectiveChartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Area key={y.dataKey} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={viewMode === "cumulative" ? 0.15 : 0.04} dot={false} />
          ))}
        </AreaChart>
      );
    }
    return (
      <LineChart {...commonProps}>
        {grid}{xAx}{yAx}{tip}{leg}
        {yAxes.map((y, i) => (
          <Line key={y.dataKey} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} activeDot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "#fff", strokeWidth: 1 }} />
        ))}
      </LineChart>
    );
  };

  const isDisabled = (mode: ChartViewMode): { disabled: boolean; reason?: string } => {
    if (mode === "cumulative" && hasRateOrPercent) {
      return { disabled: true, reason: "Cumulative doesn't apply to rates/percentages" };
    }
    if (isComposedOrDualAxis && !["cumulative", "pie"].includes(mode) && mode !== (["line", "bar", "area"].includes(defaultChartType) ? defaultChartType : "line")) {
      return { disabled: true, reason: "Not available for multi-axis charts" };
    }
    return { disabled: false };
  };

  const [savedChartId, setSavedChartId] = useState<string | null>(null);

  const handleSaveChart = async () => {
    setSaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/research/charts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          title: title || "Untitled Chart",
          chartType: defaultChartType,
          chartConfig,
          data,
          description: subtitle || source || "",
          ...(refreshRecipe ? { refreshRecipe } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to save");
      const result = await res.json().catch(() => ({}));
      if (result?.id) setSavedChartId(String(result.id));
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      toast({ title: "Saved to Library", description: `"${title}" — now refreshable as live data.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-lg border border-border/30 bg-card/40 shadow-sm ${compact ? "my-0 p-2" : "my-5 p-5"}`} style={{ overflow: "visible" }}>
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          {title && <h4 className={`font-semibold text-foreground/90 tracking-tight ${compact ? "text-xs" : "text-sm"}`}>{title}</h4>}
          {subtitle && <p className={`font-medium text-emerald-400 uppercase tracking-wider mt-1 leading-snug ${compact ? "text-[9px] line-clamp-1" : "text-[11px]"}`}>{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {latestValue && (
            <div className="text-right">
              <p className={`font-bold font-mono tabular-nums tracking-tight leading-none ${compact ? "text-base" : "text-xl"}`} style={{ color: CHART_COLORS[0] }}>{latestValue}</p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Latest</p>
            </div>
          )}
          {!hideSave && !savedChartId && (
            <button
              onClick={handleSaveChart}
              disabled={saving || saved}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                saved
                  ? "bg-amber-500/10 text-amber-500/90 border-amber-500/30"
                  : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 border-border/30"
              }`}
              data-testid="button-save-chart"
              title="Save to library"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
              {saved ? "Saved" : "Save"}
            </button>
          )}
          {!hideSave && savedChartId && (
            <ArtifactActions chartId={savedChartId} chartTitle={title} size="xs" />
          )}
        </div>
      </div>
      {!compact && (
        <div className="flex items-center gap-1 mt-2 mb-3" data-testid="chart-type-toggle">
          {CHART_VIEW_OPTIONS.map(({ mode, icon: Icon, tip }) => {
            const { disabled, reason } = isDisabled(mode);
            if (disabled) return null;
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                title={tip}
                data-testid={`chart-toggle-${mode}`}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                  viewMode === mode
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/30 border border-transparent"
                }`}
              >
                <Icon size={12} strokeWidth={viewMode === mode ? 2.2 : 1.5} />
                {tip}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ overflow: "visible" }} className={compact ? "mt-1" : "mt-2"}>
        <ResponsiveContainer width="100%" height={compact ? 280 : 300} style={{ overflow: "visible" }}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
      {source && !compact && (
        <div className="border-t border-border/20 flex items-center justify-between mt-2 pt-2">
          <p className="text-[11px] text-emerald-400/70 italic">Source: {source}</p>
          <p className="text-[10px] text-muted-foreground/50">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
      )}
    </div>
  );
}

export function InlineTable({ artifact, compact }: { artifact: Artifact; compact?: boolean }) {
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
    <div className={`rounded-lg border border-border/30 bg-card/40 overflow-hidden shadow-sm ${compact ? "my-0" : "my-5"}`}>
      {title && <h4 className={`font-semibold text-foreground/90 tracking-tight ${compact ? "text-xs px-2 pt-2 pb-1" : "text-sm px-5 pt-4 pb-2"}`}>{title}</h4>}
      <div className={`overflow-x-auto ${compact ? "max-h-[300px] overflow-y-auto" : ""}`}>
        <table className={`w-full ${compact ? "text-[10px]" : "text-[13px]"}`}>
          <thead>
            <tr className="border-b border-border/40 bg-muted/20">
              {cols.map(c => (
                <th key={c} className={`text-left font-semibold text-muted-foreground/80 uppercase tracking-wider ${compact ? "px-2 py-1.5 text-[9px]" : "px-5 py-2.5 text-xs"}`}>{c.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, compact ? 20 : 50).map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/15 last:border-0 hover:bg-muted/10 transition-colors even:bg-muted/5">
                {cols.map(c => (
                  <td key={c} className={`text-foreground/85 font-mono ${compact ? "px-2 py-1 text-[10px]" : "px-5 py-2.5 text-[13px]"}`}>{formatValue(resolveCell(row, c))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MetricCards({ artifact }: { artifact: Artifact }) {
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

export function CalloutBlock({ artifact }: { artifact: Artifact }) {
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

export function ComparisonBlock({ artifact }: { artifact: Artifact }) {
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

export function QuoteBlock({ artifact }: { artifact: Artifact }) {
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

export function MarkdownText({ text }: { text: string }) {
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

export function ModeBadge({ mode }: { mode: ResearchMode }) {
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

export function DiveDeepButton({ onDiveDeep }: { onDiveDeep: (text: string) => void }) {
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

export function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
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

export function ShareBar({ sessionId, session }: { sessionId: number; session?: Session }) {
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

export function MessageBubble({
  msg,
  onOverride,
  onDiveDeep,
  onAddToReport,
  onSaveAsModel,
  onContinue,
  isLast,
  busy,
  lastUserMessage,
}: {
  msg: SessionMessage;
  onOverride?: (action: { forceMode?: ResearchMode; refreshBrain?: boolean }) => void;
  onDiveDeep?: (text: string) => void;
  onAddToReport?: (msgId: number) => Promise<void>;
  onSaveAsModel?: (msgId: number, artifactIndex?: number) => Promise<void>;
  onContinue?: () => void;
  isLast?: boolean;
  busy?: boolean;
  lastUserMessage?: string;
}) {
  const isUser = msg.role === "user";
  const [reportState, setReportState] = useState<"idle" | "saving" | "saved">("idle");
  const [modelState, setModelState] = useState<"idle" | "saving" | "saved">("idle");

  if (isUser) {
    return (
      <div className="flex justify-end mb-5" data-testid={`msg-user-${msg.id}`}>
        <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
          <p className="text-[13px] text-foreground/90">{msg.content}</p>
        </div>
      </div>
    );
  }

  const { mode, cleaned, needsContinuation } = extractMode(msg.content);
  const parts = parseContentAndArtifacts(cleaned, msg.artifacts as Artifact[] | null);

  const artifacts: any[] = Array.isArray(msg.artifacts) ? msg.artifacts : [];
  const hasTableArtifacts = artifacts.some((a: any) => a.type === "table" || a.type === "metric_cards" || a.type === "chart" || a.type === "comparison");

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
            className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-colors ${
              reportState === "saved"
                ? "border-emerald-400/40 text-emerald-400 bg-emerald-400/5"
                : reportState === "saving"
                  ? "border-border/40 text-muted-foreground/40 cursor-wait"
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
          const isArtifact = part.type === "table" || part.type === "chart" || part.type === "metric_cards" || part.type === "comparison";
          const artifactEl = (() => {
            if (part.type === "text" && part.content) return <MarkdownText key={i} text={part.content} />;
            if (part.type === "metric_cards" && part.artifact) return <MetricCards key={i} artifact={part.artifact} />;
            if (part.type === "chart" && part.artifact) return <InlineChart key={i} artifact={part.artifact} />;
            if (part.type === "table" && part.artifact) return <InlineTable key={i} artifact={part.artifact} />;
            if (part.type === "callout" && part.artifact) return <CalloutBlock key={i} artifact={part.artifact} />;
            if (part.type === "comparison" && part.artifact) return <ComparisonBlock key={i} artifact={part.artifact} />;
            if (part.type === "quote" && part.artifact) return <QuoteBlock key={i} artifact={part.artifact} />;
            return null;
          })();
          if (isArtifact && onSaveAsModel && part.artifactIdx !== undefined) {
            return (
              <div key={i}>
                {artifactEl}
                <div className="flex items-center gap-2 mt-1.5 mb-3">
                  <button
                    disabled={modelState !== "idle"}
                    onClick={async () => {
                      setModelState("saving");
                      try {
                        await onSaveAsModel(msg.id, part.artifactIdx);
                        setModelState("saved");
                        setTimeout(() => setModelState("idle"), 3000);
                      } catch {
                        setModelState("idle");
                      }
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 transition-colors ${
                      modelState === "saved"
                        ? "border-green-400/40 text-green-400 bg-green-400/5"
                        : modelState === "saving"
                          ? "border-border/30 text-muted-foreground/40 cursor-wait"
                          : "border-border/30 text-muted-foreground/50 hover:text-foreground hover:border-border/50 hover:bg-muted/20"
                    }`}
                    data-testid={`button-save-model-${msg.id}-${i}`}
                  >
                    {modelState === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : modelState === "saved" ? <Check className="w-3 h-3" /> : <Table2 className="w-3 h-3" />}
                    {modelState === "saving" ? "Saving..." : modelState === "saved" ? "Saved" : "Save as Model"}
                  </button>
                </div>
              </div>
            );
          }
          return artifactEl;
        })}
      </div>
      {needsContinuation && isLast && !busy && onContinue && (
        <div className="mt-5 flex justify-center" data-testid="continue-analysis-section">
          <button
            onClick={onContinue}
            className="group/btn flex items-center gap-3 px-6 py-3 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
            data-testid="button-continue-analysis"
          >
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center group-hover/btn:bg-primary/25 transition-colors">
              <RefreshCw className="w-4 h-4 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground/90">Continue Analysis</p>
              <p className="text-[11px] text-muted-foreground/60">Pick up where we left off and complete the synthesis</p>
            </div>
          </button>
        </div>
      )}
      {showOverrides && !needsContinuation && (
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
