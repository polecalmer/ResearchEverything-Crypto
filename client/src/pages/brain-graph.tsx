import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Brain, X, ArrowRight, AlertTriangle, Clock, Zap, Upload, Plus, Trash2, Database, Sparkles, Target, Settings } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  ForceGraph,
  TYPE_COLORS,
  TYPE_LABELS,
  REL_LABELS,
  type BrainEntity,
  type BrainRelationship,
  type BrainFact,
  type BrainContradiction,
  type BrainGraphData,
  type GraphNode,
  type GraphEdge,
} from "@/components/force-graph";


function EntityDetail({
  name,
  entity,
  facts,
  relationships,
  contradictions,
  allKnowledge,
  onClose,
  onSelectEntity,
}: {
  name: string;
  entity: BrainEntity;
  facts: BrainFact[];
  relationships: BrainRelationship[];
  contradictions: BrainContradiction[];
  allKnowledge: BrainFact[];
  onClose: () => void;
  onSelectEntity: (name: string) => void;
}) {
  const color = TYPE_COLORS[entity.type] || "#6b7280";

  return (
    <div className="w-80 border-l border-border bg-background overflow-y-auto" data-testid="panel-entity-detail">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h3 className="font-semibold text-sm" data-testid="text-entity-name">{name}</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-detail">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-xs" data-testid="badge-entity-type">{TYPE_LABELS[entity.type] || entity.type}</Badge>
            {entity.category && <Badge variant="secondary" className="text-xs" data-testid="badge-entity-category">{entity.category}</Badge>}
          </div>
          {entity.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-entity-summary">{entity.summary}</p>
          )}
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span data-testid="text-research-count"><Zap className="w-3 h-3 inline mr-1" />{entity.researchCount}x researched</span>
          <span data-testid="text-last-researched"><Clock className="w-3 h-3 inline mr-1" />{entity.lastResearched}</span>
        </div>

        {entity.tags && entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0" data-testid={`badge-tag-${i}`}>{tag}</Badge>
            ))}
          </div>
        )}

        {entity.chains && entity.chains.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-1 text-muted-foreground">Chains</h4>
            <div className="flex flex-wrap gap-1">
              {entity.chains.map((c, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]" data-testid={`badge-chain-${i}`}>{c}</Badge>
              ))}
            </div>
          </div>
        )}

        {entity.competitors && entity.competitors.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-1 text-muted-foreground">Competitors</h4>
            <div className="flex flex-wrap gap-1">
              {entity.competitors.map((c, i) => (
                <button
                  key={i}
                  onClick={() => onSelectEntity(c)}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent cursor-pointer"
                  data-testid={`button-competitor-${i}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {relationships.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2 text-muted-foreground">Relationships</h4>
            <div className="space-y-1.5">
              {relationships.map((r, i) => {
                const other = r.from === name ? r.to : r.from;
                const dir = r.from === name ? "→" : "←";
                return (
                  <button
                    key={i}
                    onClick={() => onSelectEntity(other)}
                    className="w-full text-left text-xs p-1.5 rounded border border-border hover:bg-accent flex items-center gap-1.5"
                    data-testid={`button-relationship-${i}`}
                  >
                    <span className="text-muted-foreground">{dir}</span>
                    <span className="text-muted-foreground">{REL_LABELS[r.type] || r.type}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="font-medium">{other}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2 text-muted-foreground">Known Facts ({facts.length})</h4>
            <div className="space-y-2">
              {facts.slice(0, 15).map((f, i) => (
                <div key={i} className="text-xs border border-border rounded p-2" data-testid={`card-fact-${i}`}>
                  <div className="font-medium mb-0.5">{f.topic}</div>
                  <div className="text-muted-foreground leading-relaxed">{f.fact}</div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{f.date}</span>
                    <span>via {f.source}</span>
                    {f.confidence === "estimated" && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-500 border-amber-500/30">est.</Badge>
                    )}
                    {f.confidence === "stale" && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-500 border-red-500/30">stale</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {contradictions.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2 text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />Data Changes
            </h4>
            <div className="space-y-1.5">
              {contradictions.map((c, i) => (
                <div key={i} className="text-xs p-2 rounded border border-amber-500/20 bg-amber-500/5" data-testid={`card-contradiction-${i}`}>
                  <div className="text-muted-foreground">{c.summary}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{c.date}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const IMPORT_CATEGORIES = [
  {
    key: "data_sources",
    label: "Trusted Data Sources",
    icon: Database,
    description: "Sites, APIs, and resources you trust for specific data. The agent will prioritize these.",
    placeholder: "e.g., Always reference stonksonchain.net for HYPE token unlock data and buyback schedules",
    examples: [
      "Use artemis.xyz for cross-chain stablecoin flow data",
      "Reference tokenterminal.com for protocol revenue comparisons",
      "For Solana DeFi data, prefer Step Finance dashboards",
    ],
  },
  {
    key: "research_style",
    label: "Research Style",
    icon: Sparkles,
    description: "How you approach crypto research — your methodology, frameworks, and what makes your analysis unique.",
    placeholder: "Describe your research approach. Paste from a conversation with an LLM about your style, or write it out.",
    examples: [
      "I focus on revenue quality — distinguishing organic vs incentivized fees, and always decompose take rates",
      "I use a bottom-up approach: start with on-chain data, validate with team calls, then build financial models",
      "My edge is in tokenomics analysis — I always model unlock schedules, buyback capacity, and real float vs reported circulating supply",
    ],
  },
  {
    key: "analysis_lens",
    label: "Analysis Frameworks",
    icon: Target,
    description: "Valuation frameworks, analytical lenses, and mental models you apply to token/protocol evaluation.",
    placeholder: "e.g., I always use EV-adjusted multiples (subtract treasury from MCAP) and compare P/S to growth-adjusted benchmarks",
    examples: [
      "Always calculate P/S using EV-adjusted MCAP, not raw MCAP — subtract treasury and locked tokens",
      "I weight catalysts heavily — upcoming launches, governance changes, and token unlock cliffs matter more than current multiples",
      "For L1/L2 analysis, I focus on developer activity and real usage (daily active addresses, not transaction count which can be botted)",
    ],
  },
  {
    key: "custom_instructions",
    label: "Custom Instructions",
    icon: Settings,
    description: "Any other preferences for how the agent should behave during your research sessions.",
    placeholder: "e.g., Always compare crypto protocols to TradFi equivalents when doing valuation",
    examples: [
      "When presenting scenarios, always include a bear case with >50% drawdown assumptions",
      "I care about real yield, not incentivized yield — always separate the two in analysis",
      "Format all price targets as ranges, never point estimates. Include probability weights.",
    ],
  },
];

function BrainImportPanel({
  onClose,
  existingPreferences,
}: {
  onClose: () => void;
  existingPreferences: Record<string, any>;
}) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState(IMPORT_CATEGORIES[0].key);
  const [inputText, setInputText] = useState("");
  const [editingPrefs, setEditingPrefs] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const cat of IMPORT_CATEGORIES) {
      const existing = existingPreferences[cat.key];
      initial[cat.key] = Array.isArray(existing)
        ? existing.map((e: any) => typeof e === "string" ? e : e.description || JSON.stringify(e))
        : [];
    }
    return initial;
  });

  const saveMutation = useMutation({
    mutationFn: async (preferences: Record<string, any>) => {
      const res = await apiRequest("PUT", "/api/brain/preferences", { preferences });
      return res.json();
    },
    onSuccess: (_, savedPrefs) => {
      queryClient.invalidateQueries({ queryKey: ["/api/brain/graph"] });
      toast({ title: "Saved", description: "Brain preferences updated" });
      const updated: Record<string, string[]> = {};
      for (const cat of IMPORT_CATEGORIES) {
        const items = savedPrefs[cat.key];
        updated[cat.key] = Array.isArray(items) ? items : [];
      }
      setEditingPrefs(updated);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save preferences", variant: "destructive" });
    },
  });

  const handleAdd = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    const current = editingPrefs[activeCategory] || [];
    setEditingPrefs({ ...editingPrefs, [activeCategory]: [...current, trimmed] });
    setInputText("");
  };

  const handleRemove = (index: number) => {
    const current = editingPrefs[activeCategory] || [];
    setEditingPrefs({ ...editingPrefs, [activeCategory]: current.filter((_, i) => i !== index) });
  };

  const handleSaveAll = () => {
    const prefs: Record<string, any> = { ...existingPreferences };
    for (const cat of IMPORT_CATEGORIES) {
      const items = editingPrefs[cat.key] || [];
      if (items.length > 0) {
        prefs[cat.key] = items;
      } else {
        delete prefs[cat.key];
      }
    }
    saveMutation.mutate(prefs);
  };

  const handlePasteBulk = () => {
    const lines = inputText.split("\n").map(l => l.trim()).filter(l => l.length > 0 && l !== "-");
    if (lines.length === 0) return;
    const cleaned = lines.map(l => l.replace(/^[-•*]\s*/, ""));
    const current = editingPrefs[activeCategory] || [];
    setEditingPrefs({ ...editingPrefs, [activeCategory]: [...current, ...cleaned] });
    setInputText("");
  };

  const activeCat = IMPORT_CATEGORIES.find(c => c.key === activeCategory)!;
  const currentItems = editingPrefs[activeCategory] || [];
  const hasChanges = JSON.stringify(editingPrefs) !== JSON.stringify(
    Object.fromEntries(IMPORT_CATEGORIES.map(c => [c.key, Array.isArray(existingPreferences[c.key]) ? existingPreferences[c.key].map((e: any) => typeof e === "string" ? e : e.description || JSON.stringify(e)) : []]))
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" data-testid="modal-brain-import">
      <div className="bg-background border border-border rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold" data-testid="text-import-title">Import Into Brain</h2>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <Button
                size="sm"
                onClick={handleSaveAll}
                disabled={saveMutation.isPending}
                className="text-xs h-7"
                data-testid="button-save-all"
              >
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Save All Changes
              </Button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-import">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-48 border-r border-border p-2 space-y-0.5">
            {IMPORT_CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const count = (editingPrefs[cat.key] || []).length;
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className={`w-full text-left text-xs p-2 rounded flex items-center gap-2 transition-colors ${
                    activeCategory === cat.key ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                  data-testid={`button-category-${cat.key}`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1">{cat.label}</span>
                  {count > 0 && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">{count}</Badge>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-1" data-testid="text-category-label">{activeCat.label}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{activeCat.description}</p>
            </div>

            <div className="space-y-2">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={activeCat.placeholder}
                className="w-full h-24 text-xs p-3 rounded border border-border bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="textarea-import-input"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleAdd} disabled={!inputText.trim()} className="text-xs h-7" data-testid="button-add-single">
                  <Plus className="w-3 h-3 mr-1" />Add Entry
                </Button>
                <Button size="sm" variant="outline" onClick={handlePasteBulk} disabled={!inputText.trim()} className="text-xs h-7" data-testid="button-paste-bulk">
                  <Upload className="w-3 h-3 mr-1" />Paste Multiple (one per line)
                </Button>
              </div>
            </div>

            {currentItems.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Current entries ({currentItems.length})</h4>
                {currentItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs p-2 rounded border border-border group" data-testid={`item-entry-${i}`}>
                    <span className="flex-1 leading-relaxed">{item}</span>
                    <button
                      onClick={() => handleRemove(i)}
                      className="text-muted-foreground hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                      data-testid={`button-remove-${i}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {currentItems.length === 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Examples to get started</h4>
                <div className="space-y-1.5">
                  {activeCat.examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setEditingPrefs({ ...editingPrefs, [activeCategory]: [...currentItems, ex] });
                      }}
                      className="w-full text-left text-xs p-2 rounded border border-dashed border-border hover:border-foreground/20 hover:bg-accent/30 text-muted-foreground transition-colors"
                      data-testid={`button-example-${i}`}
                    >
                      <Plus className="w-3 h-3 inline mr-1.5 opacity-50" />{ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BrainGraphPage() {
  const { data, isLoading, error } = useQuery<BrainGraphData>({
    queryKey: ["/api/brain/graph"],
  });

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" data-testid="loader-brain">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground" data-testid="error-brain">
        Failed to load brain data
      </div>
    );
  }

  const entityNames = Object.keys(data?.entities || {});
  const hasPreferences = Object.values(data?.preferences || {}).some(
    (v: any) => Array.isArray(v) && v.length > 0
  );
  const isEmpty = entityNames.length === 0;

  const graphNodes: GraphNode[] = entityNames.map((name, i) => ({
    id: name,
    entity: data!.entities[name],
    x: Math.cos((i / entityNames.length) * Math.PI * 2) * 200,
    y: Math.sin((i / entityNames.length) * Math.PI * 2) * 200,
    vx: 0,
    vy: 0,
  }));

  const graphEdges: GraphEdge[] = (data?.relationships || [])
    .filter(r => data!.entities[r.from] && data!.entities[r.to])
    .map(r => ({ source: r.from, target: r.to, type: r.type, context: r.context }));

  const selectedEntity = selectedNode ? data?.entities[selectedNode] : null;
  const selectedFacts = selectedNode
    ? (data?.knowledge || []).filter(f => f.entities.includes(selectedNode))
    : [];
  const selectedRels = selectedNode
    ? (data?.relationships || []).filter(r => r.from === selectedNode || r.to === selectedNode)
    : [];
  const selectedContradictions = selectedNode
    ? (data?.contradictions || []).filter(c => {
        const oldFact = (data?.knowledge || []).find(f => f.id === c.factIdOld);
        const newFact = (data?.knowledge || []).find(f => f.id === c.factIdNew);
        return [...(oldFact?.entities || []), ...(newFact?.entities || [])].includes(selectedNode);
      })
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="page-brain-graph">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-5 h-5 text-muted-foreground" />
          <div>
            <h1 className="text-sm font-semibold" data-testid="text-brain-title">Research Brain</h1>
            <p className="text-xs text-muted-foreground" data-testid="text-brain-subtitle">
              {isEmpty
                ? "Start researching to build your knowledge graph"
                : `${entityNames.length} entities, ${(data?.knowledge || []).length} facts, ${(data?.relationships || []).length} relationships`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.meta && data.meta.totalSessions > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span data-testid="text-total-sessions">{data.meta.totalSessions} sessions</span>
              {data.meta.lastActive && <span data-testid="text-last-active">Last: {data.meta.lastActive}</span>}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowImport(true)}
            className="text-xs h-7"
            data-testid="button-import-brain"
          >
            <Upload className="w-3 h-3 mr-1.5" />
            Import Into Brain
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          {hasPreferences ? (
            <div className="text-center max-w-md">
              <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <h2 className="text-sm font-medium mb-2" data-testid="text-prefs-title">Brain Preferences Loaded</h2>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4" data-testid="text-prefs-description">
                Your research style, data sources, and analysis frameworks are active.
                Start a research session to build your knowledge graph — the agent will follow your preferences from the first message.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {Object.entries(data?.preferences || {}).map(([key, val]: [string, any]) => {
                  if (!Array.isArray(val) || val.length === 0) return null;
                  const labels: Record<string, string> = {
                    data_sources: "Data Sources",
                    research_style: "Research Style",
                    analysis_lens: "Frameworks",
                    custom_instructions: "Instructions",
                  };
                  return (
                    <Badge key={key} variant="secondary" className="text-[10px]" data-testid={`badge-pref-${key}`}>
                      {labels[key] || key}: {val.length}
                    </Badge>
                  );
                })}
              </div>
              <div className="flex gap-2 justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowImport(true)}
                  className="text-xs"
                  data-testid="button-edit-preferences"
                >
                  <Settings className="w-3 h-3 mr-1.5" />
                  Edit Preferences
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center max-w-sm">
              <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
              <h2 className="text-sm font-medium mb-2" data-testid="text-empty-title">Your Brain Is Empty</h2>
              <p className="text-xs text-muted-foreground leading-relaxed mb-4" data-testid="text-empty-description">
                Go to Research and ask questions about protocols, tokens, or chains.
                The AI agent will automatically record findings here, building a knowledge graph over time.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowImport(true)}
                className="text-xs"
                data-testid="button-import-brain-empty"
              >
                <Upload className="w-3 h-3 mr-1.5" />
                Import Preferences To Get Started
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative bg-background">
            <ForceGraph
              nodes={graphNodes}
              edges={graphEdges}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
            />

            <div className="absolute bottom-4 left-4 flex gap-3 text-[10px] text-muted-foreground bg-background/80 backdrop-blur-sm rounded px-3 py-2 border border-border" data-testid="legend-types">
              {Object.entries(TYPE_COLORS).map(([type, color]) => {
                const count = entityNames.filter(n => data!.entities[n].type === type).length;
                if (count === 0) return null;
                return (
                  <span key={type} className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: color }} />
                    {TYPE_LABELS[type] || type} ({count})
                  </span>
                );
              })}
            </div>

            {(data?.contradictions || []).length > 0 && (
              <div className="absolute top-4 right-4 text-[10px] text-amber-500 bg-background/80 backdrop-blur-sm rounded px-3 py-2 border border-amber-500/20 flex items-center gap-1.5" data-testid="badge-contradictions">
                <AlertTriangle className="w-3 h-3" />
                {data!.contradictions.length} data change{data!.contradictions.length !== 1 ? "s" : ""} detected
              </div>
            )}
          </div>

          {selectedNode && selectedEntity && (
            <EntityDetail
              name={selectedNode}
              entity={selectedEntity}
              facts={selectedFacts}
              relationships={selectedRels}
              contradictions={selectedContradictions}
              allKnowledge={data?.knowledge || []}
              onClose={() => setSelectedNode(null)}
              onSelectEntity={(name) => {
                if (data?.entities[name]) setSelectedNode(name);
              }}
            />
          )}
        </div>
      )}

      {showImport && (
        <BrainImportPanel
          onClose={() => setShowImport(false)}
          existingPreferences={data?.preferences || {}}
        />
      )}
    </div>
  );
}
