import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, FileText, Loader2 } from "lucide-react";
import type { MasterReport } from "@shared/schema";

export default function MasterReportsPage() {
  const [, navigate] = useLocation();
  const [newTitle, setNewTitle] = useState("");

  const { data: reports = [], isLoading } = useQuery<MasterReport[]>({
    queryKey: ["/api/master-reports"],
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("POST", "/api/master-reports", { title });
      return res.json();
    },
    onSuccess: (report: MasterReport) => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
      navigate(`/master-reports/${report.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/master-reports/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
    },
  });

  const handleCreate = () => {
    const title = newTitle.trim() || "Untitled Report";
    createMutation.mutate(title);
    setNewTitle("");
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="text-master-reports-title">Master Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Compose multi-block reports from your research, charts, and models.</p>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="New report title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="text-sm"
            data-testid="input-new-report-title"
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createMutation.isPending}
            data-testid="button-create-report"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            <span className="ml-1">Create</span>
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm" data-testid="text-no-reports">
            No master reports yet. Create one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:bg-accent/30 transition-colors cursor-pointer group"
                onClick={() => navigate(`/master-reports/${report.id}`)}
                data-testid={`card-master-report-${report.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" data-testid={`text-report-title-${report.id}`}>{report.title}</div>
                    <div className="text-xs text-muted-foreground">
                      Updated {new Date(report.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate(report.id);
                  }}
                  data-testid={`button-delete-report-${report.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
