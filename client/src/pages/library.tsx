import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, BarChart3, Loader2, Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";
import DataStation from "@/pages/data-station";

interface Report {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // Source session + message the memo was saved from. Populated by
  // save-to-report. Older rows may be null; we fall back to /reports/:id.
  sourceConversationId: number | null;
  sourceMessageId: number | null;
}

const TABS = ["charts", "reports"] as const;
type Tab = typeof TABS[number];

// Known protocol + ticker names the memo extractor is likely to surface.
// Match on a word boundary against the title first, then description, so
// "Jupiter: Revenue Streams" gets a "Jupiter" chip even if the description
// mentions other protocols later in the body.
const PROTOCOL_TAG_PATTERNS: Array<[RegExp, string]> = [
  [/\bhyperliquid\b|\bhype\b|\bhip-?3\b/i, "Hyperliquid"],
  [/\bethena\b|\busde\b|\bsusde\b|\bena\b/i, "Ethena"],
  [/\bpump\.?fun\b|\bpumpfun\b/i, "Pump.fun"],
  [/\btradexyz\b/i, "TradeXYZ"],
  [/\bjupiter\b|\bjup\b/i, "Jupiter"],
  [/\bjito\b/i, "Jito"],
  [/\bmorpho\b/i, "Morpho"],
  [/\buniswap\b|\buni\b/i, "Uniswap"],
  [/\baave\b/i, "Aave"],
  [/\blido\b|\bsteth\b/i, "Lido"],
  [/\bmakerdao\b|\bmaker\b|\bdai\b|\bsky\b/i, "MakerDAO"],
  [/\bcurve\b|\bcrv\b/i, "Curve"],
  [/\beigenlayer\b|\beigen\b/i, "EigenLayer"],
  [/\bpendle\b/i, "Pendle"],
  [/\bgmx\b/i, "GMX"],
  [/\bdydx\b/i, "dYdX"],
  [/\bsynthetix\b|\bsnx\b/i, "Synthetix"],
];

function detectProtocolTag(...fields: Array<string | null | undefined>): string | null {
  for (const field of fields) {
    if (!field) continue;
    for (const [re, label] of PROTOCOL_TAG_PATTERNS) {
      if (re.test(field)) return label;
    }
  }
  return null;
}

function getTabFromQuery(search: string): Tab {
  const params = new URLSearchParams(search);
  const t = (params.get("tab") || "").toLowerCase();
  return (TABS as readonly string[]).includes(t) ? (t as Tab) : "charts";
}

export default function Library() {
  const [location] = useLocation();
  const [tab, setTab] = useState<Tab>(() =>
    getTabFromQuery(typeof window !== "undefined" ? window.location.search : "")
  );

  useEffect(() => {
    const next = getTabFromQuery(window.location.search);
    setTab((prev) => (prev === next ? prev : next));
  }, [location]);

  const updateTab = (next: string) => {
    const t = (TABS as readonly string[]).includes(next) ? (next as Tab) : "charts";
    setTab((prev) => (prev === t ? prev : t));
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== t) {
      url.searchParams.set("tab", t);
      window.history.replaceState({}, "", url.toString());
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight" data-testid="text-library-title">
              Library
            </h1>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Everything your sessions have produced — live Charts and Memos.
            </p>
          </div>
        </div>
        <Tabs value={tab} onValueChange={updateTab}>
          <TabsList className="h-8 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="charts"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-charts"
            >
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
              Charts
            </TabsTrigger>
            <TabsTrigger
              value="reports"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-reports"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Memos
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "charts" && (
          <div className="h-full overflow-hidden">
            <DataStation embedded />
          </div>
        )}
        {tab === "reports" && <ReportsTab />}
      </div>
    </div>
  );
}

function ReportsTab() {
  const { user } = useAuth();
  const [q, setQ] = useState("");

  const reportsQuery = useQuery<Report[]>({
    queryKey: ["/api/research/reports"],
    enabled: !!user,
  });

  const reports = reportsQuery.data || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((r) =>
      [r.title, r.description || ""].some((s) => s.toLowerCase().includes(needle))
    );
  }, [reports, q]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="relative mb-4">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memos…"
            className="h-9 pl-8 text-sm"
            data-testid="input-search-reports"
          />
        </div>

        {reportsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            {reports.length === 0 ? (
              <>
                No memos yet. Save a session response with "Save Memo to Library" to start one.
              </>
            ) : (
              <>No memos match "{q}".</>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((r) => {
              // Prefer the memo view (same rendering as download) when the
              // memo was saved from a session. Fall back to the legacy report
              // viewer for old rows that were saved before we tracked source.
              const href =
                r.sourceConversationId != null && r.sourceMessageId != null
                  ? `/memo/${r.sourceConversationId}/${r.sourceMessageId}?preview=1`
                  : `/reports/${r.id}`;
              const protocolTag = detectProtocolTag(r.title, r.description);
              return (
                <Link key={r.id} href={href}>
                  <Card
                    className="group p-4 cursor-pointer hover-elevate active-elevate-2 transition-all h-full flex flex-col"
                    data-testid={`card-report-${r.id}`}
                  >
                    <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                      {protocolTag && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-medium">
                          {protocolTag}
                        </Badge>
                      )}
                      <span className="tabular-nums">
                        {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}
                      </span>
                      <ArrowRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
                    </div>
                    <h3
                      className="text-[13.5px] font-semibold leading-snug line-clamp-2 mb-1.5"
                      data-testid={`text-report-title-${r.id}`}
                    >
                      {r.title}
                    </h3>
                    {r.description && (
                      <p className="text-xs text-muted-foreground/75 line-clamp-3 leading-relaxed">
                        {r.description}
                      </p>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
