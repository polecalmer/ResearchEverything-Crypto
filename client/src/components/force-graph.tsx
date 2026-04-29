import { useEffect, useRef, useCallback, useState } from "react";

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
  protocol: "#5dd5ff",
  token: "#f5a25c",
  chain: "#9ee37d",
  person: "#b8a4ff",
  fund: "#ff8a8a",
  concept: "#c4cdf5",
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
  // world-space position (3D, allowed to drift via mild simulation)
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  // last screen-space projection
  sx: number;
  sy: number;
  sz: number; // depth in camera space (larger = farther)
  scale: number;
  baseR: number; // rendered radius before depth scaling
}

interface Particle3D {
  x: number;
  y: number;
  z: number;
  size: number; // base size in world units; depth-scaled at render
  hue: number;  // tiny color tint variation
  twinkle: number; // phase for subtle alpha modulation
  sx: number;
  sy: number;
  sz: number;
  scale: number;
}

// World-space cloud half-extents.
const CLOUD_R = 280;
const FOCAL = 720;
// How many ambient particles to scatter in the cloud (no semantic meaning).
const PARTICLE_COUNT = 220;

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

  const nodes3DRef = useRef<Node3D[]>([]);
  const particlesRef = useRef<Particle3D[]>([]);
  const edgesRef = useRef<GraphEdge[]>(edges);
  const selectedRef = useRef<string | null>(selectedNode);
  const hoveredRef = useRef<string | null>(null);

  // Camera / rotation.
  const yawRef = useRef(0);
  const pitchRef = useRef(-0.18);
  const autoYawSpeedRef = useRef(0.0022); // ~16s/rev
  const userYawVelRef = useRef(0);
  const userPitchVelRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  const dragRef = useRef<{
    mode: "rotate" | "pan" | "node" | null;
    startX: number; startY: number;
    lastX: number; lastY: number;
    moved: boolean;
    nodeId: string | null;
  }>({ mode: null, startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, nodeId: null });

  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // ---- Build / update node positions in volumetric 3D space.
  useEffect(() => {
    const n = nodes.length;
    const phi = Math.PI * (3 - Math.sqrt(5));
    const next: Node3D[] = nodes.map((node, i) => {
      const existing = nodes3DRef.current.find(e => e.id === node.id);
      const baseR = 2.5 + Math.min(node.entity.researchCount || 1, 12) * 0.9;
      if (existing) return { ...existing, entity: node.entity, baseR };
      // Distribute through a thick shell (volumetric, not surface).
      const yU = 1 - (i / Math.max(n - 1, 1)) * 2; // [-1,1]
      const rU = Math.sqrt(Math.max(0, 1 - yU * yU));
      const theta = phi * i;
      // Random radial position inside the cloud volume — gives that organic, deep look.
      const radius = CLOUD_R * (0.45 + Math.random() * 0.55);
      const x = Math.cos(theta) * rU * radius + (Math.random() - 0.5) * 25;
      const y = yU * radius + (Math.random() - 0.5) * 25;
      const z = Math.sin(theta) * rU * radius + (Math.random() - 0.5) * 25;
      return {
        id: node.id, entity: node.entity,
        x, y, z, vx: 0, vy: 0, vz: 0,
        sx: 0, sy: 0, sz: 0, scale: 1, baseR,
      };
    });
    nodes3DRef.current = next;
  }, [nodes]);

  // ---- Ambient particle field. Build once.
  useEffect(() => {
    if (particlesRef.current.length > 0) return;
    const ps: Particle3D[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Uniform-ish distribution inside a sphere of radius CLOUD_R.
      let x = 0, y = 0, z = 0, d2 = 2;
      while (d2 > 1) {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        d2 = x * x + y * y + z * z;
      }
      // Bias outward a bit so it looks like a cloud, not a ball.
      const r = CLOUD_R * Math.pow(Math.random(), 0.55) * 1.05;
      const len = Math.sqrt(d2) || 1;
      ps.push({
        x: (x / len) * r,
        y: (y / len) * r,
        z: (z / len) * r,
        size: 0.4 + Math.random() * 1.4,
        hue: Math.random(),
        twinkle: Math.random() * Math.PI * 2,
        sx: 0, sy: 0, sz: 0, scale: 1,
      });
    }
    particlesRef.current = ps;
  }, []);

  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);
  useEffect(() => { hoveredRef.current = hoveredNode; }, [hoveredNode]);

  // ---- Light 3D force simulation: keeps the cloud alive & spread.
  const stepSimulation = useCallback(() => {
    const ns = nodes3DRef.current;
    if (ns.length === 0) return;
    const alpha = 0.04;
    // Gentle damping
    for (const n of ns) { n.vx *= 0.85; n.vy *= 0.85; n.vz *= 0.85; }
    // Pairwise repulsion (3D)
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dx = ns[j].x - ns[i].x;
        const dy = ns[j].y - ns[i].y;
        const dz = ns[j].z - ns[i].z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const d = Math.sqrt(Math.max(d2, 1));
        const f = (2200 / Math.max(d2, 100)) * alpha;
        const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
        ns[i].vx -= fx; ns[i].vy -= fy; ns[i].vz -= fz;
        ns[j].vx += fx; ns[j].vy += fy; ns[j].vz += fz;
      }
    }
    // Edge springs
    const map = new Map(ns.map(n => [n.id, n]));
    for (const e of edgesRef.current) {
      const a = map.get(e.source); const b = map.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1);
      const f = (d - 160) * 0.02 * alpha;
      const fx = (dx / d) * f, fy = (dy / d) * f, fz = (dz / d) * f;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    }
    // Soft pull-back to keep things inside the cloud
    for (const n of ns) {
      const r = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z) || 1;
      if (r > CLOUD_R) {
        const k = ((r - CLOUD_R) / CLOUD_R) * 0.05;
        n.vx -= n.x * k; n.vy -= n.y * k; n.vz -= n.z * k;
      } else {
        const k = 0.0008;
        n.vx -= n.x * k; n.vy -= n.y * k; n.vz -= n.z * k;
      }
    }
    for (const n of ns) { n.x += n.vx; n.y += n.vy; n.z += n.vz; }
  }, []);

  const draw = useCallback((ts: number) => {
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

    // Background: deep nebula tone with vignette.
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, rect.width, rect.height);
    const vignette = ctx.createRadialGradient(
      rect.width / 2, rect.height / 2, Math.min(rect.width, rect.height) * 0.1,
      rect.width / 2, rect.height / 2, Math.max(rect.width, rect.height) * 0.7,
    );
    vignette.addColorStop(0, "rgba(60, 110, 200, 0.05)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, rect.width, rect.height);

    // ---- Rotation update.
    yawRef.current += autoYawSpeedRef.current + userYawVelRef.current;
    pitchRef.current += userPitchVelRef.current;
    pitchRef.current = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitchRef.current));
    userYawVelRef.current *= 0.92;
    userPitchVelRef.current *= 0.92;

    const yaw = yawRef.current, pitch = pitchRef.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const cameraZ = CLOUD_R * 2.6;
    const cx = rect.width / 2 + panRef.current.x;
    const cyScreen = rect.height / 2 + panRef.current.y;
    const zoom = zoomRef.current;

    const project = (wx: number, wy: number, wz: number) => {
      const x1 = wx * cy + wz * sy;
      const z1 = -wx * sy + wz * cy;
      const y1 = wy;
      const y2 = y1 * cp - z1 * sp;
      const z2 = y1 * sp + z1 * cp;
      const camZ = z2 + cameraZ;
      const k = (FOCAL / Math.max(camZ, 1)) * zoom;
      return { x: cx + x1 * k, y: cyScreen + y2 * k, z: camZ, k };
    };

    stepSimulation();

    // ---- Project entities + particles.
    const ns = nodes3DRef.current;
    for (const n of ns) {
      const p = project(n.x, n.y, n.z);
      n.sx = p.x; n.sy = p.y; n.sz = p.z; n.scale = p.k;
    }
    const ps = particlesRef.current;
    for (const part of ps) {
      const p = project(part.x, part.y, part.z);
      part.sx = p.x; part.sy = p.y; part.sz = p.z; part.scale = p.k;
    }

    const depthRange = CLOUD_R * 2.2;
    const minZ = cameraZ - CLOUD_R;

    // ---- Draw far-side particles.
    const partOrder = ps.slice().sort((a, b) => b.sz - a.sz);
    const tWave = ts * 0.0008;
    for (const part of partOrder) {
      const depthT = clamp01((part.sz - minZ) / depthRange);
      const front = 1 - depthT;
      const r = Math.max(0.4, part.size * part.scale * (0.5 + front * 1.2));
      const baseAlpha = (0.18 + front * 0.55) * (0.7 + 0.3 * Math.sin(tWave + part.twinkle));
      // Cool blue/cyan/violet palette, very faint.
      const tint = pickParticleTint(part.hue);
      ctx.fillStyle = hexToRgba(tint, baseAlpha * 0.85);
      ctx.beginPath();
      ctx.arc(part.sx, part.sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // ---- Edges (under nodes) — very thin, very faint.
    const byId = new Map(ns.map(n => [n.id, n]));
    const sel = selectedRef.current;
    const hov = hoveredRef.current;
    const focus = sel || hov;
    for (const e of edgesRef.current) {
      const a = byId.get(e.source); const b = byId.get(e.target);
      if (!a || !b) continue;
      const isHi = !!focus && (e.source === focus || e.target === focus);
      const avgZ = (a.sz + b.sz) / 2;
      const depthT = clamp01((avgZ - minZ) / depthRange);
      const alpha = isHi ? 0.55 : 0.04 + (1 - depthT) * 0.07;
      ctx.strokeStyle = isHi
        ? `rgba(125, 207, 255, ${alpha.toFixed(3)})`
        : `rgba(170, 190, 230, ${alpha.toFixed(3)})`;
      ctx.lineWidth = isHi ? 1.2 : 0.5;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }

    // ---- Entity nodes (painter's: far → near).
    const drawOrder = ns.slice().sort((a, b) => b.sz - a.sz);
    for (const n of drawOrder) {
      const isSel = sel === n.id;
      const isHov = hov === n.id;
      const color = TYPE_COLORS[n.entity.type] || "#9aa6c2";
      const depthT = clamp01((n.sz - minZ) / depthRange);
      const front = 1 - depthT;
      const r = Math.max(1.2, n.baseR * n.scale * (0.6 + front * 0.9));

      // Soft outer bloom — what gives the "cosmic dot" look.
      const bloomR = r * (isSel ? 6 : isHov ? 5 : 3.5);
      const bloomA = (isSel ? 0.7 : isHov ? 0.55 : 0.3) * (0.4 + front * 0.6);
      const bloom = ctx.createRadialGradient(n.sx, n.sy, r * 0.2, n.sx, n.sy, bloomR);
      bloom.addColorStop(0, hexToRgba(color, bloomA));
      bloom.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, bloomR, 0, Math.PI * 2);
      ctx.fill();

      // Bright core dot — flat, slightly desaturated by depth.
      const coreA = (isSel || isHov) ? 1 : 0.65 + front * 0.35;
      ctx.fillStyle = hexToRgba(color, coreA);
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, r, 0, Math.PI * 2);
      ctx.fill();

      // Tiny specular highlight on near-side nodes for life. Uses light
      // (white) in dark mode to brighten the node, dark (near-black) in
      // light mode to deepen the node — both produce the "rim of life"
      // visual against their respective backgrounds.
      if (front > 0.6) {
        const isDark = document.documentElement.classList.contains("dark");
        const rgb = isDark ? "255, 255, 255" : "0, 0, 0";
        ctx.fillStyle = `rgba(${rgb}, ${(0.35 * (front - 0.6) / 0.4).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(n.sx - r * 0.3, n.sy - r * 0.35, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels: only show on selection or hover, plus the largest hubs on the front side.
      const isHub = n.baseR >= 6;
      if (isSel || isHov || (isHub && front > 0.7)) {
        const labelA = isSel ? 1 : isHov ? 0.95 : Math.max(0, (front - 0.7) / 0.3) * 0.7;
        ctx.fillStyle = `rgba(230, 236, 248, ${labelA.toFixed(3)})`;
        ctx.font = `${isSel || isHov ? 600 : 500} ${Math.max(10, 12 * Math.min(1, n.scale))}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(n.id, n.sx, n.sy + r + 12);
      }
    }

    animRef.current = requestAnimationFrame(draw);
  }, [stepSimulation]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  // ---- Picking
  const pickNode = (mx: number, my: number): Node3D | null => {
    const ns = nodes3DRef.current.slice().sort((a, b) => a.sz - b.sz);
    for (const n of ns) {
      const r = Math.max(1.2, n.baseR * n.scale) + 6;
      const dx = n.sx - mx, dy = n.sy - my;
      if (dx * dx + dy * dy < r * r) return n;
    }
    return null;
  };

  // ---- Mouse
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const node = pickNode(mx, my);
    dragRef.current = {
      mode: node ? "node" : (e.shiftKey ? "pan" : "rotate"),
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
      moved: false, nodeId: node?.id ?? null,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (d.mode) {
      const dx = e.clientX - d.lastX, dy = e.clientY - d.lastY;
      if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
      d.lastX = e.clientX; d.lastY = e.clientY;
      if (d.mode === "rotate" || (d.mode === "node" && d.moved)) {
        if (d.mode === "node") d.mode = "rotate";
        userYawVelRef.current = dx * 0.005;
        userPitchVelRef.current = -dy * 0.005;
        yawRef.current += dx * 0.005;
        pitchRef.current += -dy * 0.005;
      } else if (d.mode === "pan") {
        panRef.current.x += dx;
        panRef.current.y += dy;
      }
      return;
    }
    // Hover detection (no-drag move).
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const node = pickNode(e.clientX - rect.left, e.clientY - rect.top);
    const id = node?.id ?? null;
    if (id !== hoveredRef.current) setHoveredNode(id);
  };

  const handleMouseUp = () => {
    const d = dragRef.current;
    if (d.mode === "node" && !d.moved && d.nodeId) {
      onSelectNode(d.nodeId === selectedNode ? null : d.nodeId);
    } else if (d.mode === "rotate" && !d.moved) {
      onSelectNode(null);
    }
    dragRef.current.mode = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    zoomRef.current = Math.max(0.35, Math.min(3, zoomRef.current * delta));
  };

  const handleMouseEnter = () => { autoYawSpeedRef.current = 0.0006; };
  const handleMouseLeave = () => {
    autoYawSpeedRef.current = 0.0022;
    setHoveredNode(null);
    handleMouseUp();
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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

const PARTICLE_TINTS = ["#7dd3fc", "#a5b4fc", "#c4b5fd", "#bfdbfe", "#93c5fd", "#e0e7ff"];
function pickParticleTint(t: number): string {
  return PARTICLE_TINTS[Math.floor(t * PARTICLE_TINTS.length) % PARTICLE_TINTS.length];
}
