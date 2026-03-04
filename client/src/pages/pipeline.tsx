import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";
import {
  Search,
  Sparkles,
  Building2,
  ArrowRight,
  Clock,
  ExternalLink,
  GripVertical,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

const STAGE_COLORS: Record<PipelineStage, string> = {
  discovered: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  researching: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  reaching_out: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  in_diligence: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  passed: "bg-muted text-muted-foreground",
  invested: "bg-green-500/10 text-green-600 dark:text-green-400",
};

const STAGE_DOT_COLORS: Record<PipelineStage, string> = {
  discovered: "bg-blue-500",
  researching: "bg-amber-500",
  reaching_out: "bg-purple-500",
  in_diligence: "bg-emerald-500",
  passed: "bg-muted-foreground",
  invested: "bg-green-500",
};

function CompanyCard({ company }: { company: Company }) {
  const [, navigate] = useLocation();
  const daysAgo = company.createdAt
    ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
    : "";

  return (
    <Card
      className="p-3 cursor-pointer hover-elevate transition-all duration-150 group"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`card-company-${company.id}`}
    >
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
            {company.imageUrl ? (
              <img src={company.imageUrl} alt={company.name} className="w-8 h-8 rounded-md object-cover" />
            ) : (
              <Building2 className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <h4 className="font-medium text-sm truncate" data-testid={`text-company-name-${company.id}`}>{company.name}</h4>
        </div>
        <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2" data-testid={`text-company-oneliner-${company.id}`}>
        {company.oneLiner}
      </p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {company.sector && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {company.sector}
            </Badge>
          )}
          {company.stage && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {company.stage}
            </Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          {daysAgo}
        </span>
      </div>
      {company.tags && company.tags.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {company.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/5">
              {tag}
            </Badge>
          ))}
          {company.tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{company.tags.length - 2}</span>
          )}
        </div>
      )}
    </Card>
  );
}

function PipelineColumn({
  stage,
  companies,
  onDrop,
}: {
  stage: PipelineStage;
  companies: Company[];
  onDrop: (companyId: string, newStage: PipelineStage) => void;
}) {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add("ring-2", "ring-primary/30");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("ring-2", "ring-primary/30");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("ring-2", "ring-primary/30");
    const companyId = e.dataTransfer.getData("companyId");
    if (companyId) {
      onDrop(companyId, stage);
    }
  };

  return (
    <div
      className="flex flex-col min-w-[260px] max-w-[300px] flex-1 rounded-lg transition-all"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid={`column-${stage}`}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className={`w-2 h-2 rounded-full ${STAGE_DOT_COLORS[stage]}`} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {STAGE_LABELS[stage]}
        </h3>
        <span className="text-xs text-muted-foreground ml-auto bg-accent rounded-full w-5 h-5 flex items-center justify-center font-medium">
          {companies.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 pr-2 pb-4">
          {companies.map((company) => (
            <div
              key={company.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("companyId", company.id);
              }}
              className="cursor-grab active:cursor-grabbing"
            >
              <CompanyCard company={company} />
            </div>
          ))}
          {companies.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-xs text-muted-foreground">No deals yet</p>
              <p className="text-[10px] text-muted-foreground mt-1">Drag a deal here</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function Pipeline() {
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: PipelineStage }) => {
      await apiRequest("PATCH", `/api/companies/${id}`, { pipelineStage: stage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
    },
  });

  const handleDrop = (companyId: string, newStage: PipelineStage) => {
    updateStageMutation.mutate({ id: companyId, stage: newStage });
  };

  const filteredCompanies = companies.filter((c) =>
    searchQuery
      ? c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.oneLiner.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.sector?.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  const companiesByStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = filteredCompanies.filter((c) => c.pipelineStage === stage);
      return acc;
    },
    {} as Record<PipelineStage, Company[]>
  );

  if (isLoading) {
    return (
      <div className="p-6 h-full">
        <div className="mb-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-4 overflow-x-auto h-full pb-4">
          {PIPELINE_STAGES.slice(0, 5).map((stage) => (
            <div key={stage} className="min-w-[260px] flex-1">
              <Skeleton className="h-6 w-32 mb-3" />
              <div className="space-y-2">
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="p-6 h-full flex flex-col items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight mb-2" data-testid="text-page-title">Your Deal Pipeline</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Start capturing deals by clicking the <strong>+</strong> button in the bottom-right corner, or use the <strong>Add Deal</strong> page for a full form. Deals you add will appear in your kanban pipeline here.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Button onClick={() => navigate("/add")} data-testid="button-add-first-deal">
              <Plus className="w-4 h-4 mr-1.5" />
              Add Your First Deal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">Deal Pipeline</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {companies.length} {companies.length === 1 ? "deal" : "deals"} in your pipeline
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search deals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-9 pr-4 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-64"
            data-testid="input-search-pipeline"
          />
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto flex-1 pb-4">
        {PIPELINE_STAGES.map((stage) => (
          <PipelineColumn
            key={stage}
            stage={stage}
            companies={companiesByStage[stage]}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </div>
  );
}
