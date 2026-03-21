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
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
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

function formatDateTick(ts: number): string {
  if (ts > 1e12) ts = ts / 1000;
  try { return format(new Date(ts * 1000), "MMM d"); } catch { return String(ts); }
}

function formatDateLabel(ts: number): string {
  if (ts > 1e12) ts = ts / 1000;
  try { return format(new Date(ts * 1000), "MMM d, yyyy"); } catch { return String(ts); }
}

function MiniChart({ data, xKey, yKey, label, color, xType, fmt }: {
  data: any[];
  xKey: string;
  yKey: string;
  label: string;
  color: string;
  xType: string;
  fmt?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="w-3 h-[2px] rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[9px] text-muted-foreground/50 lowercase">{label}</span>
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -5, bottom: 0 }}>
          <XAxis
            dataKey={xKey}
            tickFormatter={xType === "date" ? formatDateTick : undefined}
            tick={{ fontSize: 8, fill: "rgba(255,255,255,0.15)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => smartFormat(v, fmt)}
            tick={{ fontSize: 8, fill: "rgba(255,255,255,0.15)" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "4px",
              fontSize: "10px",
              padding: "4px 8px",
            }}
            labelFormatter={(l: any) => xType === "date" ? formatDateLabel(l) : String(l)}
            formatter={(value: any) => [smartTooltip(value, fmt), label]}
            cursor={false}
          />
          <Line
            type="monotone"
            dataKey={yKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 2, fill: color, stroke: "none" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
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
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
        className="p-1 rounded hover:bg-white/5 text-white/15 hover:text-white/40 transition-colors"
        data-testid={`button-refresh-chart-${chart.id}`}
      >
        <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
      </button>
      <button
        onClick={() => deleteMutation.mutate()}
        className="p-1 rounded hover:bg-red-500/10 text-white/15 hover:text-red-400/60 transition-colors"
        data-testid={`button-delete-chart-${chart.id}`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );

  if (chart.status === "pending") {
    return (
      <div className="rounded-lg p-5 bg-white/[0.02]" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex flex-col items-center justify-center h-32 gap-2">
          <RefreshCw className="w-4 h-4 text-white/10" />
          <span className="text-[10px] text-white/20">Click refresh to load data</span>
        </div>
      </div>
    );
  }

  if (chart.status === "generating") {
    return (
      <div className="rounded-lg p-5 bg-white/[0.02]" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{chart.title}</p>
        </div>
        <div className="flex items-center justify-center h-32 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-white/20" />
          <span className="text-[10px] text-white/20">Fetching data...</span>
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className="rounded-lg p-5 bg-white/[0.02]" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="flex items-center justify-center h-32 gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400/30" />
          <span className="text-[10px] text-red-400/40">{chart.errorMessage || "Failed to fetch data"}</span>
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

  const processedData = chartData.map((d: any) => {
    const processed = { ...d };
    if (xAxis.type === "date" && processed[xAxis.dataKey]) {
      let ts = processed[xAxis.dataKey];
      if (typeof ts === 'string') ts = new Date(ts).getTime() / 1000;
      processed[xAxis.dataKey] = ts;
    }
    return processed;
  });

  if (chart.chartType === "table") {
    const columns = chartConfig.columns || (chartData[0] ? Object.keys(chartData[0]) : []);
    return (
      <div className="rounded-lg p-5 bg-white/[0.02]" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{chart.title}</p>
          {chartActions}
        </div>
        <div className="max-h-72 overflow-auto rounded">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[hsl(var(--background))] z-10">
              <tr>
                {columns.map((col: string) => (
                  <th key={col} className="text-left px-3 py-2 text-[9px] font-semibold text-white/25 uppercase tracking-wider border-b border-white/5 whitespace-nowrap">
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
                      <td key={col} className="px-3 py-1.5 text-white/50 whitespace-nowrap font-mono">
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {chartData.length > 100 && (
            <p className="text-[9px] text-white/15 text-center py-1.5">Showing 100 of {chartData.length} rows</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 text-[9px] text-white/10">
          <span>{chart.dataSource} · {chartData.length} rows</span>
          <span>{format(new Date(chart.updatedAt), "MMM d, h:mm a")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg p-5 bg-white/[0.02]" data-testid={`chart-card-${chart.id}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">{chart.title}</p>
        {chartActions}
      </div>
      <div className={`grid gap-4 ${yAxes.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {yAxes.map((y: any, i: number) => (
          <MiniChart
            key={i}
            data={processedData}
            xKey={xAxis.dataKey}
            yKey={y.dataKey}
            label={y.label || y.dataKey}
            color={y.color || CHART_COLORS[i]}
            xType={xAxis.type || "category"}
            fmt={y.format}
          />
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-[9px] text-white/10">
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
              className="w-full h-9 px-3 pr-10 text-xs rounded-md border border-white/[0.06] bg-white/[0.02] text-foreground placeholder:text-white/15 focus:outline-none focus:border-teal-500/20 transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-white/20 hover:text-teal-400 disabled:opacity-30 transition-colors"
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
          <p className="text-[10px] text-white/15 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI is analyzing your request and fetching data...
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-white/10" />
        </div>
      ) : charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-8 h-8 text-white/5 mb-3" />
          <p className="text-sm text-white/20 font-medium">No charts yet</p>
          <p className="text-[10px] text-white/10 mt-1 max-w-xs">
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
                className="text-[10px] px-2.5 py-1 rounded-full border border-white/[0.06] text-white/20 hover:text-teal-400 hover:border-teal-500/15 transition-colors"
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
