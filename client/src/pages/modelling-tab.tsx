import { useState, useRef, useEffect } from "react";
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
  ListChecks,
  Zap,
  AlertTriangle,
  Search,
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

interface QueuedEdit {
  id: string;
  target: EditTarget;
  rationale: string;
  referenceUrl?: string;
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

function describeEdit(edit: QueuedEdit): string {
  const t = edit.target;
  let desc = "";
  switch (t.kind) {
    case "assumption":
      desc = `CHANGE #${edit.id}: Update assumption "${t.label}" (currently: ${t.currentValue}).\nRationale: ${edit.rationale}`;
      break;
    case "table-cell":
      desc = `CHANGE #${edit.id}: In table "${t.sectionHeading}", update cell at row "${t.currentValue}" in column "${t.colName}".\nRationale: ${edit.rationale}`;
      break;
    case "table-row":
      desc = `CHANGE #${edit.id}: In table "${t.sectionHeading}", update row ${(t.rowIndex || 0) + 1}: "${t.currentValue}".\nRationale: ${edit.rationale}`;
      break;
    case "metric":
      desc = `CHANGE #${edit.id}: Update metric "${t.label}" (currently: ${t.currentValue}).\nRationale: ${edit.rationale}`;
      break;
    case "scenario":
      desc = `CHANGE #${edit.id}: Update "${t.label}" scenario (currently: ${t.currentValue}).\nRationale: ${edit.rationale}`;
      break;
    case "section":
      desc = `CHANGE #${edit.id}: Update section "${t.label}".\nRationale: ${edit.rationale}`;
      break;
    case "methodology":
      desc = `CHANGE #${edit.id}: Update methodology.\nRationale: ${edit.rationale}`;
      break;
  }
  if (edit.referenceUrl) desc += `\nReference: ${edit.referenceUrl}`;
  return desc;
}

function buildBatchPrompt(edits: QueuedEdit[]): string {
  const changeList = edits.map(describeEdit).join("\n\n");
  return `BATCH MODEL CALIBRATION — ${edits.length} change${edits.length > 1 ? "s" : ""} to apply:

${changeList}

ORCHESTRATION INSTRUCTIONS:
1. Apply each numbered change to its specific target component.
2. CRITICAL: After applying all direct changes, analyze the ENTIRE model for cascading impacts. Identify every other value, calculation, table cell, chart data point, metric, scenario outcome, or commentary that depends on or references the changed values. Update ALL of them for internal consistency.
3. For example: if a revenue growth rate changes, update revenue projections, DCF cash flows, terminal value, implied valuations, buyback yields, scenario outcomes, sensitivity tables, and any commentary that references those figures.
4. The goal is a fully calibrated, internally consistent model after all changes are applied — not just the targeted cells.
5. Keep everything that is NOT affected by these changes exactly as-is.
6. Return the complete updated model JSON.`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  let html = escaped
    .replace(/^### (.+)$/gm, '<h4 class="text-[11px] font-semibold text-foreground/90 mt-2 mb-0.5">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="text-xs font-semibold text-foreground/90 mt-2 mb-0.5">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground/90 font-semibold">$1</strong>')
    .replace(/\n\n/g, '</p><p class="mb-1.5">')
    .replace(/\n/g, "<br/>");
  return `<p class="mb-1.5">${html}</p>`;
}

function InlineEditForm({ target, onQueue, onCancel }: {
  target: EditTarget;
  onQueue: (rationale: string, referenceUrl?: string) => void;
  onCancel: () => void;
}) {
  const [rationale, setRationale] = useState("");
  const [refUrl, setRefUrl] = useState("");
  const [showRef, setShowRef] = useState(false);

  return (
    <div className="mt-1.5 border border-blue-500/20 bg-blue-500/5 rounded px-2.5 py-2 space-y-1.5" data-testid={`edit-form-${target.label}`}>
      <div className="flex items-center justify-between">
        <div className="text-[9px] text-blue-400/80 font-medium uppercase tracking-wider">
          Edit: {target.label}
        </div>
        <button onClick={onCancel} className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground" data-testid="button-cancel-edit">
          <X className="w-2.5 h-2.5" />
        </button>
      </div>
      <div className="text-[9px] text-muted-foreground/50 truncate">
        Current: {target.currentValue.length > 100 ? target.currentValue.slice(0, 100) + "..." : target.currentValue}
      </div>
      <textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (rationale.trim()) onQueue(rationale.trim(), refUrl.trim() || undefined);
          }
        }}
        placeholder="What should change and why?"
        className="w-full bg-background/50 border border-border/30 rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/30 resize-none"
        rows={2}
        autoFocus
        data-testid="input-edit-rationale"
      />
      {showRef ? (
        <input
          type="url"
          value={refUrl}
          onChange={(e) => setRefUrl(e.target.value)}
          placeholder="https://..."
          className="w-full bg-background/50 border border-border/30 rounded px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/30"
          data-testid="input-edit-reference"
        />
      ) : (
        <button
          onClick={() => setShowRef(true)}
          className="flex items-center gap-1 text-[9px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          data-testid="button-add-reference"
        >
          <Link2 className="w-2 h-2" />
          Add reference
        </button>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (rationale.trim()) onQueue(rationale.trim(), refUrl.trim() || undefined); }}
          disabled={!rationale.trim()}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-blue-500/15 text-blue-400 rounded hover:bg-blue-500/25 transition-colors disabled:opacity-40"
          data-testid="button-queue-edit"
        >
          <Plus className="w-2.5 h-2.5" />
          Add to Batch
        </button>
        <button onClick={onCancel} className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground">
          cancel
        </button>
      </div>
    </div>
  );
}

