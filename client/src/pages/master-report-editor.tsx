import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, useLocation } from "wouter";
import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Plus, Trash2, GripVertical, Download, Loader2,
  ChevronUp, ChevronDown, Type, BarChart3, FileText, Calculator, Table,
  Pencil, Check, X,
} from "lucide-react";
import type { MasterReport, MasterReportBlock, DashboardChart, Report, FinancialModel } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

type ReportWithBlocks = MasterReport & { blocks: MasterReportBlock[] };

function renderSimpleMarkdown(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-4 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-lg font-semibold mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-xs">$1</code>')
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 text-sm">$1</li>')
    .replace(/\n/g, "<br/>");
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  chart: "Chart",
  "report-section": "Report Section",
  model: "Financial Model",
  table: "Table",
};

const BLOCK_TYPE_ICONS: Record<string, typeof Type> = {
  text: Type,
  chart: BarChart3,
  "report-section": FileText,
  model: Calculator,
  table: Table,
};

function BlockCard({
  block,
  reportId,
  index,
  total,
  onMoveUp,
  onMoveDown,
}: {
  block: MasterReportBlock;
  reportId: string;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(block.content || "");
  const { toast } = useToast();

  const updateMutation = useMutation({
    mutationFn: async (content: string) => {
      await apiRequest("PATCH", `/api/master-reports/${reportId}/blocks/${block.id}`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports", reportId] });
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
      setEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/master-reports/${reportId}/blocks/${block.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports", reportId] });
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
    },
  });

  const Icon = BLOCK_TYPE_ICONS[block.blockType] || Type;

  return (
    <div
      className="border border-border/50 rounded-lg group relative"
      data-testid={`block-${block.id}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/30 rounded-t-lg">
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 cursor-grab" />
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {BLOCK_TYPE_LABELS[block.blockType] || block.blockType}
        </span>
        {block.referenceId && (
          <span className="text-xs text-muted-foreground/60 ml-1">#{block.referenceId.slice(0, 8)}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={onMoveUp} data-testid={`button-move-up-${block.id}`}>
            <ChevronUp className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === total - 1} onClick={onMoveDown} data-testid={`button-move-down-${block.id}`}>
            <ChevronDown className="w-3 h-3" />
          </Button>
          {(block.blockType === "text" || block.blockType === "table") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => { setEditContent(block.content || ""); setEditing(!editing); }}
              data-testid={`button-edit-${block.id}`}
            >
              <Pencil className="w-3 h-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={() => deleteMutation.mutate()}
            data-testid={`button-delete-block-${block.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="p-3">
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={6}
              className="text-sm font-mono"
              data-testid={`textarea-edit-${block.id}`}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => updateMutation.mutate(editContent)} disabled={updateMutation.isPending} data-testid={`button-save-${block.id}`}>
                <Check className="w-3 h-3 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} data-testid={`button-cancel-${block.id}`}>
                <X className="w-3 h-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <BlockContent block={block} />
        )}
      </div>
    </div>
  );
}

function BlockContent({ block }: { block: MasterReportBlock }) {
  if (block.blockType === "text" || block.blockType === "table") {
    if (!block.content) return <p className="text-xs text-muted-foreground italic">Empty block</p>;
    return (
      <div
        className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(block.content) }}
      />
    );
  }

  if (block.blockType === "report-section" && block.referenceId) {
    return <ReferencedReport reportId={block.referenceId} />;
  }

  if (block.blockType === "model" && block.referenceId) {
    return <ReferencedModel modelId={block.referenceId} />;
  }

  if (block.blockType === "chart" && block.referenceId) {
    return <ReferencedChart chartId={block.referenceId} />;
  }

  return <p className="text-xs text-muted-foreground italic">Unknown block type</p>;
}

