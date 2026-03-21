import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { DashboardChart } from "@shared/schema";
import {
  Loader2,
  RefreshCw,
  Trash2,
  Send,
  BarChart3,
  AlertTriangle,
  Table2,
  LineChart as LineChartIcon,
  ChevronDown,
  Check,
} from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { format } from "date-fns";

interface DataTabProps {
  companyId: string;
  companyName: string;
}

const CHART_COLORS = [
  "#38bdf8", "#2dd4bf", "#818cf8", "#a78bfa",
  "#4ade80", "#f472b6", "#fb923c", "#facc15",
];

function smartFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") return `${value.toFixed(1)}%`;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function smartTooltip(value: number, fmt?: string): string {
  if (fmt === "currency") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (fmt === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function toUnixSec(val: any): number | null {
  if (typeof val === "number") {
    if (val > 1e12) return val / 1000;
    if (val > 1e8) return val;
    return null;
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return d.getTime() / 1000;
  }
  return null;
}

function isDateColumn(col: string, rows: any[]): boolean {
  if (!/date|time|day|week|month|block_time|period/i.test(col)) return false;
  const sample = rows[0]?.[col];
  if (typeof sample === "string" && /\d{4}/.test(sample)) return true;
  if (typeof sample === "number" && sample > 1e8) return true;
  return false;
}

function guessFormat(col: string): string {
  if (/usd|price|fee|revenue|volume|amount|cost|tvl|value|earnings|profit|market_cap|fdv/i.test(col)) return "currency";
  if (/pct|percent|ratio|apy|apr|growth|change|rate/i.test(col)) return "percent";
  return "number";
}

function buildDateFormatter(data: any[], xKey: string) {
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const d of data) {
    const ts = d[xKey];
    if (typeof ts !== "number") continue;
    try {
      const yr = new Date(ts * 1000).getFullYear();
      if (yr < minYear) minYear = yr;
      if (yr > maxYear) maxYear = yr;
    } catch {}
  }
  const spansYears = maxYear > minYear && minYear > 1970;

  return {
    tickFormatter: (ts: number) => {
      try {
        const d = new Date(ts * 1000);
        if (d.getFullYear() < 1971) return "";
        if (spansYears) return `${format(d, "MMM d")}\n${format(d, "yyyy")}`;
        return format(d, "MMM d");
      } catch { return String(ts); }
    },
    tooltipFormatter: (ts: any) => {
      if (typeof ts !== "number") return String(ts);
      try {
        const d = new Date(ts * 1000);
        if (d.getFullYear() < 1971) return String(ts);
        return format(d, "MMM d, yyyy");
      } catch { return String(ts); }
    },
  };
}

function parseSubtitle(description: string | null | undefined): { subtitle: string; desc: string } {
  if (!description) return { subtitle: "", desc: "" };
  if (description.includes("|||")) {
    const [sub, ...rest] = description.split("|||");
    return { subtitle: sub, desc: rest.join("|||") };
  }
  return { subtitle: "", desc: description };
}

function computeHeadlineStat(data: any[], yAxes: any[]): { value: string; label: string } | null {
  if (!data || data.length === 0 || !yAxes || yAxes.length === 0) return null;
  const primary = yAxes[0];
  const key = primary.dataKey;
  const fmt = primary.format;

  const values = data.map(d => d[key]).filter(v => typeof v === "number" && !isNaN(v));
  if (values.length === 0) return null;

  const latest = values[values.length - 1];
  const sum = values.reduce((a: number, b: number) => a + b, 0);

  if (/revenue|fee|volume|earnings|profit/i.test(key)) {
    return { value: smartFormat(sum, fmt || "currency"), label: "Total" };
  }
  if (/price|tvl|market_cap|fdv/i.test(key)) {
    return { value: smartFormat(latest, fmt || "currency"), label: "Latest" };
  }
  if (/holder|count|user|address/i.test(key)) {
    return { value: smartFormat(latest, "number"), label: "Latest" };
  }
  return { value: smartFormat(latest, fmt), label: "Latest" };
}

