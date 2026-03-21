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

function formatAxisValue(value: number, fmt?: string): string {
  if (fmt === "currency") {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
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
      toast({ title: "Chart refreshed" });
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

  if (chart.status === "generating") {
    return (
      <div className="border border-border/10 rounded-lg p-6 bg-card/20" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground/80">{chart.title}</h3>
        </div>
        <div className="flex items-center justify-center h-48 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Fetching data...</span>
        </div>
      </div>
    );
  }

  if (chart.status === "failed") {
    return (
      <div className="border border-destructive/20 rounded-lg p-6 bg-card/20" data-testid={`chart-card-${chart.id}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground/80">{chart.title}</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="p-1 rounded hover:bg-accent/20 text-muted-foreground/30 hover:text-muted-foreground transition-colors"
              data-testid={`button-retry-chart-${chart.id}`}
            >
              <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => deleteMutation.mutate()}
              className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/30 hover:text-destructive transition-colors"
              data-testid={`button-delete-chart-${chart.id}`}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center h-48 gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive/50" />
          <span className="text-xs text-destructive/60">{chart.errorMessage || "Failed to fetch data"}</span>
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
  const yAxes = chartConfig.yAxes || [{ dataKey: "value", label: "Value", color: "#3b82f6" }];
  const hasRightAxis = yAxes.some((y: any) => y.yAxisId === "right");

  const processedData = chartData.map((d: any) => {
    const processed = { ...d };
    if (xAxis.type === "date" && processed[xAxis.dataKey]) {
      let ts = processed[xAxis.dataKey];
      if (typeof ts === 'string') ts = new Date(ts).getTime() / 1000;
      processed[xAxis.dataKey] = ts;
    }
    return processed;
  });

  const renderChart = () => {
    const commonProps = {
      data: processedData,
      margin: { top: 5, right: hasRightAxis ? 60 : 20, left: 20, bottom: 5 },
    };

    const xAxisComponent = (
      <XAxis
        dataKey={xAxis.dataKey}
        tickFormatter={xAxis.type === "date" ? formatDateTick : undefined}
        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
        axisLine={{ stroke: "hsl(var(--border))", opacity: 0.15 }}
        tickLine={false}
      />
    );

    const leftYAxis = (
      <YAxis
        yAxisId="left"
        tickFormatter={(v: number) => formatAxisValue(v, yAxes[0]?.format)}
        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
        axisLine={false}
        tickLine={false}
        width={55}
      />
    );

    const rightYAxis = hasRightAxis ? (
      <YAxis
        yAxisId="right"
        orientation="right"
        tickFormatter={(v: number) => {
          const rightAxis = yAxes.find((y: any) => y.yAxisId === "right");
          return formatAxisValue(v, rightAxis?.format);
        }}
        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", opacity: 0.5 }}
        axisLine={false}
        tickLine={false}
        width={55}
      />
    ) : null;

    const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.08} />;

    const tooltipComponent = (
      <Tooltip
        contentStyle={{
          backgroundColor: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "6px",
          fontSize: "11px",
          opacity: 0.95,
        }}
        labelFormatter={(label: any) => {
          if (xAxis.type === "date") {
            let ts = label;
            if (ts > 1e12) ts = ts / 1000;
            try { return format(new Date(ts * 1000), "MMM d, yyyy"); } catch { return String(label); }
          }
          return String(label);
        }}
        formatter={(value: any, name: string) => {
          const axis = yAxes.find((y: any) => y.dataKey === name);
          return [formatTooltipValue(value, axis?.format), axis?.label || name];
        }}
      />
    );

    const legend = yAxes.length > 1 ? (
      <Legend
        wrapperStyle={{ fontSize: "10px", opacity: 0.6 }}
        formatter={(value: string) => {
          const axis = yAxes.find((y: any) => y.dataKey === value);
          return axis?.label || value;
        }}
      />
    ) : null;

    if (chart.chartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}
          {xAxisComponent}
          {leftYAxis}
          {rightYAxis}
          {tooltipComponent}
          {legend}
          {yAxes.map((y: any, i: number) => (
            <Bar key={i} dataKey={y.dataKey} fill={y.color || "#3b82f6"} yAxisId={y.yAxisId || "left"} radius={[2, 2, 0, 0]} opacity={0.8} />
          ))}
        </BarChart>
      );
    }

    if (chart.chartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {grid}
          {xAxisComponent}
          {leftYAxis}
          {rightYAxis}
          {tooltipComponent}
          {legend}
          {yAxes.map((y: any, i: number) => (
            <Area key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || "#3b82f6"} fill={y.color || "#3b82f6"} fillOpacity={0.1} yAxisId={y.yAxisId || "left"} strokeWidth={1.5} />
          ))}
        </AreaChart>
      );
    }

    if (chart.chartType === "composed") {
      return (
        <ComposedChart {...commonProps}>
          {grid}
          {xAxisComponent}
          {leftYAxis}
          {rightYAxis}
          {tooltipComponent}
          {legend}
          {yAxes.map((y: any, i: number) => {
            if (y.chartType === "bar") {
              return <Bar key={i} dataKey={y.dataKey} fill={y.color || "#3b82f6"} yAxisId={y.yAxisId || "left"} radius={[2, 2, 0, 0]} opacity={0.6} />;
            }
            if (y.chartType === "area") {
              return <Area key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || "#3b82f6"} fill={y.color || "#3b82f6"} fillOpacity={0.1} yAxisId={y.yAxisId || "left"} strokeWidth={1.5} />;
            }
            return <Line key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || "#3b82f6"} yAxisId={y.yAxisId || "left"} strokeWidth={1.5} dot={false} />;
          })}
        </ComposedChart>
      );
    }

    return (
      <LineChart {...commonProps}>
        {grid}
        {xAxisComponent}
        {leftYAxis}
        {rightYAxis}
        {tooltipComponent}
        {legend}
        {yAxes.map((y: any, i: number) => (
          <Line key={i} type="monotone" dataKey={y.dataKey} stroke={y.color || "#3b82f6"} yAxisId={y.yAxisId || "left"} strokeWidth={1.5} dot={false} />
        ))}
      </LineChart>
    );
  };

  return (
    <div className="border border-border/10 rounded-lg p-4 bg-card/20" data-testid={`chart-card-${chart.id}`}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-xs font-semibold text-foreground/80">{chart.title}</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="p-1 rounded hover:bg-accent/20 text-muted-foreground/20 hover:text-muted-foreground transition-colors"
            data-testid={`button-refresh-chart-${chart.id}`}
            title="Refresh data"
          >
            <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/20 hover:text-destructive transition-colors"
            data-testid={`button-delete-chart-${chart.id}`}
            title="Delete chart"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      {chart.description && (
        <p className="text-[10px] text-muted-foreground/30 mb-3">{chart.description}</p>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
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
              placeholder={`What chart do you want? e.g. "${companyName} TVL over last 90 days" or "Price vs Revenue"`}
              className="w-full h-9 px-3 pr-10 text-xs rounded-md border border-border/20 bg-card/30 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-blue-500/30 transition-colors"
              disabled={generateMutation.isPending}
              data-testid="input-chart-prompt"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || generateMutation.isPending}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-muted-foreground/30 hover:text-blue-400 disabled:opacity-30 transition-colors"
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
          <p className="text-[10px] text-muted-foreground/30 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI is analyzing your request and fetching data...
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : charts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="text-muted-foreground/15">
            <BarChart3 className="w-10 h-10" />
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground/50 mb-1">No charts yet</p>
            <p className="text-[11px] text-muted-foreground/25 max-w-sm">
              Describe the chart you want — the AI will pull data from Dune, DeFiLlama, or CoinGecko and build it for you.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 mt-3 justify-center">
            {[
              `${companyName} TVL history`,
              `Price chart last 90 days`,
              `Daily revenue vs fees`,
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => { setPrompt(suggestion); }}
                className="text-[10px] px-2.5 py-1 rounded-full border border-border/15 text-muted-foreground/35 hover:text-muted-foreground/60 hover:border-border/30 transition-colors"
                data-testid={`suggestion-${suggestion.substring(0, 20).replace(/\s+/g, '-').toLowerCase()}`}
              >
                {suggestion}
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
