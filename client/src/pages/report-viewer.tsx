import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { ArrowLeft, Download, Loader2, FileText, AlertCircle, Trash2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Report } from "@shared/schema";
import { useEffect, useState, useRef, useCallback } from "react";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("mailto:")) {
    return trimmed;
  }
  return "#";
}

function applyInlineFormatting(text: string): string {
  let result = escapeHtml(text);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/`(.+?)`/g, '<code class="report-code">$1</code>');
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, (_, linkText, url) => {
    const safeUrl = sanitizeUrl(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="report-link">${linkText}</a>`;
  });
  return result;
}

function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inTable = false;
  let inList = false;
  let listType: "ul" | "ol" = "ul";
  let headerDone = false;
  let tableRowIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (raw.match(/^#{1,3} /)) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      if (inTable) { result.push("</tbody></table></div>"); inTable = false; }
      const level = raw.match(/^(#{1,3}) /)![1].length;
      const text = raw.replace(/^#{1,3} /, "");
      const cls = level === 1 ? "report-h1" : level === 2 ? "report-h2" : "report-h3";
      result.push(`<h${level} class="${cls}">${applyInlineFormatting(text)}</h${level}>`);
      continue;
    }

    if (raw.trim() === "---") {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      if (inTable) { result.push("</tbody></table></div>"); inTable = false; }
      result.push('<hr class="report-hr" />');
      continue;
    }

    if (raw.startsWith("|") && raw.endsWith("|")) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      if (!inTable) {
        result.push('<div class="report-table-wrap"><table class="report-table">');
        inTable = true;
        headerDone = false;
        tableRowIndex = 0;
      }
      if (raw.match(/^\|[\s\-:|]+\|$/)) {
        headerDone = true;
        result.push("</thead><tbody>");
        continue;
      }
      const cells = raw.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (!headerDone) {
        const tag = "th";
        result.push(`<thead><tr class="report-thead-row">${cells.map((c) => `<${tag} class="report-th">${applyInlineFormatting(c.trim())}</${tag}>`).join("")}</tr>`);
      } else {
        const rowClass = tableRowIndex % 2 === 1 ? "report-tr-alt" : "report-tr";
        result.push(`<tr class="${rowClass}">${cells.map((c) => `<td class="report-td">${applyInlineFormatting(c.trim())}</td>`).join("")}</tr>`);
        tableRowIndex++;
      }
      continue;
    } else if (inTable) {
      result.push("</tbody></table></div>");
      inTable = false;
    }

    if (raw.match(/^[-*] /)) {
      if (inList && listType !== "ul") { result.push("</ol>"); inList = false; }
      if (!inList) { result.push('<ul class="report-ul">'); inList = true; listType = "ul"; }
      result.push(`<li class="report-li">${applyInlineFormatting(raw.replace(/^[-*] /, ""))}</li>`);
      continue;
    }

    if (raw.match(/^\d+\. /)) {
      if (inList && listType !== "ol") { result.push("</ul>"); inList = false; }
      if (!inList) { result.push('<ol class="report-ol">'); inList = true; listType = "ol"; }
      result.push(`<li class="report-li">${applyInlineFormatting(raw.replace(/^\d+\. /, ""))}</li>`);
      continue;
    }

    if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }

    if (raw.trim() === "") {
      result.push('<div class="report-spacer"></div>');
    } else {
      result.push(`<p class="report-p">${applyInlineFormatting(raw)}</p>`);
    }
  }

  if (inTable) result.push("</tbody></table></div>");
  if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");

  return result.join("\n");
}

function findMarkdownForSelection(selectedText: string, fullMarkdown: string): { text: string; startIndex: number } | null {
  const cleanSelected = selectedText.replace(/\s+/g, " ").trim();
  if (cleanSelected.length < 10) return null;

  const lines = fullMarkdown.split("\n");
  let bestStart = -1;
  let bestEnd = -1;
  let bestScore = 0;

  const selectedWords = cleanSelected.split(/\s+/);

  for (let start = 0; start < lines.length; start++) {
    let accumulated = "";
    for (let end = start; end < Math.min(start + 80, lines.length); end++) {
      const line = lines[end];
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;
      const cleanLine = line
        .replace(/^#{1,3}\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .replace(/\|/g, " ")
        .trim();
      if (cleanLine) {
        accumulated += (accumulated ? " " : "") + cleanLine;
      }

      const accWords = accumulated.split(/\s+/);
      const matchingWords = selectedWords.filter(w => accWords.some(aw => aw.includes(w) || w.includes(aw)));
      const score = matchingWords.length / selectedWords.length;

      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestStart = start;
        bestEnd = end;
      }

      if (accumulated.length > cleanSelected.length * 2) break;
    }
  }

  if (bestStart === -1) return null;

  while (bestStart > 0 && lines[bestStart - 1].trim() !== "" && !lines[bestStart - 1].match(/^#{1,3} /)) {
    bestStart--;
  }
  while (bestEnd < lines.length - 1 && lines[bestEnd + 1].trim() !== "" && !lines[bestEnd + 1].match(/^#{1,3} /)) {
    bestEnd++;
  }

  const matchedText = lines.slice(bestStart, bestEnd + 1).join("\n");
  let charIndex = 0;
  for (let i = 0; i < bestStart; i++) {
    charIndex += lines[i].length + 1;
  }

  return { text: matchedText, startIndex: charIndex };
}

interface FloatingButtonPos {
  top: number;
  left: number;
}

export default function ReportViewer() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const [selectedText, setSelectedText] = useState("");
  const [selectedMarkdown, setSelectedMarkdown] = useState("");
  const [sectionStartIndex, setSectionStartIndex] = useState(0);
  const [floatingBtnPos, setFloatingBtnPos] = useState<FloatingButtonPos | null>(null);
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [userInsight, setUserInsight] = useState("");

  const reportBodyRef = useRef<HTMLDivElement>(null);
  const floatingBtnRef = useRef<HTMLDivElement>(null);

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: ["/api/reports", id],
    refetchInterval: pollingEnabled ? 3000 : false,
  });

  useEffect(() => {
    if (report && report.status !== "generating") {
      setPollingEnabled(false);
    }
  }, [report]);

  const editSectionMutation = useMutation({
    mutationFn: async ({ selectedText, userInsight, sectionStartIndex }: { selectedText: string; userInsight: string; sectionStartIndex: number }) => {
      const validateRes = await apiRequest("POST", `/api/reports/${id}/edit-section/validate`, {
        selectedText,
        userInsight,
        sectionStartIndex,
      });
      const validation = await validateRes.json();
      if (!validation.valid) {
        throw new Error(validation.message || "Validation failed");
      }

      const res = await apiRequest("POST", `/api/reports/${id}/edit-section`, {
        selectedText,
        userInsight,
        sectionStartIndex,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reports", id] });
      toast({ title: "Section updated", description: "The AI has rewritten the selected section with your insight." });
      setShowEditPanel(false);
      setSelectedText("");
      setSelectedMarkdown("");
      setSectionStartIndex(0);
      setUserInsight("");
    },
    onError: (error: any) => {
      toast({ title: "Edit failed", description: error.message || "Failed to edit section", variant: "destructive" });
    },
  });

  const deleteReportMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/reports/${id}`);
      return res.json();
    },
    onSuccess: (data: { companyId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", data.companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", data.companyId, "reports"] });
      toast({ title: "Report deleted" });
      navigate(`/companies/${data.companyId}`);
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete report", description: error.message, variant: "destructive" });
    },
  });

  const handleTextSelection = useCallback(() => {
    if (showEditPanel) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setFloatingBtnPos(null);
      setSelectedText("");
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 20) {
      setFloatingBtnPos(null);
      setSelectedText("");
      return;
    }

    if (reportBodyRef.current && !reportBodyRef.current.contains(selection.anchorNode)) {
      setFloatingBtnPos(null);
      setSelectedText("");
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = reportBodyRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    setSelectedText(text);
    setFloatingBtnPos({
      top: Math.max(0, rect.top - containerRect.top - 44),
      left: Math.max(0, Math.min(containerRect.width - 140, rect.left - containerRect.left + rect.width / 2 - 70)),
    });
  }, [showEditPanel]);

  useEffect(() => {
    document.addEventListener("mouseup", handleTextSelection);
    return () => document.removeEventListener("mouseup", handleTextSelection);
  }, [handleTextSelection]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (floatingBtnRef.current && !floatingBtnRef.current.contains(e.target as Node)) {
        setFloatingBtnPos(null);
      }
    };
    if (floatingBtnPos) {
      setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 100);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [floatingBtnPos]);

  const handleEditWithAI = () => {
    if (!report || !selectedText) return;

    const match = findMarkdownForSelection(selectedText, report.content);
    if (!match) {
      toast({ title: "Could not locate section", description: "Please try selecting a larger portion of text.", variant: "destructive" });
      return;
    }

    setSelectedMarkdown(match.text);
    setSectionStartIndex(match.startIndex);
    setShowEditPanel(true);
    setFloatingBtnPos(null);
  };

  const handleSubmitEdit = () => {
    if (!selectedMarkdown || !userInsight.trim()) return;
    editSectionMutation.mutate({ selectedText: selectedMarkdown, userInsight: userInsight.trim(), sectionStartIndex });
  };

  const handleDownload = () => {
    if (!report) return;
    const blob = new Blob([report.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Report not found</p>
        <Link href="/">
          <Button variant="ghost" size="sm">Go back</Button>
        </Link>
      </div>
    );
  }

  const isGenerating = report.status === "generating";

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-[#1a1a1a]">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link href={`/companies/${report.companyId}`}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" data-testid="button-back-to-company">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to deal
            </Button>
          </Link>
          {!isGenerating && report.content && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownload} data-testid="button-download-report">
                <Download className="w-3.5 h-3.5" />
                Download .md
              </Button>
              {!showDeleteConfirm ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDeleteConfirm(true)}
                  data-testid="button-delete-report"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => deleteReportMutation.mutate()}
                    disabled={deleteReportMutation.isPending}
                    data-testid="button-confirm-delete-report"
                  >
                    {deleteReportMutation.isPending ? "Deleting..." : "Delete Report"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => setShowDeleteConfirm(false)}
                    data-testid="button-cancel-delete-report"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {isGenerating ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <FileText className="w-6 h-6 text-muted-foreground animate-pulse" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold">Generating Deep Research Report</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                The AI agent is conducting extensive web research, cross-referencing claims, and building your investment-grade report. This typically takes 1-2 minutes.
              </p>
            </div>
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-2" />
          </div>
        ) : (
          <article className="report-article">
            <div className="report-title-page">
              <span className="report-category-label">DEEP RESEARCH</span>
              <h1 className="report-title" data-testid="text-report-title">{report.title}</h1>
              <p className="report-date">
                {new Date(report.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-1 tracking-wide uppercase">
                Select text to edit with AI
              </p>
            </div>
            <div className="relative" ref={reportBodyRef}>
              <div
                className="report-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
                data-testid="report-content"
              />

              {floatingBtnPos && (
                <div
                  ref={floatingBtnRef}
                  className="absolute z-50 animate-in fade-in slide-in-from-bottom-1 duration-150"
                  style={{ top: floatingBtnPos.top, left: Math.max(0, floatingBtnPos.left) }}
                >
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs shadow-lg bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-3"
                    onClick={handleEditWithAI}
                    data-testid="button-edit-with-ai"
                  >
                    <Sparkles className="w-3 h-3" />
                    Edit with AI
                  </Button>
                </div>
              )}
            </div>
          </article>
        )}
      </div>

      {showEditPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" data-testid="edit-panel-overlay">
          <div className="bg-white dark:bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-xl mx-4 max-h-[80vh] flex flex-col border border-border/50">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Edit Section with AI</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => { setShowEditPanel(false); setUserInsight(""); }}
                disabled={editSectionMutation.isPending}
                data-testid="button-close-edit-panel"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Selected Section
                </label>
                <div className="text-xs text-foreground/80 bg-muted/50 dark:bg-white/5 rounded-lg p-3 max-h-32 overflow-y-auto border border-border/30 leading-relaxed" data-testid="text-selected-section">
                  {selectedText.length > 500 ? selectedText.substring(0, 500) + "..." : selectedText}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Your Insight or Instruction
                </label>
                <Textarea
                  placeholder="e.g., 'This doesn't account for the recent governance vote that changed fee distribution' or 'Add context about their Series B funding round in Q3 2025'"
                  value={userInsight}
                  onChange={(e) => setUserInsight(e.target.value.slice(0, 2000))}
                  className="min-h-[100px] text-sm resize-none"
                  maxLength={2000}
                  disabled={editSectionMutation.isPending}
                  data-testid="input-user-insight"
                />
                <p className="text-[10px] text-muted-foreground/50 text-right mt-1">{userInsight.length}/2000</p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-border/50 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">$0.50 per edit</p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => { setShowEditPanel(false); setUserInsight(""); }}
                  disabled={editSectionMutation.isPending}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={handleSubmitEdit}
                  disabled={!userInsight.trim() || editSectionMutation.isPending}
                  data-testid="button-submit-edit"
                >
                  {editSectionMutation.isPending ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Rewriting...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3" />
                      Rewrite Section
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
