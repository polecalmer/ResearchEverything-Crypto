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
import type { TokenProfile, DuneQuery, MasterDuneQuery, TokenAnalysis } from "@shared/schema";
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

function Section({ title, children, action }: { title: string; icon?: any; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-0">
      <div className="flex items-center gap-2 mb-3 select-none">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">{title}</span>
        <span className="flex-1 border-t border-border/15" />
        {action}
      </div>
      <div className="pl-1">{children}</div>
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

function MasterQueryBrowser({ companyId, existingQueryIds, onAttach, onClose }: {
  companyId: string;
  existingQueryIds: number[];
  onAttach: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { data: masterQueries = [], isLoading } = useQuery<MasterDuneQuery[]>({
    queryKey: ["/api/master-dune-queries"],
  });

  const attachMutation = useMutation({
    mutationFn: async (mq: MasterDuneQuery) => {
      await apiRequest("POST", `/api/companies/${companyId}/dune-queries`, {
        queryId: mq.queryId,
        label: mq.label,
        visualizationType: mq.visualizationType,
        displayOrder: existingQueryIds.length,
        masterQueryId: mq.id,
      });
    },
    onSuccess: () => {
      toast({ title: "Query attached" });
      onAttach();
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const available = masterQueries.filter(mq => !existingQueryIds.includes(mq.queryId));
  const categories = [...new Set(available.map(q => q.category).filter(Boolean))];

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="space-y-2 pt-2 border-t border-border/30">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Query Library</p>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClose}>Close</Button>
      </div>
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-3">No unattached queries in library</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-2 mb-1">{cat}</p>
              {available.filter(q => q.category === cat).map(mq => (
                <div key={mq.id} className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-accent/20 transition-colors" data-testid={`master-query-${mq.id}`}>
                  <div className="min-w-0">
                    <p className="text-xs truncate">{mq.label}</p>
                    <div className="flex gap-1 mt-0.5">
                      {(mq.protocolTags || []).slice(0, 3).map(t => (
                        <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">{t}</span>
                      ))}
                      <span className="text-[9px] text-muted-foreground/50 font-mono">#{mq.queryId}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs shrink-0"
                    onClick={() => attachMutation.mutate(mq)}
                    disabled={attachMutation.isPending}
                    data-testid={`button-attach-${mq.id}`}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          ))}
          {available.filter(q => !q.category).length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-2 mb-1">Uncategorized</p>
              {available.filter(q => !q.category).map(mq => (
                <div key={mq.id} className="flex items-center justify-between py-1 px-2 rounded-md hover:bg-accent/20 transition-colors" data-testid={`master-query-${mq.id}`}>
                  <div className="min-w-0">
                    <p className="text-xs truncate">{mq.label}</p>
                    <div className="flex gap-1 mt-0.5">
                      {(mq.protocolTags || []).slice(0, 3).map(t => (
                        <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">{t}</span>
                      ))}
                      <span className="text-[9px] text-muted-foreground/50 font-mono">#{mq.queryId}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs shrink-0"
                    onClick={() => attachMutation.mutate(mq)}
                    disabled={attachMutation.isPending}
                    data-testid={`button-attach-${mq.id}`}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DuneQueryManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
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

  const autoAttachMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/companies/${companyId}/auto-attach-dune-queries`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "dune-queries"] });
      if (data.attached > 0) {
        toast({ title: `${data.attached} queries attached from library` });
      } else {
        toast({ title: "No matching queries found in library" });
      }
    },
    onError: (err: any) => toast({ title: "Auto-attach failed", description: err.message, variant: "destructive" }),
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
      ) : browsing ? (
        <MasterQueryBrowser
          companyId={companyId}
          existingQueryIds={queries.map(q => q.queryId)}
          onAttach={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "dune-queries"] });
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      ) : (
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1 text-xs h-7" onClick={() => setAdding(true)} data-testid="button-add-dune-query">
            <Plus className="w-3 h-3 mr-1.5" />
            Manual Add
          </Button>
          <Button variant="outline" size="sm" className="flex-1 text-xs h-7" onClick={() => setBrowsing(true)} data-testid="button-browse-library">
            <Database className="w-3 h-3 mr-1.5" />
            From Library
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => autoAttachMutation.mutate()}
            disabled={autoAttachMutation.isPending}
            data-testid="button-auto-attach"
          >
            {autoAttachMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </div>
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
      <div className="mb-0">
        <div className="flex items-center gap-2 mb-3 select-none">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">{query.label}</span>
          <span className="text-[10px] font-mono text-muted-foreground/30">#{query.queryId}</span>
          <span className="flex-1 border-t border-border/15" />
        </div>
        <div className="pl-1 text-center">
          <Button variant="outline" size="sm" className="text-xs" onClick={() => fetchData()} data-testid={`button-load-query-${query.queryId}`}>
            <BarChart3 className="w-3 h-3 mr-1.5" />
            Load Data (~$0.05)
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-0">
      <div className="flex items-center gap-2 mb-3 select-none">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">{query.label}</span>
        {data && <span className="text-[10px] font-mono text-muted-foreground/30">{data.metadata.rowCount} rows</span>}
        <span className="flex-1 border-t border-border/15" />
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => fetchData(true)} disabled={loading} data-testid={`button-refresh-query-${query.queryId}`}>
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="pl-1">
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

  const deleteMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      await apiRequest("DELETE", `/api/token-analyses/${analysisId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-analyses"] });
      toast({ title: "Report deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  return (
    <div>
      {analyses.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {analyses.map((analysis) => (
            <div key={analysis.id} className="flex items-center justify-between py-1.5" data-testid={`token-analysis-${analysis.id}`}>
              <div className="flex items-center gap-2 min-w-0">
                {analysis.status === "generating" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
                ) : analysis.status === "failed" ? (
                  <AlertTriangle className="w-3 h-3 text-destructive/50 shrink-0" />
                ) : (
                  <Brain className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                )}
                <span className="text-xs text-foreground/60">
                  {analysis.status === "generating" ? "Generating..." : analysis.status === "failed" ? "Failed" : format(new Date(analysis.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>
              {analysis.status !== "generating" && (
                <button
                  onClick={() => deleteMutation.mutate(analysis.id)}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/20 hover:text-destructive transition-colors"
                  data-testid={`button-delete-analysis-${analysis.id}`}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/30 mb-2">Reports appear in the Research Report tab</p>
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
          <><Brain className="w-3 h-3" /> Generate Research Report (~$0.23)</>
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
  const [autoFetched, setAutoFetched] = useState(false);

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

  useEffect(() => {
    if (tokenProfile && !autoFetched && !snapshot) {
      setAutoFetched(true);
      fetchSnapshot();
    }
  }, [tokenProfile, autoFetched, snapshot]);

  if (!tokenProfile) {
    return (
      <div className="text-xs text-muted-foreground/60 py-4 text-center" data-testid="snapshot-no-profile">
        Attach a token profile to fetch live market data.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="token-snapshot-section">
      {loading && !snapshot && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading market data...
        </div>
      )}

      {snapshot && (
        <div data-testid="snapshot-metrics">
          <table className="w-full text-xs border-collapse">
            <tbody>
              <tr className="border-b border-border/15">
                <td className="py-1.5 pr-4 text-muted-foreground/50 w-24">Price</td>
                <td className="py-1.5 font-mono font-medium" data-testid="snapshot-price">
                  {snapshot.price !== null ? `$${snapshot.price < 0.01 ? snapshot.price.toFixed(6) : snapshot.price.toFixed(2)}` : "—"}
                  {snapshot.priceChange24h !== null && (
                    <span className={`ml-2 text-[10px] ${snapshot.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="snapshot-price-change">
                      {snapshot.priceChange24h > 0 ? "+" : ""}{snapshot.priceChange24h.toFixed(2)}%
                    </span>
                  )}
                </td>
              </tr>
              <tr className="border-b border-border/15">
                <td className="py-1.5 pr-4 text-muted-foreground/50">Market Cap</td>
                <td className="py-1.5 font-mono font-medium" data-testid="snapshot-mcap">{formatLargeNumber(snapshot.marketCap)}</td>
              </tr>
              <tr className="border-b border-border/15">
                <td className="py-1.5 pr-4 text-muted-foreground/50">24h Volume</td>
                <td className="py-1.5 font-mono font-medium" data-testid="snapshot-volume">{formatLargeNumber(snapshot.volume24h)}</td>
              </tr>
              {snapshot.holderCount !== null && (
                <tr className="border-b border-border/15">
                  <td className="py-1.5 pr-4 text-muted-foreground/50">Holders</td>
                  <td className="py-1.5 font-mono font-medium" data-testid="snapshot-holders">{snapshot.holderCount.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="text-[10px] text-muted-foreground/30 flex items-center justify-between mt-1.5">
            <span>{snapshot.source} · {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
            <button
              onClick={fetchSnapshot}
              disabled={loading}
              className="text-muted-foreground/30 hover:text-muted-foreground transition-colors"
              data-testid="button-refresh-snapshot"
            >
              {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function renderInline(text: string): JSX.Element {
  const parts: (string | JSX.Element)[] = [];
  let idx = 0;
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g;
  let match;
  let lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1]) parts.push(<strong key={idx++} className="font-semibold text-foreground">{match[1]}</strong>);
    else if (match[2]) parts.push(<em key={idx++} className="italic">{match[2]}</em>);
    else if (match[3]) parts.push(<code key={idx++} className="text-[0.85em] font-mono px-1 py-0.5 rounded bg-muted/40">{match[3]}</code>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}

function ResearchReport({ content, compact }: { content: string; compact?: boolean }) {
  let cleaned = content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
    .replace(/<scratchpad>[\s\S]*?<\/scratchpad>/gi, '')
    .trim();

  const lines = cleaned.split('\n');
  const sections: JSX.Element[] = [];
  let currentSection: JSX.Element[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];
  let i = 0;
  let sectionIdx = 0;
  let title = '';
  let subtitle = '';

  const flushList = () => {
    if (listItems.length === 0) return;
    const isOrdered = listItems[0].ordered;
    const Tag = isOrdered ? 'ol' : 'ul';
    currentSection.push(
      <Tag key={`l-${sectionIdx}-${currentSection.length}`} className={`${isOrdered ? 'list-decimal' : 'list-disc'} pl-4 space-y-1.5 my-3`}>
        {listItems.map((item, j) => (
          <li key={j} className="text-[13px] leading-[1.75] text-foreground/70 pl-1">
            {renderInline(item.text)}
          </li>
        ))}
      </Tag>
    );
    listItems = [];
  };

  const isTableRow = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');
  const isSeparatorRow = (line: string) => /^\|[\s\-:|]+\|$/.test(line.trim());
  const parseTableCells = (line: string) => line.trim().slice(1, -1).split('|').map(c => c.trim());

  const flushSection = () => {
    flushList();
    if (currentSection.length > 0) {
      sections.push(<div key={`sec-${sectionIdx}`} className="mb-0">{currentSection}</div>);
      sectionIdx++;
      currentSection = [];
    }
  };

  if (lines.length > 0 && lines[0].match(/^#\s/)) {
    title = lines[0].replace(/^#\s+/, '');
    i = 1;
  }

  if (i < lines.length && !lines[i].match(/^#/) && lines[i].trim() !== '' && lines[i].trim() !== '---') {
    subtitle = lines[i].trim();
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];

    if (isTableRow(line) && i + 1 < lines.length && isTableRow(lines[i + 1])) {
      flushList();
      const tableRows: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        tableRows.push(lines[i]);
        i++;
      }
      const dataRows = tableRows.filter(r => !isSeparatorRow(r));
      if (dataRows.length > 0) {
        const headerCells = parseTableCells(dataRows[0]);
        const bodyRows = dataRows.slice(1);
        currentSection.push(
          <div key={`t-${sectionIdx}-${currentSection.length}`} className="my-4 overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {headerCells.map((cell, ci) => (
                    <th key={ci} className="text-left py-2 px-3 text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium border-b-2 border-border/20 whitespace-nowrap">
                      {renderInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => {
                  const cells = parseTableCells(row);
                  return (
                    <tr key={ri} className="border-b border-border/8 hover:bg-muted/5 transition-colors">
                      {cells.map((cell, ci) => (
                        <td key={ci} className={`py-2 px-3 text-[12px] whitespace-nowrap ${ci === 0 ? 'text-foreground/80 font-medium' : 'text-foreground/60'}`}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*•]\s+(.+)$/);
    if (bulletMatch) {
      listItems.push({ text: bulletMatch[2], ordered: false });
      i++;
      continue;
    }

    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      if (listItems.length > 0 && !listItems[0].ordered) flushList();
      listItems.push({ text: numMatch[2], ordered: true });
      i++;
      continue;
    }

    flushList();

    if (line.match(/^---+$/)) {
      flushSection();
      i++;
      continue;
    }

    if (line.match(/^##\s/)) {
      flushSection();
      const text = line.replace(/^##\s+/, '').replace(/^\d+\.\s*/, '');
      currentSection.push(
        <div key={`h2-${sectionIdx}-${currentSection.length}`} className="pt-5 pb-2 first:pt-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{renderInline(text)}</h2>
        </div>
      );
      i++;
      continue;
    }

    if (line.match(/^###\s/)) {
      flushList();
      const text = line.replace(/^###\s+/, '');
      currentSection.push(
        <h3 key={`h3-${sectionIdx}-${currentSection.length}`} className="text-[13px] font-semibold text-foreground/85 pt-3 pb-1">
          {renderInline(text)}
        </h3>
      );
      i++;
      continue;
    }

    if (line.match(/^#\s/) && i > 0) {
      flushSection();
      const text = line.replace(/^#\s+/, '');
      currentSection.push(
        <h1 key={`h1-${sectionIdx}-${currentSection.length}`} className="text-base font-bold tracking-tight text-foreground pt-4 pb-2">
          {renderInline(text)}
        </h1>
      );
      i++;
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    currentSection.push(
      <p key={`p-${sectionIdx}-${currentSection.length}`} className="text-[13px] leading-[1.8] text-foreground/65 mb-2">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  flushSection();

  return (
    <article className={compact ? "" : "max-w-3xl"}>
      {title && (
        <header className="mb-6">
          <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">{renderInline(title)}</h1>
          {subtitle && (
            <p className="text-[13px] text-muted-foreground/50 mt-1.5 font-mono">{subtitle}</p>
          )}
        </header>
      )}
      <div>{sections}</div>
    </article>
  );
}

export function TokenReportTab({ companyId, companyName }: { companyId: string; companyName: string }) {
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
      toast({ title: "Analysis started", description: "Generating research report. This may take a minute." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      await apiRequest("DELETE", `/api/token-analyses/${analysisId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-analyses"] });
      toast({ title: "Report deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const completedAnalyses = analyses.filter(a => a.status === "completed" && a.content);
  const generating = analyses.some(a => a.status === "generating");
  const latestReport = completedAnalyses[0];

  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Generating research report...</p>
        <p className="text-[11px] text-muted-foreground/40">This typically takes 1-2 minutes</p>
      </div>
    );
  }

  if (!latestReport) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-muted-foreground/20">
          <Brain className="w-8 h-8" />
        </div>
        <div className="text-center">
          <p className="text-sm text-muted-foreground/60 mb-1">No research report yet</p>
          <p className="text-[11px] text-muted-foreground/30">Generate an AI-powered investment analysis for {companyName}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5 mt-2"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || !tokenProfile}
          data-testid="button-generate-report-tab"
        >
          <Brain className="w-3 h-3" />
          Generate Research Report (~$0.23)
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="text-[10px] text-muted-foreground/30">
          {format(new Date(latestReport.createdAt), "MMMM d, yyyy")}
          {completedAnalyses.length > 1 && ` · ${completedAnalyses.length} reports`}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => deleteMutation.mutate(latestReport.id)}
            className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/20 hover:text-destructive transition-colors"
            data-testid="button-delete-report"
            title="Delete report"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 px-2 text-muted-foreground/30 hover:text-muted-foreground"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !tokenProfile}
            data-testid="button-regenerate-report"
          >
            <RefreshCw className="w-2.5 h-2.5 mr-1" />
            Regenerate
          </Button>
        </div>
      </div>
      <ResearchReport content={latestReport.content} />
    </div>
  );
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
    <div className="space-y-6">
      <Section title="Token Profile">
        <TokenProfileManager companyId={companyId} />
      </Section>

      <Section title="Token Snapshot">
        <TokenSnapshotCard companyId={companyId} />
      </Section>

      <Section title="Dune Queries">
        <DuneQueryManager companyId={companyId} />
      </Section>

      {queries.length > 0 && (
        <div className="space-y-6">
          {queries.map((q) => (
            <DuneQueryResultCard key={q.id} query={q} />
          ))}
        </div>
      )}

      <Section title="AI Token Analysis">
        <TokenAnalysisSection companyId={companyId} companyName={companyName} />
      </Section>
    </div>
  );
}
