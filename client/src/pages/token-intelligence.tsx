import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Coins,
  Plus,
  Trash2,
  BarChart3,
  RefreshCw,
  Brain,
  ChevronRight,
  AlertTriangle,
  Link2,
  Database,
  LineChart,
  Table2,
  TrendingUp,
  TrendingDown,
  Activity,
  Users,
  DollarSign,
} from "lucide-react";
import type { TokenProfile, DuneQuery, TokenAnalysis } from "@shared/schema";
import {
  BarChart, Bar, LineChart as ReLineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

const CHAINS = [
  { value: "ethereum", label: "Ethereum" },
  { value: "base", label: "Base" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "optimism", label: "Optimism" },
  { value: "polygon", label: "Polygon" },
  { value: "solana", label: "Solana" },
  { value: "avalanche", label: "Avalanche" },
  { value: "bsc", label: "BSC" },
];

const VIZ_TYPES = [
  { value: "table", label: "Table", icon: Table2 },
  { value: "bar", label: "Bar Chart", icon: BarChart3 },
  { value: "line", label: "Line Chart", icon: LineChart },
  { value: "area", label: "Area Chart", icon: BarChart3 },
];

function Section({ title, icon: Icon, children, action }: { title: string; icon?: any; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="w-3 h-3 text-muted-foreground" />}
          <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function TokenProfileManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("ethereum");
  const [ticker, setTicker] = useState("");

  const { data: profile, isLoading } = useQuery<TokenProfile | null>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/companies/${companyId}/token-profile`, {
        contractAddress: address,
        chain,
        tokenTicker: ticker || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-profile"] });
      setEditing(false);
      toast({ title: "Token profile saved" });
    },
    onError: (err: any) => toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/companies/${companyId}/token-profile`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-profile"] });
      setAddress("");
      setChain("ethereum");
      setTicker("");
      toast({ title: "Token profile removed" });
    },
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  if (profile && !editing) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">{profile.tokenTicker || "Token"}</span>
            <span className="text-[10px] font-mono text-muted-foreground bg-accent rounded px-1.5 py-0.5">
              {CHAINS.find(c => c.value === profile.chain)?.label || profile.chain}
            </span>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => { setAddress(profile.contractAddress); setChain(profile.chain); setTicker(profile.tokenTicker || ""); setEditing(true); }} data-testid="button-edit-token">
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={() => deleteMutation.mutate()} data-testid="button-remove-token">
              Remove
            </Button>
          </div>
        </div>
        <p className="text-[11px] font-mono text-muted-foreground break-all" data-testid="text-contract-address">
          {profile.contractAddress}
        </p>
      </div>
    );
  }

  if (!profile && !editing) {
    return (
      <div className="text-center py-4">
        <Coins className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground mb-3">No token profile attached</p>
        <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditing(true)} data-testid="button-attach-token">
          <Link2 className="w-3 h-3 mr-1.5" />
          Attach Token
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1 block">Contract Address</label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x..." className="h-8 text-xs font-mono" data-testid="input-contract-address" />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1 block">Chain</label>
          <Select value={chain} onValueChange={setChain}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-chain">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAINS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1 block">Ticker</label>
          <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="e.g. ETH" className="h-8 text-xs font-mono" data-testid="input-ticker" />
        </div>
      </div>
      <div className="flex gap-1.5 justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(false)} data-testid="button-cancel-token">Cancel</Button>
        <Button size="sm" className="h-7 text-xs" onClick={() => saveMutation.mutate()} disabled={!address.trim() || saveMutation.isPending} data-testid="button-save-token">
          {saveMutation.isPending ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}

function DuneQueryManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [queryId, setQueryId] = useState("");
  const [label, setLabel] = useState("");
  const [vizType, setVizType] = useState("table");

  const { data: queries = [], isLoading } = useQuery<DuneQuery[]>({
    queryKey: ["/api/companies", companyId, "dune-queries"],
  });

  const { data: duneStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/dune/status"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/companies/${companyId}/dune-queries`, {
        queryId: parseInt(queryId),
        label,
        visualizationType: vizType,
        displayOrder: queries.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "dune-queries"] });
      setQueryId("");
      setLabel("");
      setVizType("table");
      setAdding(false);
      toast({ title: "Query added" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/dune-queries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "dune-queries"] });
      toast({ title: "Query removed" });
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  if (!duneStatus?.configured) {
    return (
      <div className="text-center py-4">
        <AlertTriangle className="w-5 h-5 text-amber-500/50 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Dune API key not configured</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">Set DUNE_API_KEY in environment secrets</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {queries.map((q) => (
        <div key={q.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-accent/20" data-testid={`dune-query-${q.id}`}>
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-3 h-3 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">{q.label}</p>
              <p className="text-[10px] text-muted-foreground font-mono">#{q.queryId} · {q.visualizationType}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-30 hover:opacity-100 text-destructive" onClick={() => removeMutation.mutate(q.id)} data-testid={`button-remove-query-${q.id}`}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2 pt-2 border-t border-border/30">
          <Input value={queryId} onChange={(e) => setQueryId(e.target.value)} placeholder="Dune Query ID (e.g. 3456789)" className="h-8 text-xs font-mono" data-testid="input-dune-query-id" />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Daily Active Users)" className="h-8 text-xs" data-testid="input-dune-label" />
          <Select value={vizType} onValueChange={setVizType}>
            <SelectTrigger className="h-8 text-xs" data-testid="select-viz-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIZ_TYPES.map((v) => (
                <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5 justify-end">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => addMutation.mutate()} disabled={!queryId.trim() || !label.trim() || addMutation.isPending} data-testid="button-save-dune-query">
              {addMutation.isPending ? "Adding..." : "Add"}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full text-xs h-7" onClick={() => setAdding(true)} data-testid="button-add-dune-query">
          <Plus className="w-3 h-3 mr-1.5" />
          Add Dune Query
        </Button>
      )}
    </div>
  );
}

interface DuneResultData {
  columns: string[];
  rows: Record<string, any>[];
  metadata: { queryId: number; state: string; rowCount: number };
}

function DuneQueryResultCard({ query }: { query: DuneQuery }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();

  const [data, setData] = useState<DuneResultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const endpoint = refresh
        ? `/api/dune-queries/${query.id}/refresh`
        : `/api/dune-queries/${query.id}/execute`;
      const res = await fetch(endpoint, { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      const result = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
      toast({ title: "Query failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading && !error) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Database className="w-3 h-3 text-muted-foreground" />
            <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{query.label}</h4>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/40">#{query.queryId}</span>
        </div>
        <div className="p-4 text-center">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => fetchData()} data-testid={`button-load-query-${query.queryId}`}>
            <BarChart3 className="w-3 h-3 mr-1.5" />
            Load Data (~$0.05)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Database className="w-3 h-3 text-muted-foreground" />
          <h4 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{query.label}</h4>
        </div>
        <div className="flex items-center gap-1.5">
          {data && <span className="text-[10px] font-mono text-muted-foreground/40">{data.metadata.rowCount} rows</span>}
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => fetchData(true)} disabled={loading} data-testid={`button-refresh-query-${query.queryId}`}>
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-xs text-muted-foreground">Fetching data...</span>
          </div>
        )}
        {error && (
          <div className="text-center py-4">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="text-xs mt-2" onClick={() => fetchData()}>Retry</Button>
          </div>
        )}
        {data && !loading && <DuneResultVisualization data={data} vizType={query.visualizationType} />}
      </div>
    </div>
  );
}

