import { useQuery } from "@tanstack/react-query";
import { Loader2, Users, Activity, DollarSign, Building2, FileText, TrendingUp, Radio } from "lucide-react";
import { format } from "date-fns";

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

        {mppChannel && (
          <div className="rounded border border-border/40 bg-card/30 overflow-hidden" data-testid="mpp-channel-card">
            <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-green-500" />
              <h2 className="text-[12px] font-medium text-foreground/80 tracking-tight">MPP Channel (Anthropic)</h2>
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
