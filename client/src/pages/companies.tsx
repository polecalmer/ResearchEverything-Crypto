import { useQuery } from "@tanstack/react-query";
import { type Company, STAGE_LABELS, type PipelineStage } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  Search,
  Building2,
  ExternalLink,
  Plus,
  Filter,
  Coins,
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

const STAGE_DOT_COLORS: Record<PipelineStage, string> = {
  discovered: "bg-blue-500",
  researching: "bg-amber-500",
  reaching_out: "bg-purple-500",
  in_diligence: "bg-emerald-500",
  passed: "bg-muted-foreground",
  invested: "bg-green-500",
};

export default function Companies() {
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
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
      </div>

      {filtered.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto mb-3 opacity-20" />
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
      ) : (
        <div className="flex-1 overflow-y-auto rounded-lg border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Company</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3 hidden md:table-cell">Sector</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3 hidden sm:table-cell">Stage</th>
                <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Pipeline</th>
                <th className="text-right text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3 hidden lg:table-cell">Added</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => {
                const daysAgo = company.createdAt
                  ? formatDistanceToNow(new Date(company.createdAt), { addSuffix: true })
                  : "";
                return (
                  <tr
                    key={company.id}
                    className="border-b border-border/50 last:border-b-0 hover:bg-accent/30 transition-colors cursor-pointer focus-visible:bg-accent/30 outline-none"
                    onClick={() => navigate(`/companies/${company.id}`)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/companies/${company.id}`); } }}
                    tabIndex={0}
                    role="link"
                    data-testid={`row-company-${company.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                          {company.imageUrl ? (
                            <img src={company.imageUrl} alt={company.name} className="w-7 h-7 rounded-md object-cover" />
                          ) : (
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate" data-testid={`text-company-name-${company.id}`}>{company.name}</span>
                            {company.hasLiquidToken && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 border border-teal-400/30 text-teal-400 flex-shrink-0" data-testid={`badge-liquid-token-${company.id}`}>
                                <Coins className="w-2.5 h-2.5" />
                                {company.tokenTicker || "TOKEN"}
                              </span>
                            )}
                            {company.sourceUrl && (
                              <a
                                href={company.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground/30 hover:text-muted-foreground transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate max-w-[300px]">{company.oneLiner}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {company.sector || "—"}{company.subSector ? ` · ${company.subSector}` : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground">{company.stage || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${STAGE_DOT_COLORS[company.pipelineStage as PipelineStage]}`} />
                        <span className="text-xs text-muted-foreground">
                          {STAGE_LABELS[company.pipelineStage as PipelineStage]}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground/60">{daysAgo}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-end px-4 py-2.5 border-t border-border/50">
            <span className="text-xs text-muted-foreground font-mono">
              {filtered.length} compan{filtered.length !== 1 ? "ies" : "y"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
