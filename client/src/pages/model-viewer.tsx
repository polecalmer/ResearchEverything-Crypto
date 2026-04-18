import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { ArrowLeft, Download, Loader2, Table2, AlertCircle, Trash2, ExternalLink, FileSpreadsheet, ChevronDown, ChevronRight, Lightbulb, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FinancialModel } from "@shared/schema";
import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

function ModelTable({ section }: { section: any }) {
  const columns: string[] = section.columns || [];
  const data: any[] = section.data || [];

  if (columns.length === 0 && data.length > 0) {
    const keys = Object.keys(data[0]);
    columns.push(...keys);
  }

  return (
    <div className="overflow-x-auto border border-border/50 rounded-lg" data-testid={`model-table-${section.title}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/30 border-b border-border/50">
            {columns.map((col, i) => (
              <th
                key={i}
                className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className={`border-b border-border/30 hover:bg-muted/20 transition-colors ${rowIdx % 2 === 1 ? "bg-muted/10" : ""}`}
            >
              {columns.map((col, colIdx) => {
                const val = row[col];
                const display = val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
                const isNumeric = /^[\$\-\d.,]+[%KMBTkmbg]?$/.test(display.trim());
                const isNegative = display.trim().startsWith("-") || display.trim().startsWith("(");
                return (
                  <td
                    key={colIdx}
                    className={`px-4 py-2 whitespace-nowrap font-mono text-[13px] ${
                      colIdx === 0 ? "font-medium text-foreground" : "text-muted-foreground"
                    } ${isNumeric ? "text-right tabular-nums" : ""} ${
                      isNegative ? "text-red-400" : ""
                    }`}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricCards({ section }: { section: any }) {
  const data: any[] = section.data || [];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="model-metrics">
      {data.map((card: any, i: number) => (
        <div key={i} className="bg-muted/20 border border-border/40 rounded-lg px-4 py-3">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">{card.label}</p>
          <p className="text-lg font-semibold font-mono tabular-nums">{card.value}</p>
          {card.subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{card.subtitle}</p>}
        </div>
      ))}
    </div>
  );
}

function ModelChart({ section }: { section: any }) {
  const cfg = section.chartConfig || {};
  const data = section.data || [];
  const yAxes = cfg.yAxes || [];

  const formatTick = (val: any, fmt?: string) => {
    if (fmt === "currency" || fmt === "usd") {
      const n = Number(val);
      if (isNaN(n)) return val;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
      return `$${n.toFixed(2)}`;
    }
    if (fmt === "percent") return `${val}%`;
    return val;
  };

  const COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4"];

  return (
    <div className="bg-muted/10 border border-border/40 rounded-lg p-4" data-testid="model-chart">
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
          <XAxis dataKey={cfg.xAxis?.dataKey || "period"} tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" />
          <YAxis tick={{ fontSize: 11 }} stroke="rgba(255,255,255,0.3)" tickFormatter={(v: any) => formatTick(v, yAxes[0]?.format)} />
          <Tooltip
            contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {yAxes.map((y: any, i: number) => {
            const ct = y.chartType || cfg.chartType || "line";
            const props = { key: y.dataKey, dataKey: y.dataKey, stroke: COLORS[i % COLORS.length], fill: COLORS[i % COLORS.length], name: y.name || y.dataKey };
            if (ct === "bar") return <Bar {...props} fillOpacity={0.7} />;
            if (ct === "area") return <Area {...props} fillOpacity={0.15} />;
            return <Line {...props} dot={false} strokeWidth={2} />;
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ComparisonSection({ section }: { section: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="model-comparison">
      {[section.left, section.right].map((side, i) => (
        <div key={i} className="bg-muted/15 border border-border/40 rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">{side?.label}</h4>
          <ul className="space-y-2">
            {(side?.items || []).map((item: string, j: number) => (
              <li key={j} className="text-sm flex gap-2">
                <span className={`mt-0.5 ${i === 0 ? "text-green-400" : "text-red-400"}`}>
                  {i === 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ScenarioSection({ section }: { section: any }) {
  const scenarios = section.scenarios || [];
  const icons: Record<string, any> = { bear: TrendingDown, base: Minus, bull: TrendingUp };
  const colors: Record<string, string> = { bear: "text-red-400", base: "text-yellow-400", bull: "text-green-400" };
  const bgColors: Record<string, string> = { bear: "bg-red-500/10 border-red-500/20", base: "bg-yellow-500/10 border-yellow-500/20", bull: "bg-green-500/10 border-green-500/20" };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="model-scenarios">
      {scenarios.map((s: any, i: number) => {
        const Icon = icons[s.type] || Minus;
        return (
          <div key={i} className={`border rounded-lg p-4 ${bgColors[s.type] || "bg-muted/15 border-border/40"}`}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${colors[s.type] || "text-muted-foreground"}`} />
              <h4 className="text-sm font-semibold capitalize">{s.type} Case</h4>
            </div>
            <ul className="space-y-1.5">
              {(s.lines || []).map((line: string, j: number) => (
                <li key={j} className="text-xs text-muted-foreground">{line.replace(/^[-*]\s*/, "")}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function CalloutSection({ section }: { section: any }) {
  const variantStyles: Record<string, string> = {
    insight: "border-blue-500/30 bg-blue-500/5",
    risk: "border-red-500/30 bg-red-500/5",
    contrarian: "border-purple-500/30 bg-purple-500/5",
    catch: "border-yellow-500/30 bg-yellow-500/5",
  };

  return (
    <div className={`border rounded-lg p-4 ${variantStyles[section.variant] || "border-border/40 bg-muted/10"}`}>
      <div className="flex items-start gap-2">
        {section.variant === "risk" ? (
          <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
        ) : (
          <Lightbulb className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
        )}
        <div>
          {section.title && <p className="text-sm font-semibold mb-1">{section.title}</p>}
          <p className="text-sm text-muted-foreground">{section.text}</p>
        </div>
      </div>
    </div>
  );
}

function generateCSV(model: FinancialModel): string {
  const lines: string[] = [];
  lines.push(`"${model.title}"`);
  lines.push(`"Generated: ${new Date(model.createdAt).toLocaleDateString()}"`);
  lines.push("");

  const sections: any[] = Array.isArray(model.sections) ? model.sections : [];
  for (const section of sections) {
    if (section.type === "table") {
      lines.push(`"${section.title}"`);
      const cols = section.columns || Object.keys(section.data?.[0] || {});
      lines.push(cols.map((c: string) => `"${c}"`).join(","));
      for (const row of section.data || []) {
        lines.push(cols.map((c: string) => {
          const v = row[c];
          return `"${v === null || v === undefined ? "" : String(v).replace(/"/g, '""')}"`;
        }).join(","));
      }
      lines.push("");
    } else if (section.type === "metrics") {
      lines.push(`"${section.title}"`);
      lines.push('"Metric","Value","Detail"');
      for (const card of section.data || []) {
        lines.push(`"${card.label}","${card.value}","${card.subtitle || ""}"`);
      }
      lines.push("");
    } else if (section.type === "chart") {
      lines.push(`"${section.title}"`);
      const chartData = section.data || [];
      if (chartData.length > 0) {
        const keys = Object.keys(chartData[0]);
        lines.push(keys.map((k: string) => `"${k}"`).join(","));
        for (const row of chartData) {
          lines.push(keys.map((k: string) => `"${row[k] ?? ""}"`).join(","));
        }
      }
      lines.push("");
    }
  }

  const assumptions: any[] = Array.isArray(model.assumptions) ? model.assumptions : [];
  if (assumptions.length > 0) {
    lines.push('"Assumptions & Key Insights"');
    for (const a of assumptions) {
      lines.push(`"${(a.title || "Assumption")}: ${a.text}"`);
    }
    lines.push("");
  }

  const sources: any[] = Array.isArray(model.sources) ? model.sources : [];
  if (sources.length > 0) {
    lines.push('"Sources"');
    for (const s of sources) {
      lines.push(`"${s.label}","${s.url}"`);
    }
  }

  return lines.join("\n");
}

export default function ModelViewer() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  const { data: model, isLoading, error } = useQuery<FinancialModel>({
    queryKey: ["/api/models", id],
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/models/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      toast({ title: "Model deleted" });
      navigate("/research");
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete model", description: error.message, variant: "destructive" });
    },
  });

  const handleDownloadCSV = () => {
    if (!model) return;
    const csv = generateCSV(model);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportGoogleSheets = () => {
    if (!model) return;
    const csv = generateCSV(model);
    const encoded = encodeURIComponent(csv);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${model.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({
      title: "CSV downloaded",
      description: "Open Google Sheets → File → Import → Upload the downloaded CSV",
    });
  };

  const toggleSection = (idx: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Model not found</p>
        <Link href="/sessions">
          <Button variant="ghost" size="sm">Go back</Button>
        </Link>
      </div>
    );
  }

  const sections: any[] = Array.isArray(model.sections) ? model.sections : [];
  const assumptions: any[] = Array.isArray(model.assumptions) ? model.assumptions : [];
  const sources: any[] = Array.isArray(model.sources) ? model.sources : [];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link href="/research">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" data-testid="button-back">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Sessions
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownloadCSV} data-testid="button-download-csv">
              <Download className="w-3.5 h-3.5" />
              Download CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleExportGoogleSheets} data-testid="button-export-sheets">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export to Sheets
            </Button>
            {!showDeleteConfirm ? (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="button-delete-model"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  data-testid="button-confirm-delete"
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setShowDeleteConfirm(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <Table2 className="w-5 h-5 text-green-400" />
            <span className="text-[11px] text-green-400 uppercase tracking-wider font-medium">Financial Model</span>
          </div>
          <h1 className="text-2xl font-bold mb-1" data-testid="text-model-title">{model.title}</h1>
          {model.subtitle && <p className="text-sm text-muted-foreground">{model.subtitle}</p>}
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(model.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section, idx) => {
            const isCollapsed = collapsedSections.has(idx);
            return (
              <div key={idx} className="space-y-2">
                <button
                  onClick={() => toggleSection(idx)}
                  className="flex items-center gap-2 text-sm font-semibold hover:text-foreground transition-colors w-full text-left"
                  data-testid={`section-toggle-${idx}`}
                >
                  {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {section.title}
                </button>
                {!isCollapsed && (
                  <>
                    {section.type === "table" && <ModelTable section={section} />}
                    {section.type === "metrics" && <MetricCards section={section} />}
                    {section.type === "chart" && <ModelChart section={section} />}
                    {section.type === "comparison" && <ComparisonSection section={section} />}
                    {section.type === "scenarios" && <ScenarioSection section={section} />}
                    {section.type === "callout" && <CalloutSection section={section} />}
                  </>
                )}
              </div>
            );
          })}

          {assumptions.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                Assumptions & Key Insights
              </h3>
              <div className="space-y-2">
                {assumptions.map((a, i) => (
                  <div key={i} className="border border-yellow-500/20 bg-yellow-500/5 rounded-lg px-4 py-3">
                    <p className="text-sm">
                      {a.title && a.title !== "Assumption" && <span className="font-medium">{a.title}: </span>}
                      {a.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sources.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-blue-400" />
                Sources
              </h3>
              <div className="border border-border/40 rounded-lg divide-y divide-border/30">
                {sources.map((s, i) => (
                  <a
                    key={i}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted/20 transition-colors"
                    data-testid={`source-link-${i}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-blue-400 hover:underline truncate">{s.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
