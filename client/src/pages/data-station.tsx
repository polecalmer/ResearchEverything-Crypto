import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw, Trash2, BarChart3, Loader2,
  Clock, Zap, MoreVertical, FileText, Plus,
  ChevronRight, TrendingUp, Layers, Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

const CHART_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f87171", "#facc15"];

interface SavedChart {
  id: string;
  title: string;
  chartType: string;
  chartConfig: string;
  data: string;
  dataSourceConfig: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Report {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ParsedChart extends SavedChart {
  parsedData: any[];
  parsedConfig: any;
  dsConfig: any;
  hasRecipe: boolean;
  protocol: string;
  metric: string;
  latestValue: string | null;
  dataPoints: number;
}

function parseChart(chart: SavedChart): ParsedChart {
  let parsedData: any[] = [];
  let parsedConfig: any = {};
  let dsConfig: any = {};
  try { parsedData = JSON.parse(chart.data || "[]"); } catch {}
  try { parsedConfig = JSON.parse(chart.chartConfig || "{}"); } catch {}
  try { dsConfig = JSON.parse(chart.dataSourceConfig || "{}"); } catch {}

  const recipe = dsConfig.refreshRecipe;
  const protocol = recipe?.protocol || extractProtocolFromTitle(chart.title);
  const metric = recipe?.metric || extractMetricFromTitle(chart.title);

  let latestValue: string | null = null;
  if (parsedData.length > 0) {
    const last = parsedData[parsedData.length - 1];
    const key = parsedConfig.yAxes?.[0]?.dataKey;
    if (key && last[key] != null) {
      const v = Number(last[key]);
      if (!isNaN(v)) {
        if (metric === "pe_ratio" || metric === "ps_ratio" || metric === "volume_tvl_ratio" || metric === "fdv_tvl") {
          latestValue = `${v.toFixed(1)}x`;
        } else if (metric === "take_rate" || metric === "capital_efficiency" || metric === "revenue_growth" || metric === "fee_growth") {
          latestValue = `${v.toFixed(1)}%`;
        } else {
          latestValue = v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
        }
      }
    }
  }

  return {
    ...chart,
    parsedData,
    parsedConfig,
    dsConfig,
    hasRecipe: !!recipe,
    protocol,
    metric,
    latestValue,
    dataPoints: parsedData.length,
  };
}

function extractProtocolFromTitle(title: string): string {
  const tokens = title.split(/\s+/);
  const stopWords = new Set(["daily", "weekly", "monthly", "total", "value", "locked", "ratio", "volume", "revenue", "fees", "tvl", "p/e", "apy", "apr", "price", "market", "cap", "fdv", "trading", "dex", "basis", "yield", "paid", "financial", "statement", "fee", "summary", "growth"]);
  for (const t of tokens) {
    if (t.length > 1 && !stopWords.has(t.toLowerCase()) && /^[A-Z]/.test(t)) return t;
  }
  return tokens[0] || "Unknown";
}

function extractMetricFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("p/e") || lower.includes("pe ratio")) return "pe_ratio";
  if (lower.includes("tvl") || lower.includes("total value locked")) return "tvl";
  if (lower.includes("volume")) return "volume";
  if (lower.includes("revenue")) return "revenue";
  if (lower.includes("fee")) return "fees";
  if (lower.includes("apy") || lower.includes("yield")) return "yield";
  if (lower.includes("price")) return "price";
  return "metric";
}

