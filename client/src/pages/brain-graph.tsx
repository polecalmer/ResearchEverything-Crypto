import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Brain, X, ArrowRight, AlertTriangle, Clock, Zap } from "lucide-react";

interface BrainEntity {
  type: "protocol" | "token" | "chain" | "person" | "fund" | "concept";
  category?: string;
  chains?: string[];
  competitors?: string[];
  relatedEntities?: string[];
  tags?: string[];
  summary?: string;
  lastResearched: string;
  researchCount: number;
}

interface BrainRelationship {
  from: string;
  to: string;
  type: string;
  context?: string;
  date: string;
}

interface BrainFact {
  id: string;
  topic: string;
  fact: string;
  entities: string[];
  source: string;
  date: string;
  confidence: "verified" | "estimated" | "stale";
  supersedes?: string;
}

interface BrainContradiction {
  factIdOld: string;
  factIdNew: string;
  summary: string;
  date: string;
}

interface BrainGraphData {
  entities: Record<string, BrainEntity>;
  relationships: BrainRelationship[];
  knowledge: BrainFact[];
  contradictions: BrainContradiction[];
  preferences: Record<string, any>;
  meta: {
    totalSessions: number;
    lastActive: string | null;
    topEntities: string[];
  };
}

interface GraphNode {
  id: string;
  entity: BrainEntity;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  context?: string;
}

const TYPE_COLORS: Record<string, string> = {
  protocol: "#3b82f6",
  token: "#f59e0b",
  chain: "#10b981",
  person: "#8b5cf6",
  fund: "#ef4444",
  concept: "#6b7280",
};

const TYPE_LABELS: Record<string, string> = {
  protocol: "Protocol",
  token: "Token",
  chain: "Chain",
  person: "Person",
  fund: "Fund",
  concept: "Concept",
};

const REL_LABELS: Record<string, string> = {
  competes_with: "Competes With",
  built_on: "Built On",
  invested_in: "Invested In",
  forked_from: "Forked From",
  partners_with: "Partners With",
  related_to: "Related To",
};

