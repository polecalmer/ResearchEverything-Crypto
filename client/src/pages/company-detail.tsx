import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, type Founder, type Note, STAGE_LABELS, PIPELINE_STAGES, type PipelineStage } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useParams } from "wouter";
import {
  ExternalLink,
  Globe,
  Linkedin,
  Twitter,
  Send,
  Trash2,
  Loader2,
  Plus,
} from "lucide-react";
import { SiGithub } from "react-icons/si";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import type { Report } from "@shared/schema";
import { AddToMasterReport } from "@/components/add-to-master-report";
import TokenIntelligenceTab, { ReportsTab } from "./token-intelligence";
import DataTab from "./data-tab";
import ModellingTab from "./modelling-tab";

const STAGE_COLORS: Record<PipelineStage, string> = {
  discovered: "text-blue-400",
  researching: "text-amber-400",
  reaching_out: "text-purple-400",
  in_diligence: "text-emerald-400",
  passed: "text-muted-foreground",
  invested: "text-green-400",
};

const STAGE_INDICATORS: Record<PipelineStage, string> = {
  discovered: "○",
  researching: "◐",
  reaching_out: "◑",
  in_diligence: "◕",
  passed: "✕",
  invested: "●",
};

interface NextStepItem {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  category: "research" | "outreach" | "diligence" | "relationship" | "action";
  verified?: boolean;
  verifierNote?: string;
}

const PRIORITY_MARKERS = {
  high: "!!!",
  medium: "!!",
  low: "!",
};

const PRIORITY_COLORS = {
  high: "text-amber-400",
  medium: "text-blue-400",
  low: "text-muted-foreground",
};

function TermBlock({ label, children, className = "", action }: { label: string; children: React.ReactNode; className?: string; icon?: string; action?: React.ReactNode }) {
  return (
    <div className={`mb-0 ${className}`}>
      <div className="flex items-center gap-2 mb-3 select-none">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</span>
        <span className="flex-1 border-t border-border/30" />
        {action}
      </div>
      <div className="pl-1">
        {children}
      </div>
    </div>
  );
}

function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {}
  return undefined;
}

function TermLink({ href, children, className = "", ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string | null }) {
  const safe = safeHref(href);
  if (!safe) return null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={`text-muted-foreground hover:text-foreground transition-colors ${className}`} {...props}>
      {children}
    </a>
  );
}


