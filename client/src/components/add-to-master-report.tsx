import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Check } from "lucide-react";
import type { MasterReport } from "@shared/schema";

interface AddToMasterReportProps {
  blockType: "text" | "chart" | "report-section" | "model" | "table";
  content?: string | null;
  referenceId?: string | null;
  label?: string;
  className?: string;
  onAdded?: () => void;
}

export function AddToMasterReport({ blockType, content, referenceId, label, className, onAdded }: AddToMasterReportProps) {
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const pendingReportTitle = useRef<string>("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { data: reports = [], isLoading } = useQuery<MasterReport[]>({
    queryKey: ["/api/master-reports"],
    enabled: open,
  });

  const addBlockMutation = useMutation({
    mutationFn: async ({ reportId }: { reportId: string }) => {
      const body: Record<string, unknown> = { blockType };
      if (content) body.content = content;
      if (referenceId) body.referenceId = referenceId;
      const res = await apiRequest("POST", `/api/master-reports/${reportId}/blocks`, body);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
      toast({ title: `Added to "${pendingReportTitle.current}"` });
      setJustAdded(vars.reportId);
      setTimeout(() => {
        setJustAdded(null);
        setOpen(false);
      }, 800);
      onAdded?.();
    },
    onError: (err: any) => {
      toast({ title: "Failed to add block", description: err.message, variant: "destructive" });
    },
  });

  const createReportMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/master-reports", { title });
      return res.json();
    },
    onSuccess: (report: MasterReport) => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
      pendingReportTitle.current = report.title;
      addBlockMutation.mutate({ reportId: report.id });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create report", description: err.message, variant: "destructive" });
    },
  });

  const addBlockToReport = (reportId: string, reportTitle: string) => {
    pendingReportTitle.current = reportTitle;
    addBlockMutation.mutate({ reportId });
  };

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, handleClickOutside]);

  const isPending = createReportMutation.isPending || addBlockMutation.isPending;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={className || "flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground/80 transition-colors"}
        data-testid={`button-add-to-master-report-${blockType}`}
      >
        <Plus className="w-3 h-3" />
        {label || "Master Report"}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-popover border border-border/50 rounded-lg shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="px-3 py-2 border-b border-border/30">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Add to Master Report</p>
          </div>

          <div className="max-h-48 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              </div>
            ) : reports.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground/50 text-center">No master reports yet</div>
            ) : (
              reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => addBlockToReport(r.id, r.title)}
                  disabled={isPending}
                  className="w-full text-left px-3 py-2 text-[11px] text-foreground/80 hover:bg-accent/10 transition-colors flex items-center justify-between disabled:opacity-40"
                  data-testid={`button-pick-master-report-${r.id}`}
                >
                  <span className="truncate">{r.title}</span>
                  {justAdded === r.id && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
                </button>
              ))
            )}
          </div>

          <div className="border-t border-border/30 px-2 py-2">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                placeholder="New report title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim()) {
                    createReportMutation.mutate(newTitle.trim());
                    setNewTitle("");
                  }
                }}
                className="flex-1 bg-transparent border border-border/30 rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-foreground/30"
                disabled={isPending}
                data-testid="input-new-master-report-title"
              />
              <button
                onClick={() => {
                  if (newTitle.trim()) {
                    createReportMutation.mutate(newTitle.trim());
                    setNewTitle("");
                  }
                }}
                disabled={!newTitle.trim() || isPending}
                className="p-1 rounded hover:bg-accent/20 text-muted-foreground/60 hover:text-foreground disabled:opacity-30 transition-colors"
                data-testid="button-create-and-add"
              >
                {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