function ForceGraph({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>(nodes);
  const dragRef = useRef<{ node: GraphNode | null; offsetX: number; offsetY: number; startX: number; startY: number; dragged: boolean }>({ node: null, offsetX: 0, offsetY: 0, startX: 0, startY: 0, dragged: false });
  const panRef = useRef({ x: 0, y: 0, isPanning: false, startX: 0, startY: 0 });
  const zoomRef = useRef(1);

  useEffect(() => {
    nodesRef.current = nodes.map((n, i) => {
      const existing = nodesRef.current.find(e => e.id === n.id);
      if (existing) return { ...n, x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy, fx: existing.fx, fy: existing.fy };
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = 150 + Math.random() * 100;
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
    });
  }, [nodes]);

  const simulate = useCallback(() => {
    const ns = nodesRef.current;
    const alpha = 0.3;

    for (const node of ns) {
      node.vx *= 0.85;
      node.vy *= 0.85;
    }

    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dx = ns[j].x - ns[i].x;
        const dy = ns[j].y - ns[i].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (800 / (d * d)) * alpha;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        ns[i].vx -= fx;
        ns[i].vy -= fy;
        ns[j].vx += fx;
        ns[j].vy += fy;
      }
    }

    for (const edge of edges) {
      const source = ns.find(n => n.id === edge.source);
      const target = ns.find(n => n.id === edge.target);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (d - 120) * 0.02 * alpha;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (const node of ns) {
      const cx = 0.001 * alpha;
      node.vx -= node.x * cx;
      node.vy -= node.y * cx;
    }

    for (const node of ns) {
      if (node.fx != null) { node.x = node.fx; node.vx = 0; }
      else { node.x += node.vx; }
      if (node.fy != null) { node.y = node.fy; node.vy = 0; }
      else { node.y += node.vy; }
    }
  }, [edges]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + panRef.current.x, rect.height / 2 + panRef.current.y);
    ctx.scale(zoomRef.current, zoomRef.current);

    const ns = nodesRef.current;

    for (const edge of edges) {
      const source = ns.find(n => n.id === edge.source);
      const target = ns.find(n => n.id === edge.target);
      if (!source || !target) continue;

      const isHighlighted = selectedNode && (edge.source === selectedNode || edge.target === selectedNode);
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.strokeStyle = isHighlighted ? "rgba(59, 130, 246, 0.6)" : "rgba(100, 116, 139, 0.15)";
      ctx.lineWidth = isHighlighted ? 2 : 1;
      ctx.stroke();
    }

    for (const node of ns) {
      const isSelected = node.id === selectedNode;
      const color = TYPE_COLORS[node.entity.type] || "#6b7280";
      const radius = Math.min(8 + (node.entity.researchCount || 1) * 2, 20);

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? color : `${color}cc`;
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#fff" : `${color}88`;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();

      ctx.fillStyle = isSelected ? "#fff" : "rgba(226, 232, 240, 0.85)";
      ctx.font = `${isSelected ? "600" : "400"} 11px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(node.id, node.x, node.y + radius + 14);
    }

    ctx.restore();

    simulate();
    animRef.current = requestAnimationFrame(draw);
  }, [edges, selectedNode, simulate]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const getNodeAt = (mx: number, my: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (mx - rect.width / 2 - panRef.current.x) / zoomRef.current;
    const y = (my - rect.height / 2 - panRef.current.y) / zoomRef.current;

    for (const node of nodesRef.current) {
      const r = Math.min(8 + (node.entity.researchCount || 1) * 2, 20);
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy < (r + 4) * (r + 4)) return node;
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);

    if (node) {
      dragRef.current = { node, offsetX: 0, offsetY: 0, startX: e.clientX, startY: e.clientY, dragged: false };
      node.fx = node.x;
      node.fy = node.y;
    } else {
      panRef.current.isPanning = true;
      panRef.current.startX = e.clientX - panRef.current.x;
      panRef.current.startY = e.clientY - panRef.current.y;
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current.node) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.dragged = true;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left - rect.width / 2 - panRef.current.x) / zoomRef.current;
      const y = (e.clientY - rect.top - rect.height / 2 - panRef.current.y) / zoomRef.current;
      dragRef.current.node.fx = x;
      dragRef.current.node.fy = y;
    } else if (panRef.current.isPanning) {
      panRef.current.x = e.clientX - panRef.current.startX;
      panRef.current.y = e.clientY - panRef.current.startY;
    }
  };

  const handleMouseUp = () => {
    if (dragRef.current.node) {
      if (!dragRef.current.dragged) {
        onSelectNode(dragRef.current.node.id === selectedNode ? null : dragRef.current.node.id);
      }
      dragRef.current.node.fx = null;
      dragRef.current.node.fy = null;
      dragRef.current.node = null;
    }
    panRef.current.isPanning = false;
  };

  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = getNodeAt(mx, my);
    if (node) {
      onSelectNode(node.id === selectedNode ? null : node.id);
    } else {
      onSelectNode(null);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomRef.current = Math.max(0.2, Math.min(3, zoomRef.current * delta));
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      onWheel={handleWheel}
      data-testid="canvas-brain-graph"
    />
  );
}

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

export default function BrainGraphPage() {
  const { data, isLoading, error } = useQuery<BrainGraphData>({
    queryKey: ["/api/brain/graph"],
  });

  const [selectedNode, setSelectedNode] = useState<string | null>(null);

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
        {data?.meta && data.meta.totalSessions > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span data-testid="text-total-sessions">{data.meta.totalSessions} sessions</span>
            {data.meta.lastActive && <span data-testid="text-last-active">Last: {data.meta.lastActive}</span>}
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-sm font-medium mb-2" data-testid="text-empty-title">Your Brain Is Empty</h2>
            <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-empty-description">
              Go to Research and ask questions about protocols, tokens, or chains.
              The AI agent will automatically record findings here, building a knowledge graph over time.
            </p>
          </div>
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
    </div>
  );
}
