import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, type Founder, type Note, STAGE_LABELS, PIPELINE_STAGES, type PipelineStage } from "@shared/schema";
import { Card } from "@/components/ui/card";
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
  Tag,
  Users,
  Briefcase,
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
  UserPlus,
  BarChart3,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { SiGithub } from "react-icons/si";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
        <p className="text-sm" data-testid={testId}>{value}</p>
      </div>
    </div>
  );
}

function FounderCard({ founder }: { founder: Founder }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/30" data-testid={`card-founder-${founder.id}`}>
      <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
        <Users className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-medium text-sm" data-testid={`text-founder-name-${founder.id}`}>{founder.name}</h4>
          {founder.role && (
            <span className="text-xs text-muted-foreground">{founder.role}</span>
          )}
        </div>
        {founder.bio && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{founder.bio}</p>
        )}
        {founder.priorCompanies && (
          <p className="text-xs text-muted-foreground mb-2">
            <span className="font-medium">Previously:</span> {founder.priorCompanies}
          </p>
        )}
        <div className="flex items-center gap-2">
          {founder.linkedinUrl && (
            <a
              href={founder.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`link-founder-linkedin-${founder.id}`}
            >
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.twitterUrl && (
            <a
              href={founder.twitterUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`link-founder-twitter-${founder.id}`}
            >
              <Twitter className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.githubUrl && (
            <a
              href={founder.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`link-founder-github-${founder.id}`}
            >
              <SiGithub className="w-3.5 h-3.5" />
            </a>
          )}
          {founder.personalUrl && (
            <a
              href={founder.personalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`link-founder-website-${founder.id}`}
            >
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
    <div className="flex items-start gap-3 py-3 border-b border-border last:border-0" data-testid={`note-${note.id}`}>
      <StickyNote className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {note.createdAt ? format(new Date(note.createdAt), "MMM d, yyyy 'at' h:mm a") : ""}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        onClick={onDelete}
        className="flex-shrink-0 opacity-50"
        data-testid={`button-delete-note-${note.id}`}
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

interface NextStep {
  icon: any;
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
}

function detectSourceType(sourceUrl: string | null | undefined): string {
  if (!sourceUrl) return "unknown";
  const url = sourceUrl.toLowerCase();
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("github.com")) return "github";
  if (url.includes("techcrunch.com") || url.includes("crunchbase.com") || url.includes("pitchbook.com")) return "press";
  if (url.includes("producthunt.com")) return "product_hunt";
  if (url.includes("ycombinator.com") || url.includes("hacker-news")) return "yc";
  if (url.includes("medium.com") || url.includes("substack.com") || url.includes("blog")) return "blog";
  return "website";
}

function getDataCompleteness(company: Company, founders: Founder[]) {
  const fields = [
    company.description,
    company.sector,
    company.businessModel,
    company.stage,
    company.fundingHistory,
    company.competitiveLandscape,
    company.websiteUrl,
  ];
  const filled = fields.filter((f) => f && f.trim()).length;
  const hasFounders = founders.length > 0;
  const hasFounderContact = founders.some((f) => f.linkedinUrl || f.twitterUrl || f.personalUrl);
  return { filled, total: fields.length, hasFounders, hasFounderContact };
}

function generateNextSteps(
  company: Company,
  founders: Founder[],
  notes: Note[],
): NextStep[] {
  const stage = company.pipelineStage as PipelineStage;
  const sourceType = detectSourceType(company.sourceUrl);
  const completeness = getDataCompleteness(company, founders);
  const steps: NextStep[] = [];

  if (stage === "discovered") {
    if (completeness.filled < completeness.total - 1) {
      steps.push({
        icon: Search,
        title: "Complete company profile",
        detail: `Only ${completeness.filled}/${completeness.total} key fields filled. Run enrichment or manually add missing info like ${!company.sector ? "sector" : !company.fundingHistory ? "funding history" : !company.competitiveLandscape ? "competitive landscape" : "details"}.`,
        priority: "high",
      });
    }

    if (!completeness.hasFounders) {
      steps.push({
        icon: UserPlus,
        title: "Identify founding team",
        detail: "No founders on record. Research the team — founder quality is often the top signal at this stage.",
        priority: "high",
      });
    }

    if (sourceType === "twitter" || sourceType === "blog") {
      steps.push({
        icon: Globe,
        title: "Find the company website",
        detail: `Deal was sourced from ${sourceType === "twitter" ? "a Twitter/X profile" : "a blog post"}. Locate the official website and product to assess what they've built.`,
        priority: "high",
      });
    }

    if (sourceType === "product_hunt") {
      steps.push({
        icon: BarChart3,
        title: "Check Product Hunt traction",
        detail: "Review upvotes, comments, and launch metrics. Look for signs of organic demand and community feedback.",
        priority: "medium",
      });
    }

    steps.push({
      icon: ArrowRight,
      title: "Move to Researching",
      detail: "Once you have enough context on the company and team, advance this deal to start deep-dive research.",
      priority: completeness.filled >= completeness.total - 2 ? "high" : "low",
    });
  }

  if (stage === "researching") {
    if (!company.competitiveLandscape || !company.competitiveLandscape.trim()) {
      steps.push({
        icon: Target,
        title: "Map the competitive landscape",
        detail: "Identify direct competitors, market positioning, and key differentiators. This is critical for the investment thesis.",
        priority: "high",
      });
    }

    if (!company.fundingHistory || !company.fundingHistory.trim()) {
      steps.push({
        icon: DollarSign,
        title: "Research funding history",
        detail: "Check Crunchbase, PitchBook, or press releases for prior rounds, investors, and valuations.",
        priority: "high",
      });
    }

    if (completeness.hasFounders && !completeness.hasFounderContact) {
      steps.push({
        icon: UserPlus,
        title: "Find founder contact info",
        detail: "You have founder names but no contact details. Find their LinkedIn, Twitter, or email for outreach.",
        priority: "medium",
      });
    }

    if (sourceType === "github") {
      steps.push({
        icon: BarChart3,
        title: "Analyze GitHub activity",
        detail: "Review commit frequency, contributor count, stars/forks, and open issues. Look for engineering velocity signals.",
        priority: "medium",
      });
    }

    steps.push({
      icon: FileText,
      title: "Draft initial investment thesis",
      detail: "Summarize why this deal is interesting: market size, team strength, timing, and unique insight. Add as a note.",
      priority: notes.length === 0 ? "high" : "medium",
    });

    steps.push({
      icon: ArrowRight,
      title: "Begin outreach",
      detail: "When research is solid, move to Reaching Out to initiate contact with the founding team.",
      priority: "medium",
    });
  }

  if (stage === "reaching_out") {
    const hasContactInfo = founders.some(
      (f) => f.linkedinUrl || f.twitterUrl || f.personalUrl
    );

    if (!hasContactInfo && founders.length > 0) {
      steps.push({
        icon: Search,
        title: "Find contact channels",
        detail: `You have ${founders.length} founder(s) on record but no contact info. Check LinkedIn, Twitter, or company website for emails.`,
        priority: "high",
      });
    }

    if (sourceType === "twitter") {
      steps.push({
        icon: Twitter,
        title: "Engage on Twitter first",
        detail: "Deal originated from Twitter. Consider engaging with their content before cold outreach — warm intros convert better.",
        priority: "high",
      });
    }

    if (sourceType === "linkedin") {
      steps.push({
        icon: Linkedin,
        title: "Send LinkedIn connection request",
        detail: "Deal sourced from LinkedIn. Send a personalized connection request referencing their work or a mutual connection.",
        priority: "high",
      });
    }

    steps.push({
      icon: Phone,
      title: "Schedule intro call",
      detail: "Aim for a 30-minute introductory call. Prepare 3-5 key questions about vision, traction, and current round details.",
      priority: "high",
    });

    if (notes.length === 0) {
      steps.push({
        icon: StickyNote,
        title: "Log outreach attempts",
        detail: "Track when and how you reached out. Note response times and communication style — these are founder signals.",
        priority: "medium",
      });
    }

    steps.push({
      icon: ArrowRight,
      title: "Advance to diligence",
      detail: "After initial meetings and positive signals, move to In Diligence for formal evaluation.",
      priority: "low",
    });
  }

  if (stage === "in_diligence") {
    steps.push({
      icon: FileText,
      title: "Request pitch deck & financials",
      detail: "Ask for the latest pitch deck, financial model, cap table, and any data room access.",
      priority: "high",
    });

    steps.push({
      icon: Users,
      title: "Conduct reference checks",
      detail: `Check references on ${founders.length > 0 ? founders.map((f) => f.name).join(", ") : "the founders"}. Talk to former colleagues, customers, and other investors.`,
      priority: "high",
    });

    steps.push({
      icon: BarChart3,
      title: "Validate key metrics",
      detail: "Verify claimed traction: revenue, growth rate, retention, unit economics. Cross-reference with independent sources.",
      priority: "high",
    });

    if (company.sector?.toLowerCase().includes("saas") || company.businessModel?.toLowerCase().includes("saas")) {
      steps.push({
        icon: DollarSign,
        title: "Review SaaS metrics",
        detail: "Focus on ARR, MRR growth, churn, LTV/CAC ratio, NDR, and payback period. Benchmark against stage-appropriate comps.",
        priority: "high",
      });
    }

    steps.push({
      icon: FileText,
      title: "Prepare investment memo",
      detail: "Draft the formal IC memo covering thesis, risks, terms, and recommendation. Include all diligence findings.",
      priority: "medium",
    });

    steps.push({
      icon: ArrowRight,
      title: "Make investment decision",
      detail: "Present to IC and decide: invest (move to Invested) or pass (move to Passed) with documented reasoning.",
      priority: "low",
    });
  }

  if (stage === "passed") {
    steps.push({
      icon: StickyNote,
      title: "Document pass reasoning",
      detail: "Record why you passed — timing, valuation, market, team concerns. This builds institutional memory for future deals.",
      priority: notes.length === 0 ? "high" : "low",
    });

    steps.push({
      icon: Users,
      title: "Maintain the relationship",
      detail: `Keep ${founders.length > 0 ? founders[0].name : "the founder"} in your network. Many great investments come from passed deals that improve over time.`,
      priority: "medium",
    });

    steps.push({
      icon: Clock,
      title: "Set a revisit reminder",
      detail: "Consider revisiting in 6-12 months. Add a note with what would need to change for you to reconsider.",
      priority: "medium",
    });
  }

  if (stage === "invested") {
    steps.push({
      icon: Users,
      title: "Schedule board/advisory cadence",
      detail: "Set up regular check-ins — monthly updates, quarterly reviews, and board prep if applicable.",
      priority: "high",
    });

    steps.push({
      icon: UserPlus,
      title: "Make portfolio introductions",
      detail: `Connect ${company.name} with relevant portfolio companies, potential customers, and future investors.`,
      priority: "high",
    });

    steps.push({
      icon: BarChart3,
      title: "Track key milestones",
      detail: "Monitor progress against the metrics and milestones discussed during diligence. Log updates as notes.",
      priority: "medium",
    });

    steps.push({
      icon: DollarSign,
      title: "Plan follow-on strategy",
      detail: "Define pro-rata and follow-on investment criteria. Know your reserves and triggers for the next round.",
      priority: "medium",
    });
  }

  return steps;
}

const PRIORITY_STYLES = {
  high: "border-l-amber-500 bg-amber-500/5",
  medium: "border-l-blue-500/50 bg-blue-500/5",
  low: "border-l-muted-foreground/30 bg-muted/30",
};

function NextStepsAdvisor({
  company,
  founders,
  notes,
}: {
  company: Company;
  founders: Founder[];
  notes: Note[];
}) {
  const steps = generateNextSteps(company, founders, notes);
  const highPriority = steps.filter((s) => s.priority === "high");
  const [showAll, setShowAll] = useState(false);

  const displaySteps = showAll ? steps : highPriority.length > 0 ? highPriority.slice(0, 3) : steps.slice(0, 2);
  const hiddenCount = steps.length - displaySteps.length;

  return (
    <Card className="p-4" data-testid="card-next-steps">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" />
        Recommended Next Steps
      </h3>
      <div className="space-y-2">
        {displaySteps.map((step, i) => (
          <div
            key={i}
            className={`border-l-2 rounded-r-md p-2.5 ${PRIORITY_STYLES[step.priority]}`}
            data-testid={`next-step-${i}`}
          >
            <div className="flex items-start gap-2">
              <step.icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-foreground" />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight">{step.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{step.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1"
          data-testid="button-show-more-steps"
        >
          <ChevronRight className="w-3 h-3" />
          {hiddenCount} more suggestion{hiddenCount > 1 ? "s" : ""}
        </button>
      )}
      {showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(false)}
          className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1"
          data-testid="button-show-less-steps"
        >
          Show less
        </button>
      )}
    </Card>
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
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {tags.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="cursor-pointer"
            onClick={() => removeTag(tag)}
            data-testid={`badge-tag-${tag}`}
          >
            {tag}
            <span className="ml-1 text-muted-foreground">&times;</span>
          </Badge>
        ))}
        {tags.length === 0 && (
          <p className="text-xs text-muted-foreground">No tags added yet</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          placeholder="Add tag..."
          className="h-8 text-sm"
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          data-testid="input-new-tag"
        />
        <Button size="sm" variant="secondary" onClick={addTag} data-testid="button-add-tag">
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

  if (companyLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Skeleton className="h-6 w-24 mb-6" />
        <div className="flex gap-6">
          <div className="flex-1 space-y-4">
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
          <div className="w-72 space-y-4">
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center">
          <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
          <h3 className="text-sm font-medium mb-1">Company not found</h3>
          <Button variant="secondary" onClick={() => navigate("/")} className="mt-3">
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

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
              {company.imageUrl ? (
                <img src={company.imageUrl} alt={company.name} className="w-14 h-14 rounded-lg object-cover" />
              ) : (
                <Building2 className="w-7 h-7 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-company-name">{company.name}</h1>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-company-oneliner">{company.oneLiner}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {company.sector && <Badge variant="secondary">{company.sector}</Badge>}
                {company.stage && <Badge variant="outline">{company.stage}</Badge>}
                {company.businessModel && <Badge variant="outline">{company.businessModel}</Badge>}
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
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/50 text-sm text-foreground hover:bg-accent transition-colors"
                    data-testid="link-company-website"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Website
                  </a>
                )}
                {company.githubUrl && (
                  <a
                    href={company.githubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/50 text-sm text-foreground hover:bg-accent transition-colors"
                    data-testid="link-company-github"
                  >
                    <SiGithub className="w-3.5 h-3.5" />
                    GitHub
                  </a>
                )}
                {company.twitterUrl && (
                  <a
                    href={company.twitterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/50 text-sm text-foreground hover:bg-accent transition-colors"
                    data-testid="link-company-twitter"
                  >
                    <Twitter className="w-3.5 h-3.5" />
                    Twitter / X
                  </a>
                )}
                {company.linkedinUrl && (
                  <a
                    href={company.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/50 text-sm text-foreground hover:bg-accent transition-colors"
                    data-testid="link-company-linkedin"
                  >
                    <Linkedin className="w-3.5 h-3.5" />
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1 mb-6">
            <InfoRow icon={DollarSign} label="Funding History" value={company.fundingHistory} testId="text-funding" />
            <InfoRow icon={Target} label="Competitive Landscape" value={company.competitiveLandscape} testId="text-competitive" />
            <InfoRow icon={Link2} label="Source" value={company.sourceUrl} testId="text-source" />
            <InfoRow
              icon={Clock}
              label="Captured"
              value={company.createdAt ? format(new Date(company.createdAt), "MMMM d, yyyy") : undefined}
              testId="text-captured"
            />
          </div>

          {founders.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
                Founders & Team
              </h3>
              <div className="space-y-2">
                {founders.map((founder) => (
                  <FounderCard key={founder.id} founder={founder} />
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
                className="min-h-[80px] text-sm resize-none"
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
              <p className="text-xs text-muted-foreground text-center py-4">No notes yet</p>
            )}
          </div>
        </div>

        <div className="lg:w-72 flex-shrink-0 space-y-4">
          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Pipeline Stage</h3>
            <Select
              value={company.pipelineStage}
              onValueChange={(v) => updateStageMutation.mutate(v as PipelineStage)}
            >
              <SelectTrigger data-testid="select-pipeline-stage">
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
          </Card>

          <NextStepsAdvisor company={company} founders={founders} notes={notes} />

          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Tags</h3>
            <TagManager tags={company.tags || []} companyId={company.id} />
          </Card>

          {(company.websiteUrl || company.sourceUrl) && (
            <Card className="p-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {company.websiteUrl && (
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button variant="secondary" className="w-full justify-start" data-testid="button-visit-website">
                      <Globe className="w-4 h-4 mr-2" />
                      Visit Website
                    </Button>
                  </a>
                )}
                {company.sourceUrl && company.sourceUrl !== company.websiteUrl && (
                  <a
                    href={company.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <Button variant="secondary" className="w-full justify-start" data-testid="button-visit-source">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Visit Source
                    </Button>
                  </a>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
