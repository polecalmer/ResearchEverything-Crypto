import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Users, Activity, DollarSign, Building2, TrendingUp, Radio, Wallet, RefreshCw, XCircle, ArrowDownCircle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";

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

  const withdrawAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/wallet/withdraw-all"),
    onSuccess: async (res) => {
      const data = await res.json();
      setActionResult(`Withdrawn: ${data.withdrawn}${data.errors?.length ? `, Errors: ${data.errors.length}` : ""}`);
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

  const isActing = closeAllMutation.isPending || closeChannelMutation.isPending || withdrawMutation.isPending || withdrawAllMutation.isPending;

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
            <div className="flex items-center gap-1.5">
              {wallet.channels.some((ch: any) => ch.status === "ready_to_finalize") && (
                <button
                  onClick={() => { setActionResult(null); withdrawAllMutation.mutate(); }}
                  disabled={isActing}
                  className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                  data-testid="button-withdraw-all-channels"
                >
                  {withdrawAllMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownCircle className="w-3 h-3" />}
                  Withdraw All
                </button>
              )}
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

export default function AdminPage() {
  const { data, isLoading, isError } = useQuery<any>({
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
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Admin access required.
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
                <p className="text-[10px] text-muted-foreground/50 mb-0.5">Spent</p>
                <p className="text-sm font-mono font-semibold text-foreground/80">${Number(mppChannel.totalSpent).toFixed(4)}</p>
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
