import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import {
  RefreshCw, Trash2, Loader2,
  Zap, MoreVertical, FileText, Plus,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineChart, InlineTable } from "@/components/research-artifacts";
import type { Artifact } from "@/lib/research-utils";
import { ArtifactActions, ProvenanceLine } from "@/components/artifact-actions";

interface SavedChart {
  id: string;
  title: string;
  chartType: string;
  dataSource: string;
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

const PROTOCOL_ALIASES: Record<string, string> = {
  hype: "Hyperliquid",
  hyperliquid: "Hyperliquid",
  "hip-3": "Hyperliquid",
  "hip3": "Hyperliquid",
  hlp: "Hyperliquid",
  ena: "Ethena",
  ethena: "Ethena",
  susde: "Ethena",
  usde: "Ethena",
  pump: "Pump.fun",
  "pump.fun": "Pump.fun",
  pumpfun: "Pump.fun",
  aave: "Aave",
  uniswap: "Uniswap",
  uni: "Uniswap",
  lido: "Lido",
  steth: "Lido",
  maker: "MakerDAO",
  mkr: "MakerDAO",
  dai: "MakerDAO",
  sky: "MakerDAO",
  jito: "Jito",
  jupiter: "Jupiter",
  jup: "Jupiter",
  raydium: "Raydium",
  ray: "Raydium",
  gmx: "GMX",
  dydx: "dYdX",
  pendle: "Pendle",
  eigen: "EigenLayer",
  eigenlayer: "EigenLayer",
  morpho: "Morpho",
  curve: "Curve",
  crv: "Curve",
  convex: "Convex",
  cvx: "Convex",
  compound: "Compound",
  comp: "Compound",
  synthetix: "Synthetix",
  snx: "Synthetix",
};

function resolveProtocol(title: string, dsConfig: any): string {
  const recipe = dsConfig?.refreshRecipe;
  if (recipe?.protocol) {
    const p = recipe.protocol.toLowerCase().trim();
    if (PROTOCOL_ALIASES[p]) return PROTOCOL_ALIASES[p];
    return recipe.protocol;
  }

  if (dsConfig?.slug) {
    const s = dsConfig.slug.toLowerCase().trim();
    if (PROTOCOL_ALIASES[s]) return PROTOCOL_ALIASES[s];
  }

  const lower = title.toLowerCase();

  for (const [alias, canonical] of Object.entries(PROTOCOL_ALIASES)) {
    const pattern = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, "i");
    if (pattern.test(lower)) return canonical;
  }

  const tokens = title.split(/[\s\-:,()]+/).filter(t => t.length > 0);
  const stopWords = new Set([
    "daily", "weekly", "monthly", "total", "value", "locked", "ratio",
    "volume", "revenue", "fees", "tvl", "p/e", "apy", "apr", "price",
    "market", "cap", "fdv", "trading", "dex", "basis", "yield", "paid",
    "financial", "statement", "fee", "summary", "growth", "adjusted",
    "ratios", "adj", "ma", "30d", "7d", "90d", "breakdown", "p&l",
    "across", "and", "key", "metrics", "for", "the", "of", "in", "on",
  ]);

  for (const t of tokens) {
    if (t.length > 1 && !stopWords.has(t.toLowerCase()) && /^[A-Z]/.test(t)) {
      const tl = t.toLowerCase();
      if (PROTOCOL_ALIASES[tl]) return PROTOCOL_ALIASES[tl];
      return t;
    }
  }

  return "Other";
}

interface ParsedChart extends SavedChart {
  parsedData: any[];
  parsedConfig: any;
  dsConfig: any;
  hasRecipe: boolean;
  protocol: string;
  artifact: Artifact;
  isTable: boolean;
}

