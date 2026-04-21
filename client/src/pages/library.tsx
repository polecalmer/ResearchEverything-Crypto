import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, BarChart3, Brain, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import DataStation from "@/pages/data-station";
import BrainGraph from "@/pages/brain-graph";

interface Report {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const TABS = ["reports", "charts", "facts"] as const;
type Tab = typeof TABS[number];

function getTabFromQuery(search: string): Tab {
  const params = new URLSearchParams(search);
  const t = (params.get("tab") || "").toLowerCase();
  return (TABS as readonly string[]).includes(t) ? (t as Tab) : "reports";
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
    const t = (TABS as readonly string[]).includes(next) ? (next as Tab) : "reports";
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
              Everything your sessions have produced — Reports, live Charts, and learned Facts.
            </p>
          </div>
        </div>
        <Tabs value={tab} onValueChange={updateTab}>
          <TabsList className="h-8 bg-transparent p-0 gap-1">
            <TabsTrigger
              value="reports"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-reports"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" />
              Reports
            </TabsTrigger>
            <TabsTrigger
              value="charts"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-charts"
            >
              <BarChart3 className="w-3.5 h-3.5 mr-1.5" />
              Charts
            </TabsTrigger>
            <TabsTrigger
              value="facts"
              className="h-7 px-3 text-[12px] data-[state=active]:bg-accent data-[state=active]:shadow-none"
              data-testid="tab-facts"
            >
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              Facts
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "reports" && <ReportsTab />}
        {tab === "charts" && (
          <div className="h-full overflow-hidden">
            <DataStation />
          </div>
        )}
        {tab === "facts" && (
          <div className="h-full overflow-hidden">
            <BrainGraph />
          </div>
        )}
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
            placeholder="Search reports…"
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
                No reports yet. Save chart blocks from a session to start a report.
              </>
            ) : (
              <>No reports match "{q}".</>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((r) => (
              <Link key={r.id} href={`/reports/${r.id}`}>
                <Card
                  className="p-4 cursor-pointer hover-elevate active-elevate-2 transition-all"
                  data-testid={`card-report-${r.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-sm font-medium leading-snug" data-testid={`text-report-title-${r.id}`}>
                      {r.title}
                    </h3>
                    <Badge variant="outline" className="text-[10px] shrink-0">Report</Badge>
                  </div>
                  {r.description && (
                    <p className="text-xs text-muted-foreground/80 line-clamp-2 mb-2">{r.description}</p>
                  )}
                  <div className="text-[10px] text-muted-foreground/60 tabular-nums">
                    Updated {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })} ·{" "}
                    {format(new Date(r.createdAt), "MMM d, yyyy")}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
