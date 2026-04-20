import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Database, Zap, BookOpen, Search, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";

type ViewMode = "overview" | "queries" | "facts" | "learnings";

const CONFIDENCE_COLORS: Record<string, string> = {
  verified_doc: "text-emerald-400",
  verified_runtime: "text-cyan-400",
  observed_once: "text-muted-foreground",
  inferred: "text-amber-400",
};

export function DataBrainView() {
  const [view, setView] = useState<ViewMode>("overview");
  const [searchFilter, setSearchFilter] = useState("");

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/data-brain/stats"],
  });

  const { data: provenQueries, isLoading: queriesLoading } = useQuery<any[]>({
    queryKey: ["/api/data-brain/proven-queries"],
    enabled: view === "queries" || view === "overview",
  });

  const { data: facts, isLoading: factsLoading } = useQuery<any[]>({
    queryKey: ["/api/data-brain/facts"],
    enabled: view === "facts" || view === "overview",
  });

  const { data: learnings, isLoading: learningsLoading } = useQuery<any[]>({
    queryKey: ["/api/data-brain/learnings"],
    enabled: view === "learnings" || view === "overview",
  });

  if (statsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center" data-testid="loading-data-brain">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const factStats = stats?.facts;
  const pqStats = stats?.provenQueries;
  const slStats = stats?.systemLearnings;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="panel-data-brain">
      <div className="flex items-center gap-3 flex-wrap">
        {(["overview", "queries", "facts", "learnings"] as ViewMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setView(m)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              view === m
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            data-testid={`button-view-${m}`}
          >
            {m === "overview" && <Database className="w-3 h-3 inline mr-1.5" />}
            {m === "queries" && <Zap className="w-3 h-3 inline mr-1.5" />}
            {m === "facts" && <BookOpen className="w-3 h-3 inline mr-1.5" />}
            {m === "learnings" && <CheckCircle2 className="w-3 h-3 inline mr-1.5" />}
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {view === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Data Facts"
              value={factStats?.total || 0}
              detail={`${Object.keys(factStats?.bySource || {}).length} sources`}
              icon={<BookOpen className="w-4 h-4 text-cyan-400" />}
            />
            <StatCard
              label="Proven Queries"
              value={pqStats?.total || 0}
              detail={`${(pqStats?.byProtocol || []).length} protocols`}
              icon={<Zap className="w-4 h-4 text-amber-400" />}
            />
            <StatCard
              label="System Learnings"
              value={slStats?.total || 0}
              detail={`${(slStats?.byScope || []).length} scopes`}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            />
          </div>

          {factStats && (
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-3 space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Facts by Source</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(factStats.bySource || {}).sort((a: any, b: any) => b[1] - a[1]).map(([source, count]: any) => (
                    <Badge key={source} variant="outline" className="text-xs gap-1" data-testid={`badge-source-${source}`}>
                      {source} <span className="text-muted-foreground">{count}</span>
                    </Badge>
                  ))}
                </div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-1">By Confidence</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(factStats.byConfidence || {}).sort((a: any, b: any) => b[1] - a[1]).map(([conf, count]: any) => (
                    <Badge key={conf} variant="secondary" className={`text-xs gap-1 ${CONFIDENCE_COLORS[conf] || ""}`} data-testid={`badge-confidence-${conf}`}>
                      {conf.replace(/_/g, " ")} <span className="opacity-60">{count}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {pqStats?.byProtocol?.length > 0 && (
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-3 space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proven Queries by Protocol</h4>
                <div className="flex flex-wrap gap-1.5">
                  {pqStats.byProtocol.slice(0, 20).map((p: any) => (
                    <Badge key={p.protocol} variant="outline" className="text-xs gap-1 cursor-pointer hover:bg-accent/50" onClick={() => { setView("queries"); setSearchFilter(p.protocol); }} data-testid={`badge-protocol-${p.protocol}`}>
                      {p.protocol} <span className="text-muted-foreground">{p.cnt}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {view === "queries" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter by protocol..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-8 h-8 text-xs"
              data-testid="input-filter-queries"
            />
          </div>
          {queriesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-1.5">
              {(provenQueries || [])
                .filter((q: any) => !searchFilter || q.protocol?.toLowerCase().includes(searchFilter.toLowerCase()) || q.metric_type?.toLowerCase().includes(searchFilter.toLowerCase()))
                .map((q: any) => (
                  <ProvenQueryRow key={q.id} query={q} />
                ))}
              {(!provenQueries || provenQueries.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-4">No proven queries yet</p>
              )}
            </div>
          )}
        </div>
      )}

      {view === "facts" && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter facts..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-8 h-8 text-xs"
              data-testid="input-filter-facts"
            />
          </div>
          {factsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-1.5">
              {(facts || [])
                .filter((f: any) => !searchFilter || f.content?.toLowerCase().includes(searchFilter.toLowerCase()) || f.source?.toLowerCase().includes(searchFilter.toLowerCase()))
                .map((f: any) => (
                  <FactRow key={f.id} fact={f} />
                ))}
            </div>
          )}
        </div>
      )}

      {view === "learnings" && (
        <div className="space-y-3">
          {learningsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-1.5">
              {(learnings || []).map((l: any) => (
                <LearningRow key={l.id} learning={l} />
              ))}
              {(!learnings || learnings.length === 0) && (
                <p className="text-xs text-muted-foreground text-center py-4">No system learnings yet</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className="text-xl font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s/g, '-')}`}>{value.toLocaleString()}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{detail}</div>
      </CardContent>
    </Card>
  );
}

function ProvenQueryRow({ query }: { query: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-border/40 rounded-md bg-card/30 overflow-hidden" data-testid={`row-proven-query-${query.id}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        <span className="text-xs font-medium truncate flex-1">{query.metric_type}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">{query.protocol}</Badge>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
          {query.success_count > 0 && <><CheckCircle2 className="w-3 h-3 inline text-emerald-400 mr-0.5" />{query.success_count}</>}
          {query.fail_count > 0 && <><AlertTriangle className="w-3 h-3 inline text-amber-400 ml-1.5 mr-0.5" />{query.fail_count}</>}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/30">
          <pre className="text-[11px] font-mono text-muted-foreground bg-background/50 rounded p-2 mt-2 overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto" data-testid="text-sql-query">
            {query.sql_query}
          </pre>
          <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
            {query.chart_type && <span>Chart: {query.chart_type}</span>}
            {query.last_used && <span><Clock className="w-3 h-3 inline mr-0.5" />Last used: {new Date(query.last_used).toLocaleDateString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function FactRow({ fact }: { fact: any }) {
  const [expanded, setExpanded] = useState(false);
  const confClass = CONFIDENCE_COLORS[fact.confidence] || "text-muted-foreground";
  return (
    <div className="border border-border/40 rounded-md bg-card/30 overflow-hidden" data-testid={`row-fact-${fact.id}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        <span className="text-xs truncate flex-1">{fact.content?.slice(0, 100)}</span>
        <Badge variant="outline" className="text-[10px] shrink-0">{fact.source}</Badge>
        <span className={`text-[10px] shrink-0 ${confClass}`}>{fact.confidence?.replace(/_/g, " ")}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 border-t border-border/30 space-y-2">
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{fact.content}</p>
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span>Category: {fact.category}</span>
            <span>Scope: {fact.scope_ref}</span>
            <span>Observed: {fact.observed_count}x</span>
            <span>Source: {fact.source_of_fact}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LearningRow({ learning }: { learning: any }) {
  return (
    <div className="border border-border/40 rounded-md bg-card/30 px-3 py-2" data-testid={`row-learning-${learning.id}`}>
      <div className="flex items-center gap-2 mb-1">
        <Badge variant="outline" className="text-[10px]">{learning.scope}</Badge>
        <Badge variant="secondary" className="text-[10px]">{learning.rule_type}</Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">Applied: {learning.applied_count}x</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{learning.rule_text}</p>
      <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
        <span>Key: {learning.scope_key}</span>
        <span>Confidence: {learning.confidence}%</span>
      </div>
    </div>
  );
}
