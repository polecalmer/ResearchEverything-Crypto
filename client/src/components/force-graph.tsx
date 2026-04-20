import { useEffect, useRef, useCallback } from "react";

export interface BrainEntity {
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

export interface BrainRelationship {
  from: string;
  to: string;
  type: string;
  context?: string;
  date: string;
}

export interface BrainFact {
  id: string;
  topic: string;
  fact: string;
  entities: string[];
  source: string;
  date: string;
  confidence: "verified" | "estimated" | "stale";
  supersedes?: string;
}

export interface BrainContradiction {
  factIdOld: string;
  factIdNew: string;
  summary: string;
  date: string;
}

export interface BrainGraphData {
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

export interface GraphNode {
  id: string;
  entity: BrainEntity;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  context?: string;
}

export const TYPE_COLORS: Record<string, string> = {
  protocol: "#7dcfff",
  token: "#f7c97a",
  chain: "#9ece6a",
  person: "#bb9af7",
  fund: "#f7768e",
  concept: "#a9b1d6",
};

export const TYPE_LABELS: Record<string, string> = {
  protocol: "Protocol",
  token: "Token",
  chain: "Chain",
  person: "Person",
  fund: "Fund",
  concept: "Concept",
};

export const REL_LABELS: Record<string, string> = {
  competes_with: "Competes With",
  built_on: "Built On",
  invested_in: "Invested In",
  forked_from: "Forked From",
  partners_with: "Partners With",
  related_to: "Related To",
  founded: "Founded",
  in_sector: "In Sector",
  in_stage: "In Stage",
  has_token: "Has Token",
};

export function ForceGraph({
  nodes,
  edges,
  selectedNode,
  onSelectNode,
  testId = "canvas-force-graph",
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  testId?: string;
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
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
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
      ctx.strokeStyle = isHighlighted ? "rgba(125, 207, 255, 0.6)" : "rgba(100, 116, 139, 0.15)";
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
      data-testid={testId}
    />
  );
}
