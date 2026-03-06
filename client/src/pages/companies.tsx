import { useQuery } from "@tanstack/react-query";
import { type Company, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Search,
  Building2,
  Clock,
  ExternalLink,
  Plus,
  Filter,
  LayoutGrid,
  List,
} from "lucide-react";
import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function CompanyRow({ company }: { company: Company }) {
  const [, navigate] = useLocation();
  const daysAgo = company.createdAt
    ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
    : "";

  return (
    <div
      className="flex items-center gap-4 px-3 py-3 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors group"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`row-company-${company.id}`}
    >
      <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
        {company.imageUrl ? (
          <img src={company.imageUrl} alt={company.name} className="w-9 h-9 rounded-md object-cover" />
        ) : (
          <Building2 className="w-4.5 h-4.5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm truncate" data-testid={`text-company-name-${company.id}`}>{company.name}</h4>
          {company.sourceUrl && (
            <a
              href={company.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{company.oneLiner}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
        {company.sector && (
          <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.sector}</span>
        )}
        {company.stage && (
          <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.stage}</span>
        )}
        <span className="text-[10px] text-muted-foreground/50 bg-accent rounded px-1.5 py-0.5">
          {STAGE_LABELS[company.pipelineStage as PipelineStage]}
        </span>
        <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5 ml-1">
          <Clock className="w-2.5 h-2.5" />
          {daysAgo}
        </span>
      </div>
    </div>
  );
}

function CompanyGridItem({ company }: { company: Company }) {
  const [, navigate] = useLocation();
  const daysAgo = company.createdAt
    ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
    : "";

  return (
    <div
      className="p-4 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors group"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`card-company-grid-${company.id}`}
    >
      <div className="flex items-start gap-3 mb-2.5">
        <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
          {company.imageUrl ? (
            <img src={company.imageUrl} alt={company.name} className="w-9 h-9 rounded-md object-cover" />
          ) : (
            <Building2 className="w-4.5 h-4.5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <h4 className="font-medium text-sm truncate">{company.name}</h4>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{STAGE_LABELS[company.pipelineStage as PipelineStage]}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-2.5">{company.oneLiner}</p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {company.sector && (
            <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.sector}</span>
          )}
          {company.stage && (
            <span className="text-[10px] text-muted-foreground bg-accent rounded px-1.5 py-0.5">{company.stage}</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground/40">{daysAgo}</span>
      </div>
    </div>
  );
}

export default function Companies() {
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [, navigate] = useLocation();

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const sectors = [...new Set(companies.map((c) => c.sector).filter(Boolean))];

  const filtered = companies.filter((c) => {
    const matchesSearch = searchQuery
      ? c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.oneLiner.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesStage = stageFilter === "all" || c.pipelineStage === stageFilter;
    const matchesSector = sectorFilter === "all" || c.sector === sectorFilter;
    return matchesSearch && matchesStage && matchesSector;
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-7 w-48 mb-6" />
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold tracking-tight" data-testid="text-page-title">Companies</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} of {companies.length}
          </p>
        </div>
        <Button size="sm" onClick={() => navigate("/add")} data-testid="button-add-deal">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Deal
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 w-full pl-8 pr-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            data-testid="input-search-companies"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-stage-filter">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="discovered">Discovered</SelectItem>
            <SelectItem value="researching">Researching</SelectItem>
            <SelectItem value="reaching_out">Reaching Out</SelectItem>
            <SelectItem value="in_diligence">In Diligence</SelectItem>
            <SelectItem value="passed">Passed</SelectItem>
            <SelectItem value="invested">Invested</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sectorFilter} onValueChange={setSectorFilter}>
          <SelectTrigger className="w-36 h-8 text-xs" data-testid="select-sector-filter">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s!} value={s!}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-0.5 ml-auto">
          <Button
            size="icon"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            className="h-8 w-8"
            onClick={() => setViewMode("list")}
            data-testid="button-view-list"
          >
            <List className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            className="h-8 w-8"
            onClick={() => setViewMode("grid")}
            data-testid="button-view-grid"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-30" />
            <h3 className="text-sm font-medium mb-1">No companies found</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery ? "Try adjusting your search" : "Add your first deal to get started"}
            </p>
            {!searchQuery && (
              <Button onClick={() => navigate("/add")} variant="secondary" size="sm" data-testid="button-add-first-deal">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Deal
              </Button>
            )}
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="flex-1 overflow-y-auto -mx-3">
          {filtered.map((company) => (
            <CompanyRow key={company.id} company={company} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-1 flex-1 overflow-y-auto -mx-3">
          {filtered.map((company) => (
            <CompanyGridItem key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}