function DuneResultVisualization({ data, vizType }: { data: DuneResultData; vizType: string }) {
  if (data.rows.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No data returned</p>;
  }

  const numericCols = data.columns.filter((col) => {
    const val = data.rows[0]?.[col];
    return typeof val === "number";
  });

  const nonNumericCols = data.columns.filter((col) => !numericCols.includes(col));
  const xKey = nonNumericCols[0] || data.columns[0];
  const yKeys = numericCols.length > 0 ? numericCols.slice(0, 3) : [data.columns[1] || data.columns[0]];

  const chartColors = ["#22c55e", "#3b82f6", "#f59e0b"];

  const chartData = data.rows.slice(0, 100).map((row) => {
    const entry: Record<string, any> = {};
    entry[xKey] = String(row[xKey] || "").slice(0, 20);
    for (const key of yKeys) {
      entry[key] = typeof row[key] === "number" ? row[key] : parseFloat(row[key]) || 0;
    }
    return entry;
  });

  if (vizType === "bar" && numericCols.length > 0) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontSize: 11 }} />
          {yKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={chartColors[i]} radius={[2, 2, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (vizType === "line" && numericCols.length > 0) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <ReLineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontSize: 11 }} />
          {yKeys.map((key, i) => (
            <Line key={key} type="monotone" dataKey={key} stroke={chartColors[i]} strokeWidth={2} dot={false} />
          ))}
        </ReLineChart>
      </ResponsiveContainer>
    );
  }

  if (vizType === "area" && numericCols.length > 0) {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 4, fontSize: 11 }} />
          {yKeys.map((key, i) => (
            <Area key={key} type="monotone" dataKey={key} stroke={chartColors[i]} fill={chartColors[i]} fillOpacity={0.15} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            {data.columns.slice(0, 8).map((col) => (
              <th key={col} className="text-left py-1.5 px-2 text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.slice(0, 25).map((row, i) => (
            <tr key={i} className="border-b border-border/20">
              {data.columns.slice(0, 8).map((col) => (
                <td key={col} className="py-1.5 px-2 font-mono text-[11px] text-foreground/80 max-w-[200px] truncate">
                  {typeof row[col] === "number" ? row[col].toLocaleString() : String(row[col] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length > 25 && (
        <p className="text-[10px] text-muted-foreground text-center mt-2">Showing 25 of {data.metadata.rowCount} rows</p>
      )}
    </div>
  );
}

function TokenAnalysisSection({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();

  const { data: analyses = [] } = useQuery<TokenAnalysis[]>({
    queryKey: ["/api/companies", companyId, "token-analyses"],
    refetchInterval: (query) => {
      const data = query.state.data as TokenAnalysis[] | undefined;
      if (data?.some((a) => a.status === "generating")) return 5000;
      return false;
    },
  });

  const { data: tokenProfile } = useQuery<TokenProfile | null>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const res = await fetch(`/api/companies/${companyId}/token-analyses/generate`, { method: "POST", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-analyses"] });
      toast({ title: "Token analysis started", description: "The AI is analyzing on-chain data. This may take a minute." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div>
      {analyses.length > 0 && (
        <div className="space-y-2 mb-3">
          {analyses.map((analysis) => (
            <div key={analysis.id} className="rounded-md border border-border/50 overflow-hidden" data-testid={`token-analysis-${analysis.id}`}>
              <button
                className="flex items-center justify-between w-full px-3 py-2.5 hover:bg-accent/20 transition-colors"
                onClick={() => setExpandedId(expandedId === analysis.id ? null : analysis.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Brain className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-medium truncate">Token Intelligence Report</p>
                    <p className="text-[10px] text-muted-foreground">
                      {analysis.status === "generating" ? "Generating..." : analysis.status === "failed" ? "Failed" : format(new Date(analysis.createdAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                </div>
                {analysis.status === "generating" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className={`w-3 h-3 text-muted-foreground/30 transition-transform shrink-0 ${expandedId === analysis.id ? "rotate-90" : ""}`} />
                )}
              </button>
              {expandedId === analysis.id && analysis.content && (
                <div className="px-3 pb-3 border-t border-border/30">
                  <div className="prose prose-sm prose-invert max-w-none mt-3 text-xs leading-relaxed [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:mb-2 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h3]:text-xs [&_h3]:font-medium [&_h3]:mb-1 [&_ul]:space-y-0.5 [&_li]:text-xs [&_p]:text-xs [&_p]:mb-1.5 [&_strong]:text-foreground" data-testid={`token-analysis-content-${analysis.id}`}>
                    <MarkdownContent content={analysis.content} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        className="w-full gap-2 text-xs h-8"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending || !tokenProfile}
        data-testid="button-generate-token-analysis"
      >
        {generateMutation.isPending ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Starting analysis...</>
        ) : !tokenProfile ? (
          <><Brain className="w-3 h-3" /> Attach a token first</>
        ) : (
          <><Brain className="w-3 h-3" /> Generate AI Token Analysis (~$0.23)</>
        )}
      </Button>
    </div>
  );
}

interface TokenSnapshotData {
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  holderCount: number | null;
  priceChange24h: number | null;
  fetchedAt: string;
  source: string;
}

function formatLargeNumber(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function TokenSnapshotCard({ companyId }: { companyId: string }) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<TokenSnapshotData | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: tokenProfile } = useQuery<TokenProfile>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });

  const fetchSnapshot = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-Privy-Token"] = token;
      }
      const res = await fetch(`/api/companies/${companyId}/token-snapshot`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Failed" }));
        throw new Error(err.message);
      }
      const data = await res.json();
      setSnapshot(data);
    } catch (err: any) {
      toast({ title: "Snapshot failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (!tokenProfile) {
    return (
      <div className="text-xs text-muted-foreground/60 py-4 text-center" data-testid="snapshot-no-profile">
        Attach a token profile to fetch live market data.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="token-snapshot-section">
      {snapshot && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="snapshot-metrics">
          <div className="border border-border/30 p-3 bg-background/30">
            <div className="flex items-center gap-1.5 text-muted-foreground/60 text-[10px] uppercase tracking-wider mb-1">
              <DollarSign className="w-3 h-3" /> Price
            </div>
            <div className="text-sm font-mono font-medium" data-testid="snapshot-price">
              {snapshot.price !== null ? `$${snapshot.price < 0.01 ? snapshot.price.toFixed(6) : snapshot.price.toFixed(2)}` : "—"}
            </div>
            {snapshot.priceChange24h !== null && (
              <div className={`flex items-center gap-0.5 text-[10px] mt-0.5 ${snapshot.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="snapshot-price-change">
                {snapshot.priceChange24h >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {snapshot.priceChange24h > 0 ? "+" : ""}{snapshot.priceChange24h.toFixed(2)}%
              </div>
            )}
          </div>

          <div className="border border-border/30 p-3 bg-background/30">
            <div className="flex items-center gap-1.5 text-muted-foreground/60 text-[10px] uppercase tracking-wider mb-1">
              <BarChart3 className="w-3 h-3" /> Market Cap
            </div>
            <div className="text-sm font-mono font-medium" data-testid="snapshot-mcap">
              {formatLargeNumber(snapshot.marketCap)}
            </div>
          </div>

          <div className="border border-border/30 p-3 bg-background/30">
            <div className="flex items-center gap-1.5 text-muted-foreground/60 text-[10px] uppercase tracking-wider mb-1">
              <Activity className="w-3 h-3" /> 24h Volume
            </div>
            <div className="text-sm font-mono font-medium" data-testid="snapshot-volume">
              {formatLargeNumber(snapshot.volume24h)}
            </div>
          </div>

          <div className="border border-border/30 p-3 bg-background/30">
            <div className="flex items-center gap-1.5 text-muted-foreground/60 text-[10px] uppercase tracking-wider mb-1">
              <Users className="w-3 h-3" /> Holders
            </div>
            <div className="text-sm font-mono font-medium" data-testid="snapshot-holders">
              {snapshot.holderCount !== null ? snapshot.holderCount.toLocaleString() : "—"}
            </div>
          </div>
        </div>
      )}

      {snapshot && (
        <div className="text-[10px] text-muted-foreground/40 flex items-center justify-between">
          <span>Source: {snapshot.source} | Fetched: {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
        </div>
      )}

      <Button
        onClick={fetchSnapshot}
        disabled={loading}
        variant="outline"
        size="sm"
        className="text-xs h-7 w-full"
        data-testid="button-fetch-snapshot"
      >
        {loading ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Fetching snapshot...</>
        ) : snapshot ? (
          <><RefreshCw className="w-3 h-3" /> Refresh Snapshot (~$0.15)</>
        ) : (
          <><Activity className="w-3 h-3" /> Fetch Token Snapshot (~$0.15)</>
        )}
      </Button>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc pl-4 space-y-0.5">
          {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      );
      listItems = [];
    }
  };

  const renderInline = (text: string) => {
    const parts: (string | JSX.Element)[] = [];
    let remaining = text;
    let idx = 0;
    const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(remaining.slice(lastIndex, match.index));
      }
      if (match[1]) {
        parts.push(<strong key={idx++}>{match[1]}</strong>);
      } else if (match[2]) {
        parts.push(<em key={idx++}>{match[2]}</em>);
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < remaining.length) {
      parts.push(remaining.slice(lastIndex));
    }
    return <>{parts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^[-*] (.+)$/);

    if (listMatch) {
      listItems.push(listMatch[1]);
      continue;
    }

    flushList();

    if (line.match(/^### (.+)$/)) {
      elements.push(<h3 key={`h3-${i}`}>{line.replace(/^### /, '')}</h3>);
    } else if (line.match(/^## (.+)$/)) {
      elements.push(<h2 key={`h2-${i}`}>{line.replace(/^## /, '')}</h2>);
    } else if (line.match(/^# (.+)$/)) {
      elements.push(<h1 key={`h1-${i}`}>{line.replace(/^# /, '')}</h1>);
    } else if (line.trim() === '') {
      continue;
    } else {
      elements.push(<p key={`p-${i}`}>{renderInline(line)}</p>);
    }
  }
  flushList();

  return <div>{elements}</div>;
}

export default function TokenIntelligenceTab({ companyId, companyName, hasLiquidToken }: { companyId: string; companyName: string; hasLiquidToken?: boolean }) {
  const { getAccessToken } = useAuth();

  useEffect(() => {
    if (hasLiquidToken) {
      (async () => {
        try {
          const token = await getAccessToken();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
            headers["X-Privy-Token"] = token;
          }
          const res = await fetch(`/api/companies/${companyId}/ensure-token-profile`, { method: "POST", headers });
          if (res.ok) {
            queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-profile"] });
          }
        } catch {}
      })();
    }
  }, [companyId, hasLiquidToken]);

  const { data: queries = [] } = useQuery<DuneQuery[]>({
    queryKey: ["/api/companies", companyId, "dune-queries"],
  });

  return (
    <div className="space-y-4">
      <Section title="Token Profile" icon={Coins}>
        <TokenProfileManager companyId={companyId} />
      </Section>

      <Section title="Token Snapshot" icon={Activity}>
        <TokenSnapshotCard companyId={companyId} />
      </Section>

      <Section title="Dune Queries" icon={Database}>
        <DuneQueryManager companyId={companyId} />
      </Section>

      {queries.length > 0 && (
        <div className="space-y-4">
          {queries.map((q) => (
            <DuneQueryResultCard key={q.id} query={q} />
          ))}
        </div>
      )}

      <Section title="AI Token Analysis" icon={Brain}>
        <TokenAnalysisSection companyId={companyId} companyName={companyName} />
      </Section>
    </div>
  );
}
