import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { FinancialModel } from "@shared/schema";
import {
  Loader2,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Target,
  BarChart3,
  Pencil,
  X,
  Link2,
  Plus,
} from "lucide-react";
import { AddToMasterReport } from "@/components/add-to-master-report";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface ModellingTabProps {
  companyId: string;
  companyName: string;
}

interface ModelAssumption {
  label: string;
  value: string;
  basis: string;
}

interface TableSection {
  heading: string;
  type: "table";
  columns: string[];
  rows: string[][];
  note?: string;
}

interface MetricsSection {
  heading: string;
  type: "metrics";
  items: { label: string; value: string; detail?: string }[];
}

interface ScenariosSection {
  heading: string;
  type: "scenarios";
  scenarios: { name: string; probability: string; outcome: string; keyDrivers: string }[];
}

interface TextSection {
  heading: string;
  type: "text";
  content: string;
}

interface ChartSection {
  heading: string;
  type: "chart";
  chartType: "bar" | "line";
  data: { label: string; value: number }[];
  valueFormat?: "currency" | "percent" | "number";
  color?: string;
}

type ModelSection = TableSection | MetricsSection | ScenariosSection | TextSection | ChartSection;

interface ParsedModel {
  title: string;
  assumptions: ModelAssumption[];
  sections: ModelSection[];
  methodology?: string;
}

interface EditTarget {
  kind: "assumption" | "table-row" | "table-cell" | "metric" | "scenario" | "section" | "methodology";
  label: string;
  currentValue: string;
  sectionHeading?: string;
  rowIndex?: number;
  colIndex?: number;
  colName?: string;
}

const EXAMPLE_PROMPTS = [
  "Build a DCF model with 3-year projections",
  "Comparable analysis vs top protocols in the sector",
  "Revenue projection based on current growth rate",
  "Bull/base/bear scenario analysis for token valuation",
  "Unit economics breakdown — cost per user, LTV/CAC",
  "Market sizing — TAM/SAM/SOM for this vertical",
];

function parseModelContent(content: string): ParsedModel | null {
  try {
    const data = JSON.parse(content);
    if (data.title && Array.isArray(data.sections)) return data as ParsedModel;
    return null;
  } catch {
    return null;
  }
}

