import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ArrowLeft, Download, Loader2, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Report } from "@shared/schema";
import { useEffect, useState } from "react";

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

export default function ReportViewer() {
  const { id } = useParams<{ id: string }>();
  const [pollingEnabled, setPollingEnabled] = useState(true);

  const { data: report, isLoading, error } = useQuery<Report>({
    queryKey: ["/api/reports", id],
    refetchInterval: pollingEnabled ? 3000 : false,
  });

  useEffect(() => {
    if (report && report.status !== "generating") {
      setPollingEnabled(false);
    }
  }, [report]);

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
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownload} data-testid="button-download-report">
              <Download className="w-3.5 h-3.5" />
              Download .md
            </Button>
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
            </div>
            <div
              className="report-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }}
              data-testid="report-content"
            />
          </article>
        )}
      </div>
    </div>
  );
}