function NextStepsAdvisor({ companyId, pipelineStage, companyName }: { companyId: string; pipelineStage: string; companyName?: string }) {
  const [showAll, setShowAll] = useState(false);
  const { getAccessToken } = useAuth();

  const { data: steps, isLoading, error, refetch, isFetched } = useQuery<NextStepItem[]>({
    queryKey: ["/api/companies", companyId, "next-steps", pipelineStage],
    queryFn: async () => {
      const { runNextStepsPipeline } = await import("@/lib/enrichment");
      return runNextStepsPipeline(companyId, getAccessToken);
    },
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });

  if (!isFetched && !isLoading) {
    return (
      <div data-testid="card-next-steps">
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-2"
          data-testid="button-generate-next-steps"
        >
          <span>Generate recommendations</span>
          <span className="text-muted-foreground/50">~$0.12</span>
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div data-testid="card-next-steps" className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Analyzing deal context...</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="pl-4">
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !steps || steps.length === 0) {
    return (
      <div data-testid="card-next-steps" className="space-y-2">
        <p className="text-xs text-red-400/60">
          {error ? "Could not generate recommendations" : "No recommendations available"}
        </p>
        <button
          onClick={() => refetch()}
          className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors flex items-center gap-2"
          data-testid="button-retry-next-steps"
        >
          <span>Retry</span>
          <span className="text-muted-foreground/50">~$0.12</span>
        </button>
      </div>
    );
  }

  const highPriority = steps.filter((s) => s.priority === "high");
  const displaySteps = showAll ? steps : highPriority.length > 0 ? highPriority.slice(0, 4) : steps.slice(0, 3);
  const hiddenCount = steps.length - displaySteps.length;

  const stepsClipContent = steps.map((s) =>
    `- **[${s.priority.toUpperCase()}]** ${s.title}\n  ${s.detail}${s.verifierNote ? `\n  _${s.verifierNote}_` : ""}`
  ).join("\n");

  return (
    <div data-testid="card-next-steps" className="space-y-2">
      {displaySteps.map((step, i) => (
        <div key={i} className="group" data-testid={`next-step-${i}`}>
          <div className="flex items-start gap-2">
            <span className={`text-[10px] flex-shrink-0 mt-0.5 ${PRIORITY_COLORS[step.priority]}`}>
              {PRIORITY_MARKERS[step.priority]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-tight" data-testid={`next-step-title-${i}`}>
                {step.title}
                {step.verified && <span className="text-emerald-500/70 ml-1 text-[10px]">verified</span>}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug" data-testid={`next-step-detail-${i}`}>{step.detail}</p>
              {step.verifierNote && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">
                  {step.verifierNote}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && !showAll && (
        <button onClick={() => setShowAll(true)} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors" data-testid="button-show-more-steps">
          +{hiddenCount} more
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button onClick={() => setShowAll(false)} className="text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors" data-testid="button-show-less-steps">
          Show less
        </button>
      )}
      <div className="flex justify-end pt-1">
        <AddToMasterReport
          blockType="text"
          content={`## ${companyName || "Company"} — Next Steps\n\n${stepsClipContent}`}
          label="+"
          className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors"
        />
      </div>
    </div>
  );
}

function DeepResearchSection({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: reports = [] } = useQuery<Report[]>({
    queryKey: ["/api/companies", companyId, "reports"],
    refetchInterval: (query) => {
      const data = query.state.data as Report[] | undefined;
      if (data?.some((r) => r.status === "generating")) return 5000;
      return false;
    },
  });

  const { getAccessToken } = useAuth();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const { runDeepResearchPipeline } = await import("@/lib/enrichment");
      return runDeepResearchPipeline(companyId, getAccessToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reports"] });
      toast({ title: "Deep research started", description: "This typically takes 2-3 minutes. The report will appear when ready." });
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate report", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <a
          key={report.id}
          href={`/reports/${report.id}`}
          onClick={(e) => { e.preventDefault(); navigate(`/reports/${report.id}`); }}
          className="flex items-center gap-2 py-1.5 text-xs group hover:text-foreground transition-colors cursor-pointer"
          data-testid={`link-report-${report.id}`}
        >
          <span className="text-muted-foreground/40 group-hover:text-foreground/60">-</span>
          <span className="text-muted-foreground group-hover:text-foreground truncate flex-1">
            {report.title}
          </span>
          {report.status === "generating" ? (
            <span className="text-amber-400/60 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span className="text-[10px]">generating</span>
            </span>
          ) : report.status === "failed" ? (
            <span className="text-red-400/60 text-[10px]">failed</span>
          ) : (
            <span className="text-muted-foreground/60 text-[10px]">{format(new Date(report.createdAt), "yyyy-MM-dd")}</span>
          )}
        </a>
      ))}
      <button
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 disabled:opacity-30"
        data-testid="button-generate-report"
      >
        {generateMutation.isPending ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Generating deep research...
          </span>
        ) : (
          <span>Generate deep research</span>
        )}
      </button>
    </div>
  );
}

function TagsInline({ tags, companyId }: { tags: string[]; companyId: string }) {
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState("");
  const { toast } = useToast();
  const updateTagsMutation = useMutation({
    mutationFn: async (updatedTags: string[]) => {
      await apiRequest("PATCH", `/api/companies/${companyId}`, { tags: updatedTags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
  });
  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (tags.includes(tag)) { toast({ title: "Tag already exists", variant: "destructive" }); return; }
    updateTagsMutation.mutate([...tags, tag]);
    setNewTag("");
    setAdding(false);
  };
  const removeTag = (tagToRemove: string) => updateTagsMutation.mutate(tags.filter((t) => t !== tagToRemove));

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => removeTag(tag)}
          className="text-muted-foreground hover:text-red-400 transition-colors px-1.5 py-0.5 rounded bg-accent/40 hover:bg-red-400/10"
          data-testid={`badge-tag-${tag}`}
        >
          {tag}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTag(); if (e.key === "Escape") { setAdding(false); setNewTag(""); } }}
          onBlur={() => { if (!newTag.trim()) setAdding(false); }}
          className="bg-transparent border-b border-border text-xs text-foreground outline-none w-20 pb-0.5 focus:border-foreground/50"
          placeholder="tag"
          data-testid="input-new-tag"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-muted-foreground/60 hover:text-foreground transition-colors"
          data-testid="button-add-tag"
        >
          +
        </button>
      )}
    </div>
  );
}

