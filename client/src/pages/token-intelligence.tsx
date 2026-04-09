import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AddToMasterReport } from "@/components/add-to-master-report";
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
  Plus,
  Trash2,
  RefreshCw,
  Brain,
  AlertTriangle,
  Link2,
  Database,
  TrendingUp,
  TrendingDown,
  FileText,
  ArrowLeft,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { TokenProfile, DuneQuery, MasterDuneQuery, TokenAnalysis } from "@shared/schema";

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

const CHART_COLORS = ["#3b6fd4", "#94a3b8", "#5a8de6", "#8b5cf6"];
const cardClass = "rounded border border-border/40 bg-card/30 overflow-hidden";

function smartFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    if (abs < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(2)}`;
  }
  if (fmt === "percent") return `${value.toFixed(1)}%`;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function axisFormat(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  if (abs < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(0)}`;
}

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
  const [inputValue, setInputValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [manualLabel, setManualLabel] = useState("");
  const [showManualForm, setShowManualForm] = useState(false);
  const [pendingQueryId, setPendingQueryId] = useState<number | null>(null);

  const { data: queries = [], isLoading } = useQuery<DuneQuery[]>({
    queryKey: ["/api/companies", companyId, "dune-queries"],
  });

  const { data: duneStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/dune/status"],
  });

  const { data: masterQueries = [] } = useQuery<MasterDuneQuery[]>({
    queryKey: ["/api/master-dune-queries"],
  });

  const existingQueryIds = queries.map(q => q.queryId);

  const addMutation = useMutation({
    mutationFn: async (payload: { queryId: number; label: string; visualizationType?: string; masterQueryId?: string }) => {
      await apiRequest("POST", `/api/companies/${companyId}/dune-queries`, {
        ...payload,
        displayOrder: queries.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "dune-queries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "charts"] });
      setInputValue("");
      setManualLabel("");
      setShowManualForm(false);
      setPendingQueryId(null);
      toast({ title: "Query added — chart will appear in Data tab" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "charts"] });
      toast({ title: data.attached > 0 ? `${data.attached} queries auto-attached` : "No matching queries found" });
    },
    onError: (err: any) => toast({ title: "Auto-attach failed", description: err.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/master-dune-queries/sync", { fromExternal: true });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-dune-queries"] });
      toast({ title: `Library synced — ${data.synced} queries` });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-12 w-full" />;

  if (!duneStatus?.configured) {
    return (
      <div className="flex items-center gap-2 py-3 px-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500/50 shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">Dune API key not configured</p>
          <p className="text-[10px] text-muted-foreground/40">Set DUNE_API_KEY in environment secrets</p>
        </div>
      </div>
    );
  }

  const isNumericInput = /^\d+$/.test(inputValue.trim());
  const searchTerm = inputValue.toLowerCase().trim();

  const available = masterQueries.filter(mq => !existingQueryIds.includes(mq.queryId));
  const categories = [...new Set(available.map(q => q.category).filter(Boolean))].sort();

  const libraryResults = searchTerm && !isNumericInput
    ? available.filter(mq => {
        if (selectedCategory && mq.category !== selectedCategory) return false;
        return mq.label.toLowerCase().includes(searchTerm) ||
          mq.description?.toLowerCase().includes(searchTerm) ||
          (mq.protocolTags || []).some(t => t.toLowerCase().includes(searchTerm)) ||
          (mq.chainTags || []).some(t => t.toLowerCase().includes(searchTerm)) ||
          String(mq.queryId).includes(searchTerm);
      })
    : selectedCategory
      ? available.filter(mq => mq.category === selectedCategory)
      : [];

  const showDropdown = inputFocused && (searchTerm.length > 0 || selectedCategory);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isNumericInput) {
      e.preventDefault();
      const qid = parseInt(inputValue.trim());
      if (existingQueryIds.includes(qid)) {
        toast({ title: "Already attached", variant: "destructive" });
        return;
      }
      const match = masterQueries.find(mq => mq.queryId === qid);
      if (match) {
        addMutation.mutate({ queryId: match.queryId, label: match.label, visualizationType: match.visualizationType || undefined, masterQueryId: match.id });
      } else {
        setPendingQueryId(qid);
        setShowManualForm(true);
      }
    }
  };

  const handleAttachLibrary = (mq: MasterDuneQuery) => {
    addMutation.mutate({ queryId: mq.queryId, label: mq.label, visualizationType: mq.visualizationType || undefined, masterQueryId: mq.id });
  };

  const handleManualSubmit = () => {
    if (!pendingQueryId || !manualLabel.trim()) return;
    addMutation.mutate({ queryId: pendingQueryId, label: manualLabel.trim() });
  };

  return (
    <div className="space-y-2">
      {queries.length > 0 && (
        <div className={`${cardClass} overflow-hidden`}>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border/20">
                <th className="text-left py-1.5 px-2.5 text-[9px] uppercase tracking-wider text-muted-foreground/40 font-medium">Query</th>
                <th className="text-right py-1.5 px-2.5 text-[9px] uppercase tracking-wider text-muted-foreground/40 font-medium w-16">ID</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q) => (
                <tr key={q.id} className="border-b border-border/10 hover:bg-muted/10 group" data-testid={`dune-query-${q.id}`}>
                  <td className="py-1.5 px-2.5 text-foreground/70 truncate max-w-[200px]">
                    <div className="flex items-center gap-1.5">
                      <Database className="w-2.5 h-2.5 text-teal-400/50 shrink-0" />
                      <span className="truncate">{q.label}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2.5 text-right font-mono text-muted-foreground/40">#{q.queryId}</td>
                  <td className="py-1 px-1">
                    <button
                      onClick={() => removeMutation.mutate(q.id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground/40 hover:text-destructive transition-all"
                      data-testid={`button-remove-query-${q.id}`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="relative">
        <div className="flex items-center gap-1">
          <div className="flex-1 relative">
            <input
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setSelectedCategory(null); }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setTimeout(() => setInputFocused(false), 200)}
              onKeyDown={handleKeyDown}
              placeholder={queries.length > 0 ? "Add query — search library or paste ID..." : "Search queries or paste a Dune query ID..."}
              className="w-full h-8 px-3 pr-8 text-xs rounded-md border border-border/40 bg-card/30 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-teal-500/30 transition-colors"
              data-testid="input-dune-search"
            />
            {isNumericInput && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-teal-400/60 font-mono">
                ↵ add
              </span>
            )}
          </div>
          <button
            onClick={() => autoAttachMutation.mutate()}
            disabled={autoAttachMutation.isPending}
            className="p-1.5 rounded-md hover:bg-accent/20 text-muted-foreground/50 hover:text-teal-400 transition-colors"
            title="Auto-detect and attach relevant queries"
            data-testid="button-auto-attach"
          >
            {autoAttachMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showDropdown && !isNumericInput && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-[hsl(var(--card))] border border-border/15 rounded-lg shadow-xl overflow-hidden" data-testid="query-dropdown">
            {categories.length > 1 && (
              <div className="flex flex-wrap gap-1 px-2.5 py-2 border-b border-border/10">
                <button
                  className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${!selectedCategory ? 'bg-teal-500/15 text-teal-400' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setSelectedCategory(null)}
                >
                  All
                </button>
                {categories.map(cat => (
                  <button
                    key={cat}
                    className={`text-[9px] px-2 py-0.5 rounded-full transition-colors capitalize ${selectedCategory === cat ? 'bg-teal-500/15 text-teal-400' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat!)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
            {libraryResults.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  {searchTerm ? "No matching queries" : "Type to search library"}
                </p>
                {masterQueries.length === 0 && (
                  <button
                    className="mt-2 text-[10px] text-teal-400/60 hover:text-teal-400 transition-colors"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => syncMutation.mutate()}
                    disabled={syncMutation.isPending}
                    data-testid="button-sync-library"
                  >
                    {syncMutation.isPending ? "Syncing..." : "Sync query library"}
                  </button>
                )}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                <p className="text-[9px] text-muted-foreground/60 px-2.5 py-1.5">{libraryResults.length} results</p>
                {libraryResults.slice(0, 20).map(mq => (
                  <button
                    key={mq.id}
                    className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-accent/10 transition-colors text-left"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleAttachLibrary(mq)}
                    disabled={addMutation.isPending}
                    data-testid={`button-attach-${mq.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-foreground/80 truncate">{mq.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-mono text-muted-foreground/50">#{mq.queryId}</span>
                        {mq.category && <span className="text-[9px] px-1.5 py-0 rounded-full bg-accent/20 text-muted-foreground/40 capitalize">{mq.category}</span>}
                        {(mq.protocolTags || []).slice(0, 1).map(t => (
                          <span key={t} className="text-[9px] text-teal-400/50">{t}</span>
                        ))}
                      </div>
                    </div>
                    <Plus className="w-3 h-3 text-muted-foreground/50 shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showManualForm && pendingQueryId && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-card/30 border border-border/10">
          <span className="text-[10px] font-mono text-teal-400/60 shrink-0">#{pendingQueryId}</span>
          <input
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="Label this query..."
            className="flex-1 h-7 px-2 text-xs rounded border border-border/40 bg-transparent text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-teal-500/30"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleManualSubmit(); if (e.key === "Escape") { setShowManualForm(false); setPendingQueryId(null); } }}
            data-testid="input-manual-label"
          />
          <button
            onClick={handleManualSubmit}
            disabled={!manualLabel.trim() || addMutation.isPending}
            className="text-[10px] px-2.5 py-1 rounded bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 disabled:opacity-30 transition-colors"
            data-testid="button-save-manual-query"
          >
            {addMutation.isPending ? "Adding..." : "Add"}
          </button>
          <button
            onClick={() => { setShowManualForm(false); setPendingQueryId(null); }}
            className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {queries.length === 0 && !showManualForm && (
        <p className="text-[10px] text-muted-foreground/50 text-center py-1">
          Search the library above, paste a Dune query ID, or use the refresh icon to auto-detect queries
        </p>
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
                <span className="text-xs text-foreground/60" title={analysis.status === "failed" && analysis.content ? analysis.content.replace(/^#.*\n\n/, '').replace(/\n\nPlease try again\.$/, '') : undefined}>
                  {analysis.status === "generating" ? "Generating..." : analysis.status === "failed" ? `Failed${analysis.content?.includes("Error:") ? ` — ${analysis.content.match(/Error: (.+?)(\n|$)/)?.[1] || ""}` : ""}` : format(new Date(analysis.createdAt), "MMM d, yyyy h:mm a")}
                </span>
              </div>
              {analysis.status !== "generating" && (
                <button
                  onClick={() => deleteMutation.mutate(analysis.id)}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground/50 hover:text-destructive transition-colors"
                  data-testid={`button-delete-analysis-${analysis.id}`}
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mb-2">Results appear in the Reports tab</p>
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
          <><Brain className="w-3 h-3" /> Generate Token Analysis (~$0.23)</>
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
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
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

function formatSupply(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
        <div className={cardClass} data-testid="snapshot-metrics">
          <div className="divide-y divide-border/15">
            <div className="px-3 py-1.5" data-testid="snapshot-price">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">Price</div>
              <div className="text-[11px] font-mono font-medium">
                {snapshot.price !== null ? `$${snapshot.price < 0.01 ? snapshot.price.toFixed(6) : snapshot.price.toFixed(2)}` : "—"}
                {snapshot.priceChange24h !== null && (
                  <span className={`ml-1 text-[8px] ${snapshot.priceChange24h >= 0 ? "text-green-500" : "text-red-500"}`} data-testid="snapshot-price-change">
                    {snapshot.priceChange24h > 0 ? "+" : ""}{snapshot.priceChange24h.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">Market Cap</div>
              <div className="text-[11px] font-mono font-medium" data-testid="snapshot-mcap">{formatLargeNumber(snapshot.marketCap)}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">FDV</div>
              <div className="text-[11px] font-mono font-medium" data-testid="snapshot-fdv">{formatLargeNumber(snapshot.fdv)}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">24h Volume</div>
              <div className="text-[11px] font-mono font-medium" data-testid="snapshot-volume">{formatLargeNumber(snapshot.volume24h)}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">Circ Supply</div>
              <div className="text-[11px] font-mono font-medium" data-testid="snapshot-circ-supply">{formatSupply(snapshot.circulatingSupply)}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="text-[9px] text-muted-foreground/50 mb-0.5">Total Supply</div>
              <div className="text-[11px] font-mono font-medium" data-testid="snapshot-total-supply">{formatSupply(snapshot.totalSupply)}</div>
            </div>
            {snapshot.holderCount !== null && (
              <div className="px-3 py-1.5">
                <div className="text-[9px] text-muted-foreground/50 mb-0.5">Holders</div>
                <div className="text-[11px] font-mono font-medium" data-testid="snapshot-holders">{snapshot.holderCount.toLocaleString()}</div>
              </div>
            )}
          </div>
          <div className="text-[9px] text-muted-foreground/40 flex items-center justify-between px-3 py-1.5 italic border-t border-border/10">
            <span>CoinGecko</span>
            <button
              onClick={fetchSnapshot}
              disabled={loading}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors not-italic"
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

interface PriceDataPoint {
  date: number;
  price: number;
  volume: number;
  market_cap: number;
}

const TIME_RANGES = [
  { label: "24H", days: 1 },
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
  { label: "All", days: 0 },
] as const;

function resolveCoinId(tokenProfile: TokenProfile): string | null {
  const ticker = (tokenProfile.tokenTicker || "").toLowerCase();
  const chain = (tokenProfile.chain || "").toLowerCase();
  const mapping: Record<string, string> = {
    eth: "ethereum", weth: "weth", steth: "staked-ether",
    btc: "bitcoin", wbtc: "wrapped-bitcoin",
    sol: "solana", hype: "hyperliquid",
    avax: "avalanche-2", matic: "matic-network", pol: "matic-network",
    arb: "arbitrum", op: "optimism", link: "chainlink", uni: "uniswap",
    aave: "aave", mkr: "maker", snx: "synthetix-network-token",
    crv: "curve-dao-token", ldo: "lido-dao", pendle: "pendle",
    gmx: "gmx", jup: "jupiter-exchange-solana", ray: "raydium",
    jto: "jito-governance-token", ena: "ethena", eigen: "eigenlayer",
    ondo: "ondo-finance", sui: "sui", apt: "aptos", sei: "sei-network",
    near: "near", atom: "cosmos", dot: "polkadot", ada: "cardano",
    doge: "dogecoin", shib: "shiba-inu", pepe: "pepe",
    wif: "dogwifcoin", bonk: "bonk", floki: "floki",
    cake: "pancakeswap-token", sushi: "sushi",
    bnb: "binancecoin", xrp: "ripple", ton: "the-open-network",
    trx: "tron", fil: "filecoin", inj: "injective-protocol",
    ftm: "fantom", manta: "manta-network", zk: "zksync",
    strk: "starknet", blast: "blast", scroll: "scroll",
    tia: "celestia", pyth: "pyth-network", w: "wormhole",
    vet: "vechain", sand: "the-sandbox", mana: "decentraland",
    grt: "the-graph", comp: "compound-governance-token",
    rpl: "rocket-pool", ssv: "ssv-network",
  };
  if (mapping[ticker]) return mapping[ticker];
  if (chain === "hyperliquid" && !tokenProfile.contractAddress) return ticker;
  return ticker || null;
}

async function fetchCoinGeckoPrices(coinId: string, days: number | "max"): Promise<PriceDataPoint[]> {
  let id = coinId;
  const daysParam = days === "max" ? "max" : String(days);
  const interval = (typeof days === "number" && days > 1 && days <= 90) ? "&interval=daily" : "";
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${daysParam}${interval}`;
  let res = await fetch(url);
  if (!res.ok) {
    const searchRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(id)}`);
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const coin = searchData.coins?.[0];
      if (coin) {
        id = coin.id;
        res = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${daysParam}${interval}`);
        if (!res.ok) throw new Error("Price data unavailable");
      } else {
        throw new Error("Price data unavailable");
      }
    } else {
      throw new Error("Price data unavailable");
    }
  }
  const data = await res.json();
  const prices = data.prices || [];
  const volumes = data.total_volumes || [];
  const marketCaps = data.market_caps || [];
  return prices.map((p: [number, number], i: number) => ({
    date: Math.floor(p[0] / 1000),
    price: p[1],
    volume: volumes[i]?.[1] || 0,
    market_cap: marketCaps[i]?.[1] || 0,
  }));
}

function PriceChart({ companyId }: { companyId: string }) {
  const [selectedRange, setSelectedRange] = useState(3);

  const { data: tokenProfile } = useQuery<TokenProfile | null>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });

  const coinId = useMemo(() => tokenProfile ? resolveCoinId(tokenProfile) : null, [tokenProfile]);

  const fetchDays = useMemo(() => {
    const days = TIME_RANGES[selectedRange].days;
    return days === 0 ? "max" as const : days;
  }, [selectedRange]);

  const { data: priceData, isLoading, isError } = useQuery<PriceDataPoint[]>({
    queryKey: ["/api/coingecko-price", coinId, fetchDays],
    queryFn: () => fetchCoinGeckoPrices(coinId!, fetchDays),
    enabled: !!coinId,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });

  if (!tokenProfile || !coinId) return null;

  if (isLoading) {
    return (
      <div>
        <h3 className="text-[12px] font-medium text-foreground/80 tracking-tight">{tokenProfile.tokenTicker || "Token"} Price</h3>
        <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> Loading chart...
        </div>
      </div>
    );
  }

  if (isError || !priceData || priceData.length === 0) {
    return (
      <div>
        <h3 className="text-[12px] font-medium text-foreground/80 tracking-tight">{tokenProfile.tokenTicker || "Token"} Price</h3>
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground/50">
          <AlertTriangle className="w-3.5 h-3.5" />
          Price history unavailable
        </div>
      </div>
    );
  }

  const latestPrice = priceData[priceData.length - 1]?.price || 0;
  const firstPrice = priceData[0]?.price || 0;
  const pctChange = firstPrice > 0 ? ((latestPrice - firstPrice) / firstPrice) * 100 : 0;

  const numPoints = priceData.length;
  const maxTicks = 6;
  const tickInterval = numPoints <= maxTicks ? 0 : Math.max(1, Math.floor(numPoints / maxTicks));
  const rangeDays = TIME_RANGES[selectedRange].days;
  const dateFmt = rangeDays <= 1 ? "h:mm a" : rangeDays <= 7 ? "MMM d" : rangeDays <= 90 ? "MMM d" : "MMM ''yy";

  return (
    <div data-testid="price-chart">
      <div className="px-0 pt-0 pb-1">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12px] font-medium text-foreground/80 tracking-tight">{tokenProfile.tokenTicker || "Token"} Price</h3>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <div className="text-right">
              <p className="text-sm font-semibold text-foreground/90 font-mono tracking-tight leading-none" data-testid="price-chart-value">
                {smartFormat(latestPrice, "currency")}
              </p>
              <p className={`text-[9px] mt-0.5 ${pctChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                {pctChange > 0 ? "+" : ""}{pctChange.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5 mt-2" data-testid="price-range-toggles">
          {TIME_RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setSelectedRange(i)}
              className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                i === selectedRange
                  ? "bg-[#3b6fd4]/15 text-[#3b6fd4]"
                  : "text-muted-foreground/40 hover:text-muted-foreground/70"
              }`}
              data-testid={`button-range-${r.label}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="px-1 pb-0">
        <ResponsiveContainer width="100%" height={245}>
          <AreaChart data={priceData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="2 6" stroke="var(--color-chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v: number) => format(new Date(v * 1000), dateFmt)}
              tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
              axisLine={{ stroke: "var(--color-chart-line)" }}
              tickLine={false}
              interval={tickInterval}
              height={22}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => axisFormat(v)}
              tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickCount={5}
            />
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
              labelFormatter={(v: number) => format(new Date(v * 1000), rangeDays <= 1 ? "MMM d, h:mm a" : "MMM d, yyyy")}
              formatter={(value: any) => [smartFormat(value, "currency"), "Price"]}
              cursor={{ fill: "var(--color-chart-cursor)" }}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={CHART_COLORS[0]}
              strokeWidth={1.2}
              fill={CHART_COLORS[0]}
              fillOpacity={0.08}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-between px-1 py-1.5 text-[9px] text-muted-foreground/60 italic">
        <span>Source: CoinGecko</span>
        <span className="not-italic text-muted-foreground/40">{format(new Date(), "MMM d, h:mm a")}</span>
      </div>
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
    if (match[1]) parts.push(<strong key={idx++} className="font-semibold text-foreground/90">{match[1]}</strong>);
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
      <Tag key={`l-${sectionIdx}-${currentSection.length}`} className={`${isOrdered ? 'list-decimal' : 'list-disc'} pl-3 space-y-0.5 my-1.5`}>
        {listItems.map((item, j) => (
          <li key={j} className="text-[10px] leading-relaxed text-foreground/65 pl-0.5">
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
          <div key={`t-${sectionIdx}-${currentSection.length}`} className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr>
                  {headerCells.map((cell, ci) => (
                    <th key={ci} className="text-left py-1.5 px-2 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium border-b border-border/20 whitespace-nowrap">
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
                        <td key={ci} className={`py-1.5 px-2 text-[10px] whitespace-nowrap tabular-nums ${ci === 0 ? 'text-foreground/80 font-medium' : 'text-foreground/60'}`}>
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
        <div key={`h2-${sectionIdx}-${currentSection.length}`} className="pt-3 pb-1 first:pt-0">
          <h2 className="text-xs font-semibold text-foreground/90">{renderInline(text)}</h2>
        </div>
      );
      i++;
      continue;
    }

    if (line.match(/^###\s/)) {
      flushList();
      const text = line.replace(/^###\s+/, '');
      currentSection.push(
        <h3 key={`h3-${sectionIdx}-${currentSection.length}`} className="text-[11px] font-semibold text-foreground/90 pt-2 pb-0.5">
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
        <h1 key={`h1-${sectionIdx}-${currentSection.length}`} className="text-xs font-bold text-foreground/90 pt-3 pb-1">
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
      <p key={`p-${sectionIdx}-${currentSection.length}`} className="text-[10px] leading-relaxed text-foreground/65 mb-1.5">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  flushSection();

  return (
    <article className={compact ? "" : "max-w-3xl"}>
      {title && (
        <header className="mb-3">
          <h1 className="text-sm font-bold text-foreground leading-tight">{renderInline(title)}</h1>
          {subtitle && (
            <p className="text-[10px] text-muted-foreground/50 mt-1 font-mono">{subtitle}</p>
          )}
        </header>
      )}
      <div>{sections}</div>
    </article>
  );
}

interface UnifiedReport {
  id: string;
  type: "token-analysis" | "deep-research";
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

function SelectedReportView({ selected, onBack, onDelete }: { selected: UnifiedReport; onBack: () => void; onDelete: () => void }) {
  const [selectedText, setSelectedText] = useState("");
  const [floatingPos, setFloatingPos] = useState<{ top: number; left: number } | null>(null);
  const reportBodyRef = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);

  const realId = selected.id.replace(/^(analysis-|report-)/, "");
  const isDeepResearch = selected.type === "deep-research";

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setFloatingPos(null);
      setSelectedText("");
      return;
    }
    const text = selection.toString().trim();
    if (text.length < 20) {
      setFloatingPos(null);
      setSelectedText("");
      return;
    }
    if (reportBodyRef.current && !reportBodyRef.current.contains(selection.anchorNode)) {
      setFloatingPos(null);
      setSelectedText("");
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = reportBodyRef.current?.getBoundingClientRect();
    if (!containerRect) return;
    setSelectedText(text);
    setFloatingPos({
      top: Math.max(0, rect.top - containerRect.top - 44),
      left: Math.max(0, Math.min(containerRect.width - 180, rect.left - containerRect.left + rect.width / 2 - 90)),
    });
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleTextSelection);
    return () => document.removeEventListener("mouseup", handleTextSelection);
  }, [handleTextSelection]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (floatingRef.current && !floatingRef.current.contains(e.target as Node)) {
        setFloatingPos(null);
      }
    };
    if (floatingPos) {
      setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 100);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [floatingPos]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-back-to-reports"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Reports
        </button>
        <div className="flex items-center gap-2">
          {isDeepResearch && (
            <AddToMasterReport
              blockType="report-section"
              referenceId={realId}
              label="Add to Master Report"
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            />
          )}
          <AddToMasterReport
            blockType="text"
            content={selected.content}
            label="Add Full Text"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          />
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground/50 hover:text-destructive transition-colors"
            data-testid="button-delete-report"
            title="Delete this report"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/60 mb-4">
        {format(new Date(selected.createdAt), "MMMM d, yyyy h:mm a")}
        <span className="ml-2 text-muted-foreground/40">
          {selected.type === "token-analysis" ? "Token Analysis" : "Deep Research"}
        </span>
      </div>
      <div className="relative" ref={reportBodyRef}>
        <ResearchReport content={selected.content} />
        {floatingPos && (
          <div
            ref={floatingRef}
            className="absolute z-50 animate-in fade-in slide-in-from-bottom-1 duration-150"
            style={{ top: floatingPos.top, left: Math.max(0, floatingPos.left) }}
          >
            <AddToMasterReport
              blockType="text"
              content={selectedText}
              label="Add to Master Report"
              className="h-8 gap-1.5 text-xs shadow-lg bg-card border border-border/50 hover:bg-accent/20 text-foreground/80 rounded-full px-3 flex items-center transition-colors"
              onAdded={() => setFloatingPos(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function ReportsTab({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { toast } = useToast();
  const { getAccessToken } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: analyses = [] } = useQuery<TokenAnalysis[]>({
    queryKey: ["/api/companies", companyId, "token-analyses"],
    refetchInterval: (query) => {
      const data = query.state.data as TokenAnalysis[] | undefined;
      if (data?.some((a) => a.status === "generating")) return 5000;
      return false;
    },
  });

  const { data: reports = [] } = useQuery<{ id: string; title: string; content: string; status: string; createdAt: string }[]>({
    queryKey: ["/api/companies", companyId, "reports"],
  });

  const { data: tokenProfile } = useQuery<TokenProfile | null>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });

  const generateAnalysisMutation = useMutation({
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
      toast({ title: "Token analysis started", description: "This may take a minute." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const generateResearchMutation = useMutation({
    mutationFn: async () => {
      const { runDeepResearchPipeline } = await import("@/lib/enrichment");
      return runDeepResearchPipeline(companyId, getAccessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reports"] });
      toast({ title: "Deep research started", description: "This typically takes 2-3 minutes." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteAnalysisMutation = useMutation({
    mutationFn: async (analysisId: string) => {
      await apiRequest("DELETE", `/api/token-analyses/${analysisId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "token-analyses"] });
      setSelectedId(null);
      toast({ title: "Deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const deleteReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      await apiRequest("DELETE", `/api/reports/${reportId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reports"] });
      setSelectedId(null);
      toast({ title: "Deleted" });
    },
    onError: (err: any) => toast({ title: "Failed to delete", description: err.message, variant: "destructive" }),
  });

  const allReports: UnifiedReport[] = [
    ...analyses
      .filter(a => (a.status === "complete" || a.status === "completed") && a.content)
      .map(a => ({
        id: `analysis-${a.id}`,
        type: "token-analysis" as const,
        title: `Token Analysis — ${format(new Date(a.createdAt), "MMM d, yyyy")}`,
        content: a.content!,
        status: "complete",
        createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt).toISOString(),
      })),
    ...reports
      .filter(r => (r.status === "complete" || r.status === "completed") && r.content)
      .map(r => ({
        id: `report-${r.id}`,
        type: "deep-research" as const,
        title: r.title || `Deep Research — ${format(new Date(r.createdAt), "MMM d, yyyy")}`,
        content: r.content,
        status: "complete",
        createdAt: r.createdAt,
      })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const TEN_MINUTES = 10 * 60 * 1000;
  const generatingAnalysis = analyses.some(a => a.status === "generating" && (Date.now() - new Date(a.createdAt).getTime()) < TEN_MINUTES);
  const generatingResearch = reports.some(r => r.status === "generating");

  const selected = selectedId ? allReports.find(r => r.id === selectedId) : null;

  function extractSummary(content: string): string {
    const plain = content.replace(/[#*_`>~\[\]()]/g, "").replace(/\n+/g, " ").trim();
    const titleEnd = plain.indexOf("Report Date:");
    const start = titleEnd > 0 ? titleEnd : 0;
    return plain.slice(start, start + 180).trim() + (plain.length > start + 180 ? "..." : "");
  }

  function extractTitle(report: UnifiedReport): string {
    const lines = report.content.split("\n").filter(l => l.trim());
    for (const line of lines) {
      const cleaned = line.replace(/^#+\s*/, "").trim();
      if (cleaned.length > 10 && cleaned.length < 120) return cleaned;
    }
    return report.type === "token-analysis" ? "Token Analysis" : "Deep Research";
  }

  if (generatingAnalysis || generatingResearch) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <p className="text-[10px] text-muted-foreground">
          {generatingAnalysis ? "Generating token analysis..." : "Generating deep research..."}
        </p>
        <p className="text-[10px] text-muted-foreground/40">This typically takes 1-2 minutes</p>
      </div>
    );
  }

  if (selected) {
    return (
      <SelectedReportView
        selected={selected}
        onBack={() => setSelectedId(null)}
        onDelete={() => {
          const realId = selected.id.replace(/^(analysis-|report-)/, "");
          if (selected.type === "token-analysis") deleteAnalysisMutation.mutate(realId);
          else deleteReportMutation.mutate(realId);
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-xs text-muted-foreground/60">{allReports.length} report{allReports.length !== 1 ? "s" : ""}</p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 px-2 text-muted-foreground/60 hover:text-muted-foreground"
            onClick={() => generateAnalysisMutation.mutate()}
            disabled={generateAnalysisMutation.isPending || !tokenProfile}
            data-testid="button-new-analysis"
          >
            <Brain className="w-2.5 h-2.5 mr-1" />
            New Analysis
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-[10px] h-6 px-2 text-muted-foreground/60 hover:text-muted-foreground"
            onClick={() => generateResearchMutation.mutate()}
            disabled={generateResearchMutation.isPending}
            data-testid="button-new-research"
          >
            <FileText className="w-2.5 h-2.5 mr-1" />
            New Research
          </Button>
        </div>
      </div>

      {allReports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="text-muted-foreground/50">
            <Brain className="w-8 h-8" />
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground/60 mb-1">No reports yet</p>
            <p className="text-[10px] text-muted-foreground">Generate AI-powered analysis for {companyName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => generateAnalysisMutation.mutate()}
              disabled={generateAnalysisMutation.isPending || !tokenProfile}
              data-testid="button-generate-token-analysis-tab"
            >
              <Brain className="w-3 h-3" />
              Token Analysis (~$0.23)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => generateResearchMutation.mutate()}
              disabled={generateResearchMutation.isPending}
              data-testid="button-generate-research-tab"
            >
              <FileText className="w-3 h-3" />
              Deep Research (~$0.50)
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="reports-card-grid">
          {allReports.map(report => (
            <button
              key={report.id}
              onClick={() => setSelectedId(report.id)}
              className="group relative text-left rounded-lg border border-border/50 bg-card/50 hover:bg-card hover:border-border transition-all duration-200 overflow-hidden"
              data-testid={`card-report-${report.id}`}
            >
              <div className={`h-1 w-full ${report.type === "token-analysis" ? "bg-blue-500/40" : "bg-violet-500/40"}`} />
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[9px] uppercase tracking-wider font-medium px-1.5 py-0.5 rounded ${
                    report.type === "token-analysis" 
                      ? "bg-blue-500/10 text-blue-400" 
                      : "bg-violet-500/10 text-violet-400"
                  }`}>
                    {report.type === "token-analysis" ? "Token Analysis" : "Deep Research"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/50">{format(new Date(report.createdAt), "MMM d, yyyy")}</span>
                </div>
                <h3 className="text-xs font-medium text-foreground/90 mb-1.5 line-clamp-2 group-hover:text-foreground transition-colors">
                  {extractTitle(report)}
                </h3>
                <p className="text-[10px] text-muted-foreground/60 line-clamp-3 leading-relaxed">
                  {extractSummary(report.content)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenSnapshotClipAction({ companyId }: { companyId: string }) {
  const { data: tokenProfile } = useQuery<TokenProfile>({
    queryKey: ["/api/companies", companyId, "token-profile"],
  });
  if (!tokenProfile) return null;
  const ticker = tokenProfile.tokenTicker || "Token";
  return (
    <AddToMasterReport
      blockType="text"
      content={`## ${ticker} — Token Snapshot\n\nLive market data fetched from CoinGecko for ${ticker} (${tokenProfile.chain}).`}
      label="+"
      className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors"
    />
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

  return (
    <div className="space-y-6">
      <Section title="Token Profile">
        <TokenProfileManager companyId={companyId} />
      </Section>

      <Section title="Token Snapshot" action={
        <TokenSnapshotClipAction companyId={companyId} />
      }>
        <div className="flex gap-3 items-start">
          <div className="w-[180px] shrink-0">
            <TokenSnapshotCard companyId={companyId} />
          </div>
          <div className="flex-1 min-w-0">
            <PriceChart companyId={companyId} />
          </div>
        </div>
      </Section>

      <Section title="Dune Queries">
        <DuneQueryManager companyId={companyId} />
      </Section>

      <Section title="AI Token Analysis">
        <TokenAnalysisSection companyId={companyId} companyName={companyName} />
      </Section>
    </div>
  );
}