function formatChartValue(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") return `${(value * 100).toFixed(1)}%`;
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function buildEditPrompt(target: EditTarget, rationale: string, referenceUrl?: string): string {
  let prompt = "";
  switch (target.kind) {
    case "assumption":
      prompt = `Update the assumption "${target.label}" (currently: ${target.currentValue}).`;
      break;
    case "table-cell":
      prompt = `In the table "${target.sectionHeading}", update the cell at row ${(target.rowIndex || 0) + 1}, column "${target.colName}" (currently: ${target.currentValue}).`;
      break;
    case "table-row":
      prompt = `In the table "${target.sectionHeading}", update row ${(target.rowIndex || 0) + 1}: "${target.currentValue}".`;
      break;
    case "metric":
      prompt = `Update the metric "${target.label}" (currently: ${target.currentValue}).`;
      break;
    case "scenario":
      prompt = `Update the "${target.label}" scenario (currently: ${target.currentValue}).`;
      break;
    case "section":
      prompt = `Update the section "${target.label}".`;
      break;
    case "methodology":
      prompt = `Update the methodology section.`;
      break;
  }
  prompt += `\n\nRationale: ${rationale}`;
  if (referenceUrl) prompt += `\n\nReference: ${referenceUrl}`;
  prompt += `\n\nIMPORTANT: Update this specific component AND recalculate/adjust any downstream values, tables, charts, and commentary that depend on this change. Keep everything else unchanged unless it needs to reflect this update.`;
  return prompt;
}

function InlineEditForm({ target, onSubmit, onCancel, isPending }: {
  target: EditTarget;
  onSubmit: (rationale: string, referenceUrl?: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [rationale, setRationale] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [showRef, setShowRef] = useState(false);

  return (
    <div className="mt-2 border border-blue-500/20 bg-blue-500/5 rounded-lg p-3 space-y-2" data-testid={`edit-form-${target.label}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-blue-400/80 font-medium uppercase tracking-wider">
          Edit: {target.label}
        </div>
        <button onClick={onCancel} className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground" data-testid="button-cancel-edit">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground/60 truncate">
        Current: {target.currentValue.length > 120 ? target.currentValue.slice(0, 120) + "..." : target.currentValue}
      </div>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (rationale.trim()) onSubmit(rationale.trim(), refUrl.trim() || undefined);
          }
        }}
        placeholder="What should change and why? e.g. 'Growth rate should be 35% based on Q1 actuals showing acceleration...'"
        className="w-full bg-background/50 border border-border/30 rounded px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/30 resize-none"
        rows={2}
        autoFocus
        disabled={isPending}
        data-testid="input-edit-rationale"
      />
      {showRef ? (
        <input
          type="url"
          value={refUrl}
          onChange={(e) => setRefUrl(e.target.value)}
          placeholder="https://... (supporting data, article, or report)"
          className="w-full bg-background/50 border border-border/30 rounded px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/30"
          disabled={isPending}
          data-testid="input-edit-reference"
        />
      ) : (
        <button
          onClick={() => setShowRef(true)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          data-testid="button-add-reference"
        >
          <Link2 className="w-2.5 h-2.5" />
          Add reference link
        </button>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (rationale.trim()) onSubmit(rationale.trim(), refUrl.trim() || undefined); }}
          disabled={!rationale.trim() || isPending}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-500/15 text-blue-400 rounded hover:bg-blue-500/25 transition-colors disabled:opacity-40"
          data-testid="button-submit-edit"
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          Update ($0.50)
        </button>
        <button
          onClick={onCancel}
          className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

function EditButton({ onClick, testId }: { onClick: () => void; testId?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="opacity-0 group-hover/editable:opacity-100 focus:opacity-100 p-0.5 text-muted-foreground/30 hover:text-blue-400 focus:text-blue-400 transition-all"
      data-testid={testId || "button-inline-edit"}
    >
      <Pencil className="w-2.5 h-2.5" />
    </button>
  );
}

function ChartSectionRenderer({ section }: { section: ChartSection }) {
  const color = section.color || "#3b6fd4";

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">{section.heading}</h4>
      <div className="h-48 w-full" data-testid={`chart-${section.heading}`}>
        <ResponsiveContainer width="100%" height="100%">
          {section.chartType === "bar" ? (
            <BarChart data={section.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => formatChartValue(v, section.valueFormat)} width={60} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: "6px", fontSize: "11px" }}
                formatter={(v: number) => [formatChartValue(v, section.valueFormat), section.heading]}
              />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={section.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.15)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v: number) => formatChartValue(v, section.valueFormat)} width={60} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.3)", borderRadius: "6px", fontSize: "11px" }}
                formatter={(v: number) => [formatChartValue(v, section.valueFormat), section.heading]}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ModelSectionRenderer({ section, onEdit }: { section: ModelSection; onEdit: (target: EditTarget) => void }) {
  if (section.type === "chart" && Array.isArray((section as ChartSection).data)) {
    return (
      <div className="group/editable relative">
        <div className="absolute right-0 top-0">
          <EditButton testId={`button-edit-chart-${section.heading}`} onClick={() => onEdit({
            kind: "section",
            label: section.heading,
            currentValue: `Chart: ${(section as ChartSection).data.map(d => `${d.label}=${d.value}`).join(", ")}`,
            sectionHeading: section.heading,
          })} />
        </div>
        <ChartSectionRenderer section={section as ChartSection} />
      </div>
    );
  }

  if (section.type === "table") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 group/editable">
          <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider" data-testid={`text-section-heading-${section.heading}`}>{section.heading}</h4>
          <EditButton testId={`button-edit-table-${section.heading}`} onClick={() => onEdit({
            kind: "section",
            label: section.heading,
            currentValue: `Table with ${section.rows.length} rows`,
            sectionHeading: section.heading,
          })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid={`table-${section.heading}`}>
            <thead>
              <tr className="border-b border-border/30">
                {(section.columns || []).map((col, i) => (
                  <th key={i} className="text-left py-2 px-3 text-muted-foreground font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(section.rows || []).map((row, ri) => (
                <tr key={ri} className="border-b border-border/10 group/editable hover:bg-accent/5 transition-colors">
                  {(Array.isArray(row) ? row : []).map((cell, ci) => (
                    <td key={ci} className={`py-2 px-3 whitespace-nowrap ${ci === 0 ? "text-foreground/80 font-medium" : "text-foreground/70 tabular-nums"}`}>
                      <span className="inline-flex items-center gap-1">
                        {cell}
                        {ci > 0 && (
                          <EditButton testId={`button-edit-cell-${ri}-${ci}`} onClick={() => onEdit({
                            kind: "table-cell",
                            label: `${row[0]} → ${section.columns[ci]}`,
                            currentValue: cell,
                            sectionHeading: section.heading,
                            rowIndex: ri,
                            colIndex: ci,
                            colName: section.columns[ci],
                          })} />
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {section.note && (
          <p className="text-[11px] text-muted-foreground/70 italic mt-1">{section.note}</p>
        )}
      </div>
    );
  }

  if (section.type === "metrics") {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">{section.heading}</h4>
        <div className="grid grid-cols-2 gap-3">
          {(section.items || []).map((item, i) => (
            <div key={i} className="bg-accent/5 border border-border/20 rounded-md p-3 group/editable relative" data-testid={`metric-${item.label}`}>
              <div className="absolute right-2 top-2">
                <EditButton testId={`button-edit-metric-${item.label}`} onClick={() => onEdit({
                  kind: "metric",
                  label: item.label,
                  currentValue: `${item.value}${item.detail ? ` — ${item.detail}` : ""}`,
                  sectionHeading: section.heading,
                })} />
              </div>
              <div className="text-[11px] text-muted-foreground mb-1">{item.label}</div>
              <div className="text-sm font-semibold text-foreground tabular-nums">{item.value}</div>
              {item.detail && <div className="text-[10px] text-muted-foreground/60 mt-1">{item.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section.type === "scenarios") {
    const scenarioColors: Record<string, string> = {
      bull: "border-emerald-500/30 bg-emerald-500/5",
      base: "border-blue-500/30 bg-blue-500/5",
      bear: "border-red-500/30 bg-red-500/5",
    };
    const scenarioIcons: Record<string, typeof TrendingUp> = {
      bull: TrendingUp,
      base: Target,
      bear: BarChart3,
    };
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">{section.heading}</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(section.scenarios || []).map((s, i) => {
            const key = s.name.toLowerCase();
            const colorClass = scenarioColors[key] || "border-border/30 bg-accent/5";
            const IconComp = scenarioIcons[key] || Target;
            return (
              <div key={i} className={`border rounded-md p-3 ${colorClass} group/editable relative`} data-testid={`scenario-${s.name}`}>
                <div className="absolute right-2 top-2">
                  <EditButton testId={`button-edit-scenario-${s.name}`} onClick={() => onEdit({
                    kind: "scenario",
                    label: s.name,
                    currentValue: `${s.outcome} (${s.probability}) — ${s.keyDrivers.slice(0, 80)}`,
                    sectionHeading: section.heading,
                  })} />
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <IconComp className="w-3 h-3 text-foreground/60" />
                  <span className="text-xs font-medium text-foreground/90">{s.name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{s.probability}</span>
                </div>
                <div className="text-sm font-semibold text-foreground mb-1">{s.outcome}</div>
                <div className="text-[10px] text-muted-foreground/70">{s.keyDrivers}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (section.type === "text") {
    return (
      <div className="space-y-2 group/editable relative">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">{section.heading}</h4>
          <EditButton testId={`button-edit-text-${section.heading}`} onClick={() => onEdit({
            kind: "section",
            label: section.heading,
            currentValue: section.content.slice(0, 200),
            sectionHeading: section.heading,
          })} />
        </div>
        <div className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap">{section.content}</div>
      </div>
    );
  }

  return null;
}

function ModelCard({ model, companyId, onDelete }: { model: FinancialModel; companyId: string; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const { toast } = useToast();
  const parsed = (model.status === "complete" || (model.status === "error" && model.content)) ? parseModelContent(model.content) : null;
  const isGenerating = model.status === "generating";
  const isError = model.status === "error" && !parsed;

  const conversationTurns = model.conversationHistory
    ? (() => { try { return (JSON.parse(model.conversationHistory) as Array<{ role: string }>).filter(h => h.role === "user").length; } catch { return 0; } })()
    : 0;

  const editMutation = useMutation({
    mutationFn: async ({ prompt }: { prompt: string }) => {
      const validateRes = await apiRequest("POST", `/api/models/${model.id}/iterate/validate`, { prompt });
      const validation = await validateRes.json();
      if (!validation.valid) throw new Error(validation.message || "Validation failed");

      const res = await apiRequest("POST", `/api/models/${model.id}/iterate`, { prompt });
      return res.json();
    },
    onSuccess: () => {
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "models"] });
      toast({ title: "Model update started", description: "Applying your change and recalculating..." });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleEdit = (target: EditTarget) => {
    setEditTarget(target);
  };

  const handleEditSubmit = (rationale: string, referenceUrl?: string) => {
    if (!editTarget) return;
    const prompt = buildEditPrompt(editTarget, rationale, referenceUrl);
    editMutation.mutate({ prompt });
  };

  return (
    <div className="border border-border/30 rounded-lg bg-card/30 overflow-hidden" data-testid={`card-model-${model.id}`}>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/5 transition-colors"
        onClick={() => !isGenerating && setExpanded(!expanded)}
        data-testid={`button-toggle-model-${model.id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isGenerating ? (
            <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />
          ) : isError ? (
            <div className="w-3.5 h-3.5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] text-red-400">!</span>
            </div>
          ) : (
            <div className="w-3.5 h-3.5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-2 h-2 text-emerald-400" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-xs font-medium text-foreground truncate" data-testid={`text-model-title-${model.id}`}>
              {model.title}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[10px] text-muted-foreground truncate">{model.prompt}</p>
              {conversationTurns > 1 && (
                <span className="text-[9px] text-blue-400/60 bg-blue-500/10 px-1 py-0.5 rounded whitespace-nowrap">
                  {conversationTurns} turns
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(model.updatedAt || model.createdAt).toLocaleDateString()}
          </span>
          {model.status === "complete" && (
            <div onClick={(e) => e.stopPropagation()}>
              <AddToMasterReport blockType="model" referenceId={model.id} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(model.id); }}
            className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
            data-testid={`button-delete-model-${model.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
          {!isGenerating && (
            expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
          )}
        </div>
      </div>

      {expanded && parsed && (
        <div className="border-t border-border/20 px-4 py-4 space-y-5">
          {parsed.assumptions && parsed.assumptions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">Key Assumptions</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {parsed.assumptions.map((a, i) => (
                  <div key={i} className="group/editable flex items-start gap-2 text-[11px] bg-accent/5 border border-border/15 rounded px-2.5 py-2 relative" data-testid={`assumption-${a.label}`}>
                    <span className="text-muted-foreground whitespace-nowrap">{a.label}:</span>
                    <span className="text-foreground font-medium">{a.value}</span>
                    {a.basis && <span className="text-muted-foreground/50 italic text-[10px]">({a.basis})</span>}
                    <div className="ml-auto flex-shrink-0">
                      <EditButton testId={`button-edit-assumption-${a.label}`} onClick={() => handleEdit({
                        kind: "assumption",
                        label: a.label,
                        currentValue: `${a.value} (${a.basis})`,
                      })} />
                    </div>
                  </div>
                ))}
              </div>
              {editTarget?.kind === "assumption" && (
                <InlineEditForm
                  target={editTarget}
                  onSubmit={handleEditSubmit}
                  onCancel={() => setEditTarget(null)}
                  isPending={editMutation.isPending}
                />
              )}
            </div>
          )}

          {parsed.sections.map((section, i) => (
            <div key={i}>
              <ModelSectionRenderer section={section} onEdit={handleEdit} />
              {editTarget && editTarget.sectionHeading === section.heading && editTarget.kind !== "assumption" && (
                <InlineEditForm
                  target={editTarget}
                  onSubmit={handleEditSubmit}
                  onCancel={() => setEditTarget(null)}
                  isPending={editMutation.isPending}
                />
              )}
            </div>
          ))}

          {parsed.methodology && (
            <div className="pt-2 border-t border-border/15 group/editable">
              <div className="flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground/50 italic flex-1">{parsed.methodology}</p>
                <EditButton testId="button-edit-methodology" onClick={() => handleEdit({
                  kind: "methodology",
                  label: "Methodology",
                  currentValue: parsed.methodology!.slice(0, 200),
                })} />
              </div>
              {editTarget?.kind === "methodology" && (
                <InlineEditForm
                  target={editTarget}
                  onSubmit={handleEditSubmit}
                  onCancel={() => setEditTarget(null)}
                  isPending={editMutation.isPending}
                />
              )}
            </div>
          )}
        </div>
      )}

      {expanded && isError && (
        <div className="border-t border-border/20 px-4 py-3">
          <p className="text-xs text-red-400/80">Model generation failed. Please try again with a different prompt.</p>
        </div>
      )}

      {isGenerating && (
        <div className="border-t border-border/20 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-1 flex-1 bg-accent/10 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500/40 rounded-full animate-pulse" style={{ width: "60%" }} />
            </div>
            <span className="text-[10px] text-muted-foreground">Generating model...</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ModellingTab({ companyId, companyName }: ModellingTabProps) {
  const [prompt, setPrompt] = useState("");
  const [showExamples, setShowExamples] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: models = [], isLoading } = useQuery<FinancialModel[]>({
    queryKey: ["/api/companies", companyId, "models"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/companies/${companyId}/models`);
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.some((m: FinancialModel) => m.status === "generating")) return 3000;
      return false;
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (modelPrompt: string) => {
      const validateRes = await apiRequest("POST", `/api/companies/${companyId}/models/validate`, { prompt: modelPrompt });
      const validation = await validateRes.json();
      if (!validation.valid) throw new Error(validation.message || "Validation failed");

      const res = await apiRequest("POST", `/api/companies/${companyId}/models`, { prompt: modelPrompt });
      return res.json();
    },
    onSuccess: () => {
      setPrompt("");
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "models"] });
      toast({ title: "Model generation started", description: "Your financial model is being built..." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to generate model", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (modelId: string) => {
      await apiRequest("DELETE", `/api/models/${modelId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "models"] });
      toast({ title: "Model deleted" });
    },
  });

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || generateMutation.isPending) return;
    generateMutation.mutate(trimmed);
  };

  return (
    <div className="space-y-5" data-testid="panel-modelling">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">Financial Modelling</h3>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              Describe what you want to model — AI builds structured projections using {companyName}'s data.
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground/40 bg-accent/10 px-2 py-0.5 rounded">$0.50/model</span>
        </div>

        <div className="relative">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="e.g. Build a DCF model with 3-year revenue projections..."
            className="w-full bg-accent/5 border border-border/30 rounded-lg px-3 py-2.5 pr-20 text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/30 resize-none min-h-[60px]"
            rows={2}
            disabled={generateMutation.isPending}
            data-testid="input-model-prompt"
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1">
            <button
              onClick={() => setShowExamples(!showExamples)}
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors px-1.5 py-0.5"
              data-testid="button-show-examples"
            >
              examples
            </button>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || generateMutation.isPending}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-blue-500/15 text-blue-400 rounded hover:bg-blue-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="button-generate-model"
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              Generate
            </button>
          </div>
        </div>

        {showExamples && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setPrompt(ex); setShowExamples(false); inputRef.current?.focus(); }}
                className="text-[10px] text-muted-foreground/60 bg-accent/5 border border-border/15 rounded px-2 py-1 hover:text-foreground/80 hover:border-border/30 transition-colors"
                data-testid={`button-example-${i}`}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-xs text-muted-foreground/50">No models yet. Describe what you want to model above.</p>
          </div>
        ) : (
          models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              companyId={companyId}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