function ExcitementBar({ companyId, score, reason }: { companyId: string; score: number | null; reason: string | null }) {
  const [localReason, setLocalReason] = useState(reason || "");
  const [editing, setEditing] = useState(false);
  const mutation = useMutation({
    mutationFn: async (data: { excitementScore: number | null; excitementReason: string }) => {
      await apiRequest("PATCH", `/api/companies/${companyId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      setEditing(false);
    },
  });
  const setScore = (v: number) => {
    const newScore = v === score ? null : v;
    mutation.mutate({ excitementScore: newScore, excitementReason: localReason });
  };
  const saveReason = () => {
    mutation.mutate({ excitementScore: score ?? null, excitementReason: localReason });
  };

  const getBarColor = (v: number) => {
    if (!score || v > score) return "bg-border/20";
    if (score <= 3) return "bg-blue-400/40";
    if (score <= 6) return "bg-blue-500/50";
    if (score <= 8) return "bg-emerald-500/50";
    return "bg-green-500/60";
  };

  const getLabel = () => {
    if (!score) return "unrated";
    if (score <= 3) return "low";
    if (score <= 6) return "moderate";
    if (score <= 8) return "high";
    return "very high";
  };

  return (
    <div data-testid="excitement-rating">
      <div className="flex items-center gap-0.5 mb-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          <button
            key={v}
            onClick={() => setScore(v)}
            className={`h-3 flex-1 transition-all hover:opacity-80 ${getBarColor(v)}`}
            data-testid={`excitement-score-${v}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {score ? `${score}/10` : "—"} <span className="text-muted-foreground/70">{getLabel()}</span>
        </span>
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={localReason}
            onChange={(e) => setLocalReason(e.target.value)}
            placeholder="why this score?"
            className="w-full min-h-[40px] bg-transparent border border-border text-xs text-foreground/80 p-2 outline-none resize-none focus:border-foreground/40 rounded"
            data-testid="textarea-excitement-reason"
          />
          <div className="flex gap-2 justify-end text-[11px]">
            <button onClick={() => { setEditing(false); setLocalReason(reason || ""); }} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="button-cancel-reason">Cancel</button>
            <button onClick={saveReason} disabled={mutation.isPending} className="text-foreground/70 hover:text-foreground transition-colors" data-testid="button-save-reason">Save</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors block w-full text-left"
          data-testid="button-edit-reason"
        >
          {reason ? <span className="text-muted-foreground">{reason}</span> : <span className="italic">add note...</span>}
        </button>
      )}
    </div>
  );
}

export default function CompanyDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [noteContent, setNoteContent] = useState("");
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"deal" | "token" | "report" | "data" | "modelling">("deal");

  const { data: company, isLoading: companyLoading } = useQuery<Company>({ queryKey: ["/api/companies", params.id] });
  const { data: founders = [] } = useQuery<Founder[]>({ queryKey: ["/api/companies", params.id, "founders"] });
  const { data: notes = [] } = useQuery<Note[]>({ queryKey: ["/api/companies", params.id, "notes"] });

  const updateStageMutation = useMutation({
    mutationFn: async (stage: PipelineStage) => { await apiRequest("PATCH", `/api/companies/${params.id}`, { pipelineStage: stage }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Pipeline stage updated" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => { await apiRequest("POST", `/api/companies/${params.id}/notes`, { content, companyId: params.id }); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id, "notes"] });
      setNoteContent("");
      toast({ title: "Note added" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => { await apiRequest("DELETE", `/api/notes/${noteId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id, "notes"] });
      toast({ title: "Note deleted" });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/companies/${params.id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company deleted" });
      navigate("/companies");
    },
    onError: (error: any) => { toast({ title: "Failed to delete", description: error.message, variant: "destructive" }); },
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (companyLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Loading...</span>
        </div>
        <Skeleton className="h-4 w-48 mb-4" />
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Company not found</p>
          <button onClick={() => navigate("/")} className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors">
            Back to pipeline
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto terminal-scrollbar">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <button onClick={() => navigate("/companies")} className="hover:text-foreground transition-colors" data-testid="button-back">Companies</button>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-foreground/70">{company.name}</span>
          </div>
          <button
            onClick={() => navigate("/add")}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-add-deal"
          >
            <Plus className="w-3 h-3" />
            New
          </button>
        </div>

        <div className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold tracking-tight" data-testid="text-company-name">{company.name}</h1>
                {company.sourceUrl && (
                  <TermLink href={company.sourceUrl} className="text-[10px]" aria-label="View source">
                    <ExternalLink className="w-3 h-3" />
                  </TermLink>
                )}
              </div>
              <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-2xl" data-testid="text-company-oneliner">{company.oneLiner}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap text-[11px] mb-3">
            {company.sector && (
              <span className="text-muted-foreground">
                {company.sector}{company.subSector ? `/${company.subSector}` : ""}
              </span>
            )}
            {company.hasLiquidToken && (
              <span className="text-teal-400/80" data-testid="badge-liquid-token">
                {company.tokenTicker || "TOKEN"}{company.tokenTier ? ` · ${company.tokenTier}` : ""}
              </span>
            )}
            {company.stage && <span className="text-muted-foreground">{company.stage}</span>}
            {company.businessModel && <span className="text-muted-foreground">{company.businessModel}</span>}
            {company.createdAt && (
              <span className="text-muted-foreground/60 ml-auto">
                {format(new Date(company.createdAt), "yyyy-MM-dd")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-muted-foreground">
            <TermLink href={company.websiteUrl} data-testid="link-company-website" aria-label="Website">
              <Globe className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.twitterUrl} data-testid="link-company-twitter" aria-label="Twitter">
              <Twitter className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.githubUrl} data-testid="link-company-github" aria-label="GitHub">
              <SiGithub className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.linkedinUrl} data-testid="link-company-linkedin" aria-label="LinkedIn">
              <Linkedin className="w-3.5 h-3.5" />
            </TermLink>
          </div>
        </div>

        <div className="border-t border-border/40 pt-4 mb-6">
          <div className="flex items-center gap-1 mb-6" role="tablist" aria-label="Intelligence tabs">
            <button
              role="tab"
              aria-selected={activeTab === "deal"}
              aria-controls="panel-deal"
              onClick={() => setActiveTab("deal")}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${activeTab === "deal" ? "text-foreground bg-blue-500/15 dark:bg-blue-400/15" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"}`}
              data-testid="tab-deal-intelligence"
            >
              Project Intelligence
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "token"}
              aria-controls="panel-token"
              onClick={() => setActiveTab("token")}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${activeTab === "token" ? "text-foreground bg-blue-500/15 dark:bg-blue-400/15" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"}`}
              data-testid="tab-token-intelligence"
            >
              Token Intelligence
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "report"}
              aria-controls="panel-report"
              onClick={() => setActiveTab("report")}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${activeTab === "report" ? "text-foreground bg-blue-500/15 dark:bg-blue-400/15" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"}`}
              data-testid="tab-reports"
            >
              Reports
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "data"}
              aria-controls="panel-data"
              onClick={() => setActiveTab("data")}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${activeTab === "data" ? "text-foreground bg-blue-500/15 dark:bg-blue-400/15" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"}`}
              data-testid="tab-data"
            >
              Data
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "modelling"}
              aria-controls="panel-modelling"
              onClick={() => setActiveTab("modelling")}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${activeTab === "modelling" ? "text-foreground bg-blue-500/15 dark:bg-blue-400/15" : "text-muted-foreground hover:text-foreground hover:bg-accent/30"}`}
              data-testid="tab-modelling"
            >
              Modelling
            </button>
          </div>
        </div>

        {activeTab === "deal" ? (
          <div id="panel-deal" role="tabpanel" aria-labelledby="tab-deal-intelligence" className="flex flex-col lg:flex-row gap-8">
            <div className="flex-1 min-w-0 space-y-6">

              {company.description && (
                <TermBlock label="Overview" action={
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Overview\n\n${company.description}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                }>
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-company-description">{company.description}</p>
                </TermBlock>
              )}

              {company.fundingHistory && (
                <TermBlock label="Funding" action={
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Funding\n\n${company.fundingHistory}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                }>
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-funding">{company.fundingHistory}</p>
                </TermBlock>
              )}

              {company.competitiveLandscape && (
                <TermBlock label="Competitive Landscape" action={
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Competitive Landscape\n\n${company.competitiveLandscape}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                }>
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-competitive">{company.competitiveLandscape}</p>
                </TermBlock>
              )}

              {company.adjacentReads && (() => {
                try {
                  const reads = JSON.parse(company.adjacentReads);
                  if (Array.isArray(reads) && reads.length > 0) {
                    const readsSummary = reads.map((r: any) => `- [${r.title}](${r.url})${r.source ? ` (${r.source})` : ""}`).join("\n");
                    return (
                      <TermBlock label={`DD Reads (${reads.length})`} action={
                        <AddToMasterReport blockType="text" content={`## ${company.name} — DD Reads\n\n${readsSummary}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                      }>
                        <div className="space-y-1">
                          {reads.map((read: any, idx: number) => (
                            <a
                              key={idx}
                              href={read.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 py-1 group text-xs"
                              data-testid={`link-dd-read-${idx}`}
                            >
                              <span className="text-muted-foreground/50 group-hover:text-foreground/70 transition-colors">-</span>
                              <span className="text-foreground/70 group-hover:text-foreground truncate flex-1 transition-colors">{read.title}</span>
                              {read.source && (
                                <span className="text-muted-foreground/50 flex-shrink-0">[{read.source}]</span>
                              )}
                            </a>
                          ))}
                        </div>
                      </TermBlock>
                    );
                  }
                } catch {}
                return null;
              })()}

              {founders.length > 0 && (() => {
                const teamSummary = founders.map((f) => {
                  let line = `**${f.name}**`;
                  if (f.role) line += ` — ${f.role}`;
                  if (f.bio) line += `\n${f.bio}`;
                  if (f.priorCompanies) line += `\nPreviously: ${f.priorCompanies}`;
                  return line;
                }).join("\n\n");
                return (
                <TermBlock label={`Team (${founders.length})`} action={
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Team\n\n${teamSummary}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                }>
                  <div className="space-y-4">
                    {founders.map((founder, idx) => (
                      <div key={founder.id} data-testid={`card-founder-${founder.id}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold" data-testid={`text-founder-name-${founder.id}`}>{founder.name}</span>
                          {founder.role && <span className="text-[10px] text-muted-foreground">{founder.role}</span>}
                          <div className="flex items-center gap-2 ml-auto text-muted-foreground">
                            <TermLink href={founder.linkedinUrl} aria-label={`${founder.name} LinkedIn`} data-testid={`link-founder-linkedin-${founder.id}`}>
                              <Linkedin className="w-3 h-3" />
                            </TermLink>
                            <TermLink href={founder.twitterUrl} aria-label={`${founder.name} Twitter`} data-testid={`link-founder-twitter-${founder.id}`}>
                              <Twitter className="w-3 h-3" />
                            </TermLink>
                            <TermLink href={founder.githubUrl} aria-label={`${founder.name} GitHub`} data-testid={`link-founder-github-${founder.id}`}>
                              <SiGithub className="w-3 h-3" />
                            </TermLink>
                            <TermLink href={founder.personalUrl} aria-label={`${founder.name} website`} data-testid={`link-founder-website-${founder.id}`}>
                              <Globe className="w-3 h-3" />
                            </TermLink>
                          </div>
                        </div>
                        {founder.bio && <p className="text-xs text-muted-foreground leading-relaxed">{founder.bio}</p>}
                        {founder.priorCompanies && (
                          <p className="text-[10px] text-muted-foreground/70 mt-1">
                            <span className="text-muted-foreground/60">Previously:</span> {founder.priorCompanies}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </TermBlock>
                );
              })()}

              <TermBlock label={`Notes (${notes.length})`} action={
                notes.length > 0 ? (
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Notes\n\n${notes.map((n) => `- ${n.createdAt ? format(new Date(n.createdAt), "MM/dd") + ": " : ""}${n.content}`).join("\n")}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                ) : undefined
              }>
                <div className="mb-3">
                  <div className="flex items-start gap-2">
                    <textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="Add a note..."
                      className="flex-1 min-h-[36px] bg-transparent text-xs text-foreground/80 outline-none resize-none placeholder:text-muted-foreground/60 border border-border/40 rounded px-2 py-1.5 focus:border-border transition-colors"
                      data-testid="textarea-note"
                    />
                    <button
                      onClick={() => noteContent.trim() && addNoteMutation.mutate(noteContent)}
                      disabled={!noteContent.trim() || addNoteMutation.isPending}
                      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-20 mt-1.5"
                      data-testid="button-add-note"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {notes.length > 0 ? (
                  <div className="space-y-0">
                    {notes.map((note) => (
                      <div key={note.id} className="flex items-start gap-2 py-2 border-t border-border/30 group" data-testid={`note-${note.id}`}>
                        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 mt-0.5 w-16">
                          {note.createdAt ? format(new Date(note.createdAt), "MM/dd HH:mm") : ""}
                        </span>
                        <p className="text-xs whitespace-pre-wrap text-foreground/70 flex-1">{note.content}</p>
                        <button
                          onClick={() => deleteNoteMutation.mutate(note.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-red-400 transition-all"
                          aria-label="Delete note"
                          data-testid={`button-delete-note-${note.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground italic">No notes yet</p>
                )}
              </TermBlock>

              <TermBlock label="Deep Research">
                <DeepResearchSection companyId={company.id} companyName={company.name} />
              </TermBlock>
            </div>

            <div className="lg:w-64 flex-shrink-0 space-y-6">
              <TermBlock label="Stage">
                <div className="space-y-1">
                  {PIPELINE_STAGES.map((stage) => {
                    const isActive = company.pipelineStage === stage;
                    return (
                      <button
                        key={stage}
                        onClick={() => updateStageMutation.mutate(stage)}
                        className={`w-full text-left text-[11px] py-1 px-2 rounded transition-colors flex items-center gap-2 ${
                          isActive
                            ? `${STAGE_COLORS[stage]} bg-accent/20`
                            : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/20"
                        }`}
                        data-testid={`stage-option-${stage}`}
                      >
                        <span>{STAGE_INDICATORS[stage]}</span>
                        <span>{STAGE_LABELS[stage]}</span>
                      </button>
                    );
                  })}
                </div>
              </TermBlock>

              <TermBlock label="Conviction" action={
                (company.excitementScore || company.excitementReason) ? (
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Conviction\n\nScore: ${company.excitementScore ?? "unrated"}/10${company.excitementReason ? `\n\n${company.excitementReason}` : ""}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                ) : undefined
              }>
                <ExcitementBar companyId={company.id} score={company.excitementScore ?? null} reason={company.excitementReason ?? null} />
              </TermBlock>

              <TermBlock label="Next Steps">
                <NextStepsAdvisor companyId={company.id} pipelineStage={company.pipelineStage} companyName={company.name} />
              </TermBlock>

              <TermBlock label="Tags" action={
                company.tags && company.tags.length > 0 ? (
                  <AddToMasterReport blockType="text" content={`## ${company.name} — Tags\n\n${company.tags.join(", ")}`} label="+" className="text-[10px] text-muted-foreground/40 hover:text-foreground/60 transition-colors" />
                ) : undefined
              }>
                <TagsInline tags={company.tags || []} companyId={company.id} />
              </TermBlock>

              <div className="pt-4 border-t border-border/30 space-y-1">
                {company.websiteUrl && (
                  <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5" data-testid="button-visit-website">
                    <Globe className="w-3 h-3" /> Visit website
                  </a>
                )}
                {company.sourceUrl && company.sourceUrl !== company.websiteUrl && (
                  <a href={company.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5" data-testid="button-visit-source">
                    <ExternalLink className="w-3 h-3" /> View source
                  </a>
                )}
                <div className="pt-3">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 text-[11px] text-muted-foreground/50 hover:text-red-400 transition-colors py-0.5"
                      data-testid="button-delete-company"
                    >
                      <Trash2 className="w-3 h-3" /> Delete company
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] text-red-400/70">
                        Delete "{company.name}"? This cannot be undone.
                      </p>
                      <div className="flex gap-3 text-[11px]">
                        <button
                          onClick={() => deleteCompanyMutation.mutate()}
                          disabled={deleteCompanyMutation.isPending}
                          className="text-red-400 hover:text-red-300 transition-colors"
                          data-testid="button-confirm-delete"
                        >
                          {deleteCompanyMutation.isPending ? "Deleting..." : "Yes, delete"}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          data-testid="button-cancel-delete"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : activeTab === "token" ? (
          <div id="panel-token" role="tabpanel" aria-labelledby="tab-token-intelligence">
            <TokenIntelligenceTab companyId={company.id} companyName={company.name} hasLiquidToken={company.hasLiquidToken ?? false} />
          </div>
        ) : activeTab === "report" ? (
          <div id="panel-report" role="tabpanel" aria-labelledby="tab-reports">
            <ReportsTab companyId={company.id} companyName={company.name} />
          </div>
        ) : activeTab === "data" ? (
          <div id="panel-data" role="tabpanel" aria-labelledby="tab-data">
            <DataTab companyId={company.id} companyName={company.name} />
          </div>
        ) : activeTab === "modelling" ? (
          <div id="panel-modelling" role="tabpanel" aria-labelledby="tab-modelling">
            <ModellingTab companyId={company.id} companyName={company.name} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