function ColumnPicker({ label, columns, selected, onSelect, multi }: {
  label: string;
  columns: string[];
  selected: string | string[];
  onSelect: (val: string | string[]) => void;
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedArr = Array.isArray(selected) ? selected : [selected];
  const displayText = selectedArr.length > 0
    ? selectedArr.map(s => s.replace(/_/g, " ")).join(", ")
    : "Select...";

  return (
    <div className="relative">
      <label className="text-[9px] text-white/25 uppercase tracking-wider block mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] rounded border border-white/[0.08] bg-white/[0.02] text-white/60 hover:border-white/[0.15] transition-colors text-left"
        data-testid={`picker-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-white/20" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-40 overflow-auto rounded border border-white/[0.1] bg-[rgb(18,18,22)] shadow-lg">
          {columns.map(col => {
            const isSelected = selectedArr.includes(col);
            return (
              <button
                key={col}
                type="button"
                className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-white/[0.04] flex items-center gap-1.5 ${isSelected ? 'text-sky-400' : 'text-white/50'}`}
                onClick={() => {
                  if (multi) {
                    const newArr = isSelected
                      ? selectedArr.filter(s => s !== col)
                      : [...selectedArr, col];
                    onSelect(newArr);
                  } else {
                    onSelect(col);
                    setOpen(false);
                  }
                }}
              >
                {multi && isSelected && <Check className="w-3 h-3" />}
                {multi && !isSelected && <span className="w-3" />}
                {col.replace(/_/g, " ")}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChartBuilder({ chart, data, onClose }: {
  chart: DashboardChart;
  data: any[];
  onClose: () => void;
}) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const columns = data[0] ? Object.keys(data[0]) : [];
  const dateCols = columns.filter(c => isDateColumn(c, data));
  const numCols = columns.filter(c => typeof data[0]?.[c] === "number" && data[0][c] > 0 ? true : typeof data[0]?.[c] === "number");

  const [xCol, setXCol] = useState(dateCols[0] || columns[0] || "");
  const [yCols, setYCols] = useState<string[]>(numCols.length > 0 ? [numCols[0]] : []);
  const [chartType, setChartType] = useState<string>("line");

  const saveMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const isXDate = isDateColumn(xCol, data);
      const chartConfig = {
        xAxis: { dataKey: xCol, label: xCol.replace(/_/g, " "), type: isXDate ? "date" : "category" },
        yAxes: yCols.map((col, i) => ({
          dataKey: col,
          label: col.replace(/_/g, " "),
          color: CHART_COLORS[i % CHART_COLORS.length],
          yAxisId: "left",
          format: guessFormat(col),
        })),
      };
      const res = await fetch(`/api/charts/${chart.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ chartType, chartConfig }),
      });
      if (!res.ok) throw new Error("Failed to save chart config");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", chart.companyId, "charts"] });
      toast({ title: "Chart created" });
      onClose();
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  return (
    <div className="border-t border-white/[0.06] mt-3 pt-3">
      <p className="text-[10px] text-white/30 uppercase tracking-wider font-medium mb-3">Chart Builder</p>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <ColumnPicker
          label="X Axis"
          columns={columns}
          selected={xCol}
          onSelect={(v) => setXCol(v as string)}
        />
        <ColumnPicker
          label="Y Axis (values)"
          columns={numCols}
          selected={yCols}
          onSelect={(v) => setYCols(v as string[])}
          multi
        />
        <div>
          <label className="text-[9px] text-white/25 uppercase tracking-wider block mb-1">Chart Type</label>
          <div className="flex gap-1">
            {(["line", "bar", "area"] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                className={`px-2 py-1.5 text-[10px] rounded border transition-colors ${chartType === t ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-white/[0.08] text-white/30 hover:text-white/50'}`}
                data-testid={`charttype-${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!xCol || yCols.length === 0 || saveMutation.isPending}
            className="px-3 py-1.5 text-[10px] rounded bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 border border-sky-500/20 disabled:opacity-30 transition-colors"
            data-testid="button-save-chart"
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Create Chart"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DataCard({ chart }: { chart: DashboardChart }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [view, setView] = useState<"auto" | "table" | "chart">("auto");
  const [showBuilder, setShowBuilder] = useState(false);

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const res = await fetch(`/api/charts/${chart.id}/refresh`, { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", chart.companyId, "charts"] });
      toast({ title: "Data refreshed" });
    },
    onError: (err: any) => toast({ title: "Refresh failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/charts/${chart.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", chart.companyId, "charts"] });
      toast({ title: "Deleted" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const res = await fetch(`/api/charts/${chart.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ chartType: "table", chartConfig: JSON.stringify({ columns: [] }) }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", chart.companyId, "charts"] });
      setView("table");
      setShowBuilder(false);
    },
  });

  const cardClass = "rounded-xl border border-white/[0.07] bg-[rgba(255,255,255,0.02)] overflow-hidden";
  const { subtitle } = parseSubtitle(chart.description);

  if (chart.status === "pending" || chart.status === "generating") {
    return (
      <div className={`${cardClass} p-6`} data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white/80 tracking-tight">{chart.title}</h3>
            {subtitle && <p className="text-[11px] text-white/25 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-0.5">
            {chart.status === "pending" && (
              <button onClick={() => refreshMutation.mutate()} className="p-1.5 rounded-lg hover:bg-white/[0.04] text-white/20 hover:text-white/50 transition-colors" data-testid={`button-refresh-chart-${chart.id}`}>
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={() => deleteMutation.mutate()} className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400/60 transition-colors" data-testid={`button-delete-chart-${chart.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center h-40 gap-2">
          {chart.status === "generating" ? (
            <><Loader2 className="w-4 h-4 animate-spin text-white/20" /><span className="text-[11px] text-white/25">Fetching data...</span></>
          ) : (
            <><RefreshCw className="w-4 h-4 text-white/10" /><span className="text-[11px] text-white/25">Click refresh to load data</span></>
          )}
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className={`${cardClass} p-6`} data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white/80 tracking-tight">{chart.title}</h3>
            {subtitle && <p className="text-[11px] text-white/25 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => refreshMutation.mutate()} className="p-1.5 rounded-lg hover:bg-white/[0.04] text-white/20 hover:text-white/50 transition-colors" data-testid={`button-refresh-chart-${chart.id}`}><RefreshCw className="w-3.5 h-3.5" /></button>
            <button onClick={() => deleteMutation.mutate()} className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400/60 transition-colors" data-testid={`button-delete-chart-${chart.id}`}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="flex items-center justify-center h-40 gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400/40" />
          <span className="text-[11px] text-red-400/50">{chart.errorMessage || "Failed"}</span>
        </div>
      </div>
    );
  }

  let chartData: any[] = [];
  let chartConfig: any = {};
  try {
    chartData = chart.data ? JSON.parse(chart.data) : [];
    chartConfig = chart.chartConfig ? JSON.parse(chart.chartConfig) : {};
  } catch { chartData = []; }

  const hasChartConfig = chartConfig.xAxis && chartConfig.yAxes && chartConfig.yAxes.length > 0;
  const isTable = chart.chartType === "table" || !hasChartConfig;
  const currentView = view === "auto" ? (isTable ? "table" : "chart") : view;

  const headlineStat = hasChartConfig ? computeHeadlineStat(chartData, chartConfig.yAxes) : null;

  const renderTable = () => {
    const columns = chartConfig.columns || (chartData[0] ? Object.keys(chartData[0]) : []);
    return (
      <div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[rgb(14,14,18)] z-10">
              <tr>
                {columns.map((col: string) => (
                  <th key={col} className="text-left px-3 py-2 text-[9px] font-medium text-white/25 uppercase tracking-wider border-b border-white/[0.06] whitespace-nowrap">
                    {col.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.slice(0, 50).map((row: any, i: number) => (
                <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.015]">
                  {columns.map((col: string) => {
                    const val = row[col];
                    let display: string;
                    if (val == null) display = "—";
                    else if (typeof val === "number") {
                      display = /usd|price|fee|revenue|volume|amount|cost|market_cap|fdv|tvl/i.test(col)
                        ? smartFormat(val, "currency")
                        : /pct|percent|growth|rate|apy|apr/i.test(col)
                        ? smartFormat(val, "percent")
                        : val.toLocaleString(undefined, { maximumFractionDigits: 2 });
                    } else if (/\d{4}.*\d{2}.*\d{2}/.test(String(val))) {
                      try { display = format(new Date(val), "MMM d, yyyy"); } catch { display = String(val); }
                    } else {
                      display = String(val);
                    }
                    return (
                      <td key={col} className="px-3 py-1.5 text-white/45 whitespace-nowrap font-mono text-[10px]">
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {chartData.length > 50 && (
          <p className="text-[9px] text-white/15 text-center py-2">Showing 50 of {chartData.length} rows</p>
        )}
      </div>
    );
  };

  const renderChart = () => {
    if (!hasChartConfig) return null;
    const xAxis = chartConfig.xAxis;
    const yAxes = chartConfig.yAxes;
    const isDate = xAxis.type === "date";
    const primary = yAxes[0];
    const primaryFmt = primary.format;

    const processedData = chartData.map((d: any) => {
      const processed = { ...d };
      if (isDate && processed[xAxis.dataKey] != null) {
        const converted = toUnixSec(processed[xAxis.dataKey]);
        if (converted !== null) processed[xAxis.dataKey] = converted;
      }
      return processed;
    }).sort((a: any, b: any) => {
      const aV = a[xAxis.dataKey], bV = b[xAxis.dataKey];
      return typeof aV === 'number' && typeof bV === 'number' ? aV - bV : 0;
    });

    const numPoints = processedData.length;
    const dateFmt = isDate ? buildDateFormatter(processedData, xAxis.dataKey) : null;
    const cType = chart.chartType || "line";

    const hasDualAxis = yAxes.some((y: any) => y.yAxisId === "right");
    const hasMixedTypes = yAxes.some((y: any) => y.chartType && y.chartType !== cType);
    const useComposed = hasDualAxis || hasMixedTypes;

    const tickInterval = cType === "bar" ? (numPoints <= 24 ? 0 : Math.floor(numPoints / 12)) : (numPoints <= 30 ? 0 : undefined);

    const xAxisEl = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={isDate ? dateFmt!.tickFormatter : undefined}
        tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
        axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
        tickLine={false}
        interval={tickInterval}
        angle={numPoints > 20 ? -45 : 0}
        textAnchor={numPoints > 20 ? "end" : "middle"}
        height={numPoints > 20 ? 55 : 30}
      />
    );

    const leftAxes = yAxes.filter((y: any) => !y.yAxisId || y.yAxisId === "left");
    const rightAxes = yAxes.filter((y: any) => y.yAxisId === "right");
    const leftFmt = leftAxes[0]?.format || primaryFmt;
    const rightFmt = rightAxes[0]?.format || primaryFmt;

    const yAxisLeftEl = (
      <YAxis
        yAxisId="left"
        tickFormatter={(v: number) => smartFormat(v, leftFmt)}
        tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
        axisLine={false}
        tickLine={false}
        width={65}
      />
    );
    const yAxisRightEl = hasDualAxis ? (
      <YAxis
        yAxisId="right"
        orientation="right"
        tickFormatter={(v: number) => smartFormat(v, rightFmt)}
        tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
        axisLine={false}
        tickLine={false}
        width={65}
      />
    ) : null;

    const singleYAxisEl = (
      <YAxis
        tickFormatter={(v: number) => smartFormat(v, primaryFmt)}
        tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
        axisLine={false}
        tickLine={false}
        width={60}
      />
    );

    const tooltipEl = (
      <Tooltip
        contentStyle={{
          backgroundColor: "rgba(10,10,14,0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "8px",
          fontSize: "12px",
          padding: "8px 12px",
          color: "rgba(255,255,255,0.8)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
        }}
        labelStyle={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", marginBottom: "4px" }}
        labelFormatter={isDate ? dateFmt!.tooltipFormatter : (l: any) => String(l)}
        formatter={(value: any, name: string) => {
          const ax = yAxes.find((y: any) => y.dataKey === name);
          return [smartTooltip(value, ax?.format || primaryFmt), ax?.label || name.replace(/_/g, " ")];
        }}
        cursor={{ fill: "rgba(255,255,255,0.02)" }}
      />
    );
    const gridEl = (
      <CartesianGrid
        strokeDasharray="2 6"
        stroke="rgba(255,255,255,0.04)"
        vertical={false}
      />
    );
    const legendEl = yAxes.length > 1 ? (
      <Legend verticalAlign="top" align="left" height={28} iconType="plainline" iconSize={12}
        wrapperStyle={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", paddingBottom: "4px" }}
        formatter={(v: string) => { const ax = yAxes.find((y: any) => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    const renderSeriesElement = (y: any, i: number) => {
      const seriesType = y.chartType || cType;
      const axisId = useComposed ? (y.yAxisId || "left") : undefined;
      const color = y.color || CHART_COLORS[i];

      if (seriesType === "bar") {
        return <Bar key={y.dataKey} dataKey={y.dataKey} yAxisId={axisId} fill={color} radius={[4, 4, 0, 0]} maxBarSize={numPoints <= 12 ? 48 : numPoints <= 24 ? 32 : 20} opacity={0.7} />;
      }
      if (seriesType === "area") {
        return <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} yAxisId={axisId} stroke={color} strokeWidth={1.5} fill={color} fillOpacity={0.08} dot={false} />;
      }
      return <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} yAxisId={axisId} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: color, stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }} />;
    };

    const chartEl = (() => {
      if (useComposed) {
        return (
          <ComposedChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {gridEl}{xAxisEl}{yAxisLeftEl}{yAxisRightEl}{tooltipEl}{legendEl}
            {yAxes.map((y: any, i: number) => renderSeriesElement(y, i))}
          </ComposedChart>
        );
      }
      if (cType === "bar") {
        return (
          <BarChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
            {yAxes.map((y: any, i: number) => (
              <Bar key={y.dataKey} dataKey={y.dataKey} fill={y.color || CHART_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={numPoints <= 12 ? 48 : numPoints <= 24 ? 32 : 20} opacity={0.7} />
            ))}
          </BarChart>
        );
      }
      if (cType === "area") {
        return (
          <AreaChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
            {yAxes.map((y: any, i: number) => (
              <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={y.color || CHART_COLORS[i]} strokeWidth={1.5} fill={y.color || CHART_COLORS[i]} fillOpacity={0.08} dot={false} />
            ))}
          </AreaChart>
        );
      }
      return (
        <LineChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
          {yAxes.map((y: any, i: number) => (
            <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={y.color || CHART_COLORS[i]} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: y.color || CHART_COLORS[i], stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }} />
          ))}
        </LineChart>
      );
    })();

    return (
      <div className="px-2 pb-1">
        <ResponsiveContainer width="100%" height={280}>
          {chartEl}
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className={cardClass} data-testid={`chart-card-${chart.id}`}>
      <div className="p-5 pb-0">
        <div className="flex items-start justify-between mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-white/90 tracking-tight leading-tight">{chart.title}</h3>
            {subtitle && <p className="text-[11px] text-white/30 mt-1">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-0 ml-4 shrink-0">
            {headlineStat && currentView === "chart" && (
              <div className="text-right mr-3">
                <p className="text-lg font-semibold text-white/90 font-mono tracking-tight leading-none">{headlineStat.value}</p>
                <p className="text-[10px] text-white/30 mt-0.5">{headlineStat.label}</p>
              </div>
            )}
            {hasChartConfig && (
              <>
                <button
                  onClick={() => setView(currentView === "chart" ? "table" : "chart")}
                  className="p-1.5 rounded-lg hover:bg-white/[0.04] text-white/20 hover:text-white/50 transition-colors"
                  data-testid={`toggle-view-${chart.id}`}
                  title={currentView === "chart" ? "Show table" : "Show chart"}
                >
                  {currentView === "chart" ? <Table2 className="w-3.5 h-3.5" /> : <LineChartIcon className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => resetMutation.mutate()}
                  className="p-1.5 rounded-lg hover:bg-white/[0.04] text-white/20 hover:text-white/50 transition-colors"
                  data-testid={`reset-chart-${chart.id}`}
                  title="Reset to table"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="p-1.5 rounded-lg hover:bg-white/[0.04] text-white/20 hover:text-white/50 transition-colors"
              data-testid={`button-refresh-chart-${chart.id}`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-400/60 transition-colors"
              data-testid={`button-delete-chart-${chart.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {currentView === "chart" ? renderChart() : <div className="px-5">{renderTable()}</div>}

      {currentView === "table" && !showBuilder && (
        <div className="px-5 pb-3">
          <button
            onClick={() => setShowBuilder(true)}
            className="mt-3 flex items-center gap-1.5 text-[10px] text-sky-400/60 hover:text-sky-400 transition-colors"
            data-testid={`button-create-chart-${chart.id}`}
          >
            <LineChartIcon className="w-3 h-3" />
            Create Chart
          </button>
        </div>
      )}

      {showBuilder && (
        <div className="px-5 pb-3">
          <ChartBuilder chart={chart} data={chartData} onClose={() => setShowBuilder(false)} />
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-2.5 text-[9px] text-white/15 border-t border-white/[0.04]">
        <span>{chart.dataSource} · {chartData.length} {currentView === "chart" ? "points" : "rows"}</span>
        <span>{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
      </div>
    </div>
  );
}

export default function DataTab({ companyId, companyName }: DataTabProps) {
  const [prompt, setPrompt] = useState("");
  const { toast } = useToast();
  const { getAccessToken } = useAuth();

  const { data: charts = [], isLoading } = useQuery<DashboardChart[]>({
    queryKey: ["/api/companies", companyId, "charts"],
  });

  const generateMutation = useMutation({
    mutationFn: async (chartPrompt: string) => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const res = await fetch(`/api/companies/${companyId}/charts/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: chartPrompt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "charts"] });
      setPrompt("");
      toast({ title: "Data loaded" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || generateMutation.isPending) return;
    generateMutation.mutate(prompt.trim());
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-6" data-testid="chart-prompt-form">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Ask for data... "${companyName} revenue", "TVL history", or "Price chart"`}
              className="w-full h-10 px-4 pr-10 text-[13px] rounded-xl border border-white/[0.07] bg-white/[0.02] text-foreground placeholder:text-white/20 focus:outline-none focus:border-white/[0.15] transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-white/25 hover:text-sky-400 disabled:opacity-30 transition-colors"
              data-testid="button-submit-chart"
            >
              {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {generateMutation.isPending && (
          <p className="text-[11px] text-white/20 mt-2.5 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Fetching data...
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-white/15" />
        </div>
      ) : charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-8 h-8 text-white/[0.06] mb-3" />
          <p className="text-sm text-white/25 font-medium">No data yet</p>
          <p className="text-[11px] text-white/15 mt-1 max-w-xs">
            Ask for data or add Dune queries from Token Intelligence. Data loads as a table — you build the chart.
          </p>
          <div className="flex flex-wrap gap-1.5 mt-4 max-w-md justify-center">
            {[
              `${companyName} revenue`,
              `Daily active users`,
              `Price history`,
              `TVL over time`,
            ].map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="text-[11px] px-3 py-1.5 rounded-full border border-white/[0.06] text-white/25 hover:text-sky-400 hover:border-sky-500/20 transition-colors"
                data-testid={`suggestion-${s.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {charts.map((chart) => (
            <DataCard key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </div>
  );
}
