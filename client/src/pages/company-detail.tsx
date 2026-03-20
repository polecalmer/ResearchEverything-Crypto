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
  Building2,
  ExternalLink,
  Users,
  Globe,
  Linkedin,
  Twitter,
  Send,
  Trash2,
  ChevronRight,
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
import { format } from "date-fns";
import type { Report } from "@shared/schema";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const STAGE_DOT_COLORS: Record<PipelineStage, string> = {
  discovered: "bg-blue-500",
  researching: "bg-amber-500",
  reaching_out: "bg-purple-500",
  in_diligence: "bg-emerald-500",
  passed: "bg-muted-foreground",
  invested: "bg-green-500",
};

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

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 border-b border-border/50">
        <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
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

function SafeLink({ href, children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string | null }) {
  const safe = safeHref(href);
  if (!safe) return null;
  return <a href={safe} target="_blank" rel="noopener noreferrer" className={className} {...props}>{children}</a>;
}

function NextStepsAdvisor({ companyId, pipelineStage }: { companyId: string; pipelineStage: string }) {
  const [showAll, setShowAll] = useState(false);
  const { data: steps, isLoading, error } = useQuery<NextStepItem[]>({
    queryKey: ["/api/companies", companyId, "next-steps", pipelineStage],
    queryFn: async () => {
      const res = await fetch(`/api/companies/${companyId}/next-steps`);
      if (!res.ok) throw new Error("Failed to fetch next steps");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div data-testid="card-next-steps" className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="w-3 h-3 animate-pulse" />
          <span>Analyzing deal...</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="border-l-2 border-l-muted rounded-r-md p-2.5">
            <Skeleton className="h-3 w-3/4 mb-1.5" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error || !steps || steps.length === 0) {
    return (
      <div data-testid="card-next-steps">
        <p className="text-xs text-muted-foreground text-center py-2">
          {error ? "Could not generate recommendations." : "No recommendations available."}
        </p>
      </div>
    );
  }

  const highPriority = steps.filter((s) => s.priority === "high");
  const displaySteps = showAll ? steps : highPriority.length > 0 ? highPriority.slice(0, 4) : steps.slice(0, 3);
  const hiddenCount = steps.length - displaySteps.length;

  return (
    <div data-testid="card-next-steps" className="space-y-1.5">
      {displaySteps.map((step, i) => {
        const Icon = CATEGORY_ICONS[step.category] || Sparkles;
        return (
          <div
            key={i}
            className={`border-l-2 rounded-r-md py-2 pl-3 pr-2 bg-accent/20 ${PRIORITY_STYLES[step.priority]}`}
            data-testid={`next-step-${i}`}
          >
            <div className="flex items-start gap-2">
              <Icon className="w-3 h-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium leading-tight" data-testid={`next-step-title-${i}`}>{step.title}</p>
                  {step.verified && <ShieldCheck className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug" data-testid={`next-step-detail-${i}`}>{step.detail}</p>
                {step.verifierNote && (
                  <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 opacity-70">
                    <ShieldCheck className="w-2.5 h-2.5 flex-shrink-0" />
                    {step.verifierNote}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {hiddenCount > 0 && !showAll && (
        <button onClick={() => setShowAll(true)} className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 hover:text-foreground transition-colors" data-testid="button-show-more-steps">
          <ChevronRight className="w-3 h-3" />
          {hiddenCount} more
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button onClick={() => setShowAll(false)} className="text-[11px] text-muted-foreground mt-1 hover:text-foreground transition-colors" data-testid="button-show-less-steps">
          Show less
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
    <div>
      {reports.length > 0 && (
        <div className="space-y-1 mb-3">
          {reports.map((report) => (
            <a
              key={report.id}
              href={`/reports/${report.id}`}
              onClick={(e) => { e.preventDefault(); navigate(`/reports/${report.id}`); }}
              className="flex items-center justify-between px-3 py-2.5 rounded-md hover:bg-accent/40 transition-colors cursor-pointer group"
              data-testid={`link-report-${report.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{report.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {report.status === "generating" ? "Generating..." : format(new Date(report.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              {report.status === "generating" ? (
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-foreground transition-colors shrink-0" />
              )}
            </a>
          ))}
        </div>
      )}
      <Button
        variant="outline"
        className="w-full gap-2 text-xs h-8"
        onClick={() => generateMutation.mutate()}
        disabled={generateMutation.isPending}
        data-testid="button-generate-report"
      >
        {generateMutation.isPending ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Starting research...</>
        ) : (
          <><FileText className="w-3 h-3" /> Generate Deep Research Report</>
        )}
      </Button>
    </div>
  );
}

function TagManager({ tags, companyId }: { tags: string[]; companyId: string }) {
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
  };
  const removeTag = (tagToRemove: string) => updateTagsMutation.mutate(tags.filter((t) => t !== tagToRemove));

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="cursor-pointer text-[10px] font-mono" onClick={() => removeTag(tag)} data-testid={`badge-tag-${tag}`}>
            {tag} <span className="ml-1 text-muted-foreground">&times;</span>
          </Badge>
        ))}
        {tags.length === 0 && <p className="text-xs text-muted-foreground">No tags</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Add tag..." className="h-7 text-xs flex-1" onKeyDown={(e) => e.key === "Enter" && addTag()} data-testid="input-new-tag" />
        <Button size="sm" variant="secondary" className="h-7 text-xs px-2.5" onClick={addTag} data-testid="button-add-tag">Add</Button>
      </div>
    </div>
  );
}

export default function CompanyDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [noteContent, setNoteContent] = useState("");
  const { toast } = useToast();

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
      <div className="p-6 max-w-5xl mx-auto">
        <Skeleton className="h-4 w-24 mb-6" />
        <div className="flex gap-6">
          <div className="flex-1 space-y-4">
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
          <div className="w-72 space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-40 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-20" />
          <h3 className="text-sm font-medium mb-1">Company not found</h3>
          <Button variant="secondary" size="sm" onClick={() => navigate("/")} className="mt-3">Back to Pipeline</Button>
        </div>
      </div>
    );
  }

  const hasLinks = company.websiteUrl || company.githubUrl || company.twitterUrl || company.linkedinUrl;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-5">
          <button onClick={() => navigate("/companies")} className="hover:text-foreground transition-colors" data-testid="button-back">Companies</button>
          <span className="text-muted-foreground/30">/</span>
          <span className="text-foreground font-medium truncate">{company.name}</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0 space-y-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                    {company.imageUrl ? (
                      <img src={company.imageUrl} alt={company.name} className="w-11 h-11 rounded-lg object-cover" />
                    ) : (
                      <Building2 className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="text-lg font-semibold tracking-tight" data-testid="text-company-name">{company.name}</h1>
                      <SafeLink href={company.sourceUrl} className="text-muted-foreground/40 hover:text-foreground transition-colors" aria-label="View source">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </SafeLink>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-company-oneliner">{company.oneLiner}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {company.sector && (
                    <span className="text-[10px] font-mono text-muted-foreground bg-accent rounded px-2 py-0.5">
                      {company.sector}{company.subSector ? ` / ${company.subSector}` : ""}
                    </span>
                  )}
                  {company.stage && <span className="text-[10px] font-mono text-muted-foreground bg-accent rounded px-2 py-0.5">{company.stage}</span>}
                  {company.businessModel && <span className="text-[10px] font-mono text-muted-foreground bg-accent rounded px-2 py-0.5">{company.businessModel}</span>}
                  {company.createdAt && (
                    <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">
                      Added {format(new Date(company.createdAt), "MMM d, yyyy")}
                    </span>
                  )}
                </div>
                {hasLinks && (
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/40">
                    <SafeLink href={company.websiteUrl} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-company-website" aria-label="Website">
                      <Globe className="w-4 h-4" />
                    </SafeLink>
                    <SafeLink href={company.twitterUrl} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-company-twitter" aria-label="Twitter">
                      <Twitter className="w-4 h-4" />
                    </SafeLink>
                    <SafeLink href={company.githubUrl} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-company-github" aria-label="GitHub">
                      <SiGithub className="w-4 h-4" />
                    </SafeLink>
                    <SafeLink href={company.linkedinUrl} className="text-muted-foreground hover:text-foreground transition-colors" data-testid="link-company-linkedin" aria-label="LinkedIn">
                      <Linkedin className="w-4 h-4" />
                    </SafeLink>
                  </div>
                )}
              </div>
            </div>

            {company.description && (
              <Section title="About">
                <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-company-description">{company.description}</p>
              </Section>
            )}

            {company.fundingHistory && (
              <Section title="Funding History">
                <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-funding">{company.fundingHistory}</p>
              </Section>
            )}

            {company.competitiveLandscape && (
              <Section title="Competitive Landscape">
                <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-competitive">{company.competitiveLandscape}</p>
              </Section>
            )}

            {founders.length > 0 && (
              <Section title={`Founders & Team (${founders.length})`}>
                <div className="space-y-4">
                  {founders.map((founder, idx) => (
                    <div key={founder.id} data-testid={`card-founder-${founder.id}`}>
                      {idx > 0 && <div className="border-t border-border/30 mb-4" />}
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-sm font-medium" data-testid={`text-founder-name-${founder.id}`}>{founder.name}</span>
                            {founder.role && <span className="text-xs text-muted-foreground font-mono">{founder.role}</span>}
                          </div>
                          {founder.bio && <p className="text-xs text-muted-foreground leading-relaxed mb-1.5">{founder.bio}</p>}
                          {founder.priorCompanies && (
                            <p className="text-xs text-muted-foreground mb-1.5">
                              <span className="text-foreground/70 font-medium">Previously:</span> {founder.priorCompanies}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <SafeLink href={founder.linkedinUrl} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`${founder.name} LinkedIn`} data-testid={`link-founder-linkedin-${founder.id}`}>
                              <Linkedin className="w-3.5 h-3.5" />
                            </SafeLink>
                            <SafeLink href={founder.twitterUrl} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`${founder.name} Twitter`} data-testid={`link-founder-twitter-${founder.id}`}>
                              <Twitter className="w-3.5 h-3.5" />
                            </SafeLink>
                            <SafeLink href={founder.githubUrl} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`${founder.name} GitHub`} data-testid={`link-founder-github-${founder.id}`}>
                              <SiGithub className="w-3.5 h-3.5" />
                            </SafeLink>
                            <SafeLink href={founder.personalUrl} className="text-muted-foreground hover:text-foreground transition-colors" aria-label={`${founder.name} website`} data-testid={`link-founder-website-${founder.id}`}>
                              <Globe className="w-3.5 h-3.5" />
                            </SafeLink>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title={`Notes (${notes.length})`}>
              <div className="mb-3">
                <Textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  placeholder="Add a note..."
                  className="min-h-[64px] text-sm resize-none bg-accent/30 border-border/50"
                  data-testid="textarea-note"
                />
                <div className="flex justify-end mt-2">
                  <Button
                    size="sm"
                    className="h-7 text-xs"
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
                <div className="space-y-0">
                  {notes.map((note) => (
                    <div key={note.id} className="flex items-start gap-3 py-2.5 border-t border-border/30" data-testid={`note-${note.id}`}>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                          {note.createdAt ? format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a") : ""}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteNoteMutation.mutate(note.id)}
                        className="flex-shrink-0 h-7 w-7 opacity-20 hover:opacity-100 text-destructive"
                        aria-label="Delete note"
                        data-testid={`button-delete-note-${note.id}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-3">No notes yet</p>
              )}
            </Section>

            <Section title="Deep Research">
              <DeepResearchSection companyId={company.id} companyName={company.name} />
            </Section>
          </div>

          <div className="lg:w-72 flex-shrink-0 space-y-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/50">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Pipeline Stage</h3>
              </div>
              <div className="p-3">
                <Select value={company.pipelineStage} onValueChange={(v) => updateStageMutation.mutate(v as PipelineStage)}>
                  <SelectTrigger className="h-9" data-testid="select-pipeline-stage">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${STAGE_DOT_COLORS[company.pipelineStage as PipelineStage]}`} />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {PIPELINE_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT_COLORS[stage]}`} />
                          {STAGE_LABELS[stage]}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/50 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-muted-foreground" />
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Next Steps</h3>
              </div>
              <div className="p-3">
                <NextStepsAdvisor companyId={company.id} pipelineStage={company.pipelineStage} />
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/50">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Tags</h3>
              </div>
              <div className="p-3">
                <TagManager tags={company.tags || []} companyId={company.id} />
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border/50">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Actions</h3>
              </div>
              <div className="p-2">
                <SafeLink href={company.websiteUrl} className="block" data-testid="button-visit-website">
                  <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs text-muted-foreground hover:text-foreground">
                    <Globe className="w-3.5 h-3.5 mr-2" /> Visit Website
                  </Button>
                </SafeLink>
                {company.sourceUrl !== company.websiteUrl && (
                  <SafeLink href={company.sourceUrl} className="block" data-testid="button-visit-source">
                    <Button variant="ghost" size="sm" className="w-full justify-start h-8 text-xs text-muted-foreground hover:text-foreground">
                      <ExternalLink className="w-3.5 h-3.5 mr-2" /> Visit Source
                    </Button>
                  </SafeLink>
                )}
                <div className="border-t border-border/30 mt-1 pt-1">
                  {!showDeleteConfirm ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start h-8 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={() => setShowDeleteConfirm(true)}
                      data-testid="button-delete-company"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete Company
                    </Button>
                  ) : (
                    <div className="p-2 space-y-2">
                      <p className="text-xs text-destructive">Delete "{company.name}"? All data will be removed.</p>
                      <div className="flex gap-1.5">
                        <Button variant="destructive" size="sm" className="flex-1 h-7 text-xs" onClick={() => deleteCompanyMutation.mutate()} disabled={deleteCompanyMutation.isPending} data-testid="button-confirm-delete">
                          {deleteCompanyMutation.isPending ? "Deleting..." : "Delete"}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowDeleteConfirm(false)} data-testid="button-cancel-delete">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
