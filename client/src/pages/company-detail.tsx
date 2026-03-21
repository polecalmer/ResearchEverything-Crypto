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
  Terminal,
} from "lucide-react";
import { SiGithub } from "react-icons/si";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import type { Report } from "@shared/schema";
import TokenIntelligenceTab from "./token-intelligence";

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

function TermBlock({ label, children, className = "", icon }: { label: string; children: React.ReactNode; className?: string; icon?: string }) {
  return (
    <div className={`mb-0 ${className}`}>
      <div className="flex items-center gap-2 mb-2 select-none">
        <span className="text-emerald-500/70 font-mono text-[10px]">{icon || ">"}</span>
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-emerald-500/70">{label}</span>
        <span className="flex-1 border-t border-emerald-500/10" />
      </div>
      <div className="pl-4 border-l border-border/30">
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
    <a href={safe} target="_blank" rel="noopener noreferrer" className={`font-mono text-emerald-500/60 hover:text-emerald-400 transition-colors underline underline-offset-2 decoration-emerald-500/20 hover:decoration-emerald-400/40 ${className}`} {...props}>
      {children}
    </a>
  );
}


function NextStepsAdvisor({ companyId, pipelineStage }: { companyId: string; pipelineStage: string }) {
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
          className="font-mono text-xs text-muted-foreground hover:text-emerald-400 transition-colors group flex items-center gap-2"
          data-testid="button-generate-next-steps"
        >
          <span className="text-emerald-500/50 group-hover:text-emerald-400">$</span>
          <span>generate_recommendations</span>
          <span className="text-muted-foreground/30">~$0.12</span>
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div data-testid="card-next-steps" className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-emerald-500/60">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>analyzing deal context...</span>
          <span className="animate-pulse">_</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="pl-4">
            <Skeleton className="h-3 w-3/4 bg-emerald-500/5" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !steps || steps.length === 0) {
    return (
      <div data-testid="card-next-steps" className="space-y-2">
        <p className="font-mono text-xs text-red-400/60">
          {error ? "ERR: could not generate recommendations" : "no recommendations available"}
        </p>
        <button
          onClick={() => refetch()}
          className="font-mono text-xs text-muted-foreground hover:text-emerald-400 transition-colors group flex items-center gap-2"
          data-testid="button-retry-next-steps"
        >
          <span className="text-emerald-500/50 group-hover:text-emerald-400">$</span>
          <span>retry</span>
          <span className="text-muted-foreground/30">~$0.12</span>
        </button>
      </div>
    );
  }

  const highPriority = steps.filter((s) => s.priority === "high");
  const displaySteps = showAll ? steps : highPriority.length > 0 ? highPriority.slice(0, 4) : steps.slice(0, 3);
  const hiddenCount = steps.length - displaySteps.length;

  return (
    <div data-testid="card-next-steps" className="space-y-2">
      {displaySteps.map((step, i) => (
        <div key={i} className="group" data-testid={`next-step-${i}`}>
          <div className="flex items-start gap-2 font-mono">
            <span className={`text-[10px] flex-shrink-0 mt-0.5 ${PRIORITY_COLORS[step.priority]}`}>
              {PRIORITY_MARKERS[step.priority]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-tight" data-testid={`next-step-title-${i}`}>
                {step.title}
                {step.verified && <span className="text-emerald-500 ml-1">✓</span>}
              </p>
              <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-snug" data-testid={`next-step-detail-${i}`}>{step.detail}</p>
              {step.verifierNote && (
                <p className="text-[10px] text-emerald-500/50 mt-0.5 font-mono">
                  ✓ {step.verifierNote}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && !showAll && (
        <button onClick={() => setShowAll(true)} className="font-mono text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors flex items-center gap-1" data-testid="button-show-more-steps">
          <span className="text-emerald-500/30">└</span> +{hiddenCount} more
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button onClick={() => setShowAll(false)} className="font-mono text-[10px] text-muted-foreground/40 hover:text-foreground transition-colors" data-testid="button-show-less-steps">
          collapse
        </button>
      )}
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
          className="flex items-center gap-2 py-1.5 font-mono text-xs group hover:text-emerald-400 transition-colors cursor-pointer"
          data-testid={`link-report-${report.id}`}
        >
          <span className="text-emerald-500/30 group-hover:text-emerald-400">├</span>
          <span className="text-muted-foreground group-hover:text-emerald-400 truncate flex-1">
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
            <span className="text-muted-foreground/30 text-[10px]">{format(new Date(report.createdAt), "yyyy-MM-dd")}</span>
          )}
        </a>
      ))}
      <button
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        className="font-mono text-xs text-muted-foreground hover:text-emerald-400 transition-colors group flex items-center gap-2 disabled:opacity-30"
        data-testid="button-generate-report"
      >
        <span className="text-emerald-500/50 group-hover:text-emerald-400">$</span>
        {generateMutation.isPending ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            initializing deep research...
          </span>
        ) : (
          <span>generate_deep_research</span>
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
    <div className="flex items-center gap-1.5 flex-wrap font-mono text-[10px]">
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => removeTag(tag)}
          className="text-muted-foreground/60 hover:text-red-400 transition-colors group"
          data-testid={`badge-tag-${tag}`}
        >
          <span className="text-emerald-500/30 group-hover:text-red-400/50">#</span>{tag}
        </button>
      ))}
      {adding ? (
        <input
          autoFocus
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") addTag(); if (e.key === "Escape") { setAdding(false); setNewTag(""); } }}
          onBlur={() => { if (!newTag.trim()) setAdding(false); }}
          className="bg-transparent border-b border-emerald-500/30 text-xs font-mono text-foreground outline-none w-20 pb-0.5"
          placeholder="tag"
          data-testid="input-new-tag"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-muted-foreground/20 hover:text-emerald-400 transition-colors"
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
    if (score <= 3) return "bg-blue-500/50";
    if (score <= 6) return "bg-amber-500/50";
    if (score <= 8) return "bg-orange-500/50";
    return "bg-red-500/50";
  };

  const getLabel = () => {
    if (!score) return "unrated";
    if (score <= 3) return "low_conviction";
    if (score <= 6) return "moderate";
    if (score <= 8) return "high_excitement";
    return "must_have";
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
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {score ? `${score}/10` : "—"} <span className="text-muted-foreground/20">{getLabel()}</span>
        </span>
      </div>
      {editing ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={localReason}
            onChange={(e) => setLocalReason(e.target.value)}
            placeholder="why this score?"
            className="w-full min-h-[40px] bg-transparent border border-border/30 text-xs font-mono text-foreground/80 p-2 outline-none resize-none focus:border-emerald-500/30"
            data-testid="textarea-excitement-reason"
          />
          <div className="flex gap-2 justify-end font-mono text-[10px]">
            <button onClick={() => { setEditing(false); setLocalReason(reason || ""); }} className="text-muted-foreground/40 hover:text-foreground transition-colors" data-testid="button-cancel-reason">cancel</button>
            <button onClick={saveReason} disabled={mutation.isPending} className="text-emerald-500/60 hover:text-emerald-400 transition-colors" data-testid="button-save-reason">save</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="mt-1 font-mono text-[10px] text-muted-foreground/30 hover:text-foreground/60 transition-colors block w-full text-left"
          data-testid="button-edit-reason"
        >
          {reason ? <span className="text-muted-foreground/50">{reason}</span> : <span className="italic">add note...</span>}
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
  const [activeTab, setActiveTab] = useState<"deal" | "token">("deal");

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
      <div className="p-6 max-w-6xl mx-auto font-mono">
        <div className="flex items-center gap-2 text-xs text-emerald-500/40 mb-6">
          <Terminal className="w-3 h-3" />
          <span>loading...</span>
          <span className="animate-pulse">_</span>
        </div>
        <Skeleton className="h-4 w-48 bg-emerald-500/5 mb-4" />
        <Skeleton className="h-32 w-full bg-emerald-500/5 mb-4" />
        <Skeleton className="h-64 w-full bg-emerald-500/5" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 flex items-center justify-center h-full font-mono">
        <div className="text-center">
          <p className="text-sm text-red-400/60 mb-2">ERR: company not found</p>
          <button onClick={() => navigate("/")} className="text-xs text-emerald-500/60 hover:text-emerald-400 transition-colors">
            $ cd /pipeline
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto terminal-scrollbar">
      <div className="max-w-6xl mx-auto p-6 font-mono">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50">
            <button onClick={() => navigate("/companies")} className="hover:text-emerald-400 transition-colors" data-testid="button-back">companies</button>
            <span className="text-muted-foreground/20">/</span>
            <span className="text-foreground/80">{company.name.toLowerCase().replace(/\s+/g, '-')}</span>
          </div>
          <button
            onClick={() => navigate("/add")}
            className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40 hover:text-emerald-400 transition-colors"
            data-testid="button-add-deal"
          >
            <Plus className="w-3 h-3" />
            new
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

          <div className="flex items-center gap-3 flex-wrap text-[10px] font-mono mb-3">
            {company.sector && (
              <span className="text-muted-foreground/40">
                {company.sector}{company.subSector ? `/${company.subSector}` : ""}
              </span>
            )}
            {company.hasLiquidToken && (
              <span className="text-yellow-500/80" data-testid="badge-liquid-token">
                {company.tokenTicker || "TOKEN"}{company.tokenTier ? ` · ${company.tokenTier}` : ""}
              </span>
            )}
            {company.stage && <span className="text-muted-foreground/30">{company.stage}</span>}
            {company.businessModel && <span className="text-muted-foreground/30">{company.businessModel}</span>}
            {company.createdAt && (
              <span className="text-muted-foreground/20 ml-auto">
                {format(new Date(company.createdAt), "yyyy-MM-dd")}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-muted-foreground/30">
            <TermLink href={company.websiteUrl} className="hover:text-emerald-400" data-testid="link-company-website" aria-label="Website">
              <Globe className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.twitterUrl} className="hover:text-emerald-400" data-testid="link-company-twitter" aria-label="Twitter">
              <Twitter className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.githubUrl} className="hover:text-emerald-400" data-testid="link-company-github" aria-label="GitHub">
              <SiGithub className="w-3.5 h-3.5" />
            </TermLink>
            <TermLink href={company.linkedinUrl} className="hover:text-emerald-400" data-testid="link-company-linkedin" aria-label="LinkedIn">
              <Linkedin className="w-3.5 h-3.5" />
            </TermLink>
          </div>
        </div>

        <div className="border-t border-border/20 pt-4 mb-6">
          <div className="flex items-center gap-6 mb-6" role="tablist" aria-label="Intelligence tabs">
            <button
              role="tab"
              aria-selected={activeTab === "deal"}
              aria-controls="panel-deal"
              onClick={() => setActiveTab("deal")}
              className={`text-xs font-mono transition-colors ${activeTab === "deal" ? "text-foreground" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
              data-testid="tab-deal-intelligence"
            >
              <span className={activeTab === "deal" ? "text-emerald-500" : "text-muted-foreground/20"}>{">"}</span> deal_intelligence
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "token"}
              aria-controls="panel-token"
              onClick={() => setActiveTab("token")}
              className={`text-xs font-mono transition-colors ${activeTab === "token" ? "text-foreground" : "text-muted-foreground/30 hover:text-muted-foreground/60"}`}
              data-testid="tab-token-intelligence"
            >
              <span className={activeTab === "token" ? "text-emerald-500" : "text-muted-foreground/20"}>{">"}</span> token_intelligence
            </button>
          </div>
        </div>

        {activeTab === "deal" ? (
          <div id="panel-deal" role="tabpanel" aria-labelledby="tab-deal-intelligence" className="flex flex-col lg:flex-row gap-8">
            <div className="flex-1 min-w-0 space-y-6">

              {company.description && (
                <TermBlock label="INTEL" icon="█">
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-company-description">{company.description}</p>
                </TermBlock>
              )}

              {company.fundingHistory && (
                <TermBlock label="FUNDING" icon="$">
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-funding">{company.fundingHistory}</p>
                </TermBlock>
              )}

              {company.competitiveLandscape && (
                <TermBlock label="COMPETITIVE" icon="⚔">
                  <p className="text-[13px] leading-relaxed text-foreground/80" data-testid="text-competitive">{company.competitiveLandscape}</p>
                </TermBlock>
              )}

              {company.adjacentReads && (() => {
                try {
                  const reads = JSON.parse(company.adjacentReads);
                  if (Array.isArray(reads) && reads.length > 0) {
                    return (
                      <TermBlock label={`DD READS [${reads.length}]`} icon="📎">
                        <div className="space-y-1">
                          {reads.map((read: any, idx: number) => (
                            <a
                              key={idx}
                              href={read.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 py-1 group text-xs font-mono"
                              data-testid={`link-dd-read-${idx}`}
                            >
                              <span className="text-emerald-500/20 group-hover:text-emerald-400 transition-colors">├</span>
                              <span className="text-foreground/60 group-hover:text-emerald-400 truncate flex-1 transition-colors">{read.title}</span>
                              {read.source && (
                                <span className="text-muted-foreground/20 flex-shrink-0">[{read.source}]</span>
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

              {founders.length > 0 && (
                <TermBlock label={`TEAM [${founders.length}]`} icon="◉">
                  <div className="space-y-4">
                    {founders.map((founder, idx) => (
                      <div key={founder.id} data-testid={`card-founder-${founder.id}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold" data-testid={`text-founder-name-${founder.id}`}>{founder.name}</span>
                          {founder.role && <span className="text-[10px] text-emerald-500/40">{founder.role}</span>}
                          <div className="flex items-center gap-2 ml-auto text-muted-foreground/20">
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
                        {founder.bio && <p className="text-xs text-muted-foreground/60 leading-relaxed">{founder.bio}</p>}
                        {founder.priorCompanies && (
                          <p className="text-[10px] text-muted-foreground/40 mt-1">
                            <span className="text-emerald-500/30">prev:</span> {founder.priorCompanies}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </TermBlock>
              )}

              <TermBlock label={`LOG [${notes.length}]`} icon="◇">
                <div className="mb-3">
                  <div className="flex items-start gap-2">
                    <span className="text-emerald-500/30 text-xs mt-1.5">$</span>
                    <textarea
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="add note..."
                      className="flex-1 min-h-[40px] bg-transparent text-xs text-foreground/80 outline-none resize-none placeholder:text-muted-foreground/20 border-b border-transparent focus:border-emerald-500/20 transition-colors"
                      data-testid="textarea-note"
                    />
                    <button
                      onClick={() => noteContent.trim() && addNoteMutation.mutate(noteContent)}
                      disabled={!noteContent.trim() || addNoteMutation.isPending}
                      className="text-emerald-500/30 hover:text-emerald-400 transition-colors disabled:opacity-20 mt-1.5"
                      data-testid="button-add-note"
                    >
                      <Send className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {notes.length > 0 ? (
                  <div className="space-y-0">
                    {notes.map((note) => (
                      <div key={note.id} className="flex items-start gap-2 py-2 border-t border-border/10 group" data-testid={`note-${note.id}`}>
                        <span className="text-[10px] text-muted-foreground/20 font-mono flex-shrink-0 mt-0.5 w-16">
                          {note.createdAt ? format(new Date(note.createdAt), "MM/dd HH:mm") : ""}
                        </span>
                        <p className="text-xs whitespace-pre-wrap text-foreground/70 flex-1">{note.content}</p>
                        <button
                          onClick={() => deleteNoteMutation.mutate(note.id)}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/20 hover:text-red-400 transition-all"
                          aria-label="Delete note"
                          data-testid={`button-delete-note-${note.id}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/20 font-mono">no entries</p>
                )}
              </TermBlock>

              <TermBlock label="DEEP RESEARCH" icon="◆">
                <DeepResearchSection companyId={company.id} companyName={company.name} />
              </TermBlock>
            </div>

            <div className="lg:w-64 flex-shrink-0 space-y-6">
              <TermBlock label="STAGE" icon="◎">
                <div className="space-y-1">
                  {PIPELINE_STAGES.map((stage) => {
                    const isActive = company.pipelineStage === stage;
                    return (
                      <button
                        key={stage}
                        onClick={() => updateStageMutation.mutate(stage)}
                        className={`w-full text-left font-mono text-[11px] py-1 px-2 transition-colors flex items-center gap-2 ${
                          isActive
                            ? `${STAGE_COLORS[stage]} bg-accent/20`
                            : "text-muted-foreground/20 hover:text-muted-foreground/60 hover:bg-accent/10"
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

              <TermBlock label="CONVICTION" icon="▲">
                <ExcitementBar companyId={company.id} score={company.excitementScore ?? null} reason={company.excitementReason ?? null} />
              </TermBlock>

              <TermBlock label="NEXT STEPS" icon="→">
                <NextStepsAdvisor companyId={company.id} pipelineStage={company.pipelineStage} />
              </TermBlock>

              <TermBlock label="TAGS" icon="#">
                <TagsInline tags={company.tags || []} companyId={company.id} />
              </TermBlock>

              <div className="pt-4 border-t border-border/10 space-y-1">
                {company.websiteUrl && (
                  <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/30 hover:text-emerald-400 transition-colors py-0.5" data-testid="button-visit-website">
                    <span className="text-emerald-500/20">$</span> open website
                  </a>
                )}
                {company.sourceUrl && company.sourceUrl !== company.websiteUrl && (
                  <a href={company.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/30 hover:text-emerald-400 transition-colors py-0.5" data-testid="button-visit-source">
                    <span className="text-emerald-500/20">$</span> open source
                  </a>
                )}
                <div className="pt-2">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex items-center gap-2 font-mono text-[10px] text-red-400/20 hover:text-red-400/60 transition-colors py-0.5"
                      data-testid="button-delete-company"
                    >
                      <span>$</span> rm -rf {company.name.toLowerCase().replace(/\s+/g, '_')}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="font-mono text-[10px] text-red-400/70">
                        confirm: delete "{company.name}"? this cannot be undone.
                      </p>
                      <div className="flex gap-2 font-mono text-[10px]">
                        <button
                          onClick={() => deleteCompanyMutation.mutate()}
                          disabled={deleteCompanyMutation.isPending}
                          className="text-red-400 hover:text-red-300 transition-colors"
                          data-testid="button-confirm-delete"
                        >
                          {deleteCompanyMutation.isPending ? "deleting..." : "y"}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="text-muted-foreground/40 hover:text-foreground transition-colors"
                          data-testid="button-cancel-delete"
                        >
                          n
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div id="panel-token" role="tabpanel" aria-labelledby="tab-token-intelligence">
            <TokenIntelligenceTab companyId={company.id} companyName={company.name} hasLiquidToken={company.hasLiquidToken ?? false} />
          </div>
        )}
      </div>
    </div>
  );
}
