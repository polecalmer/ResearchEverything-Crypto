import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { DashboardChart } from "@shared/schema";
import {
  Loader2,
  RefreshCw,
  Trash2,
  Send,
  BarChart3,
  TrendingUp,
  AlertTriangle,
  Table2,
  LineChart as LineChartIcon,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { format } from "date-fns";

interface DataTabProps {
  companyId: string;
  companyName: string;
}

const CHART_COLORS = [
  "#4ade80", "#2dd4bf", "#38bdf8", "#818cf8",
  "#a78bfa", "#f472b6", "#fb923c", "#facc15",
];

function formatAxisValue(value: number, fmt?: string): string {
  if (fmt === "currency") {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") return `${(value * 100).toFixed(1)}%`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatTooltipValue(value: number, fmt?: string): string {
  if (fmt === "currency") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (fmt === "percent") return `${(value * 100).toFixed(2)}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatDateTick(ts: number): string {
  if (ts > 1e12) ts = ts / 1000;
  try {
    return format(new Date(ts * 1000), "MMM d");
  } catch {
    return String(ts);
  }
}

function formatDateLabel(ts: number): string {
  if (ts > 1e12) ts = ts / 1000;
  try {
    return format(new Date(ts * 1000), "MMM d, yyyy");
  } catch {
    return String(ts);
  }
}

function DataTable({ data, columns }: { data: any[]; columns: string[] }) {
  if (!data.length) return null;

  return (
    <div className="max-h-72 overflow-auto rounded border border-border/8">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[hsl(var(--card))] z-10">
          <tr>
            {columns.map((col) => (
              <th key={col} className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider border-b border-border/10 whitespace-nowrap">
                {col.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.slice(0, 100).map((row, i) => (
            <tr key={i} className="border-b border-border/5 hover:bg-accent/5 transition-colors">
              {columns.map((col) => {
                const val = row[col];
                const isDate = /date|time|day|week|month/i.test(col) && (typeof val === 'string' || typeof val === 'number');
                let display: string;
                if (isDate && typeof val === 'string') {
                  try { display = format(new Date(val), "MMM d, yyyy"); } catch { display = String(val); }
                } else if (typeof val === "number") {
                  display = /usd|price|fee|revenue|volume|amount|cost/i.test(col)
                    ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : val.toLocaleString(undefined, { maximumFractionDigits: 4 });
                } else {
                  display = String(val ?? "—");
                }
                return (
                  <td key={col} className="px-3 py-1.5 text-foreground/70 whitespace-nowrap font-mono">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length > 100 && (
        <p className="text-[9px] text-muted-foreground/25 text-center py-1.5">Showing 100 of {data.length} rows</p>
      )}
    </div>
  );
}

function SingleMetricChart({ data, xKey, yKey, label, color, chartType, xType, format: fmt }: {
  data: any[];
  xKey: string;
  yKey: string;
  label: string;
  color: string;
  chartType: string;
  xType: string;
  format?: string;
}) {
  const commonProps = {
    data,
    margin: { top: 8, right: 12, left: 0, bottom: 4 },
  };

  const xAxisEl = (
    <XAxis
      dataKey={xKey}
      tickFormatter={xType === "date" ? formatDateTick : undefined}
      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }}
      axisLine={false}
      tickLine={false}
      interval="preserveStartEnd"
    />
  );

  const yAxisEl = (
    <YAxis
      tickFormatter={(v: number) => formatAxisValue(v, fmt)}
      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }}
      axisLine={false}
      tickLine={false}
      width={50}
    />
  );

  const grid = <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.06} />;

  const tooltip = (
    <Tooltip
      contentStyle={{
        backgroundColor: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "6px",
        fontSize: "11px",
        padding: "6px 10px",
      }}
      labelFormatter={(l: any) => xType === "date" ? formatDateLabel(l) : String(l)}
      formatter={(value: any) => [formatTooltipValue(value, fmt), label]}
      cursor={{ fill: "hsl(var(--accent))", opacity: 0.05 }}
    />
  );

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <BarChart {...commonProps}>
          {grid}
          {xAxisEl}
          {yAxisEl}
          {tooltip}
          <Bar dataKey={yKey} fill={color} radius={[2, 2, 0, 0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart {...commonProps}>
          {grid}
          {xAxisEl}
          {yAxisEl}
          {tooltip}
          <defs>
            <linearGradient id={`grad-${yKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={yKey} stroke={color} fill={`url(#grad-${yKey})`} strokeWidth={1.5} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart {...commonProps}>
        {grid}
        {xAxisEl}
        {yAxisEl}
        {tooltip}
        <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: color }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ChartRenderer({ chart }: { chart: DashboardChart }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");

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
      toast({ title: "Chart deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const chartActions = (
    <div className="flex items-center gap-0.5">
      {chart.status === "completed" && chart.chartType !== "table" && (
        <button
          onClick={() => setViewMode(viewMode === "chart" ? "table" : "chart")}
          className="p-1 rounded hover:bg-accent/20 text-muted-foreground/25 hover:text-muted-foreground transition-colors"
          title={viewMode === "chart" ? "View as table" : "View as chart"}
          data-testid={`button-toggle-view-${chart.id}`}
        >
          {viewMode === "chart" ? <Table2 className="w-3 h-3" /> : <LineChartIcon className="w-3 h-3" />}
        </button>
      )}
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
        className="p-1 rounded hover:bg-accent/20 text-muted-foreground/25 hover:text-muted-foreground transition-colors"
        data-testid={`button-refresh-chart-${chart.id}`}
        title="Refresh data"
      >
        <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={() => deleteMutation.mutate()}
        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/25 hover:text-destructive transition-colors"
        data-testid={`button-delete-chart-${chart.id}`}
        title="Delete"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );

  if (chart.status === "pending") {
    return (
      <div className="rounded-lg p-5 bg-card/10 border border-border/8" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex flex-col items-center justify-center h-36 gap-2">
          <RefreshCw className="w-4 h-4 text-muted-foreground/20" />
          <span className="text-[10px] text-muted-foreground/30">Click refresh to load data</span>
        </div>
      </div>
    );
  }

  if (chart.status === "generating") {
    return (
      <div className="rounded-lg p-5 bg-card/10 border border-border/8" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
        </div>
        <div className="flex items-center justify-center h-36 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/30" />
          <span className="text-[10px] text-muted-foreground/30">Fetching data...</span>
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className="rounded-lg p-5 bg-card/10 border border-destructive/10" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex items-center justify-center h-36 gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-destructive/40" />
          <span className="text-[10px] text-destructive/50">{chart.errorMessage || "Failed to fetch data"}</span>
        </div>
      </div>
    );
  }

  let chartData: any[] = [];
  let chartConfig: any = {};
  try {
    chartData = chart.data ? JSON.parse(chart.data) : [];
    chartConfig = chart.chartConfig ? JSON.parse(chart.chartConfig) : {};
  } catch {
    chartData = [];
  }

  const xAxis = chartConfig.xAxis || { dataKey: "date", type: "date" };
  const yAxes: any[] = chartConfig.yAxes || [{ dataKey: "value", label: "Value", color: CHART_COLORS[0] }];
  const allColumns = chartConfig.columns || (chartData[0] ? Object.keys(chartData[0]) : []);

  const processedData = chartData.map((d: any) => {
    const processed = { ...d };
    if (xAxis.type === "date" && processed[xAxis.dataKey]) {
      let ts = processed[xAxis.dataKey];
      if (typeof ts === 'string') ts = new Date(ts).getTime() / 1000;
      processed[xAxis.dataKey] = ts;
    }
    return processed;
  });

  if (chart.chartType === "table" || viewMode === "table") {
    return (
      <div className="rounded-lg p-5 bg-card/10 border border-border/8" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <DataTable data={chartData} columns={allColumns} />
        <div className="flex items-center justify-between mt-2 text-[9px] text-muted-foreground/20">
          <span>{chart.dataSource} · {chartData.length} rows</span>
          <span>{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
        </div>
      </div>
    );
  }

  if (yAxes.length <= 2) {
    return (
      <div className="rounded-lg p-5 bg-card/10 border border-border/8" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        {yAxes.length > 1 && (
          <div className="flex gap-3 mb-2">
            {yAxes.map((y: any, i: number) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: y.color || CHART_COLORS[i] }} />
                <span className="text-[9px] text-muted-foreground/40">{y.label || y.dataKey}</span>
              </div>
            ))}
          </div>
        )}
        <ResponsiveContainer width="100%" height={200}>
          {chart.chartType === "bar" ? (
            <BarChart data={processedData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.06} />
              <XAxis dataKey={xAxis.dataKey} tickFormatter={xAxis.type === "date" ? formatDateTick : undefined} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v: number) => formatAxisValue(v, yAxes[0]?.format)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} width={50} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px", padding: "6px 10px" }} labelFormatter={(l: any) => xAxis.type === "date" ? formatDateLabel(l) : String(l)} formatter={(value: any, name: string) => { const ax = yAxes.find((y: any) => y.dataKey === name); return [formatTooltipValue(value, ax?.format), ax?.label || name]; }} cursor={{ fill: "hsl(var(--accent))", opacity: 0.05 }} />
              {yAxes.map((y: any, i: number) => (
                <Bar key={i} dataKey={y.dataKey} fill={y.color || CHART_COLORS[i]} radius={[2, 2, 0, 0]} opacity={0.85} />
              ))}
            </BarChart>
          ) : chart.chartType === "composed" ? (
            <ComposedChart data={processedData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.06} />
              <XAxis dataKey={xAxis.dataKey} tickFormatter={xAxis.type === "date" ? formatDateTick : undefined} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="left" tickFormatter={(v: number) => formatAxisValue(v, yAxes[0]?.format)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} width={50} />
              {yAxes.some((y: any) => y.yAxisId === "right") && <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => { const ra = yAxes.find((y: any) => y.yAxisId === "right"); return formatAxisValue(v, ra?.format); }} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} width={50} />}
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px", padding: "6px 10px" }} labelFormatter={(l: any) => xAxis.type === "date" ? formatDateLabel(l) : String(l)} formatter={(value: any, name: string) => { const ax = yAxes.find((y: any) => y.dataKey === name); return [formatTooltipValue(value, ax?.format), ax?.label || name]; }} cursor={{ fill: "hsl(var(--accent))", opacity: 0.05 }} />
              {yAxes.map((y: any, i: number) => {
                if (y.chartType === "bar") return <Bar key={i} dataKey={y.dataKey} fill={y.color || CHART_COLORS[i]} yAxisId={y.yAxisId || "left"} radius={[2, 2, 0, 0]} opacity={0.85} />;
                return <Line key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || CHART_COLORS[i]} yAxisId={y.yAxisId || "left"} strokeWidth={2} dot={false} />;
              })}
            </ComposedChart>
          ) : (
            <LineChart data={processedData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" opacity={0.06} />
              <XAxis dataKey={xAxis.dataKey} tickFormatter={xAxis.type === "date" ? formatDateTick : undefined} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v: number) => formatAxisValue(v, yAxes[0]?.format)} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", opacity: 0.35 }} axisLine={false} tickLine={false} width={50} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "11px", padding: "6px 10px" }} labelFormatter={(l: any) => xAxis.type === "date" ? formatDateLabel(l) : String(l)} formatter={(value: any, name: string) => { const ax = yAxes.find((y: any) => y.dataKey === name); return [formatTooltipValue(value, ax?.format), ax?.label || name]; }} cursor={{ fill: "hsl(var(--accent))", opacity: 0.05 }} />
              {yAxes.map((y: any, i: number) => (
                <Line key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || CHART_COLORS[i]} strokeWidth={2} dot={false} activeDot={{ r: 3, fill: y.color || CHART_COLORS[i] }} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
        <div className="flex items-center justify-between mt-2 text-[9px] text-muted-foreground/20">
          <span>{chart.dataSource} · {processedData.length} points</span>
          <span>{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg p-5 bg-card/10 border border-border/8" data-testid={`chart-card-${chart.id}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">{chart.title}</p>
        {chartActions}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {yAxes.map((y: any, i: number) => (
          <div key={i}>
            <p className="text-[9px] text-muted-foreground/40 mb-1 flex items-center gap-1.5">
              <span className="w-2 h-0.5 rounded-full" style={{ backgroundColor: y.color || CHART_COLORS[i] }} />
              {y.label || y.dataKey}
            </p>
            <SingleMetricChart
              data={processedData}
              xKey={xAxis.dataKey}
              yKey={y.dataKey}
              label={y.label || y.dataKey}
              color={y.color || CHART_COLORS[i]}
              chartType={chart.chartType === "bar" ? "bar" : "line"}
              xType={xAxis.type || "category"}
              format={y.format}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 text-[9px] text-muted-foreground/20">
        <span>{chart.dataSource} · {processedData.length} points</span>
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
      toast({ title: "Charts created" });
    },
    onError: (err: any) => toast({ title: "Failed to create chart", description: err.message, variant: "destructive" }),
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
              placeholder={`What data do you want? e.g. "${companyName} TVL over 90 days" or "Price vs Revenue"`}
              className="w-full h-9 px-3 pr-10 text-xs rounded-md border border-border/15 bg-card/20 text-foreground placeholder:text-muted-foreground/25 focus:outline-none focus:border-teal-500/30 transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground/30 hover:text-teal-400 disabled:opacity-30 transition-colors"
              data-testid="button-submit-chart"
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
        {generateMutation.isPending && (
          <p className="text-[10px] text-muted-foreground/25 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI is analyzing your request and fetching data...
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/20" />
        </div>
      ) : charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground/10 mb-3" />
          <p className="text-sm text-muted-foreground/30 font-medium">No charts yet</p>
          <p className="text-[10px] text-muted-foreground/20 mt-1 max-w-xs">
            Ask the AI to pull data from Dune, DeFiLlama, or CoinGecko — or add queries from the library in Token Intelligence
          </p>
          <div className="flex flex-wrap gap-1.5 mt-4 max-w-md justify-center">
            {[
              `${companyName} TVL history`,
              `Daily active users`,
              `Revenue vs fees trend`,
              `Price chart 90 days`,
            ].map((s) => (
              <button
                key={s}
                onClick={() => setPrompt(s)}
                className="text-[10px] px-2.5 py-1 rounded-full border border-border/10 text-muted-foreground/30 hover:text-teal-400 hover:border-teal-500/20 transition-colors"
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
            <ChartRenderer key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </div>
  );
}
