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
} from "lucide-react";
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
              className="text-muted-foreground"
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
              className="text-muted-foreground"
              data-testid={`link-founder-twitter-${founder.id}`}
            >
              <Twitter className="w-3.5 h-3.5" />
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

          <div className="space-y-1 mb-6">
            <InfoRow icon={DollarSign} label="Funding History" value={company.fundingHistory} testId="text-funding" />
            <InfoRow icon={Target} label="Competitive Landscape" value={company.competitiveLandscape} testId="text-competitive" />
            <InfoRow icon={Globe} label="Source" value={company.sourceUrl} testId="text-source" />
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

          <Card className="p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Tags</h3>
            <TagManager tags={company.tags || []} companyId={company.id} />
          </Card>

          {company.sourceUrl && (
            <Card className="p-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Quick Actions</h3>
              <div className="space-y-2">
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
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
