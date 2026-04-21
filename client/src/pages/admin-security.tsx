import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Shield, Play, Loader2, ChevronRight, Trash2, AlertTriangle, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import type { SecurityAuditRun, SecurityAuditFinding } from "@shared/schema";
import { ADMIN_EMAILS, ADMIN_USERNAMES } from "@shared/constants";

const PHASES: Array<{ key: string; label: string; desc: string }> = [
  { key: "recon", label: "Reconnaissance", desc: "Map exposed tools and endpoints" },
  { key: "prompt_extraction", label: "Prompt Extraction", desc: "Try to leak the system prompt" },
  { key: "data_exfil", label: "Data Exfiltration", desc: "Drain knowledge base / secrets" },
  { key: "cross_tenant", label: "Cross-Tenant", desc: "Probe user isolation" },
  { key: "output_analysis", label: "Output Filtering", desc: "Check tool-call / scratchpad leakage" },
];

const VERDICT_STYLE: Record<string, { color: string; icon: any; label: string }> = {
  PASS: { color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10", icon: CheckCircle2, label: "PASS" },
  PARTIAL: { color: "text-amber-400 border-amber-400/30 bg-amber-400/10", icon: AlertCircle, label: "PARTIAL" },
  FAIL: { color: "text-red-400 border-red-400/30 bg-red-400/10", icon: XCircle, label: "FAIL" },
  ERROR: { color: "text-muted-foreground border-border bg-muted/20", icon: AlertTriangle, label: "ERROR" },
};

const SEV_STYLE: Record<string, string> = {
  critical: "text-red-400 border-red-400/40",
  high: "text-orange-400 border-orange-400/40",
  medium: "text-amber-400 border-amber-400/40",
  low: "text-muted-foreground border-border",
};

export default function AdminSecurity() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isAdmin = !!(user && ((ADMIN_EMAILS as readonly string[]).includes(user.email || "") || (ADMIN_USERNAMES as readonly string[]).includes(user.username || "")));
  const [budget, setBudget] = useState("5");
  const [enabledPhases, setEnabledPhases] = useState<string[]>(PHASES.map((p) => p.key));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runsQuery = useQuery<SecurityAuditRun[]>({
    queryKey: ["/api/admin/audits"],
    enabled: !!user && isAdmin,
    refetchInterval: 4000,
  });

  const detailQuery = useQuery<{ run: SecurityAuditRun; findings: SecurityAuditFinding[] }>({
    queryKey: ["/api/admin/audits", selectedRunId],
    enabled: !!selectedRunId,
    refetchInterval: (q) => {
      const status = (q.state.data as any)?.run?.status;
      return status === "running" ? 3000 : false;
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/audits", {
        budgetUsd: Number(budget),
        phases: enabledPhases,
      });
      return res.json();
    },
    onSuccess: (data: { runId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audits"] });
      setSelectedRunId(data.runId);
      toast({ title: "Audit started", description: `Budget cap: $${budget}` });
    },
    onError: (e: any) => toast({ title: "Could not start audit", description: e?.message || "Try again", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/audits/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/audits"] });
      if (selectedRunId) setSelectedRunId(null);
    },
  });

  const togglePhase = (key: string) => {
    setEnabledPhases((curr) => curr.includes(key) ? curr.filter((p) => p !== key) : [...curr, key]);
  };

  if (user && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="empty-not-admin">
        <div className="text-center max-w-sm">
          <Shield className="h-10 w-10 text-amber-400/50 mx-auto mb-3" />
          <div className="text-sm font-semibold mb-1">Admin access required</div>
          <div className="text-xs text-muted-foreground">This page is restricted to platform administrators.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="page-admin-security">
      {/* Left: configure + history */}
      <div className="w-[380px] border-r border-border/30 flex flex-col">
        <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold">Security Audit</span>
          <Badge variant="outline" className="text-[9px] ml-auto border-amber-400/40 text-amber-400">ADMIN</Badge>
        </div>

        <div className="p-4 border-b border-border/30 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Budget cap (USD)</label>
            <Input
              type="number"
              min="0.5"
              max="50"
              step="0.5"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="h-8 text-xs"
              data-testid="input-budget"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Run halts when MPP spend hits this cap.</p>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 block">Phases</label>
            <div className="space-y-1.5">
              {PHASES.map((p) => (
                <div key={p.key} className="flex items-start gap-2" data-testid={`phase-${p.key}`}>
                  <Checkbox
                    id={`ph-${p.key}`}
                    checked={enabledPhases.includes(p.key)}
                    onCheckedChange={() => togglePhase(p.key)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`ph-${p.key}`} className="text-xs cursor-pointer flex-1">
                    <div className="font-medium">{p.label}</div>
                    <div className="text-[10px] text-muted-foreground">{p.desc}</div>
                  </label>
                </div>
              ))}
            </div>
          </div>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || enabledPhases.length === 0}
            className="w-full h-8 bg-amber-500 hover:bg-amber-400 text-black"
            data-testid="button-start-audit"
          >
            {startMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            Run audit
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">History</div>
          {runsQuery.isLoading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">Loading...</div>
          )}
          {(runsQuery.data || []).length === 0 && !runsQuery.isLoading && (
            <div className="px-4 py-3 text-xs text-muted-foreground">No audits yet.</div>
          )}
          {(runsQuery.data || []).map((r) => {
            const summary = (r.summary as any) || {};
            const fails = summary.verdictCounts?.FAIL || 0;
            const partial = summary.verdictCounts?.PARTIAL || 0;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRunId(r.id)}
                className={`w-full text-left px-4 py-2.5 border-b border-border/15 hover:bg-muted/30 transition-colors ${selectedRunId === r.id ? "bg-muted/40" : ""}`}
                data-testid={`run-${r.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium truncate">{format(new Date(r.startedAt), "MMM d, HH:mm")}</span>
                  <Badge variant="outline" className={`text-[9px] ml-auto ${
                    r.status === "running" ? "border-cyan-400/40 text-cyan-400" :
                    r.status === "completed" ? "border-emerald-400/40 text-emerald-400" :
                    r.status === "halted" ? "border-amber-400/40 text-amber-400" :
                    "border-red-400/40 text-red-400"
                  }`}>{r.status}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <span>${Number(r.totalSpentUsd).toFixed(3)} / ${Number(r.budgetUsd).toFixed(2)}</span>
                  {(fails + partial) > 0 && (
                    <span className="text-amber-400">{fails} fail · {partial} partial</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 overflow-y-auto">
        {!selectedRunId && (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground" data-testid="empty-detail">
            Select a run from the left to view findings.
          </div>
        )}
        {selectedRunId && detailQuery.isLoading && (
          <div className="p-8 text-sm text-muted-foreground">Loading findings...</div>
        )}
        {selectedRunId && detailQuery.data && (
          <DetailPanel data={detailQuery.data} onDelete={() => deleteMutation.mutate(selectedRunId)} />
        )}
      </div>
    </div>
  );
}

function DetailPanel({ data, onDelete }: { data: { run: SecurityAuditRun; findings: SecurityAuditFinding[] }; onDelete: () => void }) {
  const { run, findings } = data;
  const summary = (run.summary as any) || {};
  const counts = summary.verdictCounts || {};

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold" data-testid="text-run-title">
            Audit · {format(new Date(run.startedAt), "MMM d, yyyy HH:mm")}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
            <span>Status: <span className={
              run.status === "running" ? "text-cyan-400" :
              run.status === "completed" ? "text-emerald-400" :
              run.status === "halted" ? "text-amber-400" : "text-red-400"
            }>{run.status}</span></span>
            <span>·</span>
            <span>Spent ${Number(run.totalSpentUsd).toFixed(4)} / ${Number(run.budgetUsd).toFixed(2)}</span>
            <span>·</span>
            <span>{findings.length} findings</span>
          </div>
          {run.errorMessage && (
            <div className="text-xs text-red-400 mt-2">Error: {run.errorMessage}</div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDelete} data-testid="button-delete-run">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {(["PASS", "PARTIAL", "FAIL", "ERROR"] as const).map((v) => {
          const Style = VERDICT_STYLE[v];
          return (
            <Card key={v} className={`p-3 border ${Style.color}`} data-testid={`stat-${v}`}>
              <div className="text-[10px] uppercase tracking-wide opacity-80">{Style.label}</div>
              <div className="text-2xl font-bold mt-1">{counts[v] || 0}</div>
            </Card>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Findings</div>
        {findings.length === 0 && (
          <div className="text-xs text-muted-foreground py-4">
            {run.status === "running" ? "Tests in progress..." : "No findings recorded."}
          </div>
        )}
        {findings.map((f) => {
          const VStyle = VERDICT_STYLE[f.verdict] || VERDICT_STYLE.ERROR;
          const Icon = VStyle.icon;
          return (
            <Card key={f.id} className="p-4 border-border/40" data-testid={`finding-${f.id}`}>
              <div className="flex items-start gap-3">
                <Icon className={`h-4 w-4 mt-0.5 ${VStyle.color.split(" ")[0]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{f.testName}</span>
                    <Badge variant="outline" className="text-[9px]">{f.phase}</Badge>
                    <Badge variant="outline" className={`text-[9px] ${SEV_STYLE[f.severity]}`}>{f.severity}</Badge>
                    <Badge variant="outline" className={`text-[9px] ${VStyle.color}`}>{VStyle.label}</Badge>
                    <span className="text-[10px] text-muted-foreground ml-auto">${Number(f.costUsd).toFixed(4)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1.5 italic">{f.scoreReason}</div>
                  <details className="mt-2 group">
                    <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                      <ChevronRight className="h-3 w-3 inline transition-transform group-open:rotate-90" /> prompt + response
                    </summary>
                    <div className="mt-2 space-y-2 pl-4 border-l border-border/30">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Prompt</div>
                        <div className="text-xs whitespace-pre-wrap text-foreground/90">{f.promptText}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Response</div>
                        <div className="text-xs whitespace-pre-wrap text-muted-foreground max-h-64 overflow-y-auto">{f.responseText || "(no response)"}</div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
