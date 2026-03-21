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
} from "lucide-react";
import {
  ResponsiveContainer,
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

function smartFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") {
    const abs = Math.abs(value);
    if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M%`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K%`;
    return `${value.toFixed(1)}%`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function smartTooltip(value: number, fmt?: string): string {
  if (fmt === "currency") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (fmt === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function buildDateFormatter(data: any[], xKey: string) {
  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const d of data) {
    let ts = d[xKey];
    if (typeof ts !== "number") continue;
    if (ts > 1e12) ts = ts / 1000;
    try {
      const yr = new Date(ts * 1000).getFullYear();
      if (yr < minYear) minYear = yr;
      if (yr > maxYear) maxYear = yr;
    } catch {}
  }
  const spansYears = maxYear > minYear;
  let lastYear = -1;

  return {
    tickFormatter: (ts: number) => {
      if (ts > 1e12) ts = ts / 1000;
      try {
        const d = new Date(ts * 1000);
        const yr = d.getFullYear();
        if (spansYears && yr !== lastYear) {
          lastYear = yr;
          return `${format(d, "MMM d")}\n${yr}`;
        }
        return format(d, "MMM d");
      } catch {
        return String(ts);
      }
    },
    tooltipFormatter: (ts: any) => {
      if (typeof ts !== "number") return String(ts);
      if (ts > 1e12) ts = ts / 1000;
      try { return format(new Date(ts * 1000), "MMM d, yyyy"); } catch { return String(ts); }
    },
  };
}

function ChartRenderer({ chart }: { chart: DashboardChart }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();

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
    <div className="flex items-center gap-1">
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
        className="p-1.5 rounded hover:bg-white/5 text-white/20 hover:text-white/50 transition-colors"
        data-testid={`button-refresh-chart-${chart.id}`}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={() => deleteMutation.mutate()}
        className="p-1.5 rounded hover:bg-red-500/10 text-white/20 hover:text-red-400/60 transition-colors"
        data-testid={`button-delete-chart-${chart.id}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  if (chart.status === "pending") {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-5" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex flex-col items-center justify-center h-40 gap-2">
          <RefreshCw className="w-4 h-4 text-white/10" />
          <span className="text-[11px] text-white/20">Click refresh to load data</span>
        </div>
      </div>
    );
  }

  if (chart.status === "generating") {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-5" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{chart.title}</p>
        </div>
        <div className="flex items-center justify-center h-40 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-white/20" />
          <span className="text-[11px] text-white/20">Fetching data...</span>
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-5" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex items-center justify-center h-40 gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400/40" />
          <span className="text-[11px] text-red-400/50">{chart.errorMessage || "Failed to fetch data"}</span>
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
  const isDate = xAxis.type === "date";

  const processedData = chartData.map((d: any) => {
    const processed = { ...d };
    if (isDate && processed[xAxis.dataKey]) {
      let ts = processed[xAxis.dataKey];
      if (typeof ts === 'string') ts = new Date(ts).getTime() / 1000;
      processed[xAxis.dataKey] = ts;
    }
    return processed;
  }).sort((a: any, b: any) => {
    const aVal = a[xAxis.dataKey];
    const bVal = b[xAxis.dataKey];
    if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
    return 0;
  });

  if (chart.chartType === "table") {
    const columns = chartConfig.columns || (chartData[0] ? Object.keys(chartData[0]) : []);
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-5" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="max-h-72 overflow-auto rounded">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[hsl(var(--background))] z-10">
              <tr>
                {columns.map((col: string) => (
                  <th key={col} className="text-left px-3 py-2 text-[10px] font-medium text-white/30 uppercase tracking-wider border-b border-white/[0.06] whitespace-nowrap">
                    {col.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chartData.slice(0, 100).map((row: any, i: number) => (
                <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                  {columns.map((col: string) => {
                    const val = row[col];
                    let display: string;
                    if (typeof val === "number") {
                      display = /usd|price|fee|revenue|volume|amount|cost/i.test(col)
                        ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                        : val.toLocaleString(undefined, { maximumFractionDigits: 4 });
                    } else if (/date|time|day|week|month/i.test(col) && typeof val === 'string') {
                      try { display = format(new Date(val), "MMM d, yyyy"); } catch { display = String(val); }
                    } else {
                      display = String(val ?? "—");
                    }
                    return (
                      <td key={col} className="px-3 py-1.5 text-white/50 whitespace-nowrap font-mono text-[11px]">
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {chartData.length > 100 && (
            <p className="text-[10px] text-white/15 text-center py-2">Showing 100 of {chartData.length} rows</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-3 text-[10px] text-white/15">
          <span>{chart.dataSource} · {chartData.length} rows</span>
          <span>{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
        </div>
      </div>
    );
  }

  const primary = yAxes[0];
  const primaryColor = primary.color || CHART_COLORS[0];
  const primaryFmt = primary.format;
  const cType = chart.chartType || "line";
  const isBarType = cType === "bar";
  const numPoints = processedData.length;

  const dateFmt = isDate ? buildDateFormatter(processedData, xAxis.dataKey) : null;

  const tickInterval = isBarType
    ? (numPoints <= 24 ? 0 : Math.floor(numPoints / 12))
    : (numPoints <= 30 ? 0 : undefined);

  const xAxisConfig = (
    <XAxis
      dataKey={xAxis.dataKey}
      tickFormatter={isDate ? dateFmt!.tickFormatter : undefined}
      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }}
      axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
      tickLine={false}
      interval={tickInterval}
      angle={numPoints > 20 ? -45 : 0}
      textAnchor={numPoints > 20 ? "end" : "middle"}
      height={numPoints > 20 ? 60 : 30}
    />
  );

  const yAxisConfig = (
    <YAxis
      tickFormatter={(v: number) => smartFormat(v, primaryFmt)}
      tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }}
      axisLine={false}
      tickLine={false}
      width={60}
    />
  );

  const tooltipConfig = (
    <Tooltip
      contentStyle={{
        backgroundColor: "rgba(10,10,12,0.95)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "6px",
        fontSize: "12px",
        padding: "8px 12px",
        color: "rgba(255,255,255,0.8)",
      }}
      labelStyle={{ color: "rgba(255,255,255,0.4)", fontSize: "10px", marginBottom: "2px" }}
      labelFormatter={isDate ? dateFmt!.tooltipFormatter : (l: any) => String(l)}
      formatter={(value: any) => [smartTooltip(value, primaryFmt), primary.label || primary.dataKey]}
      cursor={{ fill: "rgba(255,255,255,0.03)" }}
    />
  );

  const gridConfig = (
    <CartesianGrid
      strokeDasharray="3 3"
      stroke="rgba(255,255,255,0.04)"
      vertical={false}
    />
  );

  const chartHeight = isBarType ? 280 : (numPoints > 100 ? 260 : 240);

  const renderChart = () => {
    if (cType === "bar") {
      return (
        <BarChart data={processedData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
          {gridConfig}
          {xAxisConfig}
          {yAxisConfig}
          {tooltipConfig}
          <Bar
            dataKey={primary.dataKey}
            fill={primaryColor}
            radius={[3, 3, 0, 0]}
            maxBarSize={numPoints <= 12 ? 48 : numPoints <= 24 ? 32 : 20}
          />
        </BarChart>
      );
    }
    if (cType === "area") {
      return (
        <AreaChart data={processedData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
          {gridConfig}
          {xAxisConfig}
          {yAxisConfig}
          {tooltipConfig}
          <defs>
            <linearGradient id={`grad-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={primaryColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={primary.dataKey} stroke={primaryColor} strokeWidth={1.5} fill={`url(#grad-${chart.id})`} dot={false} />
        </AreaChart>
      );
    }
    return (
      <LineChart data={processedData} margin={{ top: 12, right: 16, left: 0, bottom: 4 }}>
        {gridConfig}
        {xAxisConfig}
        {yAxisConfig}
        {tooltipConfig}
        <Line
          type="monotone"
          dataKey={primary.dataKey}
          stroke={primaryColor}
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: primaryColor, stroke: "rgba(0,0,0,0.5)", strokeWidth: 1 }}
        />
      </LineChart>
    );
  };

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-5" data-testid={`chart-card-${chart.id}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-[3px] rounded-full" style={{ backgroundColor: primaryColor }} />
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{chart.title}</p>
        </div>
        {chartActions}
      </div>
      <ResponsiveContainer width="100%" height={chartHeight}>
        {renderChart()}
      </ResponsiveContainer>
      <div className="flex items-center justify-between mt-2 text-[10px] text-white/15">
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
              className="w-full h-9 px-3 pr-10 text-xs rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-white/20 focus:outline-none focus:border-teal-500/20 transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/25 hover:text-teal-400 disabled:opacity-30 transition-colors"
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
          <p className="text-[11px] text-white/20 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI is analyzing your request and fetching data...
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
          <p className="text-sm text-white/25 font-medium">No charts yet</p>
          <p className="text-[11px] text-white/15 mt-1 max-w-xs">
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
                className="text-[11px] px-2.5 py-1 rounded-full border border-white/[0.06] text-white/25 hover:text-teal-400 hover:border-teal-500/20 transition-colors"
                data-testid={`suggestion-${s.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {charts.map((chart) => (
            <ChartRenderer key={chart.id} chart={chart} />
          ))}
        </div>
      )}
    </div>
  );
}
