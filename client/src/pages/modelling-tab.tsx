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
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Target,
  BarChart3,
} from "lucide-react";

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

type ModelSection = TableSection | MetricsSection | ScenariosSection | TextSection;

interface ParsedModel {
  title: string;
  assumptions: ModelAssumption[];
  sections: ModelSection[];
  methodology?: string;
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
    if (data.title && data.sections) return data as ParsedModel;
    return null;
  } catch {
    return null;
  }
}

function ModelSectionRenderer({ section }: { section: ModelSection }) {
  if (section.type === "table") {
    return (
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider" data-testid={`text-section-heading-${section.heading}`}>{section.heading}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid={`table-${section.heading}`}>
            <thead>
              <tr className="border-b border-border/30">
                {section.columns.map((col, i) => (
                  <th key={i} className="text-left py-2 px-3 text-muted-foreground font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/10 hover:bg-accent/5 transition-colors">
                  {row.map((cell, ci) => (
                    <td key={ci} className={`py-2 px-3 whitespace-nowrap ${ci === 0 ? "text-foreground/80 font-medium" : "text-foreground/70 tabular-nums"}`}>{cell}</td>
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
          {section.items.map((item, i) => (
            <div key={i} className="bg-accent/5 border border-border/20 rounded-md p-3" data-testid={`metric-${item.label}`}>
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
          {section.scenarios.map((s, i) => {
            const key = s.name.toLowerCase();
            const colorClass = scenarioColors[key] || "border-border/30 bg-accent/5";
            const IconComp = scenarioIcons[key] || Target;
            return (
              <div key={i} className={`border rounded-md p-3 ${colorClass}`} data-testid={`scenario-${s.name}`}>
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
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-foreground/90 uppercase tracking-wider">{section.heading}</h4>
        <div className="text-xs text-foreground/75 leading-relaxed whitespace-pre-wrap">{section.content}</div>
      </div>
    );
  }

  return null;
}

function ModelCard({ model, onDelete }: { model: FinancialModel; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = model.status === "complete" ? parseModelContent(model.content) : null;
  const isGenerating = model.status === "generating";
  const isError = model.status === "error";

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
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">{model.prompt}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50">
            {new Date(model.createdAt).toLocaleDateString()}
          </span>
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
                  <div key={i} className="flex items-start gap-2 text-[11px] bg-accent/5 border border-border/15 rounded px-2.5 py-2" data-testid={`assumption-${a.label}`}>
                    <span className="text-muted-foreground whitespace-nowrap">{a.label}:</span>
                    <span className="text-foreground font-medium">{a.value}</span>
                    {a.basis && <span className="text-muted-foreground/50 italic ml-auto text-[10px]">({a.basis})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.sections.map((section, i) => (
            <ModelSectionRenderer key={i} section={section} />
          ))}

          {parsed.methodology && (
            <div className="pt-2 border-t border-border/15">
              <p className="text-[10px] text-muted-foreground/50 italic">{parsed.methodology}</p>
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
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
