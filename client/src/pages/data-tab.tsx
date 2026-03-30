import { useState, useRef, useCallback } from "react";
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
  "#3b6fd4", "#94a3b8", "#5a8de6", "#8b5cf6",
  "#2d5fc0", "#a78bfa", "#4b7ad8", "#7c8db5",
];

function smartFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function axisFormat(value: number, fmt?: string, isRatio?: boolean): string {
  const suffix = isRatio ? "x" : "";
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    if (Math.abs(pct) < 1) return `${pct.toFixed(1)}%`;
    return `${pct.toFixed(0)}%`;
  }
  if (isRatio) return `${value.toFixed(0)}${suffix}`;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function smartTooltip(value: number, fmt?: string): string {
  if (fmt === "currency") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    return `${pct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
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

function autoCorrectChartConfig(config: any, data: any[]): any {
  if (!config || !data || data.length === 0) return config;
  const xAxis = config.xAxis;
  const yAxes = config.yAxes;
  if (!xAxis || !yAxes) return config;

  const sampleRow = data[0];
  const allCols = Object.keys(sampleRow);

  const xKeyExists = allCols.includes(xAxis.dataKey);
  const yKeysExist = yAxes.every((y: any) => allCols.includes(y.dataKey));

  let xNeedsCorrection = !xKeyExists;
  if (xKeyExists && data.length > 1) {
    const xVals = data.map(d => d[xAxis.dataKey]);
    const uniqueVals = new Set(xVals.map(v => String(v)));
    if (uniqueVals.size <= 1) {
      xNeedsCorrection = true;
    }
  }

  if (!xNeedsCorrection && xKeyExists && yKeysExist) return config;

  const dateCols = allCols.filter(c => isDateColumn(c, data));
  const numericCols = allCols.filter(c => {
    if (dateCols.includes(c)) return false;
    const sample = data.find(d => d[c] != null)?.[c];
    return typeof sample === "number";
  });
  const stringCols = allCols.filter(c => !dateCols.includes(c) && !numericCols.includes(c));

  const corrected = JSON.parse(JSON.stringify(config));

  if (xNeedsCorrection) {
    const goodDateCol = dateCols.find(c => {
      if (c === xAxis.dataKey) return false;
      const vals = data.map(d => d[c]);
      const unique = new Set(vals.map(v => String(v)));
      return unique.size > 1;
    });
    if (goodDateCol) {
      corrected.xAxis.dataKey = goodDateCol;
      corrected.xAxis.type = "date";
    } else if (dateCols.length > 0 && dateCols[0] !== xAxis.dataKey) {
      corrected.xAxis.dataKey = dateCols[0];
      corrected.xAxis.type = "date";
    } else if (stringCols.length > 0) {
      corrected.xAxis.dataKey = stringCols[0];
      corrected.xAxis.type = undefined;
    } else if (numericCols.length > 0) {
      const leastLikelyValue = numericCols.find(c => !/usd|price|fee|revenue|volume|amount|cost|tvl|value|earnings|profit/i.test(c));
      corrected.xAxis.dataKey = leastLikelyValue || numericCols[0];
    }
  }

  const usedCols = new Set([corrected.xAxis.dataKey]);
  const availableNumeric = numericCols.filter(c => !usedCols.has(c));

  for (let i = 0; i < corrected.yAxes.length; i++) {
    const y = corrected.yAxes[i];
    if (!allCols.includes(y.dataKey)) {
      const fuzzyMatch = allCols.find(c => {
        const cNorm = c.toLowerCase().replace(/[_\s]/g, "");
        const yNorm = y.dataKey.toLowerCase().replace(/[_\s]/g, "");
        return cNorm === yNorm || cNorm.includes(yNorm) || yNorm.includes(cNorm);
      });
      if (fuzzyMatch && !usedCols.has(fuzzyMatch)) {
        corrected.yAxes[i].dataKey = fuzzyMatch;
        usedCols.add(fuzzyMatch);
      } else if (availableNumeric.length > 0) {
        const col = availableNumeric.shift()!;
        corrected.yAxes[i].dataKey = col;
        corrected.yAxes[i].format = guessFormat(col);
        usedCols.add(col);
      }
    } else {
      usedCols.add(y.dataKey);
    }
  }

  return corrected;
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
        if (spansYears) return format(d, "MMM ''yy");
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

function computeHeadlineStat(data: any[], yAxes: any[], title?: string, xAxisKey?: string): { value: string; label: string } | null {
  if (!data || data.length === 0 || !yAxes || yAxes.length === 0) return null;
  const primary = yAxes[0];
  const key = primary.dataKey;
  const fmt = primary.format;

  const validRows = data.filter(d => typeof d[key] === "number" && !isNaN(d[key]));
  if (validRows.length === 0) return null;

  let latestRow = validRows[validRows.length - 1];
  if (xAxisKey) {
    const sorted = [...validRows].sort((a, b) => {
      const aVal = a[xAxisKey], bVal = b[xAxisKey];
      if (typeof aVal === "number" && typeof bVal === "number") return aVal - bVal;
      if (typeof aVal === "string" && typeof bVal === "string") return aVal.localeCompare(bVal);
      return 0;
    });
    latestRow = sorted[sorted.length - 1];
  }

  const latest = latestRow[key];
  const titleLower = (title || "").toLowerCase();
  const keyLower = key.toLowerCase();
  const isRatio = /ratio|p\/e|pe_ratio|multiple|p_e/i.test(keyLower) || /ratio|p\/e|multiple/i.test(titleLower);

  if (isRatio) {
    const formatted = latest >= 1000 ? smartFormat(latest, "number") : latest.toFixed(2);
    return { value: formatted + "x", label: "Latest" };
  }

  if (fmt === "percent") {
    const pct = Math.abs(latest) < 1 ? latest * 100 : latest;
    return { value: `${pct.toFixed(1)}%`, label: "Latest" };
  }
  return { value: smartFormat(latest, fmt || "currency"), label: "Latest" };
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
      <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wider block mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1.5 text-[11px] rounded border border-border/40 bg-muted/10 text-foreground/60 hover:border-border/60 transition-colors text-left"
        data-testid={`picker-${label.toLowerCase().replace(/\s+/g, "-")}`}
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground/40" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-40 overflow-auto rounded border border-border/40 bg-popover shadow-lg">
          {columns.map(col => {
            const isSelected = selectedArr.includes(col);
            return (
              <button
                key={col}
                type="button"
                className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-muted/30 flex items-center gap-1.5 ${isSelected ? 'text-sky-400' : 'text-foreground/50'}`}
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
    <div className="border-t border-border/30 mt-3 pt-3">
      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-medium mb-3">Chart Builder</p>
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
          <label className="text-[9px] text-muted-foreground/50 uppercase tracking-wider block mb-1">Chart Type</label>
          <div className="flex gap-1">
            {(["line", "bar", "area"] as const).map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                className={`px-2 py-1.5 text-[10px] rounded border transition-colors ${chartType === t ? 'border-sky-500/30 bg-sky-500/10 text-sky-400' : 'border-border/40 text-muted-foreground/50 hover:text-foreground/60'}`}
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


  const cardClass = "group rounded border border-border/40 bg-card/30 overflow-hidden";
  const { subtitle } = parseSubtitle(chart.description);

  if (chart.status === "pending" || chart.status === "generating") {
    return (
      <div className={`${cardClass} px-4 py-3`} data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground/80 tracking-tight">{chart.title}</h3>
            {subtitle && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-0.5">
            {chart.status === "pending" && (
              <button onClick={() => refreshMutation.mutate()} className="p-1 rounded hover:bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground transition-colors" data-testid={`button-refresh-chart-${chart.id}`}>
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            <button onClick={() => deleteMutation.mutate()} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400/60 transition-colors" data-testid={`button-delete-chart-${chart.id}`}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center h-28 gap-2">
          {chart.status === "generating" ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/40" /><span className="text-[10px] text-muted-foreground/50">Fetching data...</span></>
          ) : (
            <><RefreshCw className="w-3.5 h-3.5 text-muted-foreground/20" /><span className="text-[10px] text-muted-foreground/50">Click refresh to load data</span></>
          )}
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className={`${cardClass} px-4 py-3`} data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground/80 tracking-tight">{chart.title}</h3>
            {subtitle && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={() => refreshMutation.mutate()} className="p-1 rounded hover:bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground transition-colors" data-testid={`button-refresh-chart-${chart.id}`}><RefreshCw className="w-3 h-3" /></button>
            <button onClick={() => deleteMutation.mutate()} className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400/60 transition-colors" data-testid={`button-delete-chart-${chart.id}`}><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
        <div className="flex items-center justify-center h-28 gap-2 px-4">
          <AlertTriangle className="w-3 h-3 text-red-400/40 flex-shrink-0" />
          <span className="text-[10px] text-red-400/50 line-clamp-2">{
            (() => {
              const msg = chart.errorMessage || "Failed";
              if (msg.includes("InsufficientBalance") || msg.includes("insufficient USDC"))
                return "MPP wallet out of funds — top up USDC on Tempo to continue.";
              if (msg.includes("Payment settlement failed"))
                return "Payment failed — try refreshing.";
              if (msg.includes("timed out"))
                return "Query timed out — try a simpler request.";
              const clean = msg.replace(/\/home\/runner\/[^\s]+/g, "").replace(/UserWarning:[^\n]+/g, "").trim();
              return clean.length > 120 ? clean.slice(0, 120) + "…" : clean;
            })()
          }</span>
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

  const correctedForHeadline = hasChartConfig ? autoCorrectChartConfig(chartConfig, chartData) : null;
  const headlineStat = correctedForHeadline ? computeHeadlineStat(chartData, correctedForHeadline.yAxes, chart.title, correctedForHeadline.xAxis?.dataKey) : null;

  const renderTable = () => {
    const columns = chartConfig.columns || (chartData[0] ? Object.keys(chartData[0]) : []);
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              {columns.map((col: string) => (
                <th key={col} className="text-left px-3 py-2 text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider border-b border-border/40 whitespace-nowrap">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartData.map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                {columns.map((col: string) => {
                  const val = row[col];
                  let display: string;
                  if (val == null) display = "—";
                  else if (typeof val === "number" && /date|time|day|week|month/i.test(col) && val > 1e8 && val < 2e10) {
                    try { display = format(new Date(val * 1000), "MMM d, yyyy"); } catch { display = String(val); }
                  } else if (typeof val === "number") {
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
                    <td key={col} className="px-3 py-1.5 text-foreground/50 whitespace-nowrap font-mono text-[10px]">
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderChart = () => {
    if (!hasChartConfig) return null;
    const correctedConfig = autoCorrectChartConfig(chartConfig, chartData);
    const xAxis = correctedConfig.xAxis;
    const yAxes = correctedConfig.yAxes;
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

    const titleLower = (chart.title || "").toLowerCase();
    const primaryKeyLower = (primary.dataKey || "").toLowerCase();
    const isRatioChart = /ratio|p\/e|pe_ratio|multiple|p_e/i.test(primaryKeyLower) || /ratio|p\/e|multiple/i.test(titleLower);

    const maxTicks = 6;
    const tickInterval = cType === "bar"
      ? (numPoints <= maxTicks ? 0 : Math.floor(numPoints / maxTicks))
      : (numPoints <= maxTicks ? 0 : Math.max(1, Math.floor(numPoints / maxTicks)));

    const xAxisEl = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={isDate ? dateFmt!.tickFormatter : undefined}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={{ stroke: "var(--color-chart-line)" }}
        tickLine={false}
        interval={tickInterval}
        angle={0}
        textAnchor="middle"
        height={22}
      />
    );

    const leftAxes = yAxes.filter((y: any) => !y.yAxisId || y.yAxisId === "left");
    const rightAxes = yAxes.filter((y: any) => y.yAxisId === "right");
    const leftFmt = leftAxes[0]?.format || primaryFmt;
    const rightFmt = rightAxes[0]?.format || primaryFmt;

    const yAxisLeftEl = (
      <YAxis
        yAxisId="left"
        domain={[0, 'auto']}
        tickFormatter={(v: number) => axisFormat(v, leftFmt, isRatioChart)}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={44}
        tickCount={5}
      />
    );
    const yAxisRightEl = hasDualAxis ? (
      <YAxis
        yAxisId="right"
        orientation="right"
        domain={[0, 'auto']}
        tickFormatter={(v: number) => axisFormat(v, rightFmt)}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={40}
        tickCount={5}
      />
    ) : null;

    const singleYAxisEl = (
      <YAxis
        domain={[0, 'auto']}
        tickFormatter={(v: number) => axisFormat(v, primaryFmt, isRatioChart)}
        tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={44}
        tickCount={5}
      />
    );

    const tooltipEl = (
      <Tooltip
        contentStyle={{
          backgroundColor: "var(--color-tooltip-bg)",
          border: "1px solid var(--color-tooltip-border)",
          borderRadius: "8px",
          fontSize: "12px",
          padding: "8px 12px",
          color: "var(--color-tooltip-text)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}
        labelStyle={{ color: "var(--color-chart-tick)", fontSize: "10px", marginBottom: "4px" }}
        labelFormatter={isDate ? dateFmt!.tooltipFormatter : (l: any) => {
          if (typeof l === "number") {
            const xFmt = guessFormat(xAxis.dataKey);
            if (xFmt === "currency") return `$${l.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
            if (xFmt === "percent") return `${l.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
            return l.toLocaleString(undefined, { maximumFractionDigits: 4 });
          }
          return String(l);
        }}
        formatter={(value: any, name: string) => {
          const ax = yAxes.find((y: any) => y.dataKey === name);
          return [smartTooltip(value, ax?.format || primaryFmt), ax?.label || name.replace(/_/g, " ")];
        }}
        cursor={{ fill: "var(--color-chart-cursor)" }}
      />
    );
    const gridEl = (
      <CartesianGrid
        strokeDasharray="2 6"
        stroke="var(--color-chart-grid)"
        vertical={false}
      />
    );
    const legendEl = yAxes.length > 1 ? (
      <Legend verticalAlign="top" align="left" height={22} iconType="plainline" iconSize={10}
        wrapperStyle={{ fontSize: "9px", color: "var(--color-tooltip-text)", paddingBottom: "2px" }}
        formatter={(v: string) => { const ax = yAxes.find((y: any) => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    const renderSeriesElement = (y: any, i: number) => {
      const seriesType = y.chartType || cType;
      const axisId = useComposed ? (y.yAxisId || "left") : undefined;
      const color = CHART_COLORS[i % CHART_COLORS.length];

      if (seriesType === "bar") {
        return <Bar key={y.dataKey} dataKey={y.dataKey} yAxisId={axisId} fill={color} radius={[1, 1, 0, 0]} maxBarSize={numPoints <= 12 ? 48 : numPoints <= 24 ? 32 : 20} opacity={0.85} />;
      }
      if (seriesType === "area") {
        return <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} yAxisId={axisId} stroke={color} strokeWidth={1.2} fill={color} fillOpacity={0.08} dot={false} />;
      }
      return <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} yAxisId={axisId} stroke={color} strokeWidth={1.2} dot={false} activeDot={{ r: 2.5, fill: color, stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }} />;
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
        const isStacked = yAxes.length > 1;
        return (
          <BarChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
            {yAxes.map((y: any, i: number) => (
              <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} stackId={isStacked ? "stack" : undefined} radius={isStacked && i === yAxes.length - 1 ? [1, 1, 0, 0] : isStacked ? undefined : [1, 1, 0, 0]} maxBarSize={numPoints <= 12 ? 48 : numPoints <= 24 ? 32 : 20} opacity={0.85} />
            ))}
          </BarChart>
        );
      }
      if (cType === "area") {
        return (
          <AreaChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
            {yAxes.map((y: any, i: number) => (
              <Area key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />
            ))}
          </AreaChart>
        );
      }
      return (
        <LineChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
          {yAxes.map((y: any, i: number) => (
            <Line key={y.dataKey} type="monotone" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} activeDot={{ r: 2.5, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }} />
          ))}
        </LineChart>
      );
    })();

    return (
      <div className="px-1 pb-0">
        <ResponsiveContainer width="100%" height={245}>
          {chartEl}
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className={cardClass} data-testid={`chart-card-${chart.id}`}>
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-medium text-foreground/80 tracking-tight leading-tight">{chart.title}</h3>
            {subtitle && <p className="text-[9px] text-emerald-600 dark:text-emerald-400/70 mt-1.5 uppercase tracking-wide font-medium leading-tight">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-1 ml-3 shrink-0">
            {headlineStat && currentView === "chart" && (
              <div className="text-right">
                <p className="text-sm font-semibold text-foreground/90 font-mono tracking-tight leading-none">{headlineStat.value}</p>
                <p className="text-[9px] text-muted-foreground/50 mt-0.5">{headlineStat.label}</p>
              </div>
            )}
            <div className="flex items-center gap-0">
              <button
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="p-1 rounded hover:bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                data-testid={`button-refresh-chart-${chart.id}`}
              >
                <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400/60 transition-colors"
                data-testid={`button-delete-chart-${chart.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {currentView === "chart" ? renderChart() : <div className="px-4">{renderTable()}</div>}

      {currentView === "table" && !showBuilder && (
        <div className="px-4 pb-2">
          <button
            onClick={() => setShowBuilder(true)}
            className="mt-2 flex items-center gap-1.5 text-[10px] text-sky-500/60 hover:text-sky-500 transition-colors"
            data-testid={`button-create-chart-${chart.id}`}
          >
            <LineChartIcon className="w-3 h-3" />
            Create Chart
          </button>
        </div>
      )}

      {showBuilder && (
        <div className="px-4 pb-2">
          <ChartBuilder chart={chart} data={chartData} onClose={() => setShowBuilder(false)} />
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1.5 text-[9px] text-muted-foreground/60 italic">
        <span>Source: {chart.dataSource === "dune" ? "Dune Analytics" : chart.dataSource === "defillama" ? "DeFiLlama" : chart.dataSource === "coingecko" ? "CoinGecko" : chart.dataSource === "allium-sql" ? "Allium SQL" : chart.dataSource === "allium-prices" ? "Allium" : chart.dataSource === "allium" ? "Allium" : chart.dataSource === "stonks" ? "StonksOnChain" : chart.dataSource}</span>
        <span className="not-italic text-muted-foreground/40">{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
      </div>
    </div>
  );
}

export default function DataTab({ companyId, companyName }: DataTabProps) {
  const [prompt, setPrompt] = useState("");
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const dragItemRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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
    onError: (err: any) => {
      let desc = err.message || "Something went wrong";
      if (desc.includes("InsufficientBalance") || desc.includes("insufficient USDC"))
        desc = "MPP wallet out of funds — top up USDC on Tempo to continue.";
      else if (desc.includes("Execution reverted"))
        desc = "Payment transaction failed — wallet may need funding.";
      toast({ title: "Failed", description: desc, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) { headers["Authorization"] = `Bearer ${token}`; headers["X-Privy-Token"] = token; }
      await fetch(`/api/companies/${companyId}/charts/reorder`, { method: "POST", headers, body: JSON.stringify({ orderedIds }) });
    },
  });

  const retryFailedMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) { headers["Authorization"] = `Bearer ${token}`; headers["X-Privy-Token"] = token; }
      const res = await fetch(`/api/companies/${companyId}/charts/refresh-failed`, { method: "POST", headers });
      if (!res.ok) throw new Error("Failed to retry");
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "charts"] });
      const msg = data.refreshed > 0
        ? `${data.refreshed} of ${data.total} chart(s) recovered`
        : `${data.total} chart(s) retried — all still failing`;
      toast({ title: msg });
    },
    onError: () => {
      toast({ title: "Retry failed", variant: "destructive" });
    },
  });

  const handleDragStart = useCallback((chartId: string) => (e: React.DragEvent) => {
    dragItemRef.current = chartId;
    e.dataTransfer.effectAllowed = "move";
    (e.currentTarget as HTMLElement).style.opacity = "0.4";
  }, []);

  const handleDragOver = useCallback((chartId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(chartId);
  }, []);

  const handleDrop = useCallback((targetId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.opacity = "1";
    setDragOverId(null);
    const sourceId = dragItemRef.current;
    if (!sourceId || sourceId === targetId) return;
    const ids = charts.map(c => c.id);
    const srcIdx = ids.indexOf(sourceId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, sourceId);
    queryClient.setQueryData<DashboardChart[]>(["/api/companies", companyId, "charts"], (old) => {
      if (!old) return old;
      const map = new Map(old.map(c => [c.id, c]));
      return ids.map(id => map.get(id)!).filter(Boolean);
    });
    reorderMutation.mutate(ids);
    dragItemRef.current = null;
  }, [charts, companyId, reorderMutation]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = "1";
    setDragOverId(null);
    dragItemRef.current = null;
  }, []);

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
              className="w-full h-10 px-4 pr-10 text-[13px] rounded-xl border border-border/40 bg-muted/10 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-border/60 transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted-foreground/50 hover:text-sky-400 disabled:opacity-30 transition-colors"
              data-testid="button-submit-chart"
            >
              {generateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        {generateMutation.isPending && (
          <p className="text-[11px] text-muted-foreground/40 mt-2.5 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Fetching data...
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/30" />
        </div>
      ) : charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground/10 mb-3" />
          <p className="text-sm text-muted-foreground/50 font-medium">No data yet</p>
          <p className="text-[11px] text-muted-foreground/30 mt-1 max-w-xs">
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
                className="text-[11px] px-3 py-1.5 rounded-full border border-border/30 text-muted-foreground/40 hover:text-sky-400 hover:border-sky-500/20 transition-colors"
                data-testid={`suggestion-${s.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {charts.some(c => c.status === "failed") && (
            <div className="flex justify-end mb-2">
              <button
                onClick={() => retryFailedMutation.mutate()}
                disabled={retryFailedMutation.isPending}
                className="flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-md border border-border/30 text-muted-foreground hover:text-sky-400 hover:border-sky-500/20 transition-colors disabled:opacity-50"
                data-testid="button-retry-all-failed"
              >
                {retryFailedMutation.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                Retry All Failed
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
          {charts.map((chart) => (
            <div
              key={chart.id}
              draggable
              onDragStart={handleDragStart(chart.id)}
              onDragOver={handleDragOver(chart.id)}
              onDrop={handleDrop(chart.id)}
              onDragEnd={handleDragEnd}
              className={`cursor-grab active:cursor-grabbing rounded transition-colors ${dragOverId === chart.id ? "ring-1 ring-sky-500/40" : ""}`}
            >
              <DataCard chart={chart} />
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
