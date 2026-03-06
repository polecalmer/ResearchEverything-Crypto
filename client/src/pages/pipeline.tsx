import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Company, PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";
import {
  Search,
  Sparkles,
  Building2,
  Clock,
  ExternalLink,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";

const STAGE_DOT_COLORS: Record<PipelineStage, string> = {
  discovered: "bg-blue-500",
  researching: "bg-amber-500",
  reaching_out: "bg-purple-500",
  in_diligence: "bg-emerald-500",
  passed: "bg-muted-foreground",
  invested: "bg-green-500",
};

function CompanyRow({ company }: { company: Company }) {
  const [, navigate] = useLocation();
  const daysAgo = company.createdAt
    ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
    : "";

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors group"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`card-company-${company.id}`}
    >
      <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
        {company.imageUrl ? (
          <img src={company.imageUrl} alt={company.name} className="w-8 h-8 rounded-md object-cover" />
        ) : (
          <Building2 className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <h4 className="font-medium text-sm truncate" data-testid={`text-company-name-${company.id}`}>{company.name}</h4>
          <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-1.5" data-testid={`text-company-oneliner-${company.id}`}>
          {company.oneLiner}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {company.sector && (
            <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">
              {company.sector}{company.subSector ? ` · ${company.subSector}` : ""}
            </span>
          )}
          {company.stage && (
            <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">
              {company.stage}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5 ml-auto">
            <Clock className="w-2.5 h-2.5" />
            {daysAgo}
          </span>
        </div>
      </div>
    </div>
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
    e.currentTarget.classList.add("bg-accent/30");
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.currentTarget.classList.remove("bg-accent/30");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("bg-accent/30");
    const companyId = e.dataTransfer.getData("companyId");
    if (companyId) {
      onDrop(companyId, stage);
    }
  };

  return (
    <div
      className="flex flex-col min-w-[260px] max-w-[300px] flex-1 rounded-lg transition-colors"
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
        <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">
          {companies.length}
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 pb-4">
          {companies.map((company) => (
            <div
              key={company.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("companyId", company.id);
              }}
              className="cursor-grab active:cursor-grabbing"
            >
              <CompanyRow company={company} />
            </div>
          ))}
          {companies.length === 0 && (
            <div className="rounded-lg border border-dashed border-border/50 p-8 text-center">
              <p className="text-xs text-muted-foreground/60">Drop deals here</p>
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
          <Skeleton className="h-7 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-4 overflow-x-auto h-full pb-4">
          {PIPELINE_STAGES.slice(0, 5).map((stage) => (
            <div key={stage} className="min-w-[260px] flex-1">
              <Skeleton className="h-5 w-32 mb-3" />
              <div className="space-y-2">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-20 w-full rounded-lg" />
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
          <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-7 h-7 text-foreground" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight mb-2" data-testid="text-page-title">Your Deal Pipeline</h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Start by adding your first deal. Use the button below or the <strong>Add Deal</strong> page in the sidebar.
          </p>
          <Button onClick={() => navigate("/add")} data-testid="button-add-first-deal">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Your First Deal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Pipeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {companies.length} {companies.length === 1 ? "deal" : "deals"}
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring w-52"
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