function parseChart(chart: SavedChart): ParsedChart {
  let parsedData: any[] = [];
  let parsedConfig: any = {};
  let dsConfig: any = {};
  try { parsedData = JSON.parse(chart.data || "[]"); } catch {}
  try { parsedConfig = JSON.parse(chart.chartConfig || "{}"); } catch {}
  try { dsConfig = JSON.parse(chart.dataSourceConfig || "{}"); } catch {}

  const recipe = dsConfig.refreshRecipe;
  const canRefresh = !!recipe
    || (chart.dataSource === "dune" && !!dsConfig.queryId)
    || (chart.dataSource === "defillama" && !!dsConfig.endpoint)
    || chart.dataSource === "stonks";
  const protocol = resolveProtocol(chart.title, dsConfig);
  const isTable = chart.chartType === "table" || (!parsedConfig?.yAxes?.length && parsedConfig?.columns);

  const artifact: Artifact = isTable ? {
    type: "table",
    title: chart.title,
    subtitle: chart.description || undefined,
    source: recipe?.dataSource || dsConfig?.source || undefined,
    data: parsedData,
    columns: parsedConfig?.columns || (parsedData[0] ? Object.keys(parsedData[0]) : []),
  } : {
    type: "chart",
    title: chart.title,
    subtitle: chart.description || undefined,
    source: recipe?.dataSource || dsConfig?.source || undefined,
    data: parsedData,
    chartConfig: parsedConfig,
    refreshRecipe: recipe,
  };

  return {
    ...chart,
    parsedData,
    parsedConfig,
    dsConfig,
    hasRecipe: canRefresh,
    protocol,
    artifact,
    isTable,
  };
}

