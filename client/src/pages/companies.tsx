import { useQuery } from "@tanstack/react-query";
import { type Company, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLocation, Link } from "wouter";
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
      className="flex items-center gap-4 p-3 rounded-lg hover-elevate cursor-pointer border border-transparent hover:border-border transition-all"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`row-company-${company.id}`}
    >
      <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
        {company.imageUrl ? (
          <img src={company.imageUrl} alt={company.name} className="w-10 h-10 rounded-md object-cover" />
        ) : (
          <Building2 className="w-5 h-5 text-muted-foreground" />
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
              className="text-muted-foreground"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{company.oneLiner}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
        {company.sector && (
          <Badge variant="secondary" className="text-[10px]">
            {company.sector}
          </Badge>
        )}
        {company.stage && (
          <Badge variant="outline" className="text-[10px]">
            {company.stage}
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          {STAGE_LABELS[company.pipelineStage as PipelineStage]}
        </Badge>
        <span className="text-[10px] text-muted-foreground flex items-center gap-0.5 ml-2">
          <Clock className="w-2.5 h-2.5" />
          {daysAgo}
        </span>
      </div>
    </div>
  );
}

function CompanyGridCard({ company }: { company: Company }) {
  const [, navigate] = useLocation();
  const daysAgo = company.createdAt
    ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
    : "";

  return (
    <Card
      className="p-4 cursor-pointer hover-elevate transition-all duration-150 group"
      onClick={() => navigate(`/companies/${company.id}`)}
      data-testid={`card-company-grid-${company.id}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
          {company.imageUrl ? (
            <img src={company.imageUrl} alt={company.name} className="w-10 h-10 rounded-md object-cover" />
          ) : (
            <Building2 className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <h4 className="font-medium text-sm truncate">{company.name}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">{STAGE_LABELS[company.pipelineStage as PipelineStage]}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{company.oneLiner}</p>
      <div className="flex items-center justify-between gap-1 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {company.sector && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{company.sector}</Badge>
          )}
          {company.stage && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{company.stage}</Badge>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{daysAgo}</span>
      </div>
    </Card>
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
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">Companies</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} of {companies.length} companies
          </p>
        </div>
        <Button onClick={() => navigate("/add")} data-testid="button-add-deal">
          <Plus className="w-4 h-4 mr-1.5" />
          Add Deal
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-full pl-9 pr-4 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-search-companies"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-40" data-testid="select-stage-filter">
            <Filter className="w-3 h-3 mr-1.5" />
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
          <SelectTrigger className="w-40" data-testid="select-sector-filter">
            <SelectValue placeholder="Sector" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sectors</SelectItem>
            {sectors.map((s) => (
              <SelectItem key={s!} value={s!}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 ml-auto">
          <Button
            size="icon"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            onClick={() => setViewMode("list")}
            data-testid="button-view-list"
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            onClick={() => setViewMode("grid")}
            data-testid="button-view-grid"
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
            <h3 className="text-sm font-medium mb-1">No companies found</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {searchQuery ? "Try adjusting your search" : "Add your first deal to get started"}
            </p>
            {!searchQuery && (
              <Button onClick={() => navigate("/add")} variant="secondary" data-testid="button-add-first-deal">
                <Plus className="w-4 h-4 mr-1.5" />
                Add Deal
              </Button>
            )}
          </div>
        </div>
      ) : viewMode === "list" ? (
        <div className="space-y-1 flex-1 overflow-y-auto">
          {filtered.map((company) => (
            <CompanyRow key={company.id} company={company} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 flex-1 overflow-y-auto">
          {filtered.map((company) => (
            <CompanyGridCard key={company.id} company={company} />
          ))}
        </div>
      )}
    </div>
  );
}
