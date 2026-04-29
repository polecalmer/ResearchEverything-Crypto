import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, Network, Building2, BarChart3 } from "lucide-react";
import Pipeline from "@/pages/pipeline";
import PipelineBrain from "@/pages/pipeline-brain";
import Companies from "@/pages/companies";
import DataPage from "@/pages/data";

// Combined Tools surface: pipeline, knowledge map, companies, and data station
// share a top tab bar. Each individual page still works at its own route
// (`/`, `/map`, `/companies`, `/data`) so internal links don't break — this
// page is purely a navigation consolidation that gives the sidebar a single
// "Tools" entry instead of four. Tab state syncs to ?view=<id> so links to a
// specific tab can be shared.

const TABS = [
  { id: "pipeline",  label: "Pipeline",  icon: LayoutDashboard, Component: Pipeline },
  { id: "map",       label: "Map",       icon: Network,         Component: PipelineBrain },
  { id: "companies", label: "Companies", icon: Building2,       Component: Companies },
  { id: "data",      label: "Data",      icon: BarChart3,       Component: DataPage },
] as const;

type TabId = typeof TABS[number]["id"];

function readTabFromUrl(search: string): TabId {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  const v = params.get("view");
  if (v && TABS.some(t => t.id === v)) return v as TabId;
  return "pipeline";
}

export default function Tools() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    typeof window !== "undefined" ? readTabFromUrl(window.location.search) : "pipeline"
  );

  // Sync the URL query param so a refresh / share lands on the same tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === activeTab) return;
    params.set("view", activeTab);
    const next = `/tools?${params.toString()}`;
    window.history.replaceState({}, "", next);
  }, [activeTab]);

  const ActiveComponent = TABS.find(t => t.id === activeTab)!.Component;

  return (
    <div className="h-full flex flex-col" data-testid="tools-page">
      <div
        className="border-b border-border/30 px-4 flex items-center gap-0 sticky top-0 z-10 bg-background/90 backdrop-blur"
        data-testid="tools-tab-bar"
      >
        {TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium border-b-2 transition-colors ${
                active
                  ? "border-primary/60 text-foreground"
                  : "border-transparent text-muted-foreground/55 hover:text-foreground/85"
              }`}
              data-testid={`tools-tab-${t.id}`}
              aria-selected={active}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-hidden">
        <ActiveComponent />
      </div>
    </div>
  );
}
