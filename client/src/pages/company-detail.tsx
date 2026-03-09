import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, type Founder, type Note, STAGE_LABELS, PIPELINE_STAGES, type PipelineStage } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Clock,
  Users,
  DollarSign,
  Target,
  Globe,
  Linkedin,
  Twitter,
  StickyNote,
  Send,
  Trash2,
  ChevronRight,
  Link2,
  Search,
  Phone,
  FileText,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { SiGithub } from "react-icons/si";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import type { Report } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

function InfoRow({
  icon: Icon,
  label,
  value,
  testId,
}: {
  icon: any;
  label: string;
  value?: string | null;
  testId?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-0.5">{label}</p>
        <p className="text-sm leading-relaxed" data-testid={testId}>{value}</p>
      </div>
    </div>
  );
}

function FounderItem({ founder }: { founder: Founder }) {
  return (
    <div className="flex items-start gap-3 py-3" data-testid={`card-founder-${founder.id}`}>
      <div className="w-9 h-9 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
        <Users className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <h4 className="font-medium text-sm" data-testid={`text-founder-name-${founder.id}`}>{founder.name}</h4>
          {founder.role && (
            <span className="text-xs text-muted-foreground">{founder.role}</span>
          )}
        </div>
        {founder.bio && (
          <p className="text-xs text-muted-foreground mb-1.5 leading-relaxed">{founder.bio}</p>
        )}
        {founder.priorCompanies && (
          <p className="text-xs text-muted-foreground mb-1.5">
            <span className="font-medium">Previously:</span> {founder.priorCompanies}
          </p>
        )}
        <div className="flex items-center gap-2">
          {founder.linkedinUrl && (
            <a href={founder.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid={`link-founder-linkedin-${founder.id}`}>
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.twitterUrl && (
            <a href={founder.twitterUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid={`link-founder-twitter-${founder.id}`}>
              <Twitter className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.githubUrl && (
            <a href={founder.githubUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid={`link-founder-github-${founder.id}`}>
              <SiGithub className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.personalUrl && (
            <a href={founder.personalUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid={`link-founder-website-${founder.id}`}>
              <Globe className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteItem({ note, onDelete }: { note: Note; onDelete: () => void }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0" data-testid={`note-${note.id}`}>
      <StickyNote className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
        <p className="text-[10px] text-muted-foreground/50 mt-1">
          {note.createdAt ? format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a") : ""}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={onDelete}
        className="flex-shrink-0 opacity-30 hover:opacity-100"
        data-testid={`button-delete-note-${note.id}`}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

interface NextStepItem {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
  category: "research" | "outreach" | "diligence" | "relationship" | "action";
  verified?: boolean;
  verifierNote?: string;
}

const CATEGORY_ICONS: Record<string, any> = {
  research: Search,
  outreach: Phone,
  diligence: FileText,
  relationship: Users,
  action: ArrowRight,
};

const PRIORITY_STYLES = {
  high: "border-l-amber-500",
  medium: "border-l-blue-500/40",
  low: "border-l-muted-foreground/20",
};

function NextStepsAdvisor({
  companyId,
  pipelineStage,
}: {
  companyId: string;
  pipelineStage: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const { data: steps, isLoading, error } = useQuery<NextStepItem[]>({
    queryKey: ["/api/companies", companyId, "next-steps"],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/next-steps`);
      if (!res.ok) throw new Error("Failed to fetch next steps");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div data-testid="card-next-steps">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          Analyzing Deal...
        </h3>
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-l-2 border-l-muted rounded-r-md p-2.5">
              <Skeleton className="h-3 w-3/4 mb-1.5" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !steps || steps.length === 0) {
    return (
      <div data-testid="card-next-steps">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" />
          Recommended Next Steps
        </h3>
        <p className="text-[11px] text-muted-foreground text-center py-3">
          {error ? "Could not generate recommendations." : "No recommendations available."}
        </p>
      </div>
    );
  }

  const highPriority = steps.filter((s) => s.priority === "high");
  const displaySteps = showAll ? steps : highPriority.length > 0 ? highPriority.slice(0, 4) : steps.slice(0, 3);
  const hiddenCount = steps.length - displaySteps.length;

  return (
    <div data-testid="card-next-steps">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        Recommended Next Steps
      </h3>
      <div className="space-y-1.5">
        {displaySteps.map((step, i) => {
          const Icon = CATEGORY_ICONS[step.category] || Sparkles;
          return (
            <div
              key={i}
              className={`border-l-2 rounded-r-md py-2 pl-3 pr-2 ${PRIORITY_STYLES[step.priority]}`}
              data-testid={`next-step-${i}`}
            >
              <div className="flex items-start gap-2">
                <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-foreground/70" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium leading-tight" data-testid={`next-step-title-${i}`}>{step.title}</p>
                    {step.verified && (
                      <ShieldCheck className="w-3 h-3 text-emerald-500 flex-shrink-0" data-testid={`next-step-verified-${i}`} />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug" data-testid={`next-step-detail-${i}`}>{step.detail}</p>
                  {step.verifierNote && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1 opacity-60" data-testid={`next-step-verifier-note-${i}`}>
                      <ShieldCheck className="w-2.5 h-2.5 flex-shrink-0" />
                      {step.verifierNote}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1"
          data-testid="button-show-more-steps"
        >
          <ChevronRight className="w-3 h-3" />
          {hiddenCount} more
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(false)}
          className="text-[11px] text-muted-foreground mt-2"
          data-testid="button-show-less-steps"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function DeepResearchSection({ companyId, companyName }: { companyId: string; companyName: string }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: reports = [], isLoading } = useQuery<Report[]>({
    queryKey: ["/api/companies", companyId, "reports"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/companies/${companyId}/reports/generate`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "reports"] });
      navigate(`/reports/${data.reportId}`);
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate report", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="mb-6">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
        Deep Research
      </h3>

      {reports.length > 0 && (
        <div className="space-y-2 mb-4">
          {reports.map((report) => (
            <a
              key={report.id}
              href={`/reports/${report.id}`}
              onClick={(e) => { e.preventDefault(); navigate(`/reports/${report.id}`); }}
              className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer group"
              data-testid={`link-report-${report.id}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{report.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {report.status === "generating" ? "Generating..." : format(new Date(report.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              {report.status === "generating" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
              )}
            </a>
          ))}
        </div>
      )}

      <Button
        variant="outline"
        className="w-full gap-2 text-xs"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        data-testid="button-generate-report"
      >
        {generateMutation.isPending ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Starting research...
          </>
        ) : (
          <>
            <FileText className="w-3.5 h-3.5" />
            Generate Deep Research Report
          </>
        )}
      </Button>
    </div>
  );
}

function TagManager({
  tags,
  companyId,
}: {
  tags: string[];
  companyId: string;
}) {
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
    if (tags.includes(tag)) {
      toast({ title: "Tag already exists", variant: "destructive" });
      return;
    }
    updateTagsMutation.mutate([...tags, tag]);
    setNewTag("");
  };

  const removeTag = (tagToRemove: string) => {
    updateTagsMutation.mutate(tags.filter((t) => t !== tagToRemove));
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="cursor-pointer text-[10px]"
            onClick={() => removeTag(tag)}
            data-testid={`badge-tag-${tag}`}
          >
            {tag}
            <span className="ml-1 text-muted-foreground">&times;</span>
          </Badge>
        ))}
        {tags.length === 0 && (
          <p className="text-xs text-muted-foreground/50">No tags yet</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="Add tag..."
          className="h-7 text-xs"
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          data-testid="input-new-tag"
        />
        <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={addTag} data-testid="button-add-tag">
          Add
        </Button>
      </div>
    </div>
  );
}

export default function CompanyDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [noteContent, setNoteContent] = useState("");
  const { toast } = useToast();

  const { data: company, isLoading: companyLoading } = useQuery<Company>({
    queryKey: ["/api/companies", params.id],
  });

  const { data: founders = [] } = useQuery<Founder[]>({
    queryKey: ["/api/companies", params.id, "founders"],
  });

  const { data: notes = [] } = useQuery<Note[]>({
    queryKey: ["/api/companies", params.id, "notes"],
  });

  const updateStageMutation = useMutation({
    mutationFn: async (stage: PipelineStage) => {
      await apiRequest("PATCH", `/api/companies/${params.id}`, { pipelineStage: stage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Pipeline stage updated" });
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async (content: string) => {
      await apiRequest("POST", `/api/companies/${params.id}/notes`, {
        content,
        companyId: params.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id, "notes"] });
      setNoteContent("");
      toast({ title: "Note added" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      await apiRequest("DELETE", `/api/notes/${noteId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", params.id, "notes"] });
      toast({ title: "Note deleted" });
    },
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/companies/${params.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Company deleted" });
      navigate("/companies");
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (companyLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-5 w-16 mb-6" />
        <div className="flex gap-8">
          <div className="flex-1 space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="w-64 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
          <h3 className="text-sm font-medium mb-1">Company not found</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate("/")} className="mt-3">
            Back to Pipeline
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto h-full overflow-y-auto">
      <button
        onClick={() => navigate(-1 as any)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4"
        data-testid="button-back"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
              {company.imageUrl ? (
                <img src={company.imageUrl} alt={company.name} className="w-12 h-12 rounded-lg object-cover" />
              ) : (
                <Building2 className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight" data-testid="text-company-name">{company.name}</h1>
              <p className="text-sm text-muted-foreground mt-0.5" data-testid="text-company-oneliner">{company.oneLiner}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {company.sector && (
                  <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.sector}{company.subSector ? ` · ${company.subSector}` : ""}</span>
                )}
                {company.stage && (
                  <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.stage}</span>
                )}
                {company.businessModel && (
                  <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.businessModel}</span>
                )}
              </div>
            </div>
          </div>

          {company.description && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">About</h3>
              <p className="text-sm leading-relaxed" data-testid="text-company-description">{company.description}</p>
            </div>
          )}

          {(company.websiteUrl || company.githubUrl || company.twitterUrl || company.linkedinUrl) && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Links</h3>
              <div className="flex flex-wrap gap-2">
                {company.websiteUrl && (
                  <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors" data-testid="link-company-website">
                    <Globe className="w-3 h-3" /> Website
                  </a>
                )}
                {company.githubUrl && (
                  <a href={company.githubUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors" data-testid="link-company-github">
                    <SiGithub className="w-3 h-3" /> GitHub
                  </a>
                )}
                {company.twitterUrl && (
                  <a href={company.twitterUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors" data-testid="link-company-twitter">
                    <Twitter className="w-3 h-3" /> Twitter / X
                  </a>
                )}
                {company.linkedinUrl && (
                  <a href={company.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent/50 text-xs text-foreground hover:bg-accent transition-colors" data-testid="link-company-linkedin">
                    <Linkedin className="w-3 h-3" /> LinkedIn
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="space-y-0 mb-6">
            <InfoRow icon={DollarSign} label="Funding History" value={company.fundingHistory} testId="text-funding" />
            <InfoRow icon={Target} label="Competitive Landscape" value={company.competitiveLandscape} testId="text-competitive" />
            <InfoRow icon={Link2} label="Source" value={company.sourceUrl} testId="text-source" />
            <InfoRow icon={Clock} label="Captured" value={company.createdAt ? format(new Date(company.createdAt), "MMMM d, yyyy") : undefined} testId="text-captured" />
          </div>

          {founders.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Founders & Team
              </h3>
              <div className="divide-y divide-border/30">
                {founders.map((founder) => (
                  <FounderItem key={founder.id} founder={founder} />
                ))}
              </div>
            </div>
          )}

          <div className="mb-6">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
              Notes ({notes.length})
            </h3>
            <div className="mb-3">
              <Textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Add a note about this company..."
                className="min-h-[72px] text-sm resize-none"
                data-testid="textarea-note"
              />
              <div className="flex justify-end mt-2">
                <Button
                  size="sm"
                  onClick={() => noteContent.trim() && addNoteMutation.mutate(noteContent)}
                  disabled={!noteContent.trim() || addNoteMutation.isPending}
                  data-testid="button-add-note"
                >
                  <Send className="w-3 h-3 mr-1.5" />
                  {addNoteMutation.isPending ? "Adding..." : "Add Note"}
                </Button>
              </div>
            </div>
            {notes.length > 0 ? (
              <div>
                {notes.map((note) => (
                  <NoteItem
                    key={note.id}
                    note={note}
                    onDelete={() => deleteNoteMutation.mutate(note.id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/40 text-center py-4">No notes yet</p>
            )}
          </div>

          <DeepResearchSection companyId={company.id} companyName={company.name} />
        </div>

        <div className="lg:w-64 flex-shrink-0 space-y-6">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Pipeline Stage</h3>
            <Select
              value={company.pipelineStage}
              onValueChange={(v) => updateStageMutation.mutate(v as PipelineStage)}
            >
              <SelectTrigger className="h-8" data-testid="select-pipeline-stage">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_STAGES.map((stage) => (
                  <SelectItem key={stage} value={stage}>
                    {STAGE_LABELS[stage]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border-t pt-6">
            <NextStepsAdvisor companyId={company.id} pipelineStage={company.pipelineStage} />
          </div>

          <div className="border-t pt-6">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Tags</h3>
            <TagManager tags={company.tags || []} companyId={company.id} />
          </div>

          <div className="border-t pt-6">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Quick Actions</h3>
            <div className="space-y-1.5">
              {company.websiteUrl && (
                <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" data-testid="button-visit-website">
                    <Globe className="w-3.5 h-3.5 mr-2" /> Visit Website
                  </Button>
                </a>
              )}
              {company.sourceUrl && company.sourceUrl !== company.websiteUrl && (
                <a href={company.sourceUrl} target="_blank" rel="noopener noreferrer" className="block">
                  <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs" data-testid="button-visit-source">
                    <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visit Source
                  </Button>
                </a>
              )}
            </div>
          </div>

          <div className="border-t pt-6">
            {!showDeleteConfirm ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setShowDeleteConfirm(true)}
                data-testid="button-delete-company"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Company
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-destructive font-medium">Delete "{company.name}"? This removes all founders, notes, and reports.</p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 h-7 text-xs"
                    onClick={() => deleteCompanyMutation.mutate()}
                    disabled={deleteCompanyMutation.isPending}
                    data-testid="button-confirm-delete"
                  >
                    {deleteCompanyMutation.isPending ? "Deleting..." : "Confirm Delete"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowDeleteConfirm(false)}
                    data-testid="button-cancel-delete"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