function ReferencedReport({ reportId }: { reportId: string }) {
  const { data: report, isLoading } = useQuery<Report>({
    queryKey: ["/api/reports", reportId],
    queryFn: async () => {
      const res = await fetch(`/api/reports/${reportId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading report...</div>;
  if (!report) return <p className="text-xs text-muted-foreground italic">Report not found</p>;

  const preview = report.content?.slice(0, 500) || "";
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{report.title}</div>
      <div className="text-xs text-muted-foreground line-clamp-4" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(preview) }} />
      {report.content && report.content.length > 500 && (
        <p className="text-xs text-muted-foreground/60">...truncated in preview</p>
      )}
    </div>
  );
}

function ReferencedModel({ modelId }: { modelId: string }) {
  const { data: model, isLoading } = useQuery<FinancialModel>({
    queryKey: ["/api/models", modelId],
    queryFn: async () => {
      const res = await fetch(`/api/models/${modelId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load model");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading model...</div>;
  if (!model) return <p className="text-xs text-muted-foreground italic">Model not found</p>;

  const preview = model.content?.slice(0, 500) || "";
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{model.title}</div>
      <div className="text-xs text-muted-foreground line-clamp-4" dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(preview) }} />
    </div>
  );
}

function ReferencedChart({ chartId }: { chartId: string }) {
  const { data: chart, isLoading } = useQuery<DashboardChart>({
    queryKey: ["/api/charts", chartId],
    queryFn: async () => {
      const res = await fetch(`/api/charts/${chartId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load chart");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> Loading chart...</div>;
  if (!chart) return <p className="text-xs text-muted-foreground italic">Chart not found</p>;

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{chart.title}</div>
      <div className="text-xs text-muted-foreground">Type: {chart.chartType} | Status: {chart.status}</div>
      {chart.description && <div className="text-xs text-muted-foreground">{chart.description}</div>}
    </div>
  );
}

export default function MasterReportEditor() {
  const [, params] = useRoute("/master-reports/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const [addBlockType, setAddBlockType] = useState<string>("text");
  const [addRefId, setAddRefId] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  const reportId = params?.id || "";

  const { data: report, isLoading } = useQuery<ReportWithBlocks>({
    queryKey: ["/api/master-reports", reportId],
    enabled: !!reportId,
  });

  useEffect(() => {
    if (report && !editingTitle) {
      setTitleValue(report.title);
    }
  }, [report, editingTitle]);

  const updateTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      await apiRequest("PATCH", `/api/master-reports/${reportId}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports", reportId] });
      queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
      setEditingTitle(false);
    },
  });

  const invalidateReport = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/master-reports", reportId] });
    queryClient.invalidateQueries({ queryKey: ["/api/master-reports"] });
  };

  const addBlockMutation = useMutation({
    mutationFn: async (data: { blockType: string; content?: string; referenceId?: string }) => {
      const res = await apiRequest("POST", `/api/master-reports/${reportId}/blocks`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateReport();
      setAddRefId("");
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (blockIds: string[]) => {
      await apiRequest("POST", `/api/master-reports/${reportId}/reorder`, { blockIds });
    },
    onSuccess: invalidateReport,
  });

  const handleAddBlock = () => {
    const needsRef = ["chart", "report-section", "model"].includes(addBlockType);
    if (needsRef && !addRefId.trim()) {
      toast({ title: "Reference ID required", description: "Enter the ID of the chart, report, or model to reference.", variant: "destructive" });
      return;
    }
    addBlockMutation.mutate({
      blockType: addBlockType,
      content: needsRef ? null : "New block — click edit to add content",
      referenceId: needsRef ? addRefId.trim() : undefined,
    } as any);
  };

  const handleMove = useCallback((blocks: MasterReportBlock[], index: number, direction: "up" | "down") => {
    const newBlocks = [...blocks];
    const swapIdx = direction === "up" ? index - 1 : index + 1;
    [newBlocks[index], newBlocks[swapIdx]] = [newBlocks[swapIdx], newBlocks[index]];
    reorderMutation.mutate(newBlocks.map((b) => b.id));
  }, [reorderMutation]);

  const handleExport = async () => {
    try {
      const res = await fetch(`/api/master-reports/${reportId}/export`, { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${report?.title || "report"}.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Exported", description: "Report downloaded as Markdown." });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-3">
        <p className="text-sm text-muted-foreground">Report not found</p>
        <Button variant="ghost" size="sm" onClick={() => navigate("/master-reports")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </div>
    );
  }

  const blocks = report.blocks || [];
  const needsRef = ["chart", "report-section", "model"].includes(addBlockType);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/master-reports")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>

          {editingTitle ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                ref={titleInputRef}
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") updateTitleMutation.mutate(titleValue);
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="text-lg font-semibold h-9"
                autoFocus
                data-testid="input-edit-title"
              />
              <Button size="sm" onClick={() => updateTitleMutation.mutate(titleValue)} data-testid="button-save-title">
                <Check className="w-3 h-3" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          ) : (
            <h1
              className="text-lg font-semibold tracking-tight cursor-pointer hover:text-muted-foreground transition-colors flex-1"
              onClick={() => setEditingTitle(true)}
              data-testid="text-report-title"
            >
              {report.title}
            </h1>
          )}

          <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export">
            <Download className="w-3.5 h-3.5 mr-1" /> Export
          </Button>
        </div>

        <div className="space-y-3">
          {blocks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border/50 rounded-lg" data-testid="text-empty-blocks">
              No blocks yet. Add your first block below.
            </div>
          )}
          {blocks.map((block, i) => (
            <BlockCard
              key={block.id}
              block={block}
              reportId={reportId}
              index={i}
              total={blocks.length}
              onMoveUp={() => handleMove(blocks, i, "up")}
              onMoveDown={() => handleMove(blocks, i, "down")}
            />
          ))}
        </div>

        <div className="border border-border/50 rounded-lg p-3 space-y-3 bg-muted/20">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Add Block</div>
          <div className="flex gap-2 flex-wrap">
            <Select value={addBlockType} onValueChange={setAddBlockType}>
              <SelectTrigger className="w-[160px] h-8 text-sm" data-testid="select-block-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="chart">Chart</SelectItem>
                <SelectItem value="report-section">Report Section</SelectItem>
                <SelectItem value="model">Financial Model</SelectItem>
                <SelectItem value="table">Table</SelectItem>
              </SelectContent>
            </Select>
            {needsRef && (
              <Input
                placeholder="Reference ID (e.g. chart or report UUID)"
                value={addRefId}
                onChange={(e) => setAddRefId(e.target.value)}
                className="flex-1 h-8 text-sm"
                data-testid="input-reference-id"
              />
            )}
            <Button size="sm" className="h-8" onClick={handleAddBlock} disabled={addBlockMutation.isPending} data-testid="button-add-block">
              {addBlockMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span className="ml-1">Add</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
