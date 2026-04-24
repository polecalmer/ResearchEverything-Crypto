import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users, Activity, DollarSign, Building2, TrendingUp, Radio, Wallet, RefreshCw, XCircle, ArrowDownCircle, ExternalLink, BarChart3, Calendar, Clock, Scale, AlertTriangle, CheckCircle2, HelpCircle, Flag, Bell, BellOff, Settings, Send, Brain, BookOpen, Plus, Pencil, Save, Power } from "lucide-react";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";

const EVENT_LABELS: Record<string, string> = {
  user_signup: "Sign Up",
  enrichment_started: "Enrichment",
  deep_research_started: "Deep Research",
  token_analysis_started: "Token Analysis",
  data_chart_generated: "Data Chart",
  company_created: "Company Created",
  page_view: "Page View",
  login: "Login",
  company_viewed: "Company Viewed",
  token_intel_viewed: "Token Intel Viewed",
  data_tab_viewed: "Data Tab Viewed",
  report_viewed: "Report Viewed",
};

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string | number; icon: any; sub?: string }) {
  return (
    <div className="rounded border border-border/40 bg-card/30 p-4" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      </div>
      <p className="text-xl font-semibold text-foreground/90 font-mono">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground/50 mt-0.5">{sub}</p>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  open: "text-green-400",
  close_pending: "text-yellow-400",
  ready_to_finalize: "text-blue-400",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  close_pending: "Closing",
  ready_to_finalize: "Ready",
};

function WalletPanel() {
  const queryClient = useQueryClient();
  const [actionResult, setActionResult] = useState<string | null>(null);

  const { data: wallet, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/wallet"],
    refetchInterval: false,
  });

  const closeAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/wallet/close-all"),
    onSuccess: async (res) => {
      const data = await res.json();
      setActionResult(`Requested: ${data.requested}, Finalized: ${data.finalized}${data.errors?.length ? `, Errors: ${data.errors.length}` : ""}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wallet"] });
    },
    onError: (e: any) => setActionResult(`Error: ${e.message}`),
  });

  const closeChannelMutation = useMutation({
    mutationFn: (channelId: string) => apiRequest("POST", `/api/admin/wallet/channel/${encodeURIComponent(channelId)}/close`),
    onSuccess: async (res) => {
      const data = await res.json();
      setActionResult(data.success ? `Close requested: ${data.txHash?.slice(0, 18)}...` : `Error: ${data.error}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wallet"] });
    },
    onError: (e: any) => setActionResult(`Error: ${e.message}`),
  });

  const withdrawMutation = useMutation({
    mutationFn: (channelId: string) => apiRequest("POST", `/api/admin/wallet/channel/${encodeURIComponent(channelId)}/withdraw`),
    onSuccess: async (res) => {
      const data = await res.json();
      setActionResult(data.success ? `Withdrawn: ${data.txHash?.slice(0, 18)}...` : `Error: ${data.error}`);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/wallet"] });
    },
    onError: (e: any) => setActionResult(`Error: ${e.message}`),
  });

  if (isLoading) {
    return (
      <div className="rounded border border-border/40 bg-card/30 p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground/60 ml-2">Loading wallet...</span>
      </div>
    );
  }

  if (!wallet) return null;

  const isActing = closeAllMutation.isPending || closeChannelMutation.isPending || withdrawMutation.isPending;

  return (
    <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="wallet-panel">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Wallet className="w-3.5 h-3.5 text-foreground/60" />
        <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Server Wallet</h2>
        <a
          href={`https://explore.tempo.xyz/address/${wallet.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-muted-foreground/50 font-mono hover:text-foreground/60 transition-colors flex items-center gap-1"
          data-testid="link-wallet-explorer"
        >
          {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
          <ExternalLink className="w-2.5 h-2.5" />
        </a>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
            data-testid="button-refresh-wallet"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">USDC.e Balance</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-wallet-balance">${wallet.usdcBalance.toFixed(4)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Open Channels</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-open-channels">{wallet.openCount}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Recoverable</p>
          <p className="text-sm font-mono font-semibold text-green-400" data-testid="text-recoverable">${wallet.totalRecoverable.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Effective Total</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-effective-total">
            ${(wallet.usdcBalance + wallet.totalRecoverable).toFixed(2)}
          </p>
        </div>
      </div>

      {wallet.channels.length > 0 && (
        <div className="border-t border-border/30">
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/50">{wallet.channels.length} active channel{wallet.channels.length !== 1 ? "s" : ""}</span>
            {wallet.openCount > 0 && (
              <button
                onClick={() => { setActionResult(null); closeAllMutation.mutate(); }}
                disabled={isActing}
                className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                data-testid="button-close-all-channels"
              >
                {closeAllMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                Close All
              </button>
            )}
          </div>
          <div className="divide-y divide-border/20">
            {wallet.channels.map((ch: any) => (
              <div key={ch.id} className="px-4 py-2 flex items-center gap-3 hover:bg-accent/30 transition-colors" data-testid={`channel-row-${ch.id.slice(0, 10)}`}>
                <span className="text-[10px] font-mono text-muted-foreground/50 w-36 truncate">{ch.id.slice(0, 18)}...</span>
                <span className={`text-[10px] font-medium w-16 ${STATUS_COLORS[ch.status] || "text-muted-foreground/50"}`}>
                  {STATUS_LABELS[ch.status] || ch.status}
                </span>
                <span className="text-[10px] font-mono text-foreground/60">${ch.deposit.toFixed(2)} dep</span>
                <span className="text-[10px] font-mono text-green-400/80">${ch.recoverable.toFixed(2)} rec</span>
                {ch.status === "close_pending" && ch.waitMinutes > 0 && (
                  <span className="text-[10px] text-yellow-400/60">{ch.waitMinutes}min</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  {ch.status === "open" && (
                    <button
                      onClick={() => { setActionResult(null); closeChannelMutation.mutate(ch.id); }}
                      disabled={isActing}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                      data-testid={`button-close-${ch.id.slice(0, 10)}`}
                    >
                      Close
                    </button>
                  )}
                  {ch.status === "ready_to_finalize" && (
                    <button
                      onClick={() => { setActionResult(null); withdrawMutation.mutate(ch.id); }}
                      disabled={isActing}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50"
                      data-testid={`button-withdraw-${ch.id.slice(0, 10)}`}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {actionResult && (
        <div className="px-4 py-2 border-t border-border/30 bg-accent/20">
          <p className="text-[10px] text-foreground/60" data-testid="text-wallet-action-result">{actionResult}</p>
        </div>
      )}
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  enrichment: "Enrichment",
  next_steps: "Next Steps",
  deep_research: "Deep Research",
  session_research: "Research Session",
  token_analysis: "Token Analysis",
  data_chart: "Data Chart",
  dune_query: "Dune Query",
  token_snapshot: "Token Snapshot",
};

function CostTrendBar({ items, maxValue, valueKey, formatLabel }: {
  items: any[];
  maxValue: number;
  valueKey: string;
  formatLabel: (item: any) => string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.map((item: any, i: number) => {
        const value = Number(item[valueKey]) || 0;
        const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-2 text-[10px]" data-testid={`trend-bar-${i}`}>
            <span className="text-muted-foreground/50 w-16 shrink-0 text-right">{formatLabel(item)}</span>
            <div className="flex-1 h-3 bg-border/20 rounded overflow-hidden">
              <div
                className="h-full bg-amber-400/60 rounded"
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
            <span className="font-mono text-foreground/60 w-16 shrink-0 text-right">${value.toFixed(4)}</span>
            <span className="font-mono text-muted-foreground/40 w-12 shrink-0 text-right">{item.tx_count}</span>
          </div>
        );
      })}
    </div>
  );
}

function CostAlertSettingsPanel() {
  const { data: settings, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/cost-alert-settings"],
  });
  const [editing, setEditing] = useState(false);
  const [threshold, setThreshold] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [telegramEnabled, setTelegramEnabled] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: { dailyThreshold: number; enabled: boolean; telegramEnabled: boolean }) =>
      apiRequest("PUT", "/api/admin/cost-alert-settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cost-alert-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cost-report"] });
      setEditing(false);
    },
  });

  const startEditing = () => {
    setThreshold(String(settings?.dailyThreshold ?? 5));
    setEnabled(settings?.enabled !== false);
    setTelegramEnabled(settings?.telegramEnabled === true);
    setEditing(true);
  };

  const handleSave = () => {
    const val = parseFloat(threshold);
    if (isNaN(val) || val < 0) return;
    mutation.mutate({ dailyThreshold: val, enabled, telegramEnabled });
  };

  if (isLoading) return null;

  return (
    <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="cost-alert-settings-panel">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Bell className="w-3.5 h-3.5 text-foreground/60" />
        <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Cost Alert Settings</h2>
        <span className="ml-auto">
          {!editing ? (
            <button
              onClick={startEditing}
              className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
              data-testid="button-edit-cost-alert"
            >
              <Settings className="w-3 h-3" /> Configure
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={mutation.isPending}
                className="text-[10px] px-2 py-0.5 rounded bg-foreground/10 hover:bg-foreground/20 text-foreground/70 transition-colors"
                data-testid="button-save-cost-alert"
              >
                {mutation.isPending ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-[10px] text-muted-foreground/50 hover:text-foreground/60 transition-colors"
                data-testid="button-cancel-cost-alert"
              >
                Cancel
              </button>
            </div>
          )}
        </span>
      </div>
      <div className="p-4">
        {editing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted-foreground/60 w-28">Daily Threshold</label>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground/50">$</span>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  className="w-24 px-2 py-1 text-[11px] bg-background/50 border border-border/40 rounded text-foreground/80 font-mono"
                  data-testid="input-cost-threshold"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted-foreground/60 w-28">Alerts Enabled</label>
              <button
                onClick={() => setEnabled(!enabled)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${enabled ? "bg-green-500/20 text-green-400" : "bg-muted/30 text-muted-foreground/50"}`}
                data-testid="button-toggle-alerts"
              >
                {enabled ? "On" : "Off"}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-muted-foreground/60 w-28">Telegram Notify</label>
              <button
                onClick={() => setTelegramEnabled(!telegramEnabled)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${telegramEnabled ? "bg-blue-500/20 text-blue-400" : "bg-muted/30 text-muted-foreground/50"}`}
                data-testid="button-toggle-telegram"
              >
                <Send className="w-3 h-3" />
                {telegramEnabled ? "On" : "Off"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-6 text-[11px]">
            <div className="flex items-center gap-1.5">
              {settings?.enabled !== false ? (
                <Bell className="w-3 h-3 text-green-400" />
              ) : (
                <BellOff className="w-3 h-3 text-muted-foreground/40" />
              )}
              <span className={settings?.enabled !== false ? "text-green-400" : "text-muted-foreground/40"}>
                {settings?.enabled !== false ? "Active" : "Disabled"}
              </span>
            </div>
            <span className="text-muted-foreground/50">
              Threshold: <span className="font-mono text-foreground/70">${Number(settings?.dailyThreshold ?? 5).toFixed(2)}</span>
            </span>
            {settings?.telegramEnabled && (
              <span className="text-blue-400/70 flex items-center gap-1">
                <Send className="w-3 h-3" /> Telegram
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CostReportPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/cost-report"],
    refetchInterval: false,
  });
  const [trendView, setTrendView] = useState<"daily" | "weekly">("daily");
  const [sessionExpanded, setSessionExpanded] = useState(false);

  const trendData = useMemo(() => {
    if (!data) return { items: [], max: 0 };
    const items = trendView === "daily" ? (data.dailyCosts || []) : (data.weeklyCosts || []);
    const costKey = trendView === "daily" ? "daily_cost" : "weekly_cost";
    const max = Math.max(...items.map((d: any) => Number(d[costKey]) || 0), 0.0001);
    return { items, max, costKey };
  }, [data, trendView]);

  if (isLoading) {
    return (
      <div className="rounded border border-border/40 bg-card/30 p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground/60 ml-2">Loading cost report...</span>
      </div>
    );
  }

  if (!data) return null;

  const { onChain, transactionBreakdown, tokenUsage, sessionBreakdown, costAlert } = data;
  const sessionsToShow = sessionExpanded ? (sessionBreakdown || []) : (sessionBreakdown || []).slice(0, 10);

  return (
    <div className="space-y-4">
      {costAlert?.exceeded && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 flex items-center gap-3" data-testid="cost-alert-banner">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <div className="flex-1">
            <p className="text-[12px] font-medium text-red-400">Daily Cost Alert</p>
            <p className="text-[11px] text-red-300/70">
              Today's API spend of <span className="font-mono font-semibold">${costAlert.todayCost.toFixed(4)}</span> has exceeded the threshold of <span className="font-mono font-semibold">${costAlert.threshold.toFixed(2)}</span>
            </p>
          </div>
        </div>
      )}
      <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="cost-report-panel">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-foreground/60" />
          <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">On-Chain Cost Report</h2>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground/40">{onChain?.generatedAt ? format(new Date(onChain.generatedAt), "h:mm a") : ""}</span>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
              data-testid="button-refresh-cost-report"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </span>
        </div>

        <div className="p-4 grid grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Total Funded</p>
            <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-total-funded">
              ${onChain?.totalFunded?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Current Balance</p>
            <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-current-balance">
              ${onChain?.currentBalance?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Net Cost</p>
            <p className="text-sm font-mono font-semibold text-amber-400" data-testid="text-net-cost">
              ${onChain?.netCost?.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Protocol Fees</p>
            <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-protocol-fees">
              ${onChain?.protocolFees?.toFixed(4)}
            </p>
            <p className="text-[9px] text-muted-foreground/40">{onChain?.protocolFeeTxCount} txns</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-0.5">Escrow Locked</p>
            <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-escrow-locked">
              ${onChain?.escrowLocked?.toFixed(2)}
            </p>
          </div>
        </div>

        {tokenUsage && (
          <div className="px-4 pb-3 border-t border-border/20 pt-3">
            <div className="flex items-center gap-6 text-[10px]">
              <span className="text-muted-foreground/50">
                Input Tokens: <span className="font-mono text-foreground/60">{Number(tokenUsage.total_input).toLocaleString()}</span>
              </span>
              <span className="text-muted-foreground/50">
                Output Tokens: <span className="font-mono text-foreground/60">{Number(tokenUsage.total_output).toLocaleString()}</span>
              </span>
              <span className="text-muted-foreground/50">
                API Calls: <span className="font-mono text-foreground/60">{Number(tokenUsage.total_txns).toLocaleString()}</span>
              </span>
              {Number(tokenUsage.total_txns) > 0 && onChain?.protocolFees > 0 && (
                <span className="text-muted-foreground/50">
                  Avg Fee/Call: <span className="font-mono text-foreground/60">${(onChain.protocolFees / Number(tokenUsage.total_txns)).toFixed(4)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {transactionBreakdown && transactionBreakdown.length > 0 && (
          <div className="border-t border-border/20">
            <div className="px-4 py-2">
              <span className="text-[10px] text-muted-foreground/50">By Type</span>
            </div>
            <div className="divide-y divide-border/10">
              {transactionBreakdown.map((t: any) => (
                <div key={t.type} className="px-4 py-1.5 flex items-center gap-3 text-[11px]" data-testid={`cost-row-${t.type}`}>
                  <span className="text-foreground/70 w-32">{TYPE_LABELS[t.type] || t.type}</span>
                  <span className="font-mono text-muted-foreground/60 w-16 text-right">{t.count} calls</span>
                  <span className="font-mono text-muted-foreground/60 w-24 text-right">
                    {Number(t.total_input_tokens).toLocaleString()} in
                  </span>
                  <span className="font-mono text-muted-foreground/60 w-24 text-right">
                    {Number(t.total_output_tokens).toLocaleString()} out
                  </span>
                  <span className="font-mono text-amber-400/70 w-20 text-right">
                    ${Number(t.logged_cost).toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="cost-trend-panel">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-foreground/60" />
          <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Cost Trend</h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setTrendView("daily")}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${trendView === "daily" ? "bg-accent text-foreground/80" : "text-muted-foreground/50 hover:text-foreground/60"}`}
              data-testid="button-trend-daily"
            >
              <Calendar className="w-3 h-3 inline mr-1" />Daily
            </button>
            <button
              onClick={() => setTrendView("weekly")}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${trendView === "weekly" ? "bg-accent text-foreground/80" : "text-muted-foreground/50 hover:text-foreground/60"}`}
              data-testid="button-trend-weekly"
            >
              <Clock className="w-3 h-3 inline mr-1" />Weekly
            </button>
          </div>
        </div>
        <div className="p-4">
          {trendData.items.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 italic">No cost data for this period.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground/40 mb-2">
                <span className="w-16 text-right">Date</span>
                <span className="flex-1">API Cost</span>
                <span className="w-16 text-right">Cost</span>
                <span className="w-12 text-right">Calls</span>
              </div>
              <CostTrendBar
                items={trendData.items}
                maxValue={trendData.max}
                valueKey={trendData.costKey}
                formatLabel={(item: any) => {
                  const dateStr = trendView === "daily" ? item.day : item.week_start;
                  try { return format(new Date(dateStr), trendView === "daily" ? "MMM d" : "MMM d"); }
                  catch { return String(dateStr).slice(5, 10); }
                }}
              />
            </>
          )}
        </div>
      </div>

      <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="session-breakdown-panel">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5 text-foreground/60" />
          <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Per-Session Cost Breakdown</h2>
          <span className="text-[10px] text-muted-foreground/40 ml-1">
            {(sessionBreakdown || []).length} sessions
          </span>
        </div>
        <div className="overflow-x-auto">
          {(!sessionBreakdown || sessionBreakdown.length === 0) ? (
            <p className="p-4 text-xs text-muted-foreground/50 italic">No session data yet.</p>
          ) : (
            <>
              <table className="w-full text-[11px]" data-testid="table-session-costs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground/50">
                    <th className="text-left px-4 py-2 font-medium">Type</th>
                    <th className="text-left px-4 py-2 font-medium">Description</th>
                    <th className="text-left px-4 py-2 font-medium">User</th>
                    <th className="text-right px-4 py-2 font-medium">Input</th>
                    <th className="text-right px-4 py-2 font-medium">Output</th>
                    <th className="text-right px-4 py-2 font-medium">API Cost</th>
                    <th className="text-right px-4 py-2 font-medium">Charged</th>
                    <th className="text-right px-4 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionsToShow.map((s: any) => (
                    <tr key={s.id} className="border-b border-border/20 hover:bg-accent/30 transition-colors" data-testid={`session-row-${s.id}`}>
                      <td className="px-4 py-1.5">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-accent/40 text-foreground/70">
                          {TYPE_LABELS[s.type] || s.type}
                        </span>
                      </td>
                      <td className="px-4 py-1.5 text-foreground/70 max-w-[200px] truncate" title={s.description}>
                        {s.company_name || s.description?.slice(0, 50) || "—"}
                      </td>
                      <td className="px-4 py-1.5 text-muted-foreground/60">{s.username || "—"}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-muted-foreground/60">
                        {Number(s.input_tokens).toLocaleString()}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-muted-foreground/60">
                        {Number(s.output_tokens).toLocaleString()}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-amber-400/70">
                        ${Number(s.api_cost || 0).toFixed(4)}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-foreground/70">
                        ${Number(s.amount || 0).toFixed(4)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-muted-foreground/50">
                        {s.created_at ? format(new Date(s.created_at), "MMM d, h:mm a") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(sessionBreakdown || []).length > 10 && (
                <div className="px-4 py-2 border-t border-border/20">
                  <button
                    onClick={() => setSessionExpanded(!sessionExpanded)}
                    className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
                    data-testid="button-toggle-sessions"
                  >
                    {sessionExpanded ? "Show less" : `Show all ${sessionBreakdown.length} sessions`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CostBasisBadge({ basis }: { basis: string | null }) {
  if (basis === "receipt") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400" data-testid="badge-receipt">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Receipt
      </span>
    );
  }
  if (basis === "voucher_estimate") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400" data-testid="badge-voucher">
        <AlertTriangle className="w-2.5 h-2.5" />
        Voucher
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground/50" data-testid="badge-unknown">
      <HelpCircle className="w-2.5 h-2.5" />
      Unknown
    </span>
  );
}

function ReconciliationPanel() {
  const queryClient = useQueryClient();
  const [showTransactions, setShowTransactions] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/reconciliation"],
    refetchInterval: false,
  });

  const flagMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/reconciliation/flag", { action: "flag_legacy" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reconciliation"] });
    },
  });

  if (isLoading) {
    return (
      <div className="rounded border border-border/40 bg-card/30 p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground/60 ml-2">Loading reconciliation...</span>
      </div>
    );
  }

  if (!data) return null;

  const { summary, onChain, discrepancy, discrepancyPct, byType, recentTransactions } = data;
  const discrepancyColor = Math.abs(discrepancyPct) < 5 ? "text-green-400" : Math.abs(discrepancyPct) < 20 ? "text-yellow-400" : "text-red-400";
  const totalBasisKnown = summary.receiptCount + summary.voucherCount;
  const basisCoverage = summary.totalTransactions > 0 ? ((totalBasisKnown / summary.totalTransactions) * 100) : 0;

  return (
    <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="reconciliation-panel">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Scale className="w-3.5 h-3.5 text-foreground/60" />
        <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Cost Reconciliation</h2>
        <span className="text-[10px] text-muted-foreground/40">Logged vs On-Chain</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
            data-testid="button-refresh-reconciliation"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      <div className="p-4 grid grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Logged API Cost</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-logged-cost">
            ${summary.totalLoggedCost.toFixed(4)}
          </p>
          <p className="text-[9px] text-muted-foreground/40">{summary.totalTransactions} transactions</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">On-Chain Net Cost</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-onchain-cost">
            ${onChain.netCost.toFixed(4)}
          </p>
          <p className="text-[9px] text-muted-foreground/40">funded - balance</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Discrepancy</p>
          <p className={`text-sm font-mono font-semibold ${discrepancyColor}`} data-testid="text-discrepancy">
            {discrepancy >= 0 ? "+" : ""}${discrepancy.toFixed(4)}
          </p>
          <p className={`text-[9px] ${discrepancyColor}`}>
            {discrepancyPct >= 0 ? "+" : ""}{discrepancyPct.toFixed(1)}% {Math.abs(discrepancyPct) < 5 ? "✓" : Math.abs(discrepancyPct) < 20 ? "⚠" : "✗"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-0.5">Basis Coverage</p>
          <p className="text-sm font-mono font-semibold text-foreground/80" data-testid="text-basis-coverage">
            {basisCoverage.toFixed(0)}%
          </p>
          <p className="text-[9px] text-muted-foreground/40">{totalBasisKnown} of {summary.totalTransactions} tracked</p>
        </div>
      </div>

      <div className="px-4 pb-3 border-t border-border/20 pt-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400"></span>
            <span className="text-[10px] text-muted-foreground/60">
              Receipt: <span className="font-mono text-foreground/70">{summary.receiptCount}</span>
              <span className="text-muted-foreground/40 ml-1">(${summary.receiptCost.toFixed(4)})</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-yellow-400"></span>
            <span className="text-[10px] text-muted-foreground/60">
              Voucher: <span className="font-mono text-foreground/70">{summary.voucherCount}</span>
              <span className="text-muted-foreground/40 ml-1">(${summary.voucherCost.toFixed(4)})</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"></span>
            <span className="text-[10px] text-muted-foreground/60">
              Unknown: <span className="font-mono text-foreground/70">{summary.unknownCount}</span>
              <span className="text-muted-foreground/40 ml-1">(${summary.unknownCost.toFixed(4)})</span>
            </span>
          </div>
        </div>

        {summary.unknownCount > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => flagMutation.mutate()}
              disabled={flagMutation.isPending}
              className="text-[10px] px-2.5 py-1 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
              data-testid="button-flag-legacy"
            >
              {flagMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Flag className="w-3 h-3" />}
              Flag {summary.unknownCount} Legacy as Voucher Estimates
            </button>
            {flagMutation.isSuccess && (
              <span className="text-[10px] text-green-400">Flagged successfully</span>
            )}
          </div>
        )}
      </div>

      {byType && byType.length > 0 && (
        <div className="border-t border-border/20">
          <div className="px-4 py-2">
            <span className="text-[10px] text-muted-foreground/50">Reconciliation by Type</span>
          </div>
          <div className="divide-y divide-border/10">
            {byType.map((t: any) => (
              <div key={t.type} className="px-4 py-1.5 flex items-center gap-3 text-[11px]" data-testid={`recon-row-${t.type}`}>
                <span className="text-foreground/70 w-28">{t.type}</span>
                <span className="font-mono text-muted-foreground/60 w-16 text-right">{t.count} txns</span>
                <span className="font-mono text-muted-foreground/60 w-24 text-right">${Number(t.logged_cost).toFixed(4)}</span>
                <div className="flex items-center gap-1.5 ml-auto">
                  {Number(t.receipt_count) > 0 && (
                    <span className="text-[9px] text-green-400 font-mono">{t.receipt_count}✓</span>
                  )}
                  {Number(t.voucher_count) > 0 && (
                    <span className="text-[9px] text-yellow-400 font-mono">{t.voucher_count}⚠</span>
                  )}
                  {Number(t.unknown_count) > 0 && (
                    <span className="text-[9px] text-muted-foreground/40 font-mono">{t.unknown_count}?</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-border/20">
        <button
          onClick={() => setShowTransactions(!showTransactions)}
          className="w-full px-4 py-2 text-left text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
          data-testid="button-toggle-transactions"
        >
          {showTransactions ? "▼" : "▶"} Recent Transactions ({recentTransactions?.length || 0})
        </button>

        {showTransactions && recentTransactions && recentTransactions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]" data-testid="table-reconciliation-transactions">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground/50">
                  <th className="text-left px-4 py-1.5 font-medium">Type</th>
                  <th className="text-left px-4 py-1.5 font-medium">Description</th>
                  <th className="text-right px-4 py-1.5 font-medium">API Cost</th>
                  <th className="text-right px-4 py-1.5 font-medium">Charged</th>
                  <th className="text-center px-4 py-1.5 font-medium">Basis</th>
                  <th className="text-right px-4 py-1.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx: any) => (
                  <tr key={tx.id} className="border-b border-border/10 hover:bg-accent/20 transition-colors" data-testid={`tx-row-${tx.id}`}>
                    <td className="px-4 py-1.5 text-foreground/70">{tx.type}</td>
                    <td className="px-4 py-1.5 text-muted-foreground/60 max-w-[200px] truncate">{tx.description}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-foreground/70">
                      ${Number(tx.api_cost || 0).toFixed(4)}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono text-foreground/70">
                      ${Number(tx.amount || 0).toFixed(4)}
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      <CostBasisBadge basis={tx.cost_basis} />
                    </td>
                    <td className="px-4 py-1.5 text-right text-muted-foreground/50">
                      {tx.created_at ? format(new Date(tx.created_at), "MMM d, h:mm a") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DataSourceBrainPanel() {
  const { data, isLoading, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/data-source-brain/stats"],
    refetchInterval: false,
  });

  const reseed = async () => {
    await fetch("/api/admin/data-source-brain/reseed", { method: "POST", credentials: "include" });
    refetch();
  };

  if (isLoading) {
    return (
      <div className="rounded border border-border/40 bg-card/30 p-6 flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground/60 ml-2">Loading brain stats...</span>
      </div>
    );
  }

  if (!data) return null;

  const sources = Object.entries(data.bySource || {}) as [string, number][];
  const categories = Object.entries(data.byCategory || {}) as [string, number][];
  const confidences = Object.entries(data.byConfidence || {}) as [string, number][];
  const confidenceColor: Record<string, string> = {
    verified_doc: "text-emerald-400",
    verified_runtime: "text-cyan-400",
    observed_once: "text-amber-400",
    inferred: "text-muted-foreground/70",
    unverified: "text-muted-foreground/60",
  };

  return (
    <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="data-source-brain-panel">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-cyan-400" />
        <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Data-Source Brain</h2>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/40" data-testid="text-brain-total">{data.total} facts</span>
          <button
            onClick={reseed}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
            data-testid="button-reseed-brain"
          >
            Reseed
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
            data-testid="button-refresh-brain"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-1.5 uppercase tracking-wide">By Source</p>
            <div className="space-y-1">
              {sources.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 italic">No facts yet</p>
              ) : sources.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]" data-testid={`brain-source-${k}`}>
                  <span className="text-foreground/70">{k}</span>
                  <span className="font-mono text-foreground/60">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-1.5 uppercase tracking-wide">By Category</p>
            <div className="space-y-1">
              {categories.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 italic">—</p>
              ) : categories.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]" data-testid={`brain-cat-${k}`}>
                  <span className="text-foreground/70">{k}</span>
                  <span className="font-mono text-foreground/60">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground/50 mb-1.5 uppercase tracking-wide">By Confidence</p>
            <div className="space-y-1">
              {confidences.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/40 italic">—</p>
              ) : confidences.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-[11px]" data-testid={`brain-conf-${k}`}>
                  <span className={confidenceColor[k] || "text-foreground/70"}>{k}</span>
                  <span className="font-mono text-foreground/60">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <p className="text-[10px] text-muted-foreground/50 mb-1.5 uppercase tracking-wide">Most-Recent Observations</p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {(data.recent || []).length === 0 ? (
              <p className="text-[11px] text-muted-foreground/40 italic">No observations yet</p>
            ) : (data.recent as any[]).map((f) => (
              <div key={f.id} className="text-[11px] border-l-2 border-border/40 pl-2 py-0.5" data-testid={`brain-fact-${f.id}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-cyan-400/80 font-mono text-[10px]">{f.source}</span>
                  <span className="text-muted-foreground/40 font-mono text-[10px]">{f.scopeRef}</span>
                  <span className={`${confidenceColor[f.confidence] || "text-foreground/60"} text-[10px]`}>{f.confidence}</span>
                  <span className="ml-auto text-muted-foreground/40 text-[10px] font-mono">×{f.observedCount}</span>
                </div>
                <p className="text-foreground/70 leading-snug">{f.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SystemLearning {
  id: string;
  scope: string;
  scopeKey: string;
  ruleType: string;
  ruleText: string;
  confidence: number;
  source: string;
  triggeredBy: string | null;
  appliedCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function SystemLearningsPanel() {
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterScope, setFilterScope] = useState<string>("all");
  const [searchQ, setSearchQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<SystemLearning>>({});
  const [showNewForm, setShowNewForm] = useState(false);
  const [newDraft, setNewDraft] = useState<Partial<SystemLearning>>({
    scope: "global",
    scopeKey: "global",
    ruleType: "synthesis_discipline",
    ruleText: "",
  });

  const queryKey = showInactive
    ? ["/api/admin/learnings", { includeInactive: true }]
    : ["/api/admin/learnings"];

  const { data: rules = [], isLoading, refetch, isFetching } = useQuery<SystemLearning[]>({
    queryKey,
    queryFn: async () => {
      const url = showInactive
        ? "/api/admin/learnings?includeInactive=true"
        : "/api/admin/learnings";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    refetchInterval: false,
  });

  const createMutation = useMutation({
    mutationFn: async (draft: Partial<SystemLearning>) => {
      const res = await apiRequest("POST", "/api/admin/learnings", draft);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/learnings"] });
      setShowNewForm(false);
      setNewDraft({ scope: "global", scopeKey: "global", ruleType: "synthesis_discipline", ruleText: "" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SystemLearning> }) => {
      const res = await apiRequest("PATCH", `/api/admin/learnings/${id}`, patch);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/learnings"] });
      setEditingId(null);
      setEditDraft({});
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/learnings/${id}`);
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/learnings"] }),
  });

  const types = useMemo(() => Array.from(new Set(rules.map(r => r.ruleType))).sort(), [rules]);
  const scopes = useMemo(() => Array.from(new Set(rules.map(r => r.scope))).sort(), [rules]);

  const filtered = useMemo(() => {
    const needle = searchQ.trim().toLowerCase();
    return rules.filter(r => {
      if (filterType !== "all" && r.ruleType !== filterType) return false;
      if (filterScope !== "all" && r.scope !== filterScope) return false;
      if (needle && ![r.scopeKey, r.ruleText, r.ruleType, r.source, r.triggeredBy || ""].some(s => s.toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [rules, filterType, filterScope, searchQ]);

  const startEdit = (r: SystemLearning) => {
    setEditingId(r.id);
    setEditDraft({ ruleText: r.ruleText, confidence: r.confidence, scopeKey: r.scopeKey, scope: r.scope, ruleType: r.ruleType });
  };

  const saveEdit = () => {
    if (!editingId) return;
    patchMutation.mutate({ id: editingId, patch: editDraft });
  };

  const toggleActive = (r: SystemLearning) => {
    patchMutation.mutate({ id: r.id, patch: { isActive: !r.isActive } });
  };

  const sourceColor: Record<string, string> = {
    benchmark: "text-emerald-400/80",
    manual: "text-cyan-400/80",
    user_feedback: "text-amber-400/80",
    auto: "text-muted-foreground/60",
  };

  const typeColor: Record<string, string> = {
    synthesis_discipline: "text-purple-400/80",
    routing_override: "text-blue-400/80",
    sql_pattern: "text-cyan-400/80",
    slug_hint: "text-emerald-400/80",
    table_warning: "text-amber-400/80",
    data_caveat: "text-rose-400/80",
  };

  return (
    <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="system-learnings-panel">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <BookOpen className="w-3.5 h-3.5 text-purple-400" />
        <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">System Learnings</h2>
        <span className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/40" data-testid="text-learnings-total">
            {filtered.length}{filtered.length !== rules.length ? ` / ${rules.length}` : ""} rules
          </span>
          <button
            onClick={() => setShowNewForm(!showNewForm)}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
            data-testid="button-new-rule"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className={`text-[10px] transition-colors ${showInactive ? "text-amber-400/80" : "text-muted-foreground/60 hover:text-foreground/70"}`}
            data-testid="button-toggle-inactive"
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/70 transition-colors flex items-center gap-1"
            data-testid="button-refresh-learnings"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>

      <div className="px-4 py-2 border-b border-border/20 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          placeholder="Search rules…"
          className="text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded flex-1 min-w-[150px] text-foreground/80 focus:outline-none focus:border-border/60"
          data-testid="input-search-learnings"
        />
        <select
          value={filterScope}
          onChange={e => setFilterScope(e.target.value)}
          className="text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/70 focus:outline-none"
          data-testid="select-filter-scope"
        >
          <option value="all">All scopes</option>
          {scopes.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/70 focus:outline-none"
          data-testid="select-filter-type"
        >
          <option value="all">All types</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {showNewForm && (
        <div className="px-4 py-3 border-b border-border/20 bg-background/20 space-y-2" data-testid="new-rule-form">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">Scope</label>
              <select
                value={newDraft.scope}
                onChange={e => setNewDraft({ ...newDraft, scope: e.target.value })}
                className="w-full text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/80 mt-0.5"
              >
                <option value="global">global</option>
                <option value="protocol">protocol</option>
                <option value="metric">metric</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">Scope Key</label>
              <input
                type="text"
                value={newDraft.scopeKey || ""}
                onChange={e => setNewDraft({ ...newDraft, scopeKey: e.target.value })}
                className="w-full text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/80 mt-0.5"
                placeholder="e.g. hyperliquid, peer_comparison"
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">Rule Type</label>
              <input
                type="text"
                value={newDraft.ruleType || ""}
                onChange={e => setNewDraft({ ...newDraft, ruleType: e.target.value })}
                className="w-full text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/80 mt-0.5"
                placeholder="synthesis_discipline, routing_override, …"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground/50 uppercase tracking-wide">Rule Text</label>
            <textarea
              value={newDraft.ruleText || ""}
              onChange={e => setNewDraft({ ...newDraft, ruleText: e.target.value })}
              rows={3}
              className="w-full text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/80 mt-0.5 font-mono leading-relaxed"
              placeholder="Instruction for future queries (max 200-500 chars ideal)"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setShowNewForm(false)}
              className="text-[11px] px-2.5 py-1 text-muted-foreground/70 hover:text-foreground/80"
            >
              Cancel
            </button>
            <button
              onClick={() => createMutation.mutate(newDraft)}
              disabled={!newDraft.ruleText || !newDraft.ruleType || !newDraft.scopeKey || createMutation.isPending}
              className="text-[11px] px-2.5 py-1 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40 rounded border border-purple-500/30"
              data-testid="button-save-new-rule"
            >
              {createMutation.isPending ? "Saving…" : "Save rule"}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {isLoading ? (
          <div className="p-6 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-[11px] text-muted-foreground/40 italic text-center">
            {rules.length === 0 ? "No rules yet." : "No rules match your filters."}
          </p>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map(r => {
              const isEditing = editingId === r.id;
              return (
                <div
                  key={r.id}
                  className={`px-4 py-2.5 text-[11px] ${!r.isActive ? "opacity-50" : ""}`}
                  data-testid={`row-learning-${r.id}`}
                >
                  <div className="flex items-start gap-2 mb-1">
                    <span className={`font-mono text-[10px] shrink-0 ${typeColor[r.ruleType] || "text-muted-foreground/60"}`}>
                      {r.ruleType}
                    </span>
                    <span className="text-muted-foreground/40 font-mono text-[10px] shrink-0">
                      [{r.scope}/{r.scopeKey}]
                    </span>
                    <span className={`text-[10px] shrink-0 ${sourceColor[r.source] || "text-muted-foreground/60"}`}>
                      {r.source}
                    </span>
                    <span className="text-muted-foreground/40 font-mono text-[10px] shrink-0" title="Applied count">
                      ×{r.appliedCount}
                    </span>
                    <span className="text-muted-foreground/40 font-mono text-[10px] shrink-0" title="Confidence">
                      {r.confidence}%
                    </span>
                    {!r.isActive && (
                      <span className="text-[10px] text-amber-400/70 shrink-0">inactive</span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            disabled={patchMutation.isPending}
                            className="text-emerald-400/70 hover:text-emerald-400 transition-colors"
                            title="Save"
                            data-testid={`button-save-edit-${r.id}`}
                          >
                            <Save className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditDraft({}); }}
                            className="text-muted-foreground/60 hover:text-foreground/80"
                            title="Cancel"
                          >
                            <XCircle className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(r)}
                            className="text-muted-foreground/50 hover:text-foreground/80 transition-colors"
                            title="Edit"
                            data-testid={`button-edit-${r.id}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => toggleActive(r)}
                            disabled={patchMutation.isPending}
                            className={`transition-colors ${r.isActive ? "text-muted-foreground/50 hover:text-rose-400/80" : "text-amber-400/70 hover:text-emerald-400/80"}`}
                            title={r.isActive ? "Deactivate" : "Reactivate"}
                            data-testid={`button-toggle-active-${r.id}`}
                          >
                            <Power className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="space-y-1.5">
                      <textarea
                        value={editDraft.ruleText || ""}
                        onChange={e => setEditDraft({ ...editDraft, ruleText: e.target.value })}
                        rows={3}
                        className="w-full text-[11px] px-2 py-1 bg-background/40 border border-border/40 rounded text-foreground/80 font-mono leading-relaxed"
                        data-testid={`input-edit-rule-text-${r.id}`}
                      />
                      <div className="grid grid-cols-4 gap-1.5">
                        <input
                          value={editDraft.scope || ""}
                          onChange={e => setEditDraft({ ...editDraft, scope: e.target.value })}
                          placeholder="scope"
                          className="text-[10px] px-1.5 py-0.5 bg-background/40 border border-border/40 rounded text-foreground/70"
                        />
                        <input
                          value={editDraft.scopeKey || ""}
                          onChange={e => setEditDraft({ ...editDraft, scopeKey: e.target.value })}
                          placeholder="scopeKey"
                          className="text-[10px] px-1.5 py-0.5 bg-background/40 border border-border/40 rounded text-foreground/70"
                        />
                        <input
                          value={editDraft.ruleType || ""}
                          onChange={e => setEditDraft({ ...editDraft, ruleType: e.target.value })}
                          placeholder="ruleType"
                          className="text-[10px] px-1.5 py-0.5 bg-background/40 border border-border/40 rounded text-foreground/70"
                        />
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={editDraft.confidence ?? 0}
                          onChange={e => setEditDraft({ ...editDraft, confidence: Number(e.target.value) })}
                          placeholder="confidence"
                          className="text-[10px] px-1.5 py-0.5 bg-background/40 border border-border/40 rounded text-foreground/70"
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-foreground/75 leading-relaxed whitespace-pre-wrap" data-testid={`text-rule-${r.id}`}>
                      {r.ruleText}
                    </p>
                  )}

                  {r.triggeredBy && !isEditing && (
                    <p className="text-[9px] text-muted-foreground/40 mt-1 font-mono">
                      triggered by: {r.triggeredBy}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { data, isLoading, isError, error } = useQuery<any>({
    queryKey: ["/api/admin/analytics"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    const msg = (error as any)?.message || "";
    const isForbidden = msg.startsWith("403:");
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-6">
        <div className="text-center max-w-md">
          <div className="font-semibold mb-2">{isForbidden ? "Admin access required." : "Failed to load analytics"}</div>
          {!isForbidden && <div className="text-xs font-mono break-all opacity-70">{msg || "Unknown error"}</div>}
        </div>
      </div>
    );
  }

  const { users, transactions, transactionsByType, companies, reports, eventCounts, recentEvents, userList, mppChannel } = data;

  return (
    <div className="h-full overflow-y-auto" data-testid="admin-page">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold text-foreground/90 tracking-tight" data-testid="text-admin-title">Analytics</h1>
          <p className="text-xs text-muted-foreground/60 mt-0.5">Usage tracking and platform metrics</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Users" value={users?.total_users || 0} icon={Users} sub={users?.first_signup ? `Since ${format(new Date(users.first_signup), "MMM d, yyyy")}` : undefined} />
          <StatCard label="Companies" value={companies?.total_companies || 0} icon={Building2} sub={`${companies?.users_with_companies || 0} users with deals`} />
          <StatCard label="Revenue" value={`$${Number(transactions?.total_revenue || 0).toFixed(2)}`} icon={DollarSign} sub={`${transactions?.paying_users || 0} paying users`} />
          <StatCard label="Transactions" value={transactions?.total_transactions || 0} icon={TrendingUp} sub={`Avg $${Number(transactions?.avg_transaction || 0).toFixed(3)}`} />
        </div>

        <WalletPanel />

        <CostAlertSettingsPanel />

        <CostReportPanel />

        <DataSourceBrainPanel />

        <SystemLearningsPanel />

        <ReconciliationPanel />

        {mppChannel && (
          <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="mpp-channel-card">
            <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-green-500" />
              <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">MPP Session (Anthropic)</h2>
              <span className="ml-auto text-[10px] text-green-500/80 font-medium">Active</span>
            </div>
            <div className="p-4 grid grid-cols-4 gap-4">
              <div>
                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Deposit</p>
                <p className="text-sm font-mono font-semibold text-foreground/80">${mppChannel.deposit}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Actual Spent</p>
                <p className="text-sm font-mono font-semibold text-foreground/80">${Number(mppChannel.totalSpent).toFixed(4)}</p>
                <p className="text-[9px] text-muted-foreground/40">
                  Voucher: ${Number(mppChannel.totalVoucherAuthorized || mppChannel.totalSpent).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Requests</p>
                <p className="text-sm font-mono font-semibold text-foreground/80">{mppChannel.requestCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Uptime</p>
                <p className="text-sm font-mono font-semibold text-foreground/80">
                  {mppChannel.uptime > 3600
                    ? `${Math.floor(mppChannel.uptime / 3600)}h ${Math.floor((mppChannel.uptime % 3600) / 60)}m`
                    : mppChannel.uptime > 60
                      ? `${Math.floor(mppChannel.uptime / 60)}m`
                      : `${mppChannel.uptime}s`}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded border border-border/40 bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30">
              <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Event Summary</h2>
            </div>
            <div className="p-4">
              {(!eventCounts || eventCounts.length === 0) ? (
                <p className="text-xs text-muted-foreground/50 italic">No events tracked yet. Events will appear as users interact with the platform.</p>
              ) : (
                <div className="space-y-2">
                  {eventCounts.map((e: any) => (
                    <div key={e.event} className="flex items-center justify-between" data-testid={`event-row-${e.event}`}>
                      <span className="text-xs text-foreground/70">{EVENT_LABELS[e.event] || e.event}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground/50">{e.unique_users} user{Number(e.unique_users) !== 1 ? "s" : ""}</span>
                        <span className="text-xs font-mono font-medium text-foreground/80">{e.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded border border-border/40 bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/30">
              <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Transaction Breakdown</h2>
            </div>
            <div className="p-4">
              {(!transactionsByType || transactionsByType.length === 0) ? (
                <p className="text-xs text-muted-foreground/50 italic">No transactions yet.</p>
              ) : (
                <div className="space-y-2">
                  {transactionsByType.map((t: any) => (
                    <div key={t.type} className="flex items-center justify-between">
                      <span className="text-xs text-foreground/70">{t.type}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground/50">${Number(t.revenue || 0).toFixed(2)} rev</span>
                        <span className="text-xs font-mono font-medium text-foreground/80">{t.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="rounded border border-border/40 bg-card/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Users</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="table-users">
              <thead>
                <tr className="border-b border-border/30 text-muted-foreground/60">
                  <th className="text-left px-4 py-2 font-medium">Username</th>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Wallet</th>
                  <th className="text-right px-4 py-2 font-medium">Credits</th>
                  <th className="text-right px-4 py-2 font-medium">Companies</th>
                  <th className="text-right px-4 py-2 font-medium">Events</th>
                  <th className="text-right px-4 py-2 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {(userList || []).map((u: any) => (
                  <tr key={u.id} className="border-b border-border/20 hover:bg-accent/30 transition-colors" data-testid={`user-row-${u.id}`}>
                    <td className="px-4 py-2 text-foreground/80 font-medium">{u.username}</td>
                    <td className="px-4 py-2 text-muted-foreground/60">{u.email || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground/60 font-mono">{u.wallet_address ? `${u.wallet_address.slice(0, 6)}...${u.wallet_address.slice(-4)}` : "—"}</td>
                    <td className="px-4 py-2 text-right text-foreground/70 font-mono">{u.credits}</td>
                    <td className="px-4 py-2 text-right text-foreground/70 font-mono">{u.company_count}</td>
                    <td className="px-4 py-2 text-right text-foreground/70 font-mono">{u.event_count}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground/50">{u.created_at ? format(new Date(u.created_at), "MMM d") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded border border-border/40 bg-card/30 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/30">
            <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">Recent Activity</h2>
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {(!recentEvents || recentEvents.length === 0) ? (
              <p className="p-4 text-xs text-muted-foreground/50 italic">No activity yet.</p>
            ) : (
              <div className="divide-y divide-border/20">
                {recentEvents.map((e: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/30 transition-colors" data-testid={`activity-row-${i}`}>
                    <Activity className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-foreground/70 font-medium">{EVENT_LABELS[e.event] || e.event}</span>
                      {e.metadata && (
                        <span className="text-[10px] text-muted-foreground/40 ml-2">
                          {e.metadata.companyName || e.metadata.input?.slice(0, 40) || e.metadata.page || ""}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 shrink-0">{e.username || "unknown"}</span>
                    <span className="text-[10px] text-muted-foreground/40 shrink-0">{e.created_at ? format(new Date(e.created_at), "MMM d, h:mm a") : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