function formatMetricLabel(metric: string): string {
  const labels: Record<string, string> = {
    pe_ratio: "P/E Ratio", ps_ratio: "P/S Ratio", tvl: "TVL", volume: "Volume",
    revenue: "Revenue", fees: "Fees", yield: "Yield", price: "Price",
    take_rate: "Take Rate", capital_efficiency: "Capital Efficiency",
    revenue_growth: "Revenue Growth", fee_growth: "Fee Growth",
    volume_tvl_ratio: "Vol/TVL", fdv_tvl: "FDV/TVL", metric: "Data",
  };
  return labels[metric] || metric.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function MiniChart({ pc, height = 120 }: { pc: ParsedChart; height?: number }) {
  const { parsedData, parsedConfig, chartType: rawType } = pc;
  if (!parsedData.length || !parsedConfig?.yAxes?.length) return null;
  const chartType = parsedConfig.chartType || rawType || "line";
  const yAxes = parsedConfig.yAxes || [];
  const fmtTick = (v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v >= 100 ? String(Math.round(v)) : v >= 1 ? v.toFixed(1) : v.toFixed(2);

  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartType === "bar" ? (
        <BarChart data={parsedData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={false} axisLine={false} height={0} />
          <YAxis tick={{ fontSize: 8, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} width={38} tickFormatter={fmtTick} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 10, padding: "6px 10px" }} />
          {yAxes.map((y: any, i: number) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={0.75} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      ) : chartType === "area" ? (
        <AreaChart data={parsedData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={false} axisLine={false} height={0} />
          <YAxis tick={{ fontSize: 8, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} width={38} tickFormatter={fmtTick} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 10, padding: "6px 10px" }} />
          {yAxes.map((y: any, i: number) => (
            <Area key={y.dataKey} dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.12} strokeWidth={1.5} />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={parsedData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="date" tick={false} axisLine={false} height={0} />
          <YAxis tick={{ fontSize: 8, fill: "rgba(255,255,255,0.25)" }} axisLine={false} tickLine={false} width={38} tickFormatter={fmtTick} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, fontSize: 10, padding: "6px 10px" }} />
          {yAxes.map((y: any, i: number) => (
            <Line key={y.dataKey} dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

function DashboardCard({ pc, onRefresh, onDelete, onAddToReport, reports, refreshingId }: {
  pc: ParsedChart;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToReport: (chartId: string, reportId: string) => void;
  reports: Report[];
  refreshingId: string | null;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isRefreshing = refreshingId === pc.id;
  const metricLabel = formatMetricLabel(pc.metric);

  return (
    <div className="bg-card/20 border border-border/15 rounded-lg overflow-hidden hover:border-border/30 transition-all group" data-testid={`chart-card-${pc.id}`}>
      <div className="px-3 pt-2.5 pb-0.5 flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40 mb-0.5">{metricLabel}</p>
          {pc.latestValue ? (
            <p className="text-base font-semibold text-foreground/95 leading-tight tabular-nums" data-testid={`text-chart-value-${pc.id}`}>{pc.latestValue}</p>
          ) : (
            <p className="text-[10px] text-foreground/70 truncate" data-testid={`text-chart-title-${pc.id}`}>{pc.title}</p>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 -mt-0.5">
          {pc.hasRecipe && (
            <button
              onClick={() => onRefresh(pc.id)}
              disabled={isRefreshing}
              className="p-1 text-muted-foreground/30 hover:text-cyan-400 transition-colors"
              title="Refresh live data"
              data-testid={`button-refresh-chart-${pc.id}`}
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
            </button>
          )}
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="p-1 text-muted-foreground/30 hover:text-foreground/60 transition-colors" data-testid={`button-chart-menu-${pc.id}`}>
              <MoreVertical className="h-3 w-3" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-6 z-50 bg-card border border-border/30 rounded-md shadow-xl py-1 min-w-[140px]" onMouseLeave={() => setShowMenu(false)}>
                {reports.length > 0 && reports.map(r => (
                  <button
                    key={r.id}
                    className="w-full text-left px-3 py-1.5 text-[10px] text-foreground/60 hover:bg-muted/20 flex items-center gap-2"
                    onClick={() => { onAddToReport(pc.id, r.id); setShowMenu(false); }}
                    data-testid={`button-add-to-report-${r.id}`}
                  >
                    <FileText className="h-3 w-3" /> Add to {r.title}
                  </button>
                ))}
                <button
                  className="w-full text-left px-3 py-1.5 text-[10px] text-destructive/70 hover:bg-destructive/10 flex items-center gap-2 border-t border-border/15"
                  onClick={() => { onDelete(pc.id); setShowMenu(false); }}
                  data-testid={`button-delete-chart-${pc.id}`}
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-0.5 mt-1">
        <MiniChart pc={pc} height={100} />
      </div>

      <div className="px-3 pb-1.5 flex items-center justify-between">
        <span className="text-[8px] text-muted-foreground/30">{pc.dataPoints} pts</span>
        <span className="text-[8px] text-muted-foreground/30">
          {formatDistanceToNow(new Date(pc.updatedAt || pc.createdAt), { addSuffix: true })}
        </span>
      </div>
    </div>
  );
}

function ProtocolDashboard({ protocol, charts, onRefresh, onDelete, onAddToReport, reports, refreshingId, onRefreshProtocol }: {
  protocol: string;
  charts: ParsedChart[];
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToReport: (chartId: string, reportId: string) => void;
  reports: Report[];
  refreshingId: string | null;
  onRefreshProtocol: (protocol: string) => void;
}) {
  const refreshableCount = charts.filter(c => c.hasRecipe).length;
  const metrics = [...new Set(charts.map(c => formatMetricLabel(c.metric)))];
  const latestUpdate = charts.reduce((latest, c) => {
    const d = new Date(c.updatedAt || c.createdAt);
    return d > latest ? d : latest;
  }, new Date(0));

  return (
    <div className="mb-8" data-testid={`protocol-dashboard-${protocol}`}>
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-border/20 flex items-center justify-center">
            <span className="text-[10px] font-bold text-foreground/80">{protocol.slice(0, 2).toUpperCase()}</span>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">{protocol}</h3>
            <p className="text-[9px] text-muted-foreground/40">
              {charts.length} chart{charts.length !== 1 ? "s" : ""} · {metrics.join(", ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[8px] text-muted-foreground/30">
            {formatDistanceToNow(latestUpdate, { addSuffix: true })}
          </span>
          {refreshableCount > 0 && (
            <button
              onClick={() => onRefreshProtocol(protocol)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[9px] text-cyan-400/70 hover:text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/15 hover:border-cyan-500/30 transition-all"
              data-testid={`button-refresh-protocol-${protocol}`}
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Refresh ({refreshableCount})
            </button>
          )}
        </div>
      </div>

      <div className={`grid gap-2.5 ${charts.length === 1 ? "grid-cols-1 max-w-md" : charts.length === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
        {charts.map(pc => (
          <DashboardCard key={pc.id} pc={pc} onRefresh={onRefresh} onDelete={onDelete} onAddToReport={onAddToReport} reports={reports} refreshingId={refreshingId} />
        ))}
      </div>
    </div>
  );
}

export default function DataStation() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"protocols" | "report">("protocols");
  const [activeReport, setActiveReport] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [newReportTitle, setNewReportTitle] = useState("");
  const [showNewReport, setShowNewReport] = useState(false);

  const chartsQuery = useQuery<SavedChart[]>({
    queryKey: ["/api/research/charts/saved"],
    enabled: !!user,
  });

  const reportsQuery = useQuery<Report[]>({
    queryKey: ["/api/research/reports"],
    enabled: !!user,
  });

  const reportChartsQuery = useQuery<SavedChart[]>({
    queryKey: ["/api/research/reports", activeReport, "charts"],
    queryFn: async () => {
      if (!activeReport) return [];
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/reports/${activeReport}/charts`, { headers: authHeaders, credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!activeReport,
  });

  const charts = chartsQuery.data || [];
  const reports = reportsQuery.data || [];

  const parsed = useMemo(() => charts.map(parseChart), [charts]);
  const reportParsed = useMemo(() => (reportChartsQuery.data || []).map(parseChart), [reportChartsQuery.data]);

  const protocolGroups = useMemo(() => {
    const groups = new Map<string, ParsedChart[]>();
    for (const pc of parsed) {
      const key = pc.protocol;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pc);
    }
    const sorted = [...groups.entries()].sort((a, b) => {
      const aDate = Math.max(...a[1].map(c => new Date(c.updatedAt || c.createdAt).getTime()));
      const bDate = Math.max(...b[1].map(c => new Date(c.updatedAt || c.createdAt).getTime()));
      return bDate - aDate;
    });
    return sorted;
  }, [parsed]);

  const totalRefreshable = parsed.filter(c => c.hasRecipe).length;

  const handleRefresh = async (chartId: string) => {
    setRefreshingId(chartId);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/charts/${chartId}/refresh`, { method: "POST", headers: authHeaders, credentials: "include" });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Refresh failed"); }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      if (activeReport) queryClient.invalidateQueries({ queryKey: ["/api/research/reports", activeReport, "charts"] });
      toast({ title: "Refreshed", description: `${result.dataPoints} points in ${(result.refreshTimeMs / 1000).toFixed(1)}s` });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (chartId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/charts/${chartId}`, { method: "DELETE", headers: authHeaders, credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const handleAddToReport = async (chartId: string, reportId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/reports/${reportId}/charts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ chartId }),
      });
      if (!res.ok) throw new Error("Failed to add");
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports", reportId, "charts"] });
      toast({ title: "Added to report" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const handleRefreshProtocol = async (protocol: string) => {
    const group = protocolGroups.find(([p]) => p === protocol);
    if (!group) return;
    const refreshable = group[1].filter(c => c.hasRecipe);
    if (refreshable.length === 0) return;
    toast({ title: `Refreshing ${protocol}`, description: `${refreshable.length} charts...` });
    const results = await Promise.allSettled(refreshable.map(c => handleRefresh(c.id)));
    const ok = results.filter(r => r.status === "fulfilled").length;
    queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
    toast({ title: `${protocol} refreshed`, description: `${ok}/${refreshable.length} charts updated` });
  };

  const handleRefreshAll = async () => {
    const refreshable = parsed.filter(c => c.hasRecipe);
    if (refreshable.length === 0) return;
    toast({ title: "Refreshing all", description: `${refreshable.length} charts across ${protocolGroups.length} protocols...` });
    const results = await Promise.allSettled(refreshable.map(c => handleRefresh(c.id)));
    const ok = results.filter(r => r.status === "fulfilled").length;
    queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
    toast({ title: "All refreshed", description: `${ok}/${refreshable.length} charts updated` });
  };

  const handleCreateReport = async () => {
    if (!newReportTitle.trim()) return;
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/research/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ title: newReportTitle.trim() }),
      });
      if (!res.ok) throw new Error("Create failed");
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports"] });
      setNewReportTitle("");
      setShowNewReport(false);
    } catch (e: any) {
      toast({ title: "Failed to create report", description: e.message, variant: "destructive" });
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/reports/${reportId}`, { method: "DELETE", headers: authHeaders, credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      if (activeReport === reportId) { setActiveReport(null); setActiveView("protocols"); }
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports"] });
    } catch (e: any) {
      toast({ title: "Failed to delete report", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="flex h-[calc(100vh-48px)]" data-testid="data-station-page">
      <div className="w-52 border-r border-border/15 flex flex-col bg-card/5 shrink-0">
        <div className="p-3 pb-2 border-b border-border/15">
          <div className="flex items-center gap-2 mb-3">
            <Radio className="h-3.5 w-3.5 text-cyan-400/70" />
            <span className="text-[11px] font-semibold text-foreground/85 tracking-wide">Data Station</span>
          </div>
          {totalRefreshable > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshAll}
              className="w-full h-7 text-[9px] gap-1.5 border-cyan-500/15 text-cyan-400/70 hover:bg-cyan-500/10 hover:text-cyan-400"
              data-testid="button-refresh-all"
            >
              <Zap className="h-3 w-3" />
              Refresh All ({totalRefreshable})
            </Button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-2 pt-2 pb-1">
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground/35 font-medium px-1">Protocols</span>
          </div>

          <button
            onClick={() => { setActiveView("protocols"); setActiveReport(null); }}
            className={`w-full text-left px-3 py-1.5 text-[10px] flex items-center gap-2 transition-colors ${
              activeView === "protocols" && !activeReport ? "bg-muted/20 text-foreground/90" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"
            }`}
            data-testid="button-all-protocols"
          >
            <Layers className="h-3 w-3" />
            All Protocols ({protocolGroups.length})
          </button>

          {protocolGroups.map(([protocol, pCharts]) => (
            <button
              key={protocol}
              onClick={() => {
                setActiveView("protocols");
                setActiveReport(null);
                document.getElementById(`protocol-${protocol}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="w-full text-left px-3 py-1.5 text-[10px] flex items-center gap-2 text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10 transition-colors"
              data-testid={`button-protocol-nav-${protocol}`}
            >
              <div className="w-4 h-4 rounded bg-gradient-to-br from-cyan-500/15 to-purple-500/15 flex items-center justify-center shrink-0">
                <span className="text-[7px] font-bold text-foreground/60">{protocol.slice(0, 2).toUpperCase()}</span>
              </div>
              <span className="truncate flex-1">{protocol}</span>
              <span className="text-[8px] text-muted-foreground/30">{pCharts.length}</span>
            </button>
          ))}

          <div className="px-2 pt-4 pb-1 flex items-center justify-between">
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground/35 font-medium px-1">Reports</span>
            <button onClick={() => setShowNewReport(true)} className="p-0.5 text-muted-foreground/30 hover:text-foreground/50" data-testid="button-new-report">
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {showNewReport && (
            <div className="px-3 pb-2">
              <input
                value={newReportTitle}
                onChange={e => setNewReportTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateReport(); if (e.key === "Escape") setShowNewReport(false); }}
                placeholder="Report name..."
                className="w-full bg-muted/15 border border-border/20 rounded px-2 py-1 text-[10px] text-foreground/80 placeholder:text-muted-foreground/25 outline-none focus:border-cyan-500/30"
                autoFocus
                data-testid="input-new-report-title"
              />
            </div>
          )}

          {reports.map(r => (
            <div key={r.id} className="group flex items-center">
              <button
                onClick={() => { setActiveReport(r.id); setActiveView("report"); }}
                className={`flex-1 text-left px-3 py-1.5 text-[10px] flex items-center gap-2 transition-colors min-w-0 ${
                  activeReport === r.id ? "bg-muted/20 text-foreground/90" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"
                }`}
                data-testid={`button-report-${r.id}`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{r.title}</span>
              </button>
              <button
                onClick={() => handleDeleteReport(r.id)}
                className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-muted-foreground/30 hover:text-destructive transition-opacity"
                data-testid={`button-delete-report-${r.id}`}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {reports.length === 0 && !showNewReport && (
            <p className="text-[9px] text-muted-foreground/25 px-4 py-2">No reports yet</p>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <div className="flex-1 overflow-y-auto">
          {chartsQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
            </div>
          ) : activeView === "report" && activeReport ? (
            <div className="p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground/90">{reports.find(r => r.id === activeReport)?.title}</h2>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">{reportParsed.length} charts</p>
                </div>
              </div>
              {reportParsed.length === 0 ? (
                <div className="text-center py-16">
                  <FileText className="h-6 w-6 text-muted-foreground/15 mx-auto mb-2" />
                  <p className="text-[10px] text-muted-foreground/30">No charts in this report yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {reportParsed.map(pc => (
                    <DashboardCard key={pc.id} pc={pc} onRefresh={handleRefresh} onDelete={handleDelete} onAddToReport={handleAddToReport} reports={reports} refreshingId={refreshingId} />
                  ))}
                </div>
              )}
            </div>
          ) : parsed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8" data-testid="empty-station">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-border/15 flex items-center justify-center mb-4">
                <Radio className="h-5 w-5 text-cyan-400/40" />
              </div>
              <h2 className="text-sm font-semibold text-foreground/70 mb-1.5">Your Data Station</h2>
              <p className="text-[11px] text-muted-foreground/40 max-w-sm leading-relaxed">
                Charts you save from Sessions appear here, automatically organized by protocol. 
                Each chart with a data recipe can be refreshed with one click to pull the latest live data — no AI cost.
              </p>
              <div className="flex items-center gap-4 mt-6 text-[9px] text-muted-foreground/30">
                <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Auto-indexed by protocol</span>
                <span className="flex items-center gap-1"><RefreshCw className="h-3 w-3" /> One-click live refresh</span>
                <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Organize into reports</span>
              </div>
            </div>
          ) : (
            <div className="p-5">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground/90">Protocol Dashboards</h2>
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                    {parsed.length} charts across {protocolGroups.length} protocol{protocolGroups.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {protocolGroups.map(([protocol, pCharts]) => (
                <div key={protocol} id={`protocol-${protocol}`}>
                  <ProtocolDashboard
                    protocol={protocol}
                    charts={pCharts}
                    onRefresh={handleRefresh}
                    onDelete={handleDelete}
                    onAddToReport={handleAddToReport}
                    reports={reports}
                    refreshingId={refreshingId}
                    onRefreshProtocol={handleRefreshProtocol}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
