import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, BookOpen, Layers, Calendar, Search, ExternalLink, ChevronDown, ChevronRight, Tag, Users } from "lucide-react";

import type { AnalystName } from "@shared/schema";

interface AnalystOverview {
  analyst: AnalystName;
  displayName: string;
  documents: number;
  chunks: number;
  frameworks: number;
  dateRange: { earliest: string | null; latest: string | null };
  topSources: Array<{ source: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
}

interface FrameworkItem {
  frameworkSlug: string;
  name: string;
  description: string;
  category: string | null;
  versionCount: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  versions: Array<{
    version: number;
    date: string;
    description: string;
    scope?: string;
    source_article?: string;
    confidence?: number;
  }>;
}

interface DocumentItem {
  id: string;
  source: string;
  url: string | null;
  date: string | null;
  title: string | null;
  type: string | null;
  tags: string[];
  preview: string;
}

const ANALYST_BLURB: Record<AnalystName, string> = {
  TopherGMI: "Arca CIO. Macro, market structure, tokenomics and capital rotation.",
  shaundadevens: "Blockworks columnist. Fees, governance, market microstructure.",
  thiccyth0t: "Scimitar Capital. Derivatives, market-making, on-chain quant.",
  CryptoHayes: "BitMEX co-founder. Macro, geopolitics, monetary policy and crypto cycles.",
  AustinBarack: "Crypto investor. Early-stage picks, market catalysts, ecosystem analysis.",
  defi_monk: "DeFi native. Protocol mechanics, yield strategies, on-chain analytics.",
  RyanWatkins_: "Messari alum. Sector mapping, protocol valuation, market structure.",
  robbiepetersen_: "Delphi Digital. Cross-chain research, emerging protocols.",
};

function StatBlock({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="border border-border rounded p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold" data-testid={`stat-${label.replace(/\s+/g, "-").toLowerCase()}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function FrameworkCard({ fw }: { fw: FrameworkItem }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="hover-elevate" data-testid={`card-framework-${fw.frameworkSlug}`}>
      <CardContent className="p-3">
        <button
          className="w-full text-left"
          onClick={() => setOpen((o) => !o)}
          data-testid={`button-framework-toggle-${fw.frameworkSlug}`}
        >
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              {open ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
              <span className="text-sm font-medium truncate">{fw.name}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {fw.category && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0">{fw.category}</Badge>
              )}
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                v{fw.versionCount}
              </Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed ml-4.5">{fw.description}</p>
          {(fw.firstSeenDate || fw.lastSeenDate) && (
            <div className="text-[10px] text-muted-foreground mt-1 ml-4.5 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {fw.firstSeenDate ?? "?"}{fw.firstSeenDate !== fw.lastSeenDate ? ` → ${fw.lastSeenDate ?? "?"}` : ""}
            </div>
          )}
        </button>

        {open && fw.versions.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border space-y-2" data-testid={`versions-${fw.frameworkSlug}`}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Evolution</div>
            {fw.versions.map((v, i) => (
              <div key={i} className="text-xs border-l-2 border-border pl-3 pb-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-[10px] text-muted-foreground">{v.date}</span>
                  {v.scope && <Badge variant="outline" className="text-[9px] px-1 py-0">{v.scope}</Badge>}
                </div>
                <p className="text-muted-foreground leading-relaxed">{v.description}</p>
                {v.source_article && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 italic truncate">from: {v.source_article}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DocumentRow({ doc }: { doc: DocumentItem }) {
  return (
    <div className="border border-border rounded p-3 hover-elevate" data-testid={`doc-${doc.id}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-xs font-medium truncate">{doc.title || doc.source}</span>
            {doc.type && <Badge variant="outline" className="text-[9px] px-1 py-0">{doc.type}</Badge>}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{doc.source}</span>
            {doc.date && <><span>·</span><span>{doc.date}</span></>}
          </div>
        </div>
        {doc.url && (
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            data-testid={`link-doc-${doc.id}`}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
      {doc.preview && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3 mt-1">{doc.preview}…</p>
      )}
      {doc.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {doc.tags.slice(0, 6).map((t, i) => (
            <Badge key={i} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalystBrainView({ overview }: { overview: AnalystOverview }) {
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const frameworksQ = useQuery<{ items: FrameworkItem[] }>({
    queryKey: ["/api/analyst", overview.analyst, "frameworks"],
  });

  const docsQ = useQuery<{ items: DocumentItem[]; total: number }>({
    queryKey: ["/api/analyst", overview.analyst, "documents", committedQuery, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: committedQuery,
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      const res = await apiRequest("GET", `/api/analyst/${encodeURIComponent(overview.analyst)}/documents?${params.toString()}`);
      return res.json();
    },
  });

  const dateSpan = useMemo(() => {
    const { earliest, latest } = overview.dateRange;
    if (!earliest && !latest) return "—";
    if (earliest === latest) return earliest ?? "—";
    return `${earliest ?? "?"} → ${latest ?? "?"}`;
  }, [overview.dateRange]);

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    setCommittedQuery(query.trim());
    setPage(0);
  };

  return (
    <div className="p-4 space-y-5 overflow-y-auto" data-testid={`view-analyst-${overview.analyst}`}>
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold" data-testid={`text-analyst-name-${overview.analyst}`}>{overview.analyst}</h2>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{ANALYST_BLURB[overview.analyst]}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <StatBlock label="Documents" value={overview.documents.toLocaleString()} />
        <StatBlock label="Chunks" value={overview.chunks.toLocaleString()} hint="embedded & searchable" />
        <StatBlock label="Frameworks" value={overview.frameworks.toLocaleString()} hint="named reasoning patterns" />
        <StatBlock label="Span" value={dateSpan} />
      </div>

      {overview.topTags.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground">Top Topics</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {overview.topTags.slice(0, 16).map((t) => (
              <Badge
                key={t.tag}
                variant="secondary"
                className="text-[10px] cursor-pointer"
                onClick={() => { setQuery(t.tag); setCommittedQuery(t.tag); setPage(0); }}
                data-testid={`badge-tag-${t.tag}`}
              >
                {t.tag} <span className="ml-1 opacity-60">{t.count}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Layers className="w-3.5 h-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground">Frameworks ({overview.frameworks})</h3>
        </div>
        {frameworksQ.isLoading ? (
          <div className="py-6 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : (frameworksQ.data?.items ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">No frameworks extracted yet.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {(frameworksQ.data?.items ?? []).map((fw) => (
              <FrameworkCard key={fw.frameworkSlug} fw={fw} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-medium text-muted-foreground">
              Corpus ({docsQ.data?.total ?? overview.documents})
            </h3>
          </div>
          <form onSubmit={onSearch} className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles, body, sources…"
                className="h-7 text-xs pl-6 w-56"
                data-testid={`input-search-${overview.analyst}`}
              />
            </div>
            <Button type="submit" size="sm" variant="outline" className="text-xs h-7" data-testid={`button-search-${overview.analyst}`}>
              Search
            </Button>
            {committedQuery && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-xs h-7"
                onClick={() => { setQuery(""); setCommittedQuery(""); setPage(0); }}
                data-testid={`button-clear-${overview.analyst}`}
              >
                Clear
              </Button>
            )}
          </form>
        </div>

        {docsQ.isLoading ? (
          <div className="py-6 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : (docsQ.data?.items ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">No documents match.</div>
        ) : (
          <>
            <div className="space-y-2">
              {docsQ.data!.items.map((d) => <DocumentRow key={d.id} doc={d} />)}
            </div>
            {(docsQ.data!.total > pageSize) && (
              <div className="flex items-center justify-between mt-3 text-xs">
                <span className="text-muted-foreground">
                  {page * pageSize + 1}–{Math.min((page + 1) * pageSize, docsQ.data!.total)} of {docsQ.data!.total}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="text-xs h-7"
                    data-testid={`button-prev-${overview.analyst}`}
                  >
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(page + 1) * pageSize >= docsQ.data!.total}
                    onClick={() => setPage((p) => p + 1)}
                    className="text-xs h-7"
                    data-testid={`button-next-${overview.analyst}`}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AnalystLensesView() {
  const { data, isLoading, error } = useQuery<{ analysts: AnalystOverview[] }>({
    queryKey: ["/api/analyst/overview"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loader-analysts">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground" data-testid="error-analysts">
        Failed to load analyst lenses
      </div>
    );
  }

  const analysts = data.analysts;
  const first = analysts[0]?.analyst;

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="view-analyst-lenses">
      <Tabs defaultValue={first} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 self-start" data-testid="tabs-analysts">
          {analysts.map((a) => (
            <TabsTrigger key={a.analyst} value={a.analyst} data-testid={`tab-analyst-${a.analyst}`} className="text-xs">
              {a.analyst}
              <span className="ml-1.5 opacity-60 text-[10px]">{a.documents}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {analysts.map((a) => (
          <TabsContent key={a.analyst} value={a.analyst} className="flex-1 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
            <AnalystBrainView overview={a} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
