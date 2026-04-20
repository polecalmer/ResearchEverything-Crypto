import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  RefreshCw, Plus, Trash2, FolderPlus, BarChart3, Loader2,
  Clock, Zap, ChevronDown, MoreVertical, FileText,
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

function MiniChart({ chart, parsedData, parsedConfig }: { chart: SavedChart; parsedData: any[]; parsedConfig: any }) {
  if (!parsedData.length || !parsedConfig?.yAxes?.length) return null;
  const chartType = parsedConfig.chartType || chart.chartType || "line";
  const yAxes = parsedConfig.yAxes || [];

  return (
    <ResponsiveContainer width="100%" height={160}>
      {chartType === "bar" ? (
        <BarChart data={parsedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} width={45} tickFormatter={(v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
          {yAxes.map((y: any, i: number) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} opacity={0.8} />
          ))}
        </BarChart>
      ) : chartType === "area" ? (
        <AreaChart data={parsedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} width={45} tickFormatter={(v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
          {yAxes.map((y: any, i: number) => (
            <Area key={y.dataKey} dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.15} />
          ))}
        </AreaChart>
      ) : (
        <LineChart data={parsedData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="date" tick={false} axisLine={false} />
          <YAxis tick={{ fontSize: 9, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} width={45} tickFormatter={(v: number) => v >= 1e9 ? `${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : String(v)} />
          <Tooltip contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }} />
          {yAxes.map((y: any, i: number) => (
            <Line key={y.dataKey} dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

function ChartCard({ chart, reports, onRefresh, onDelete, onAddToReport }: {
  chart: SavedChart;
  reports: Report[];
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToReport: (chartId: string, reportId: string) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [showReportMenu, setShowReportMenu] = useState(false);

  let parsedData: any[] = [];
  let parsedConfig: any = {};
  let hasRecipe = false;
  try { parsedData = JSON.parse(chart.data || "[]"); } catch {}
  try { parsedConfig = JSON.parse(chart.chartConfig || "{}"); } catch {}
  try { const ds = JSON.parse(chart.dataSourceConfig || "{}"); hasRecipe = !!ds.refreshRecipe; } catch {}

  const latestValue = parsedData.length > 0 ? (() => {
    const last = parsedData[parsedData.length - 1];
    const key = parsedConfig.yAxes?.[0]?.dataKey;
    if (!key || !last[key]) return null;
    const v = Number(last[key]);
    if (isNaN(v)) return null;
    return v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
  })() : null;

  const handleRefresh = async () => {
    setRefreshing(true);
    await onRefresh(chart.id);
    setRefreshing(false);
  };

  return (
    <div className="group bg-card/30 border border-border/20 rounded-lg overflow-hidden hover:border-border/40 transition-all" data-testid={`chart-card-${chart.id}`}>
      <div className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium text-foreground/90 truncate" data-testid={`text-chart-title-${chart.id}`}>{chart.title}</h3>
            {latestValue && (
              <p className="text-lg font-semibold text-foreground/95 mt-0.5" data-testid={`text-chart-value-${chart.id}`}>{latestValue}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasRecipe && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-1 text-muted-foreground/50 hover:text-cyan-400 transition-colors"
                title="Refresh with live data"
                data-testid={`button-refresh-chart-${chart.id}`}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setShowReportMenu(!showReportMenu)}
                className="p-1 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                data-testid={`button-chart-menu-${chart.id}`}
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
              {showReportMenu && (
                <div className="absolute right-0 top-6 z-50 bg-card border border-border/40 rounded-md shadow-lg py-1 min-w-[160px]" onMouseLeave={() => setShowReportMenu(false)}>
                  {reports.length > 0 && reports.map(r => (
                    <button
                      key={r.id}
                      className="w-full text-left px-3 py-1.5 text-[10px] text-foreground/70 hover:bg-muted/30 flex items-center gap-2"
                      onClick={() => { onAddToReport(chart.id, r.id); setShowReportMenu(false); }}
                      data-testid={`button-add-to-report-${r.id}`}
                    >
                      <FileText className="h-3 w-3" /> Add to {r.title}
                    </button>
                  ))}
                  <button
                    className="w-full text-left px-3 py-1.5 text-[10px] text-destructive/70 hover:bg-destructive/10 flex items-center gap-2 border-t border-border/20"
                    onClick={() => { onDelete(chart.id); setShowReportMenu(false); }}
                    data-testid={`button-delete-chart-${chart.id}`}
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-1">
        <MiniChart chart={chart} parsedData={parsedData} parsedConfig={parsedConfig} />
      </div>

      <div className="px-3 pb-2 flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground/40">
          {parsedData.length} pts · {chart.chartType}
        </span>
        <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {format(new Date(chart.updatedAt || chart.createdAt), "MMM d, HH:mm")}
        </span>
      </div>
    </div>
  );
}

export default function DataStation() {
  const { user, getAuthHeaders: getAuth } = useAuth();
  const { toast } = useToast();
  const [activeReport, setActiveReport] = useState<string | null>(null);
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
  const reportCharts = reportChartsQuery.data || [];
  const displayCharts = activeReport ? reportCharts : charts;

  const handleRefresh = async (chartId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/charts/${chartId}/refresh`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Refresh failed");
      }
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      if (activeReport) queryClient.invalidateQueries({ queryKey: ["/api/research/reports", activeReport, "charts"] });
      toast({ title: "Refreshed", description: `${result.dataPoints} data points updated in ${(result.refreshTimeMs / 1000).toFixed(1)}s` });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    }
  };

  const handleDelete = async (chartId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/research/charts/${chartId}`, { method: "DELETE", headers: authHeaders, credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      toast({ title: "Deleted" });
    } catch {}
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
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports", reportId, "charts"] });
      toast({ title: "Added to report" });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
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
      if (!res.ok) throw new Error("Failed");
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports"] });
      setNewReportTitle("");
      setShowNewReport(false);
      toast({ title: "Report created" });
    } catch {}
  };

  const handleDeleteReport = async (reportId: string) => {
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/research/reports/${reportId}`, { method: "DELETE", headers: authHeaders, credentials: "include" });
      if (activeReport === reportId) setActiveReport(null);
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports"] });
      toast({ title: "Report deleted" });
    } catch {}
  };

  const handleRefreshAll = async () => {
    const chartsToRefresh = displayCharts.filter(c => {
      try { return !!JSON.parse(c.dataSourceConfig || "{}").refreshRecipe; } catch { return false; }
    });
    if (chartsToRefresh.length === 0) {
      toast({ title: "No refreshable charts", description: "Save charts from Sessions with a data recipe to enable refresh." });
      return;
    }
    toast({ title: "Refreshing all", description: `Updating ${chartsToRefresh.length} charts...` });
    const results = await Promise.allSettled(chartsToRefresh.map(c => handleRefresh(c.id)));
    const succeeded = results.filter(r => r.status === "fulfilled").length;
    toast({ title: "Done", description: `${succeeded}/${chartsToRefresh.length} charts refreshed` });
  };

  const refreshableCount = displayCharts.filter(c => {
    try { return !!JSON.parse(c.dataSourceConfig || "{}").refreshRecipe; } catch { return false; }
  }).length;

  return (
    <div className="flex h-[calc(100vh-48px)]" data-testid="data-station-page">
      <div className="w-48 border-r border-border/20 flex flex-col bg-card/10 shrink-0">
        <div className="p-3 border-b border-border/20">
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">Data Station</h2>
        </div>

        <div className="flex-1 overflow-y-auto">
          <button
            onClick={() => setActiveReport(null)}
            className={`w-full text-left px-3 py-2 text-[10px] flex items-center gap-2 transition-colors ${
              !activeReport ? "bg-muted/30 text-foreground/90" : "text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/10"
            }`}
            data-testid="button-all-charts"
          >
            <BarChart3 className="h-3 w-3" /> All Charts ({charts.length})
          </button>

          <div className="px-3 pt-3 pb-1 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40">Reports</span>
            <button
              onClick={() => setShowNewReport(true)}
              className="p-0.5 text-muted-foreground/40 hover:text-foreground/60"
              data-testid="button-new-report"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {showNewReport && (
            <div className="px-3 pb-2">
              <input
                value={newReportTitle}
                onChange={e => setNewReportTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleCreateReport()}
                placeholder="Report name..."
                className="w-full bg-muted/20 border border-border/30 rounded px-2 py-1 text-[10px] text-foreground/80 placeholder:text-muted-foreground/30 outline-none focus:border-primary/40"
                autoFocus
                data-testid="input-new-report-title"
              />
            </div>
          )}

          {reports.map(r => (
            <div key={r.id} className="group flex items-center">
              <button
                onClick={() => setActiveReport(r.id)}
                className={`flex-1 text-left px-3 py-2 text-[10px] flex items-center gap-2 transition-colors min-w-0 ${
                  activeReport === r.id ? "bg-muted/30 text-foreground/90" : "text-muted-foreground/60 hover:text-foreground/70 hover:bg-muted/10"
                }`}
                data-testid={`button-report-${r.id}`}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{r.title}</span>
              </button>
              <button
                onClick={() => handleDeleteReport(r.id)}
                className="opacity-0 group-hover:opacity-100 p-1 mr-1 text-muted-foreground/40 hover:text-destructive transition-opacity"
                data-testid={`button-delete-report-${r.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-border/20 px-4 py-2.5 flex items-center justify-between bg-card/5">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium text-foreground/90" data-testid="text-station-title">
              {activeReport ? reports.find(r => r.id === activeReport)?.title || "Report" : "All Charts"}
            </h1>
            <span className="text-[10px] text-muted-foreground/40">
              {displayCharts.length} chart{displayCharts.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {refreshableCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefreshAll}
                className="h-7 text-[10px] gap-1.5 border-cyan-500/20 text-cyan-400/80 hover:bg-cyan-500/10"
                data-testid="button-refresh-all"
              >
                <Zap className="h-3 w-3" />
                Refresh All ({refreshableCount})
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {chartsQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
            </div>
          ) : displayCharts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="empty-station">
              <BarChart3 className="h-8 w-8 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground/50 mb-1">
                {activeReport ? "No charts in this report yet" : "No saved charts yet"}
              </p>
              <p className="text-[10px] text-muted-foreground/30 max-w-xs">
                {activeReport
                  ? "Add charts from the All Charts view using the menu on each card."
                  : "Generate charts in Sessions and click Save to build your data station. Each chart with a recipe can be refreshed with one click to pull live data."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {displayCharts.map(chart => (
                <ChartCard
                  key={chart.id}
                  chart={chart}
                  reports={reports}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                  onAddToReport={handleAddToReport}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
