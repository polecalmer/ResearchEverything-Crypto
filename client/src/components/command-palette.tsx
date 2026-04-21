import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard, Building2, FlaskConical, Library as LibraryIcon,
  FileText, BarChart3, Brain, Wallet, Network, Activity, Plus,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface Session {
  id: number;
  title: string;
  createdAt: string;
}

interface SavedChart {
  id: string;
  title: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const sessionsQuery = useQuery<Session[]>({
    queryKey: ["/api/research/sessions"],
    enabled: !!user && open,
  });

  const chartsQuery = useQuery<SavedChart[]>({
    queryKey: ["/api/research/charts/saved"],
    enabled: !!user && open,
  });

  const go = (path: string) => {
    setOpen(false);
    setLocation(path);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to anything — sessions, charts, reports…" data-testid="input-command-palette" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>

        <CommandGroup heading="Create">
          <CommandItem onSelect={() => go("/research")} data-testid="cmd-new-session">
            <Plus className="w-3.5 h-3.5 mr-2" />
            New Session
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => go("/")} data-testid="cmd-nav-pipeline">
            <LayoutDashboard className="w-3.5 h-3.5 mr-2" />
            Pipeline
          </CommandItem>
          <CommandItem onSelect={() => go("/map")} data-testid="cmd-nav-map">
            <Network className="w-3.5 h-3.5 mr-2" />
            Map
          </CommandItem>
          <CommandItem onSelect={() => go("/companies")} data-testid="cmd-nav-companies">
            <Building2 className="w-3.5 h-3.5 mr-2" />
            Companies
          </CommandItem>
          <CommandItem onSelect={() => go("/research")} data-testid="cmd-nav-sessions">
            <FlaskConical className="w-3.5 h-3.5 mr-2" />
            Sessions
          </CommandItem>
          <CommandItem onSelect={() => go("/library?tab=reports")} data-testid="cmd-nav-library-reports">
            <FileText className="w-3.5 h-3.5 mr-2" />
            Library — Reports
          </CommandItem>
          <CommandItem onSelect={() => go("/library?tab=charts")} data-testid="cmd-nav-library-charts">
            <BarChart3 className="w-3.5 h-3.5 mr-2" />
            Library — Charts
          </CommandItem>
          <CommandItem onSelect={() => go("/library?tab=facts")} data-testid="cmd-nav-library-facts">
            <Brain className="w-3.5 h-3.5 mr-2" />
            Library — Facts
          </CommandItem>
          <CommandItem onSelect={() => go("/wallet")} data-testid="cmd-nav-wallet">
            <Wallet className="w-3.5 h-3.5 mr-2" />
            Wallet
          </CommandItem>
        </CommandGroup>

        {(sessionsQuery.data?.length ?? 0) > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent Sessions">
              {(sessionsQuery.data || []).slice(0, 8).map((s) => (
                <CommandItem
                  key={`session-${s.id}`}
                  onSelect={() => go(`/research?sessionId=${s.id}`)}
                  data-testid={`cmd-session-${s.id}`}
                >
                  <FlaskConical className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{s.title || "Untitled session"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {(chartsQuery.data?.length ?? 0) > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Saved Charts">
              {(chartsQuery.data || []).slice(0, 8).map((c) => (
                <CommandItem
                  key={`chart-${c.id}`}
                  onSelect={() => go(`/research?chart=${c.id}`)}
                  data-testid={`cmd-chart-${c.id}`}
                >
                  <BarChart3 className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{c.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
