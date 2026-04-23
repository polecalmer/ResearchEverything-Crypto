import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Sparkles, BarChart3, FileText, Database, ChevronRight, ChevronLeft,
  Brain, Activity, GitBranch, CheckCircle2, Loader2, AlertCircle,
} from "lucide-react";
import type { SessionMessage, ThinkingStep } from "@/lib/research-utils";

interface Props {
  sessionId: number | null;
  messages: SessionMessage[] | undefined;
  thinkingSteps: ThinkingStep[];
  isStreaming: boolean;
}

export function SessionInspector({ sessionId, messages, thinkingSteps, isStreaming }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const stats = useMemo(() => {
    const charts = new Set<string>();
    const sources = new Set<string>();
    let textBlocks = 0;
    let modelBlocks = 0;
    try {
      for (const m of messages || []) {
        const arts: any[] = Array.isArray((m as any)?.artifacts) ? (m as any).artifacts : [];
        for (const a of arts) {
          if (!a || typeof a !== "object") continue;
          if (a.type === "chart") {
            if (a.id) charts.add(String(a.id));
            else charts.add(`${m?.id ?? ""}-${a.title || "chart"}`);
            if (a.dataSource) sources.add(String(a.dataSource));
            const recipe = a?.dataSourceConfig?.refreshRecipe;
            if (recipe?.source) sources.add(String(recipe.source));
          } else if (a.type === "model") {
            modelBlocks += 1;
          } else if (a.type === "table") {
            textBlocks += 1;
          }
        }
      }
    } catch (err) {
      console.warn("[session-inspector] stats aggregation failed", err);
    }
    return {
      charts: charts.size,
      models: modelBlocks,
      tables: textBlocks,
      sources: Array.from(sources),
    };
  }, [messages]);

  // Roll up parallel sub-question progress from the step stream so the
  // user can watch the deep pipeline's wave structure live.
  const subQuestions = useMemo(() => {
    const map = new Map<string, { id: string; text: string; status: "pending" | "running" | "done" | "failed"; lastLabel?: string; detail?: string }>();
    for (const step of thinkingSteps || []) {
      const id = step.subQuestionId;
      if (!id) continue;
      const text = step.subQuestionText || step.label || id;
      const existing = map.get(id) || { id, text, status: "pending" as const };
      if (step.type === "sub_question_started") {
        map.set(id, { ...existing, text, status: existing.status === "done" || existing.status === "failed" ? existing.status : "pending" });
      } else if (step.type === "sub_question_progress") {
        map.set(id, { ...existing, text, status: existing.status === "done" || existing.status === "failed" ? existing.status : "running", lastLabel: step.label });
      } else if (step.type === "sub_question_done") {
        const failed = (step.label || "").toLowerCase().startsWith("failed");
        map.set(id, { ...existing, text, status: failed ? "failed" : "done", detail: step.detail });
      }
    }
    return Array.from(map.values());
  }, [thinkingSteps]);

  const synthesisStarted = useMemo(
    () => (thinkingSteps || []).some(s => s.type === "synthesis_started"),
    [thinkingSteps],
  );

  const brainHits = useMemo(() => {
    let total = 0;
    for (const step of thinkingSteps || []) {
      const label = (step.label || step.detail || "").toLowerCase();
      if (label.includes("brain") || label.includes("fact") || label.includes("retriev")) {
        const m = label.match(/(\d+)\s*(facts?|hits?|results?)/);
        if (m) total += parseInt(m[1], 10);
      }
    }
    return total;
  }, [thinkingSteps]);

  if (collapsed) {
    return (
      <div className="w-8 border-l border-border/50 bg-background/50 flex flex-col items-center pt-3 gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCollapsed(false)}
          data-testid="button-expand-inspector"
          aria-label="Expand inspector"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <div className="flex flex-col items-center gap-2 mt-1 text-muted-foreground/60">
          <Activity className="w-3.5 h-3.5" />
          <span className="text-[9px] [writing-mode:vertical-rl] tracking-[0.3em] uppercase">
            Inspector
          </span>
        </div>
      </div>
    );
  }

  return (
    <aside
      className="w-64 border-l border-border/50 bg-background/40 flex flex-col overflow-hidden"
      data-testid="panel-session-inspector"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-amber-500/80" />
          <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 font-medium">
            Inspector
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setCollapsed(true)}
          data-testid="button-collapse-inspector"
          aria-label="Collapse inspector"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4 text-[11px]">
        {!sessionId ? (
          <div className="text-muted-foreground/60 italic">
            Open or start a session to see context, sources, and outputs here.
          </div>
        ) : (
          <>
            {subQuestions.length > 0 && (
              <Section title="Sub-questions" icon={<GitBranch className="w-3 h-3" />}>
                <div className="space-y-1.5">
                  {subQuestions.map((sq) => (
                    <div key={sq.id} className="flex items-start gap-1.5" data-testid={`sub-question-${sq.id}`}>
                      <span className="mt-0.5 shrink-0">
                        {sq.status === "done" ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500/90" />
                        ) : sq.status === "failed" ? (
                          <AlertCircle className="w-3 h-3 text-red-500/90" />
                        ) : sq.status === "running" ? (
                          <Loader2 className="w-3 h-3 text-amber-500/90 animate-spin" />
                        ) : (
                          <span className="inline-block w-3 h-3 rounded-full border border-muted-foreground/40" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-[10.5px] leading-tight ${sq.status === "done" ? "text-foreground/80" : sq.status === "failed" ? "text-red-500/90" : "text-foreground/90"}`}>
                          {sq.text}
                        </div>
                        {sq.status === "running" && sq.lastLabel && (
                          <div className="text-[9.5px] text-muted-foreground/70 truncate" title={sq.lastLabel}>{sq.lastLabel}</div>
                        )}
                        {sq.status === "done" && sq.detail && (
                          <div className="text-[9.5px] text-muted-foreground/60 tabular-nums">{sq.detail}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {synthesisStarted && (
                    <div className="mt-2 pt-2 border-t border-border/40 flex items-center gap-1.5 text-[10px] text-amber-500/90">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Synthesizing findings…
                    </div>
                  )}
                </div>
              </Section>
            )}

            <Section title="Brain" icon={<Brain className="w-3 h-3" />}>
              {isStreaming && brainHits === 0 ? (
                <Row label="Consulting brain" value="…" muted />
              ) : brainHits > 0 ? (
                <Row label="Facts retrieved" value={String(brainHits)} accent />
              ) : (
                <Row label="No facts pulled yet" value="" muted />
              )}
            </Section>

            <Section title="Sources used" icon={<Database className="w-3 h-3" />}>
              {stats.sources.length === 0 ? (
                <div className="text-muted-foreground/60">
                  Live sources will appear as the session pulls data.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {stats.sources.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center px-1.5 py-0.5 rounded border border-border/60 bg-background text-[10px] tabular-nums"
                      data-testid={`badge-source-${s}`}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Outputs" icon={<Sparkles className="w-3 h-3" />}>
              <Row
                label={<><BarChart3 className="w-3 h-3 inline mr-1" />Live charts</>}
                value={String(stats.charts)}
                accent={stats.charts > 0}
              />
              <Row
                label={<><FileText className="w-3 h-3 inline mr-1" />Tables</>}
                value={String(stats.tables)}
                muted={stats.tables === 0}
              />
              <Row
                label={<><Sparkles className="w-3 h-3 inline mr-1" />Model outputs</>}
                value={String(stats.models)}
                muted={stats.models === 0}
              />
            </Section>

            {isStreaming && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-500/80">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse" />
                Working…
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.28em] text-muted-foreground/55 mb-1.5">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={muted ? "text-muted-foreground/60" : "text-foreground/90"}>{label}</span>
      <span
        className={`tabular-nums ${
          accent ? "text-amber-500/90 font-medium" : muted ? "text-muted-foreground/50" : "text-foreground/80"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
