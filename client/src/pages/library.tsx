import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";
import DataStation from "@/pages/data-station";
import type { Session } from "@/lib/research-utils";

interface Report {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  sourceConversationId: number | null;
  sourceMessageId: number | null;
}

const TABS = ["charts", "memos", "sessions"] as const;
type Tab = typeof TABS[number];

// Known protocol + ticker names the memo extractor is likely to surface.
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
  // Back-compat: the second tab used to be ?tab=reports; rename to memos.
  if (t === "reports") return "memos";
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
              Everything your sessions have produced — Charts, Memos, and session history.
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
              Charts
            </TabsTrigger>
            <TabsTrigger
              value="memos"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-reports"
            >
              Memos
            </TabsTrigger>
            <TabsTrigger
              value="sessions"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-sessions"
            >
              Sessions
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
        {tab === "memos" && <ReportsTab />}
        {tab === "sessions" && <SessionsTab />}
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
      <div className="max-w-4xl mx-auto px-6 py-6">
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
          // Slick list: no row separators, two-line layout (title above,
          // meta below in muted small type), generous vertical rhythm.
          // Hover gives a subtle inset background instead of a border.
          <ul className="flex flex-col">
            {filtered.map((r) => {
              const href =
                r.sourceConversationId != null && r.sourceMessageId != null
                  ? `/memo/${r.sourceConversationId}/${r.sourceMessageId}?preview=1`
                  : `/reports/${r.id}`;
              const protocolTag = detectProtocolTag(r.title, r.description);
              return (
                <li key={r.id}>
                  <Link
                    href={href}
                    className="block rounded-md px-3 py-3 hover:bg-accent/30 active:bg-accent/50 transition-colors"
                    data-testid={`row-report-${r.id}`}
                  >
                    <div
                      className="text-[13.5px] font-medium text-foreground/95 leading-snug truncate"
                      data-testid={`text-report-title-${r.id}`}
                    >
                      {r.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                      {protocolTag && (
                        <>
                          <span className="font-medium text-muted-foreground/80">{protocolTag}</span>
                          <span className="text-muted-foreground/30">·</span>
                        </>
                      )}
                      <span className="tabular-nums">
                        {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}
                      </span>
                      {r.description && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span className="truncate">{r.description}</span>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SessionsTab() {
  const { user } = useAuth();
  const [q, setQ] = useState("");

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user,
  });

  const sessions = sessionsQuery.data || [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) => s.title?.toLowerCase().includes(needle));
  }, [sessions, q]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="relative mb-4">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search sessions…"
            className="h-9 pl-8 text-sm"
            data-testid="input-search-sessions"
          />
        </div>

        {sessionsQuery.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-muted-foreground">
            {sessions.length === 0 ? (
              <>No sessions yet. Start one from the Research page.</>
            ) : (
              <>No sessions match "{q}".</>
            )}
          </div>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((s) => {
              const protocolTag = detectProtocolTag(s.title);
              return (
                <li key={s.id}>
                  <Link
                    href={`/research?sessionId=${s.id}`}
                    className="block rounded-md px-3 py-3 hover:bg-accent/30 active:bg-accent/50 transition-colors"
                    data-testid={`row-session-${s.id}`}
                  >
                    <div
                      className="text-[13.5px] font-medium text-foreground/95 leading-snug truncate"
                      data-testid={`text-session-title-${s.id}`}
                    >
                      {s.title || "Untitled session"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/60">
                      {protocolTag && (
                        <>
                          <span className="font-medium text-muted-foreground/80">{protocolTag}</span>
                          <span className="text-muted-foreground/30">·</span>
                        </>
                      )}
                      <span className="tabular-nums">
                        {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                      </span>
                      {s.parentSessionId && (
                        <>
                          <span className="text-muted-foreground/30">·</span>
                          <span>spawned thread</span>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
