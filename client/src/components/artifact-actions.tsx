import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Send, BookmarkPlus, Loader2, Plus, Database } from "lucide-react";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";

interface Report {
  id: string;
  title: string;
  updatedAt: string;
}

interface Session {
  id: number;
  title: string;
}

export function ArtifactActions({
  chartId,
  chartTitle,
  size = "sm",
}: {
  chartId: string;
  chartTitle?: string;
  size?: "xs" | "sm";
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const reportsQuery = useQuery<Report[]>({
    queryKey: ["/api/research/reports"],
    enabled: !!user && reportsOpen,
  });

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user && sessionsOpen,
  });

  const addToReportMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const auth = await getAuthHeaders();
      const res = await fetch(`/api/research/reports/${reportId}/charts`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ chartId }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (_data, reportId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports", reportId, "charts"] });
      toast({ title: "Saved to report", description: chartTitle || "Chart added." });
    },
    onError: (e: any) => {
      toast({ title: "Could not save", description: e?.message || "Try again", variant: "destructive" });
    },
  });

  const createReportMutation = useMutation({
    mutationFn: async () => {
      const auth = await getAuthHeaders();
      const res = await fetch("/api/research/reports", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: chartTitle ? `Report: ${chartTitle}` : `New Report — ${format(new Date(), "MMM d")}`,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: async (report: Report) => {
      queryClient.invalidateQueries({ queryKey: ["/api/research/reports"] });
      try {
        await addToReportMutation.mutateAsync(report.id);
      } catch {}
    },
  });

  const sendToSession = (sessionId?: number) => {
    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", String(sessionId));
    else params.set("newSession", "1");
    params.set("chart", chartId);
    setLocation(`/research?${params.toString()}`);
  };

  const btnSize = size === "xs" ? "h-6 text-[10px] px-2" : "h-7 text-[11px] px-2.5";

  return (
    <div className="flex items-center gap-1.5" data-testid={`artifact-actions-${chartId}`}>
      <DropdownMenu open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${btnSize} gap-1 text-muted-foreground hover:text-foreground`}
            data-testid={`button-send-to-session-${chartId}`}
          >
            <Send className="w-3 h-3" />
            Send to Session
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Send to
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => sendToSession()}
            data-testid={`menu-send-new-session-${chartId}`}
          >
            <Plus className="w-3.5 h-3.5 mr-2" />
            New session
          </DropdownMenuItem>
          {sessionsQuery.isLoading && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {(sessionsQuery.data?.length ?? 0) > 0 && (
            <>
              <DropdownMenuSeparator />
              {(sessionsQuery.data || []).slice(0, 8).map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => sendToSession(s.id)}
                  data-testid={`menu-send-session-${s.id}-${chartId}`}
                >
                  <span className="truncate">{s.title || "Untitled"}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu open={reportsOpen} onOpenChange={setReportsOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${btnSize} gap-1 text-muted-foreground hover:text-foreground`}
            data-testid={`button-save-to-report-${chartId}`}
          >
            <BookmarkPlus className="w-3 h-3" />
            Save to Report
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Save to
          </DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => createReportMutation.mutate()}
            disabled={createReportMutation.isPending}
            data-testid={`menu-save-new-report-${chartId}`}
          >
            <Plus className="w-3.5 h-3.5 mr-2" />
            New report
            {createReportMutation.isPending && (
              <Loader2 className="w-3 h-3 ml-auto animate-spin" />
            )}
          </DropdownMenuItem>
          {reportsQuery.isLoading && (
            <div className="flex justify-center py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {(reportsQuery.data?.length ?? 0) > 0 && (
            <>
              <DropdownMenuSeparator />
              {(reportsQuery.data || []).slice(0, 8).map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onClick={() => addToReportMutation.mutate(r.id)}
                  data-testid={`menu-save-report-${r.id}-${chartId}`}
                >
                  <span className="truncate">{r.title}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function ProvenanceLine({
  source,
  sessionTitle,
  lastRefresh,
  className,
}: {
  source?: string | null;
  sessionTitle?: string | null;
  lastRefresh?: string | Date | null;
  className?: string;
}) {
  const parts: string[] = [];
  if (sessionTitle) parts.push(`from "${sessionTitle}"`);
  if (source) parts.push(source);
  if (lastRefresh) {
    const d = typeof lastRefresh === "string" ? new Date(lastRefresh) : lastRefresh;
    if (!isNaN(d.getTime())) parts.push(`updated ${format(d, "MMM d, HH:mm")}`);
  }
  if (parts.length === 0) return null;
  return (
    <div
      className={`flex items-center gap-1.5 text-[10px] text-muted-foreground/60 tabular-nums ${className || ""}`}
      data-testid="provenance-line"
    >
      <Database className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{parts.join(" · ")}</span>
    </div>
  );
}