function StationCard({ pc, onRefresh, onDelete, onAddToReport, reports, refreshingId }: {
  pc: ParsedChart;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToReport: (chartId: string, reportId: string) => void;
  reports: Report[];
  refreshingId: string | null;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const isRefreshing = refreshingId === pc.id;

  return (
    <div className="relative group" data-testid={`chart-card-${pc.id}`}>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5">
        {pc.hasRecipe && (
          <button
            onClick={() => onRefresh(pc.id)}
            disabled={isRefreshing}
            className="p-1.5 rounded-md bg-card/80 backdrop-blur-sm border border-border/20 text-muted-foreground/40 hover:text-cyan-400 hover:border-cyan-500/30 transition-all"
            title="Refresh live data"
            data-testid={`button-refresh-chart-${pc.id}`}
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        )}
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 rounded-md bg-card/80 backdrop-blur-sm border border-border/20 text-muted-foreground/50 hover:text-foreground/70 transition-all"
            data-testid={`button-chart-menu-${pc.id}`}
          >
            <MoreVertical className="h-3 w-3" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-8 z-50 bg-card border border-border/30 rounded-md shadow-xl py-1 min-w-[140px]" onMouseLeave={() => setShowMenu(false)}>
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

      {pc.isTable ? (
        <InlineTable artifact={pc.artifact} compact />
      ) : (
        <InlineChart artifact={pc.artifact} hideSave compact />
      )}

      <div className="px-2 pb-2 -mt-1 flex items-center justify-between gap-2">
        <ProvenanceLine
          source={pc.artifact?.source || (pc.hasRecipe ? "live" : undefined)}
          lastRefresh={pc.updatedAt || pc.createdAt}
        />
        <ArtifactActions chartId={pc.id} chartTitle={pc.title} size="xs" />
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
  const latestUpdate = charts.reduce((latest, c) => {
    const d = new Date(c.updatedAt || c.createdAt);
    return d > latest ? d : latest;
  }, new Date(0));

  return (
    <div className="mb-6" data-testid={`protocol-dashboard-${protocol}`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground/90">{protocol}</h3>
          <span className="text-[10px] text-muted-foreground/35">
            {charts.length} chart{charts.length !== 1 ? "s" : ""} · updated {formatDistanceToNow(latestUpdate, { addSuffix: true })}
          </span>
        </div>
        {refreshableCount > 0 && (
          <button
            onClick={() => onRefreshProtocol(protocol)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] text-cyan-400/70 hover:text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/15 hover:border-cyan-500/30 transition-all"
            data-testid={`button-refresh-protocol-${protocol}`}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh All ({refreshableCount})
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {charts.map(pc => (
          <StationCard
            key={pc.id}
            pc={pc}
            onRefresh={onRefresh}
            onDelete={onDelete}
            onAddToReport={onAddToReport}
            reports={reports}
            refreshingId={refreshingId}
          />
        ))}
      </div>
    </div>
  );
}

export default function DataStation({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<"protocols" | "report">("protocols");
  const [activeProtocol, setActiveProtocol] = useState<string | null>(null);
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
      if (a[1].length !== b[1].length) return b[1].length - a[1].length;
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
    <div className="flex flex-col h-full min-h-0" data-testid="data-station-page">
      <div className="border-b border-border/15 bg-card/5 px-4 py-2 flex items-center gap-3 shrink-0">
        {!embedded && (
          <div className="flex items-center gap-2">
            <Radio className="h-3.5 w-3.5 text-cyan-400/70" />
            <span className="text-[11px] font-semibold text-foreground/85">Data & Viz Hub</span>
          </div>
        )}

        <div className="flex items-center gap-1 overflow-x-auto">
          {protocolGroups.map(([protocol, pCharts]) => (
            <button
              key={protocol}
              onClick={() => {
                setActiveView("protocols");
                setActiveProtocol(protocol);
                setActiveReport(null);
              }}
              className={`px-2 py-1 rounded text-[10px] whitespace-nowrap transition-colors ${
                activeView === "protocols" && activeProtocol === protocol ? "bg-muted/25 text-foreground/90" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"
              }`}
              data-testid={`button-protocol-nav-${protocol}`}
            >
              {protocol} <span className="text-[8px] text-muted-foreground/30">{pCharts.length}</span>
            </button>
          ))}
          {reports.map(r => (
            <button
              key={r.id}
              onClick={() => { setActiveReport(r.id); setActiveView("report"); }}
              className={`px-2 py-1 rounded text-[10px] whitespace-nowrap flex items-center gap-1 transition-colors ${
                activeReport === r.id ? "bg-muted/25 text-foreground/90" : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/10"
              }`}
              data-testid={`button-report-${r.id}`}
            >
              <FileText className="h-2.5 w-2.5" /> {r.title}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          {showNewReport ? (
            <input
              value={newReportTitle}
              onChange={e => setNewReportTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateReport(); if (e.key === "Escape") { setShowNewReport(false); setNewReportTitle(""); } }}
              placeholder="Report name..."
              className="bg-muted/15 border border-border/20 rounded px-2 py-1 text-[10px] text-foreground/80 placeholder:text-muted-foreground/25 outline-none focus:border-cyan-500/30 w-32"
              autoFocus
              data-testid="input-new-report-title"
            />
          ) : (
            <button onClick={() => setShowNewReport(true)} className="p-1 text-muted-foreground/30 hover:text-foreground/50" title="New Report" data-testid="button-new-report">
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          {totalRefreshable > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefreshAll}
              className="h-6 text-[9px] gap-1 border-cyan-500/15 text-cyan-400/70 hover:bg-cyan-500/10 hover:text-cyan-400 px-2"
              data-testid="button-refresh-all"
            >
              <Zap className="h-3 w-3" />
              Refresh All ({totalRefreshable})
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
          {chartsQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
            </div>
          ) : activeView === "report" && activeReport ? (
            <div className="px-4 py-3">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-foreground/90">{reports.find(r => r.id === activeReport)?.title}</h2>
                <p className="text-[10px] text-muted-foreground/40 mt-0.5">{reportParsed.length} charts</p>
              </div>
              {reportParsed.length === 0 ? (
                <div className="text-center py-16">
                  <FileText className="h-6 w-6 text-muted-foreground/15 mx-auto mb-2" />
                  <p className="text-[10px] text-muted-foreground/30">No charts in this report yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  {reportParsed.map(pc => (
                    <StationCard key={pc.id} pc={pc} onRefresh={handleRefresh} onDelete={handleDelete} onAddToReport={handleAddToReport} reports={reports} refreshingId={refreshingId} />
                  ))}
                </div>
              )}
            </div>
          ) : parsed.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8" data-testid="empty-station">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border border-border/15 flex items-center justify-center mb-4">
                <Radio className="h-5 w-5 text-cyan-400/40" />
              </div>
              <h2 className="text-sm font-semibold text-foreground/70 mb-1.5">Your Data and Visualization Hub</h2>
              <p className="text-[11px] text-muted-foreground/40 max-w-sm leading-relaxed">
                Charts you save from Sessions appear here, automatically organized by protocol. 
                Each chart with a data recipe can be refreshed with one click to pull the latest live data — no AI cost.
              </p>
            </div>
          ) : (
            <div className="px-4 py-3">
              {activeProtocol ? (
                (() => {
                  const group = protocolGroups.find(([p]) => p === activeProtocol);
                  if (!group) return null;
                  const [protocol, pCharts] = group;
                  return (
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
                  );
                })()
              ) : protocolGroups[0] ? (
                <ProtocolDashboard
                  protocol={protocolGroups[0][0]}
                  charts={protocolGroups[0][1]}
                  onRefresh={handleRefresh}
                  onDelete={handleDelete}
                  onAddToReport={handleAddToReport}
                  reports={reports}
                  refreshingId={refreshingId}
                  onRefreshProtocol={handleRefreshProtocol}
                />
              ) : null}
            </div>
          )}
      </div>
    </div>
  );
}
