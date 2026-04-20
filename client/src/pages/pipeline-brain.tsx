import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2, Network, X, ArrowRight, Clock, Zap } from "lucide-react";
import {
  ForceGraph,
  TYPE_COLORS,
  TYPE_LABELS,
  REL_LABELS,
  type BrainEntity,
  type BrainRelationship,
  type BrainFact,
  type BrainGraphData,
  type GraphNode,
  type GraphEdge,
} from "@/components/force-graph";

function PipelineEntityDetail({
  name,
  entity,
  facts,
  relationships,
  onClose,
  onSelectEntity,
}: {
  name: string;
  entity: BrainEntity;
  facts: BrainFact[];
  relationships: BrainRelationship[];
  onClose: () => void;
  onSelectEntity: (name: string) => void;
}) {
  const color = TYPE_COLORS[entity.type] || "#6b7280";

  return (
    <div className="w-80 border-l border-border bg-background overflow-y-auto" data-testid="panel-pipeline-entity-detail">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
          <h3 className="font-semibold text-sm truncate" data-testid="text-entity-name">{name}</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" data-testid="button-close-detail">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="text-xs">{TYPE_LABELS[entity.type] || entity.type}</Badge>
            {entity.category && <Badge variant="secondary" className="text-xs">{entity.category}</Badge>}
          </div>
          {entity.summary && (
            <p className="text-xs text-muted-foreground leading-relaxed">{entity.summary}</p>
          )}
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span><Zap className="w-3 h-3 inline mr-1" />{entity.researchCount} signals</span>
          <span><Clock className="w-3 h-3 inline mr-1" />{entity.lastResearched}</span>
        </div>

        {entity.tags && entity.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entity.tags.map((tag, i) => (
              <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0">{tag}</Badge>
            ))}
          </div>
        )}

        {entity.chains && entity.chains.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-1 text-muted-foreground">Chains</h4>
            <div className="flex flex-wrap gap-1">
              {entity.chains.map((c, i) => (
                <Badge key={i} variant="secondary" className="text-[10px]">{c}</Badge>
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
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {relationships.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2 text-muted-foreground">Connections</h4>
            <div className="space-y-1.5">
              {relationships.slice(0, 30).map((r, i) => {
                const other = r.from === name ? r.to : r.from;
                const dir = r.from === name ? "→" : "←";
                return (
                  <button
                    key={i}
                    onClick={() => onSelectEntity(other)}
                    className="w-full text-left text-xs p-1.5 rounded border border-border hover:bg-accent flex items-center gap-1.5"
                  >
                    <span className="text-muted-foreground">{dir}</span>
                    <span className="text-muted-foreground">{REL_LABELS[r.type] || r.type}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground" />
                    <span className="font-medium truncate">{other}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {facts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium mb-2 text-muted-foreground">Facts ({facts.length})</h4>
            <div className="space-y-2">
              {facts.slice(0, 20).map((f, i) => (
                <div key={i} className="text-xs border border-border rounded p-2">
                  <div className="font-medium mb-0.5">{f.topic}</div>
                  <div className="text-muted-foreground leading-relaxed">{f.fact}</div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{f.date}</span>
                    <span>via {f.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const FILTERS: { key: BrainEntity["type"] | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "protocol", label: "Protocols" },
  { key: "token", label: "Tokens" },
  { key: "person", label: "Founders" },
  { key: "concept", label: "Sectors" },
  { key: "chain", label: "Chains" },
];

export default function PipelineBrainPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<BrainEntity["type"] | "all">("all");

  const { data, isLoading, error } = useQuery<BrainGraphData>({
    queryKey: ["/api/pipeline-brain"],
  });

  const { nodes, edges, typeCounts } = useMemo(() => {
    if (!data) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], typeCounts: {} as Record<string, number> };

    const counts: Record<string, number> = {};
    for (const e of Object.values(data.entities)) counts[e.type] = (counts[e.type] || 0) + 1;

    const allowedIds = new Set(
      Object.entries(data.entities)
        .filter(([_, e]) => filter === "all" || e.type === filter)
        .map(([id]) => id)
    );

    const ns: GraphNode[] = Object.entries(data.entities)
      .filter(([id]) => allowedIds.has(id))
      .map(([id, entity]) => ({ id, entity, x: 0, y: 0, vx: 0, vy: 0 }));

    const es: GraphEdge[] = data.relationships
      .filter(r => allowedIds.has(r.from) && allowedIds.has(r.to))
      .map(r => ({ source: r.from, target: r.to, type: r.type, context: r.context }));

    return { nodes: ns, edges: es, typeCounts: counts };
  }, [data, filter]);

  const selectedEntity = selected && data ? data.entities[selected] : null;
  const selectedFacts = selected && data ? data.knowledge.filter(f => f.entities.includes(selected)) : [];
  const selectedRels = selected && data ? data.relationships.filter(r => r.from === selected || r.to === selected) : [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Failed to derive pipeline graph.
      </div>
    );
  }

  const isEmpty = !data || Object.keys(data.entities).length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6 pb-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono tabular-nums text-cyan-400/80">02</span>
          <span className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground/55">Map</span>
        </div>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.025em] leading-[0.96] bg-gradient-to-b from-foreground via-foreground/95 to-foreground/65 bg-clip-text text-transparent">
              Pipeline knowledge graph.
            </h1>
            <p className="text-sm text-muted-foreground/70 mt-1.5 font-mono tabular-nums">
              {data?.meta.totalSessions ?? 0} deals · {Object.keys(data?.entities || {}).length} entities · {data?.relationships.length ?? 0} edges
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {FILTERS.map(f => {
              const count = f.key === "all"
                ? Object.keys(data?.entities || {}).length
                : typeCounts[f.key] || 0;
              const active = filter === f.key;
              const color = f.key === "all" ? "#7dcfff" : TYPE_COLORS[f.key] || "#6b7280";
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all flex items-center gap-1.5 ${
                    active
                      ? "border-foreground/30 bg-accent/60 text-foreground"
                      : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                  data-testid={`button-filter-${f.key}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: active ? `0 0 6px ${color}` : "none" }} />
                  {f.label}
                  <span className="font-mono tabular-nums text-muted-foreground/50">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          {isEmpty ? (
            <div className="absolute inset-0 flex items-center justify-center text-center px-6">
              <div className="max-w-sm">
                <Network className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
                <h3 className="text-sm font-medium mb-1">No deals yet</h3>
                <p className="text-xs text-muted-foreground">
                  Add companies to your pipeline and the knowledge graph will draw itself — protocols, founders, sectors, and chains, linked automatically.
                </p>
              </div>
            </div>
          ) : nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
              No entities match this filter.
            </div>
          ) : (
            <ForceGraph
              nodes={nodes}
              edges={edges}
              selectedNode={selected}
              onSelectNode={setSelected}
              testId="canvas-pipeline-brain"
            />
          )}
        </div>

        {selected && selectedEntity && (
          <PipelineEntityDetail
            name={selected}
            entity={selectedEntity}
            facts={selectedFacts}
            relationships={selectedRels}
            onClose={() => setSelected(null)}
            onSelectEntity={(name) => setSelected(name)}
          />
        )}
      </div>
    </div>
  );
}
