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

interface Node3D {
  id: string;
  entity: BrainEntity;
  // base position on the unit sphere (normalized direction)
  px: number;
  py: number;
  pz: number;
  // current radius from origin (lets us animate/spread without losing direction)
  r: number;
  // last projected screen coords for hit testing & label placement
  sx: number;
  sy: number;
  sz: number; // depth in camera space
  scale: number;
}

const SPHERE_RADIUS = 240;
const FOCAL = 700;

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

  // Persistent 3D node table.
  const nodes3DRef = useRef<Node3D[]>([]);
  const edgesRef = useRef<GraphEdge[]>(edges);
  const selectedRef = useRef<string | null>(selectedNode);

  // Camera / rotation state.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.25); // small downward tilt for that "3D look"
  const autoYawSpeedRef = useRef(0.0035); // radians per frame, ~12s/rev
  const userYawVelRef = useRef(0);
  const userPitchVelRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  // Interaction state.
  const dragRef = useRef<{
    mode: "rotate" | "pan" | "node" | null;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    nodeId: string | null;
    downAt: number;
  }>({ mode: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, nodeId: null, downAt: 0 });

  // ---- Layout: fibonacci sphere distribution, persistent across data updates.
  useEffect(() => {
    const n = nodes.length;
    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
    const next: Node3D[] = nodes.map((node, i) => {
      const existing = nodes3DRef.current.find(e => e.id === node.id);
      if (existing) return { ...existing, entity: node.entity };
      const y = 1 - (i / Math.max(n - 1, 1)) * 2; // y in [-1,1]
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      return {
        id: node.id,
        entity: node.entity,
        px: x,
        py: y,
        pz: z,
        r: SPHERE_RADIUS * (0.9 + Math.random() * 0.2),
        sx: 0,
        sy: 0,
        sz: 0,
        scale: 1,
      };
    });
    nodes3DRef.current = next;
  }, [nodes]);

  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(rect.width * dpr) || canvas.height !== Math.floor(rect.height * dpr)) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Subtle deep-space radial gradient for that "3D" feel.
    const grad = ctx.createRadialGradient(
      rect.width / 2,
      rect.height / 2,
      Math.min(rect.width, rect.height) * 0.15,
      rect.width / 2,
      rect.height / 2,
      Math.max(rect.width, rect.height) * 0.75,
    );
    grad.addColorStop(0, "rgba(125, 207, 255, 0.04)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, rect.width, rect.height);

    // ---- Update rotation.
    yawRef.current += autoYawSpeedRef.current + userYawVelRef.current;
    pitchRef.current += userPitchVelRef.current;
    pitchRef.current = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitchRef.current));
    // Decay user-imparted rotation so the graph eases back into auto-spin.
    userYawVelRef.current *= 0.92;
    userPitchVelRef.current *= 0.92;

    const yaw = yawRef.current;
    const pitch = pitchRef.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    // Camera at +Z looking toward origin. We'll add SPHERE_RADIUS*3 in world->camera Z.
    const cameraZ = SPHERE_RADIUS * 3;
    const cx = rect.width / 2 + panRef.current.x;
    const cyScreen = rect.height / 2 + panRef.current.y;
    const zoom = zoomRef.current;

    // ---- Project all nodes.
    const ns = nodes3DRef.current;
    for (const n of ns) {
      const wx = n.px * n.r;
      const wy = n.py * n.r;
      const wz = n.pz * n.r;
      // Yaw around Y axis.
      const x1 = wx * cy + wz * sy;
      const z1 = -wx * sy + wz * cy;
      const y1 = wy;
      // Pitch around X axis.
      const y2 = y1 * cp - z1 * sp;
      const z2 = y1 * sp + z1 * cp;
      const x2 = x1;

      const camZ = z2 + cameraZ;
      const k = (FOCAL / Math.max(camZ, 1)) * zoom;
      n.sx = cx + x2 * k;
      n.sy = cyScreen + y2 * k;
      n.sz = camZ;
      n.scale = k;
    }

    // ---- Painter's algorithm: draw far → near.
    const drawOrder = [...ns].sort((a, b) => b.sz - a.sz);

    // Edges first (under the nodes), with depth fade.
    const byId = new Map(ns.map(n => [n.id, n]));
    const eList = edgesRef.current;
    for (const e of eList) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const sel = selectedRef.current;
      const isHi = !!sel && (e.source === sel || e.target === sel);
      const avgDepth = (a.sz + b.sz) / 2;
      const depthT = clamp01((avgDepth - (cameraZ - SPHERE_RADIUS)) / (SPHERE_RADIUS * 2));
      const alpha = isHi ? 0.55 : 0.07 + (1 - depthT) * 0.13;
      ctx.strokeStyle = isHi
        ? `rgba(125, 207, 255, ${alpha.toFixed(3)})`
        : `rgba(148, 163, 184, ${alpha.toFixed(3)})`;
      ctx.lineWidth = isHi ? 1.4 : 0.7;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // Nodes + labels.
    for (const n of drawOrder) {
      const sel = selectedRef.current === n.id;
      const color = TYPE_COLORS[n.entity.type] || "#6b7280";
      const baseR = Math.min(6 + (n.entity.researchCount || 1) * 1.6, 16);
      const r = baseR * n.scale;
      const depthT = clamp01((n.sz - (cameraZ - SPHERE_RADIUS)) / (SPHERE_RADIUS * 2));
      const frontness = 1 - depthT; // 1 = nearest, 0 = farthest

      // Glow halo for selection or hover-front nodes.
      if (sel || frontness > 0.85) {
        const halo = ctx.createRadialGradient(n.sx, n.sy, r * 0.3, n.sx, n.sy, r * 3.2);
        halo.addColorStop(0, hexToRgba(color, sel ? 0.55 : 0.25));
        halo.addColorStop(1, hexToRgba(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sphere body with a fake highlight for 3D feel.
      const sphereGrad = ctx.createRadialGradient(
        n.sx - r * 0.4, n.sy - r * 0.5, r * 0.1,
        n.sx, n.sy, r,
      );
      const lit = mixHex(color, "#ffffff", 0.55);
      const dark = mixHex(color, "#000000", 0.45);
      const fadeAlpha = (0.35 + frontness * 0.65).toFixed(3);
      sphereGrad.addColorStop(0, hexToRgba(lit, +fadeAlpha));
      sphereGrad.addColorStop(0.55, hexToRgba(color, +fadeAlpha));
      sphereGrad.addColorStop(1, hexToRgba(dark, +fadeAlpha));
      ctx.fillStyle = sphereGrad;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.lineWidth = sel ? 1.5 : 0.6;
      ctx.strokeStyle = sel ? "#ffffff" : hexToRgba(color, 0.4 + frontness * 0.4);
      ctx.stroke();

      // Label — only readable for front-facing nodes; fade smoothly.
      const labelAlpha = sel ? 1 : Math.max(0, frontness - 0.2);
      if (labelAlpha > 0.05) {
        ctx.fillStyle = `rgba(226, 232, 240, ${labelAlpha.toFixed(3)})`;
        ctx.font = `${sel ? 600 : 500} ${Math.max(9, 11 * Math.min(1, n.scale))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(n.id, n.sx, n.sy + r + 12);
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ---- Picking
  const pickNode = (mx: number, my: number): Node3D | null => {
    const ns = nodes3DRef.current;
    // Iterate near→far so we hit the closest first.
    const sorted = [...ns].sort((a, b) => a.sz - b.sz);
    for (const n of sorted) {
      const baseR = Math.min(6 + (n.entity.researchCount || 1) * 1.6, 16);
      const r = baseR * n.scale + 4;
      const dx = n.sx - mx;
      const dy = n.sy - my;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  };

  // ---- Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = pickNode(mx, my);
    if (node) {
      dragRef.current = {
        mode: "node",
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        moved: false, nodeId: node.id, downAt: performance.now(),
      };
    } else {
      dragRef.current = {
        mode: e.shiftKey ? "pan" : "rotate",
        startX: e.clientX, startY: e.clientY,
        lastX: e.clientX, lastY: e.clientY,
        moved: false, nodeId: null, downAt: performance.now(),
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.mode === "rotate" || d.mode === "node") {
      // Even if a node was clicked, allow a drag to spin the world.
      if (d.mode === "node" && !d.moved) return;
      if (d.mode === "node") d.mode = "rotate";
      userYawVelRef.current = dx * 0.005;
      userPitchVelRef.current = -dy * 0.005;
      yawRef.current += dx * 0.005;
      pitchRef.current += -dy * 0.005;
    } else if (d.mode === "pan") {
      panRef.current.x += dx;
      panRef.current.y += dy;
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (d.mode === "node" && !d.moved && d.nodeId) {
      onSelectNode(d.nodeId === selectedNode ? null : d.nodeId);
    } else if (d.mode === "rotate" && !d.moved) {
      // Click on empty space deselects.
      onSelectNode(null);
    }
    dragRef.current.mode = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    zoomRef.current = Math.max(0.35, Math.min(3, zoomRef.current * delta));
  };

  // Pause auto-rotate on hover so users can read.
  const handleMouseEnter = () => { autoYawSpeedRef.current = 0.0008; };
  const handleMouseLeave = () => { autoYawSpeedRef.current = 0.0035; };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={(e) => { handleMouseUp(e); handleMouseLeave(); }}
      onMouseEnter={handleMouseEnter}
      onWheel={handleWheel}
      data-testid={testId}
    />
  );
}

// ---------- helpers ----------

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(m(pa[0], pb[0]))}${toHex(m(pa[1], pb[1]))}${toHex(m(pa[2], pb[2]))}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