function BatchTray({ edits, onRemove, onApply, onClear, isPending }: {
  edits: QueuedEdit[];
  onRemove: (id: string) => void;
  onApply: () => void;
  onClear: () => void;
  isPending: boolean;
}) {
  if (edits.length === 0) return null;

  return (
    <div className="border border-amber-500/25 bg-amber-500/5 rounded px-2.5 py-2 space-y-1.5" data-testid="batch-tray">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <ListChecks className="w-3 h-3 text-amber-400/80" />
          <span className="text-[10px] font-medium text-amber-300/90">
            {edits.length} Pending
          </span>
        </div>
        <button onClick={onClear} className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground" data-testid="button-clear-batch">
          clear
        </button>
      </div>
      <div className="space-y-0.5">
        {edits.map((edit) => (
          <div key={edit.id} className="flex items-center gap-1.5 text-[10px] bg-background/30 border border-border/10 rounded px-2 py-1" data-testid={`batch-item-${edit.id}`}>
            <span className="text-amber-400/70 font-medium truncate flex-shrink-0">{edit.target.label}</span>
            <span className="text-muted-foreground/40">—</span>
            <span className="text-foreground/60 truncate flex-1">{edit.rationale.length > 60 ? edit.rationale.slice(0, 60) + "..." : edit.rationale}</span>
            <button onClick={() => onRemove(edit.id)} className="p-0.5 text-muted-foreground/30 hover:text-red-400 flex-shrink-0" data-testid={`button-remove-batch-${edit.id}`}>
              <X className="w-2 h-2" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={onApply}
        disabled={isPending}
        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-amber-500/15 text-amber-300 rounded hover:bg-amber-500/25 transition-colors disabled:opacity-40 w-full justify-center"
        data-testid="button-apply-batch"
      >
        {isPending ? (
          <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Calibrating...</>
        ) : (
          <><Zap className="w-2.5 h-2.5" /> Apply {edits.length} Change{edits.length !== 1 ? "s" : ""} ($0.50)</>
        )}
      </button>
    </div>
  );
}

interface GlaringMiss {
  description: string;
  significance: string;
  dataSources: string[];
}

const GLARING_MISS_PROMPT_BUDGET = 4500;

function buildGlaringMissPrompt(miss: GlaringMiss): string {
  const prompt = `[GLARING MISS] Deep-research a critical gap in this model and augment it:

MISSING: ${miss.description}

SIGNIFICANCE: ${miss.significance}

INSTRUCTIONS: (1) Deeply research the missing topic — understand mechanics, fee flows, growth dynamics. (2) Add NEW assumptions, sections (tables/metrics/charts/scenarios). (3) Update ALL existing values affected — DCF, multiples, scenarios, sensitivity, commentary. (4) Return complete recalibrated model JSON.`;

  if (prompt.length > GLARING_MISS_PROMPT_BUDGET) {
    return prompt.slice(0, GLARING_MISS_PROMPT_BUDGET);
  }
  return prompt;
}

function buildGlaringMissHistoryEntry(miss: GlaringMiss): string {
  return `[Glaring Miss] ${miss.description.slice(0, 200)}`;
}

function GlaringMissForm({ onSubmit, onCancel, isPending }: {
  onSubmit: (miss: GlaringMiss) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [description, setDescription] = useState("");
  const [significance, setSignificance] = useState("");
  const [dataSourcesText, setDataSourcesText] = useState("");
  const [sources, setSources] = useState<string[]>([]);

  const addSource = () => {
    const newSources = dataSourcesText
      .split(/[\n,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && (s.startsWith("/") || s.startsWith("http")));
    if (newSources.length > 0) {
      setSources(prev => [...prev, ...newSources.filter(ns => !prev.includes(ns))]);
      setDataSourcesText("");
    }
  };

  const handleSubmit = () => {
    if (!description.trim() || !significance.trim()) return;
    const allSources = [
      ...sources,
      ...dataSourcesText.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0 && (s.startsWith("/") || s.startsWith("http"))),
    ];
    const uniqueSources = [...new Set(allSources)];
    onSubmit({
      description: description.trim(),
      significance: significance.trim(),
      dataSources: uniqueSources,
    });
  };

  return (
    <div className="border border-orange-500/25 bg-orange-500/5 rounded px-3 py-2.5 space-y-2" data-testid="glaring-miss-form">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-orange-400/80" />
          <span className="text-[10px] font-medium text-orange-300/90 uppercase tracking-wider">Flag Missing Analysis</span>
        </div>
        <button onClick={onCancel} className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground" data-testid="button-cancel-miss">
          <X className="w-2.5 h-2.5" />
        </button>
      </div>

      <p className="text-[9px] text-muted-foreground/50">
        Identify a critical dimension this model doesn't account for. An AI research agent will deeply analyze the topic, pull available data, and augment the model with new sections, assumptions, and recalculated projections.
      </p>

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider">What's Missing?</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. HIP-3 revenues — the model doesn't account for revenue generated by the HIP-3 mechanism..."
          className="w-full bg-background/50 border border-border/30 rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-500/30 resize-none"
          rows={3}
          autoFocus
          data-testid="input-miss-description"
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider">Economic Significance</label>
        <textarea
          value={significance}
          onChange={(e) => setSignificance(e.target.value)}
          placeholder="e.g. Could add $50-200M in annual protocol revenue..."
          className="w-full bg-background/50 border border-border/30 rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-500/30 resize-none"
          rows={2}
          data-testid="input-miss-significance"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider">Data Sources (Optional)</label>
          <button
            onClick={addSource}
            className="text-[9px] text-orange-400/60 hover:text-orange-400 transition-colors"
          >
            + add source
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/35">
          API endpoints, dashboards, or article URLs with relevant data.
        </p>
        {sources.length > 0 && (
          <div className="space-y-0.5">
            {sources.map((src, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px] bg-background/30 border border-border/10 rounded px-2 py-0.5 font-mono">
                <a href={src.startsWith("/") ? undefined : src} className="text-foreground/60 truncate flex-1">{src}</a>
                <button onClick={() => setSources(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground/30 hover:text-red-400 flex-shrink-0">
                  <X className="w-2 h-2" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={dataSourcesText}
          onChange={(e) => setDataSourcesText(e.target.value)}
          placeholder={"/api/v1/fees/summary\nhttps://api.example.com/data"}
          className="w-full bg-background/50 border border-border/30 rounded px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-500/30 resize-none font-mono"
          rows={3}
          data-testid="input-data-sources"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!description.trim() || !significance.trim() || isPending}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-orange-500/15 text-orange-300 rounded hover:bg-orange-500/25 transition-colors disabled:opacity-40"
          data-testid="button-submit-miss"
        >
          {isPending ? (
            <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Researching...</>
          ) : (
            <><Search className="w-2.5 h-2.5" /> Run Deep Analysis ($0.50)</>
          )}
        </button>
        <button onClick={onCancel} className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground">
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
      className="opacity-0 group-hover/editable:opacity-100 focus:opacity-100 p-0.5 text-muted-foreground/25 hover:text-blue-400 focus:text-blue-400 transition-all"
      data-testid={testId || "button-inline-edit"}
    >
      <Pencil className="w-2 h-2" />
    </button>
  );
}

function EditButtonQueued({ testId }: { testId?: string }) {
  return (
    <span className="p-0.5 text-amber-400/60" data-testid={testId}>
      <ListChecks className="w-2 h-2" />
    </span>
  );
}

function ChartSectionRenderer({ section }: { section: ChartSection }) {
  const color = section.color || "#3b6fd4";

  return (
    <div className="h-32 w-full" data-testid={`chart-${section.heading}`}>
      <ResponsiveContainer width="100%" height="100%">
        {section.chartType === "bar" ? (
          <BarChart data={section.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.1)" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground)/0.6)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground)/0.5)" }} tickFormatter={(v: number) => formatChartValue(v, section.valueFormat)} width={48} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.2)", borderRadius: "4px", fontSize: "10px", padding: "4px 8px" }}
              formatter={(v: number) => [formatChartValue(v, section.valueFormat), ""]}
              labelStyle={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}
            />
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={section.data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.1)" />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground)/0.6)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground)/0.5)" }} tickFormatter={(v: number) => formatChartValue(v, section.valueFormat)} width={48} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.2)", borderRadius: "4px", fontSize: "10px", padding: "4px 8px" }}
              formatter={(v: number) => [formatChartValue(v, section.valueFormat), ""]}
              labelStyle={{ fontSize: "9px", color: "hsl(var(--muted-foreground))" }}
            />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={{ r: 2, fill: color }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="h-px flex-1 bg-border/15" />
      <h4 className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-[0.08em] flex-shrink-0" data-testid={`text-section-heading-${children}`}>{children}</h4>
      <div className="h-px flex-1 bg-border/15" />
    </div>
  );
}

function ModelSectionRenderer({ section, onEdit, isQueued }: { section: ModelSection; onEdit: (target: EditTarget) => void; isQueued: (label: string, sectionHeading?: string) => boolean }) {
  if (section.type === "chart" && Array.isArray((section as ChartSection).data)) {
    const queued = isQueued(section.heading, section.heading);
    return (
      <div className="group/editable relative">
        <div className="absolute right-0 top-0 z-10">
          {queued ? <EditButtonQueued testId={`queued-chart-${section.heading}`} /> : (
            <EditButton testId={`button-edit-chart-${section.heading}`} onClick={() => onEdit({
              kind: "section",
              label: section.heading,
              currentValue: `Chart: ${(section as ChartSection).data.map(d => `${d.label}=${d.value}`).join(", ")}`,
              sectionHeading: section.heading,
            })} />
          )}
        </div>
        <SectionHeading>{section.heading}</SectionHeading>
        <ChartSectionRenderer section={section as ChartSection} />
      </div>
    );
  }

  if (section.type === "table") {
    return (
      <div>
        <div className="flex items-center gap-2 group/editable">
          <SectionHeading>{section.heading}</SectionHeading>
          {isQueued(section.heading, section.heading) ? <EditButtonQueued /> : (
            <EditButton testId={`button-edit-table-${section.heading}`} onClick={() => onEdit({
              kind: "section",
              label: section.heading,
              currentValue: `Table with ${section.rows.length} rows`,
              sectionHeading: section.heading,
            })} />
          )}
        </div>
        <div className="overflow-x-auto -mx-0.5">
          <table className="w-full text-[10px]" data-testid={`table-${section.heading}`}>
            <thead>
              <tr className="border-b border-border/25">
                {(section.columns || []).map((col, i) => (
                  <th key={i} className={`text-left py-1 px-1.5 text-muted-foreground/70 font-semibold whitespace-nowrap ${i === 0 ? "" : "text-right"}`}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(section.rows || []).map((row, ri) => (
                <tr key={ri} className="border-b border-border/8 group/editable hover:bg-accent/3 transition-colors">
                  {(Array.isArray(row) ? row : []).map((cell, ci) => {
                    const cellLabel = `${row[0]} → ${section.columns[ci]}`;
                    const cellQueued = ci > 0 && isQueued(cellLabel, section.heading);
                    return (
                      <td key={ci} className={`py-0.5 px-1.5 whitespace-nowrap ${ci === 0 ? "text-foreground/70 font-medium" : "text-foreground/60 tabular-nums text-right"}`}>
                        <span className="inline-flex items-center gap-0.5">
                          {cell}
                          {ci > 0 && (
                            cellQueued ? <EditButtonQueued testId={`queued-cell-${ri}-${ci}`} /> : (
                              <EditButton testId={`button-edit-cell-${ri}-${ci}`} onClick={() => onEdit({
                                kind: "table-cell",
                                label: cellLabel,
                                currentValue: cell,
                                sectionHeading: section.heading,
                                rowIndex: ri,
                                colIndex: ci,
                                colName: section.columns[ci],
                              })} />
                            )
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {section.note && (
          <p className="text-[9px] text-muted-foreground/45 mt-1 leading-relaxed">{section.note}</p>
        )}
      </div>
    );
  }

  if (section.type === "metrics") {
    return (
      <div>
        <SectionHeading>{section.heading}</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(section.items || []).map((item, i) => {
            const queued = isQueued(item.label, section.heading);
            return (
              <div key={i} className="bg-accent/3 border border-border/12 rounded px-2 py-1.5 group/editable relative" data-testid={`metric-${item.label}`}>
                <div className="absolute right-1 top-1">
                  {queued ? <EditButtonQueued testId={`queued-metric-${item.label}`} /> : (
                    <EditButton testId={`button-edit-metric-${item.label}`} onClick={() => onEdit({
                      kind: "metric",
                      label: item.label,
                      currentValue: `${item.value}${item.detail ? ` — ${item.detail}` : ""}`,
                      sectionHeading: section.heading,
                    })} />
                  )}
                </div>
                <div className="text-[9px] text-muted-foreground/50 uppercase tracking-wider mb-0.5 leading-tight">{item.label}</div>
                <div className="text-[13px] font-bold text-foreground tabular-nums leading-none">{item.value}</div>
                {item.detail && <div className="text-[9px] text-muted-foreground/40 mt-0.5 leading-tight">{item.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (section.type === "scenarios") {
    const scenarioColors: Record<string, string> = {
      bull: "border-emerald-500/20 bg-emerald-500/3",
      base: "border-blue-500/20 bg-blue-500/3",
      bear: "border-red-500/20 bg-red-500/3",
    };
    const labelColors: Record<string, string> = {
      bull: "text-emerald-400",
      base: "text-blue-400",
      bear: "text-red-400",
    };
    return (
      <div>
        <SectionHeading>{section.heading}</SectionHeading>
        <div className="grid grid-cols-3 gap-1.5">
          {(section.scenarios || []).map((s, i) => {
            const key = s.name.toLowerCase();
            const colorClass = scenarioColors[key] || "border-border/20 bg-accent/3";
            const labelColor = labelColors[key] || "text-foreground/70";
            const queued = isQueued(s.name, section.heading);
            return (
              <div key={i} className={`border rounded px-2 py-1.5 ${colorClass} group/editable relative`} data-testid={`scenario-${s.name}`}>
                <div className="absolute right-1 top-1">
                  {queued ? <EditButtonQueued testId={`queued-scenario-${s.name}`} /> : (
                    <EditButton testId={`button-edit-scenario-${s.name}`} onClick={() => onEdit({
                      kind: "scenario",
                      label: s.name,
                      currentValue: `${s.outcome} (${s.probability}) — ${s.keyDrivers.slice(0, 80)}`,
                      sectionHeading: section.heading,
                    })} />
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-0.5">
                  <span className={`text-[10px] font-bold ${labelColor}`}>{s.name}</span>
                  <span className="text-[9px] text-muted-foreground/50">{s.probability}</span>
                </div>
                <div className="text-[11px] font-semibold text-foreground/90 mb-0.5">{s.outcome}</div>
                <div className="text-[9px] text-muted-foreground/45 leading-snug">{s.keyDrivers}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (section.type === "text") {
    const queued = isQueued(section.heading, section.heading);
    return (
      <div className="group/editable relative">
        <div className="flex items-center gap-1 mb-1">
          <SectionHeading>{section.heading}</SectionHeading>
          {queued ? <EditButtonQueued /> : (
            <EditButton testId={`button-edit-text-${section.heading}`} onClick={() => onEdit({
              kind: "section",
              label: section.heading,
              currentValue: section.content.slice(0, 200),
              sectionHeading: section.heading,
            })} />
          )}
        </div>
        <div
          className="text-[10px] text-foreground/65 leading-relaxed [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:text-foreground/85 [&_h4]:text-[10px] [&_h4]:font-semibold [&_h4]:text-foreground/80 [&_strong]:text-foreground/85"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
        />
      </div>
    );
  }

  return null;
}

const GENERATION_STEPS = [
  { label: "Collecting company data & market context", minSec: 0 },
  { label: "Analyzing sector comparables & on-chain metrics", minSec: 8 },
  { label: "Building financial projections & assumptions", minSec: 20 },
  { label: "Running scenario analysis (bull / base / bear)", minSec: 35 },
  { label: "Generating charts & sensitivity tables", minSec: 50 },
  { label: "Finalizing model & cross-checking outputs", minSec: 65 },
];

function GeneratingIndicator({ createdAt }: { createdAt: string | Date }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [createdAt]);

  const currentStepIdx = GENERATION_STEPS.reduce((acc, step, i) => (elapsed >= step.minSec ? i : acc), 0);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;

  return (
    <div className="border-t border-border/15 px-3 py-3 space-y-2" data-testid="generating-indicator">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
          <span className="text-[10px] font-medium text-blue-400/90">Building Model</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">{timeStr}</span>
      </div>

      <div className="space-y-0.5">
        {GENERATION_STEPS.map((step, i) => {
          const isActive = i === currentStepIdx;
          const isDone = i < currentStepIdx;
          const isPending = i > currentStepIdx;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 py-0.5 transition-all duration-300 ${isPending ? "opacity-30" : ""}`}
            >
              <div className="w-3 flex items-center justify-center flex-shrink-0">
                {isDone ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
                ) : isActive ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                ) : (
                  <div className="w-1 h-1 rounded-full bg-muted-foreground/20" />
                )}
              </div>
              <span className={`text-[10px] ${isActive ? "text-foreground/80 font-medium" : isDone ? "text-muted-foreground/60" : "text-muted-foreground/30"}`}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="h-0.5 w-full bg-border/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500/40 rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${Math.min(95, (currentStepIdx / (GENERATION_STEPS.length - 1)) * 90 + 5)}%` }}
        />
      </div>

      <p className="text-[9px] text-muted-foreground/35">
        This typically takes 60–90 seconds. The model will appear automatically when ready.
      </p>
    </div>
  );
}

function ModelCard({ model, companyId, onDelete }: { model: FinancialModel; companyId: string; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [batchEdits, setBatchEdits] = useState<QueuedEdit[]>([]);
  const [showMissForm, setShowMissForm] = useState(false);
  const { toast } = useToast();
  const parsed = (model.status === "complete" || (model.status === "error" && model.content)) ? parseModelContent(model.content) : null;
  const isGenerating = model.status === "generating";
  const isError = model.status === "error" && !parsed;

  const conversationTurns = model.conversationHistory
    ? (() => { try { return (JSON.parse(model.conversationHistory) as Array<{ role: string }>).filter(h => h.role === "user").length; } catch { return 0; } })()
    : 0;

  let nextEditId = useRef(1);

  const batchMutation = useMutation({
    mutationFn: async ({ prompt }: { prompt: string }) => {
      const validateRes = await apiRequest("POST", `/api/models/${model.id}/iterate/validate`, { prompt });
      const validation = await validateRes.json();
      if (!validation.valid) throw new Error(validation.message || "Validation failed");

      const res = await apiRequest("POST", `/api/models/${model.id}/iterate`, { prompt });
      return res.json();
    },
    onSuccess: () => {
      setBatchEdits([]);
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "models"] });
      toast({ title: "Model calibration started", description: "Applying all changes and recalculating..." });
    },
    onError: (err: any) => {
      toast({ title: "Calibration failed", description: err.message, variant: "destructive" });
    },
  });

  const glaringMissMutation = useMutation({
    mutationFn: async ({ prompt, dataSources }: { prompt: string; dataSources?: string[] }) => {
      const validateRes = await apiRequest("POST", `/api/models/${model.id}/iterate/validate`, { prompt });
      const validation = await validateRes.json();
      if (!validation.valid) throw new Error(validation.message || "Validation failed");

      const res = await apiRequest("POST", `/api/models/${model.id}/iterate`, { prompt, dataSources });
      return res.json();
    },
    onSuccess: () => {
      setShowMissForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "models"] });
      toast({ title: "Deep analysis started", description: "Agent is researching the gap and augmenting the model..." });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const handleGlaringMiss = (miss: GlaringMiss) => {
    const prompt = buildGlaringMissPrompt(miss);
    const dataSources = miss.dataSources.filter(s => s.trim().length > 0);
    glaringMissMutation.mutate({ prompt, dataSources: dataSources.length > 0 ? dataSources : undefined });
  };

  const anyMutating = batchMutation.isPending || glaringMissMutation.isPending;

  const isQueued = (label: string, sectionHeading?: string): boolean => {
    return batchEdits.some(e => e.target.label === label && e.target.sectionHeading === sectionHeading);
  };

  const handleEdit = (target: EditTarget) => {
    if (isQueued(target.label, target.sectionHeading)) return;
    setEditTarget(target);
  };

  const handleQueue = (rationale: string, referenceUrl?: string) => {
    if (!editTarget) return;
    const id = String(nextEditId.current++);
    setBatchEdits(prev => [...prev, { id, target: editTarget, rationale, referenceUrl }]);
    setEditTarget(null);
    toast({ title: "Change queued", description: `"${editTarget.label}" added to batch` });
  };

  const handleRemoveFromBatch = (id: string) => {
    setBatchEdits(prev => prev.filter(e => e.id !== id));
  };

  const handleApplyBatch = () => {
    if (batchEdits.length === 0) return;
    const prompt = buildBatchPrompt(batchEdits);
    batchMutation.mutate({ prompt });
  };

  return (
    <div className="border border-border/25 rounded bg-card/20 overflow-hidden" data-testid={`card-model-${model.id}`}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-accent/3 transition-colors"
        onClick={() => !isGenerating && setExpanded(!expanded)}
        data-testid={`button-toggle-model-${model.id}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isGenerating ? (
            <Loader2 className="w-3 h-3 text-blue-400 animate-spin flex-shrink-0" />
          ) : isError ? (
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/30 flex-shrink-0" />
          ) : (
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/30 flex-shrink-0" />
          )}
          <div className="min-w-0">
            <h3 className="text-[11px] font-medium text-foreground truncate" data-testid={`text-model-title-${model.id}`}>
              {model.title}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <p className="text-[9px] text-muted-foreground/50 truncate">{model.prompt}</p>
              {conversationTurns > 1 && (
                <span className="text-[8px] text-blue-400/50 bg-blue-500/8 px-1 py-px rounded whitespace-nowrap">
                  {conversationTurns} turns
                </span>
              )}
              {batchEdits.length > 0 && (
                <span className="text-[8px] text-amber-400/60 bg-amber-500/8 px-1 py-px rounded whitespace-nowrap">
                  {batchEdits.length} pending
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[9px] text-muted-foreground/40">
            {new Date(model.updatedAt || model.createdAt).toLocaleDateString()}
          </span>
          {model.status === "complete" && (
            <div onClick={(e) => e.stopPropagation()}>
              <AddToMasterReport blockType="model" referenceId={model.id} />
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(model.id); }}
            className="p-0.5 text-muted-foreground/30 hover:text-red-400 transition-colors"
            data-testid={`button-delete-model-${model.id}`}
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
          {!isGenerating && (
            expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground/30" /> : <ChevronDown className="w-3 h-3 text-muted-foreground/30" />
          )}
        </div>
      </div>

      {expanded && parsed && (
        <div className="border-t border-border/15 px-3 py-3 space-y-3">
          {parsed.assumptions && parsed.assumptions.length > 0 && (
            <div>
              <SectionHeading>Key Assumptions</SectionHeading>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {parsed.assumptions.map((a, i) => {
                  const queued = isQueued(a.label);
                  return (
                    <div key={i} className={`group/editable flex items-start gap-1 text-[9px] border rounded px-1.5 py-1 relative ${queued ? "bg-amber-500/5 border-amber-500/15" : "bg-accent/3 border-border/10"}`} data-testid={`assumption-${a.label}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-muted-foreground/60">{a.label}:</span>{" "}
                        <span className="text-foreground/80 font-semibold">{a.value}</span>
                      </div>
                      <div className="flex-shrink-0 mt-px">
                        {queued ? <EditButtonQueued testId={`queued-assumption-${a.label}`} /> : (
                          <EditButton testId={`button-edit-assumption-${a.label}`} onClick={() => handleEdit({
                            kind: "assumption",
                            label: a.label,
                            currentValue: `${a.value} (${a.basis})`,
                          })} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {editTarget?.kind === "assumption" && (
                <InlineEditForm
                  target={editTarget}
                  onQueue={handleQueue}
                  onCancel={() => setEditTarget(null)}
                />
              )}
            </div>
          )}

          {parsed.sections.map((section, i) => (
            <div key={i}>
              <ModelSectionRenderer section={section} onEdit={handleEdit} isQueued={isQueued} />
              {editTarget && editTarget.sectionHeading === section.heading && editTarget.kind !== "assumption" && (
                <InlineEditForm
                  target={editTarget}
                  onQueue={handleQueue}
                  onCancel={() => setEditTarget(null)}
                />
              )}
            </div>
          ))}

          {parsed.methodology && (
            <div className="pt-1.5 border-t border-border/10 group/editable">
              <div className="flex items-start gap-1">
                <p className="text-[9px] text-muted-foreground/40 italic flex-1 leading-relaxed">{parsed.methodology}</p>
                {isQueued("Methodology") ? <EditButtonQueued testId="queued-methodology" /> : (
                  <EditButton testId="button-edit-methodology" onClick={() => handleEdit({
                    kind: "methodology",
                    label: "Methodology",
                    currentValue: parsed.methodology!.slice(0, 200),
                  })} />
                )}
              </div>
              {editTarget?.kind === "methodology" && (
                <InlineEditForm
                  target={editTarget}
                  onQueue={handleQueue}
                  onCancel={() => setEditTarget(null)}
                />
              )}
            </div>
          )}

          <BatchTray
            edits={batchEdits}
            onRemove={handleRemoveFromBatch}
            onApply={handleApplyBatch}
            onClear={() => setBatchEdits([])}
            isPending={anyMutating}
          />

          {showMissForm ? (
            <GlaringMissForm
              onSubmit={handleGlaringMiss}
              onCancel={() => setShowMissForm(false)}
              isPending={anyMutating}
            />
          ) : (
            <button
              onClick={() => setShowMissForm(true)}
              disabled={anyMutating}
              className="flex items-center gap-1 text-[9px] text-orange-400/50 hover:text-orange-400 transition-colors disabled:opacity-40"
              data-testid="button-flag-missing"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              Flag Missing Analysis
            </button>
          )}
        </div>
      )}

      {expanded && isError && (
        <div className="border-t border-border/15 px-3 py-2">
          <p className="text-[10px] text-red-400/70">{model.errorMessage || "Model generation failed. Please try again."}</p>
        </div>
      )}

      {isGenerating && (
        <GeneratingIndicator createdAt={model.createdAt} />
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
    <div className="space-y-4" data-testid="panel-modelling">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[10px] font-semibold text-foreground/80 uppercase tracking-wider">Financial Modelling</h3>
            <p className="text-[9px] text-muted-foreground/45 mt-0.5">
              Describe what you want to model — AI builds structured projections using {companyName}'s data.
            </p>
          </div>
          <span className="text-[9px] text-muted-foreground/35">$0.50/model</span>
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
            className="w-full bg-card/50 border border-border/30 rounded px-2.5 py-2 pr-20 text-[11px] text-foreground placeholder:text-muted-foreground/35 focus:outline-none focus:border-blue-500/25 resize-none min-h-[44px]"
            rows={2}
            disabled={generateMutation.isPending}
            data-testid="input-model-prompt"
          />
          <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
            <button
              onClick={() => setShowExamples(!showExamples)}
              className="text-[9px] text-muted-foreground/40 hover:text-muted-foreground transition-colors px-1 py-0.5"
              data-testid="button-show-examples"
            >
              examples
            </button>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || generateMutation.isPending}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-blue-500/12 text-blue-400 rounded hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="button-generate-model"
            >
              {generateMutation.isPending ? (
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
              ) : (
                <Send className="w-2.5 h-2.5" />
              )}
              Generate
            </button>
          </div>
        </div>

        {showExamples && (
          <div className="flex flex-wrap gap-1">
            {EXAMPLE_PROMPTS.map((ex, i) => (
              <button
                key={i}
                onClick={() => { setPrompt(ex); setShowExamples(false); inputRef.current?.focus(); }}
                className="text-[9px] text-muted-foreground/50 bg-accent/3 border border-border/10 rounded px-1.5 py-0.5 hover:text-foreground/70 hover:border-border/25 transition-colors"
                data-testid={`button-example-${i}`}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-[10px] text-muted-foreground/40">No models yet. Describe what you want to model above.</p>
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
