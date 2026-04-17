import { Button } from "@/components/ui/button";
import { ArrowRight, Brain } from "lucide-react";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { usePrivy } from "@privy-io/react-auth";
import sessionsLogo from "@assets/sessions_logo.png";

const TYPE_COLORS: Record<string, string> = {
  protocol: "#7aa2f7",
  token: "#f7c97a",
  chain: "#bb9af7",
  person: "#f7768e",
  fund: "#9ece6a",
  concept: "#7dcfff",
  metric: "#c0caf5",
};

const TYPE_LABELS: Record<string, string> = {
  protocol: "Protocols",
  token: "Tokens",
  chain: "Chains",
  person: "People",
  fund: "Funds",
  concept: "Concepts",
  metric: "Metrics",
};

const TYPE_ORDER = ["protocol", "token", "chain", "concept", "fund", "person", "metric"];

interface AggNode {
  id: string; label?: string; type: string; count: number;
  x: number; y: number; vx: number; vy: number; named: boolean;
}
interface AggEdge { from: string; to: string; weight: number; }

function FlowField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const PALETTE = ["#7dcfff", "#bb9af7", "#f7768e"];
    const PARTICLES = 420;

    type P = { x: number; y: number; px: number; py: number; age: number; maxAge: number; color: string; speed: number };
    let particles: P[] = [];
    let w = 0, h = 0, t = 0;
    let dpr = 1;

    function noise(x: number, y: number, time: number): number {
      const tt = time * 0.0006;
      const a = Math.sin(x * 0.0028 + tt * 0.9) * Math.cos(y * 0.0024 - tt * 0.7);
      const b = Math.cos(x * 0.0017 - tt * 1.1) * Math.sin(y * 0.0021 + tt * 0.6);
      const c = Math.sin((x + y) * 0.0014 + tt * 1.4);
      return (a + b + c * 0.6) / 2.6;
    }

    function spawn(p: P, randomAge = false) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.pow(Math.random(), 0.6) * Math.min(w, h) * 0.55;
      p.x = w / 2 + Math.cos(angle) * r;
      p.y = h / 2 + Math.sin(angle) * r * 0.7;
      p.px = p.x;
      p.py = p.y;
      p.maxAge = 220 + Math.random() * 380;
      p.age = randomAge ? Math.random() * p.maxAge : 0;
      p.color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      p.speed = 0.45 + Math.random() * 0.9;
    }

    function init() {
      const rect = canvas!.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      w = rect.width;
      h = rect.height;

      ctx!.fillStyle = "#0a0a0c";
      ctx!.fillRect(0, 0, w, h);

      particles = [];
      for (let i = 0; i < PARTICLES; i++) {
        const p = {} as P;
        spawn(p, true);
        particles.push(p);
      }
    }

    function draw() {
      t++;

      ctx!.fillStyle = "rgba(10, 10, 12, 0.035)";
      ctx!.fillRect(0, 0, w, h);

      for (const p of particles) {
        const n = noise(p.x, p.y, t);
        const angle = n * Math.PI * 2;

        p.px = p.x;
        p.py = p.y;
        p.x += Math.cos(angle) * p.speed;
        p.y += Math.sin(angle) * p.speed;
        p.age++;

        const lifeT = p.age / p.maxAge;
        const alpha = lifeT < 0.12 ? lifeT / 0.12 : lifeT > 0.75 ? Math.max(0, (1 - lifeT) / 0.25) : 1;

        ctx!.beginPath();
        ctx!.moveTo(p.px, p.py);
        ctx!.lineTo(p.x, p.y);
        ctx!.strokeStyle = p.color + toHex2(alpha * 0.55);
        ctx!.lineWidth = 0.7;
        ctx!.stroke();

        if (p.age > p.maxAge || p.x < -80 || p.x > w + 80 || p.y < -80 || p.y > h + 80) {
          spawn(p);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    init();
    animRef.current = requestAnimationFrame(draw);

    const onResize = () => init();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-screen h-screen block pointer-events-none"
      style={{ zIndex: 0 }}
      data-testid="canvas-flow"
    />
  );
}

// legacy SynapseField (kept as no-op so older HMR snapshots don't error)

function BrainGraphHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<AggNode[]>([]);
  const animRef = useRef<number>(0);
  const hoverRef = useRef<string | null>(null);
  const rotationRef = useRef(0);
  const tRef = useRef(0);

  const graph = useMemo(() => buildBigDemoGraph(), []);
  const namedCount = useMemo(() => graph.nodes.filter(n => n.named).length, [graph.nodes]);

  useEffect(() => {
    nodesRef.current = graph.nodes.map((n) => {
      const typeIdx = TYPE_ORDER.indexOf(n.type);
      const baseAngle = (typeIdx / TYPE_ORDER.length) * Math.PI * 2;
      const spread = (Math.PI * 2) / TYPE_ORDER.length;
      const angle = baseAngle + (Math.random() - 0.5) * spread * 1.4;
      const r = n.named ? 80 + Math.random() * 160 : 180 + Math.random() * 280;
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
    });
  }, [graph.nodes]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const ns = nodesRef.current;
    const alpha = 0.14;
    const map = new Map(ns.map(n => [n.id, n]));

    for (const n of ns) { n.vx *= 0.88; n.vy *= 0.88; }
    for (let i = 0; i < ns.length; i++) {
      const ni = ns[i];
      for (let j = i + 1; j < ns.length; j++) {
        const nj = ns[j];
        const dx = nj.x - ni.x;
        const dy = nj.y - ni.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 40000) continue;
        const d = Math.max(Math.sqrt(d2), 1);
        const force = (700 / (d * d)) * alpha;
        const fx = (dx / d) * force, fy = (dy / d) * force;
        ni.vx -= fx; ni.vy -= fy;
        nj.vx += fx; nj.vy += fy;
      }
    }
    for (const edge of graph.edges) {
      const s = map.get(edge.from), t = map.get(edge.to);
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const target = s.named && t.named ? 130 : 70;
      const force = (d - target) * 0.025 * alpha;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }
    for (const n of ns) {
      const k = n.named ? 0.0010 : 0.0006;
      n.vx -= n.x * k * alpha;
      n.vy -= n.y * k * alpha;
      n.x += n.vx; n.y += n.vy;
    }

    tRef.current += 1;
    rotationRef.current += 0.0006;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const cosR = Math.cos(rotationRef.current), sinR = Math.sin(rotationRef.current);

    ctx.save();
    ctx.translate(cx, cy);

    const hover = hoverRef.current;
    const hoverNeighbors = new Set<string>();
    if (hover) {
      hoverNeighbors.add(hover);
      for (const e of graph.edges) {
        if (e.from === hover) hoverNeighbors.add(e.to);
        else if (e.to === hover) hoverNeighbors.add(e.from);
      }
    }

    ctx.lineCap = "round";
    for (const edge of graph.edges) {
      const s = map.get(edge.from), t = map.get(edge.to);
      if (!s || !t) continue;
      const sx = s.x * cosR - s.y * sinR, sy = s.x * sinR + s.y * cosR;
      const tx = t.x * cosR - t.y * sinR, ty = t.x * sinR + t.y * cosR;
      const isHover = hover && (edge.from === hover || edge.to === hover);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      if (isHover) {
        ctx.strokeStyle = "rgba(125, 207, 255, 0.55)";
        ctx.lineWidth = 1.2;
      } else {
        const a = Math.min(0.05 + edge.weight * 0.012, 0.12);
        ctx.strokeStyle = `rgba(140, 160, 210, ${hover ? a * 0.4 : a})`;
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();
    }

    const sorted = [...ns].sort((a, b) => (a.named === b.named ? 0 : a.named ? 1 : -1));
    for (const n of sorted) {
      const x = n.x * cosR - n.y * sinR;
      const y = n.x * sinR + n.y * cosR;
      const color = TYPE_COLORS[n.type] || "#6b7280";
      const pulse = n.named ? 0.5 + 0.5 * Math.sin(tRef.current * 0.02 + n.x * 0.01) : 0;
      const r = n.named ? Math.min(3 + Math.sqrt(n.count) * 1.6, 8) : 1.2 + Math.random() * 0.3;
      const isHover = hover === n.id;
      const isNeighbor = hoverNeighbors.has(n.id);
      const dimmed = hover && !isNeighbor;

      if (n.named) {
        const glowR = (isHover ? r * 4.5 : r * 3) + pulse * 1.2;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        const a = isHover ? 0.45 : dimmed ? 0.04 : 0.18;
        grad.addColorStop(0, `${color}${toHex2(a)}`);
        grad.addColorStop(1, `${color}00`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, isHover ? r + 1.5 : r, 0, Math.PI * 2);
      const coreA = dimmed ? 0.3 : 1;
      ctx.fillStyle = isHover ? color : `${color}${toHex2(coreA * (n.named ? 0.85 : 0.55))}`;
      ctx.fill();

      if (isHover && n.named) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(n.label || n.id, x, y - r - 10);
      }
    }
    ctx.restore();

    animRef.current = requestAnimationFrame(draw);
  }, [graph.edges, graph.nodes]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const handleMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const cosR = Math.cos(-rotationRef.current), sinR = Math.sin(-rotationRef.current);
    const lx = mx * cosR - my * sinR;
    const ly = mx * sinR + my * cosR;
    let found: string | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (!n.named) continue;
      const dx = n.x - lx, dy = n.y - ly;
      const d = dx * dx + dy * dy;
      const r = Math.min(3 + Math.sqrt(n.count) * 1.6, 8);
      if (d < (r + 8) * (r + 8) && d < bestD) { bestD = d; found = n.id; }
    }
    if (found !== hoverRef.current) hoverRef.current = found;
  };

  const types = TYPE_ORDER;

  return (
    <div className="relative w-full" style={{ height: "720px" }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseMove={handleMove}
        onMouseLeave={() => { hoverRef.current = null; }}
        data-testid="canvas-landing-brain"
      />

      <div className="absolute top-4 left-4 font-mono text-[10px] tracking-wider text-muted-foreground/70 select-none">
        <div className="mb-2 text-muted-foreground/50">DISCIPLINES</div>
        <div className="space-y-1">
          {types.map(t => (
            <div key={t} className="flex items-center gap-2" data-testid={`legend-${t}`}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] || "#6b7280", boxShadow: `0 0 6px ${TYPE_COLORS[t]}` }} />
              <span>{TYPE_LABELS[t] || t}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border/30 text-muted-foreground/40">
          <div>{namedCount} ENTITIES</div>
          <div>{graph.edges.length} CONNECTIONS</div>
        </div>
      </div>

      <div className="absolute top-4 right-4 font-mono text-[10px] tracking-wider text-muted-foreground/50 select-none">
        THE COLLECTIVE BRAIN
      </div>

      <div className="absolute bottom-4 right-4 font-mono text-[9px] tracking-wider text-muted-foreground/30 select-none">
        ◐ HOVER NODES
      </div>

      <div className="pointer-events-none absolute inset-0" style={{
        background: "radial-gradient(ellipse 70% 60% at center, transparent 0%, transparent 55%, hsl(var(--background)) 100%)",
      }} />
    </div>
  );
}

function toHex2(a: number): string {
  const v = Math.max(0, Math.min(255, Math.round(a * 255)));
  return v.toString(16).padStart(2, "0");
}

function buildBigDemoGraph(): { nodes: AggNode[]; edges: AggEdge[] } {
  const named: Array<{ id: string; type: string; count: number; label?: string }> = [
    { id: "Hyperliquid", type: "protocol", count: 24 },
    { id: "Ethena", type: "protocol", count: 22 },
    { id: "MakerDAO", type: "protocol", count: 19 },
    { id: "Aave", type: "protocol", count: 18 },
    { id: "Uniswap", type: "protocol", count: 17 },
    { id: "Lido", type: "protocol", count: 16 },
    { id: "GMX", type: "protocol", count: 13 },
    { id: "dYdX", type: "protocol", count: 12 },
    { id: "Pendle", type: "protocol", count: 14 },
    { id: "Curve", type: "protocol", count: 11 },
    { id: "Aerodrome", type: "protocol", count: 12 },
    { id: "Jupiter", type: "protocol", count: 13 },
    { id: "Pump.fun", type: "protocol", count: 11 },
    { id: "EigenLayer", type: "protocol", count: 15 },
    { id: "Symbiotic", type: "protocol", count: 9 },
    { id: "Morpho", type: "protocol", count: 10 },
    { id: "Spark", type: "protocol", count: 9 },
    { id: "Frax", type: "protocol", count: 10 },
    { id: "Convex", type: "protocol", count: 8 },
    { id: "Sky", type: "protocol", count: 8 },
    { id: "Drift", type: "protocol", count: 8 },
    { id: "Maple", type: "protocol", count: 7 },
    { id: "Ondo", type: "protocol", count: 9 },
    { id: "Pyth", type: "protocol", count: 9 },
    { id: "Chainlink", type: "protocol", count: 13 },
    { id: "HYPE", type: "token", count: 19 },
    { id: "ENA", type: "token", count: 17 },
    { id: "USDe", type: "token", count: 15 },
    { id: "MKR", type: "token", count: 13 },
    { id: "ETH", type: "token", count: 24 },
    { id: "BTC", type: "token", count: 22 },
    { id: "SOL", type: "token", count: 18 },
    { id: "PUMP", type: "token", count: 11 },
    { id: "AERO", type: "token", count: 10 },
    { id: "JUP", type: "token", count: 10 },
    { id: "EIGEN", type: "token", count: 12 },
    { id: "PENDLE", type: "token", count: 11 },
    { id: "FXS", type: "token", count: 8 },
    { id: "CRV", type: "token", count: 9 },
    { id: "AAVE", type: "token", count: 12 },
    { id: "UNI", type: "token", count: 11 },
    { id: "LDO", type: "token", count: 10 },
    { id: "ONDO", type: "token", count: 9 },
    { id: "SYRUP", type: "token", count: 7 },
    { id: "USDC", type: "token", count: 16 },
    { id: "USDT", type: "token", count: 15 },
    { id: "Ethereum", type: "chain", count: 28 },
    { id: "Solana", type: "chain", count: 22 },
    { id: "Base", type: "chain", count: 16 },
    { id: "Arbitrum", type: "chain", count: 15 },
    { id: "Optimism", type: "chain", count: 12 },
    { id: "Hyperliquid L1", type: "chain", count: 12 },
    { id: "Berachain", type: "chain", count: 10 },
    { id: "Monad", type: "chain", count: 9 },
    { id: "Sui", type: "chain", count: 10 },
    { id: "BNB Chain", type: "chain", count: 11 },
    { id: "Paradigm", type: "fund", count: 14 },
    { id: "Multicoin", type: "fund", count: 11 },
    { id: "a16z Crypto", type: "fund", count: 13 },
    { id: "Pantera", type: "fund", count: 10 },
    { id: "Polychain", type: "fund", count: 10 },
    { id: "Variant", type: "fund", count: 8 },
    { id: "Dragonfly", type: "fund", count: 9 },
    { id: "Vitalik Buterin", type: "person", count: 14 },
    { id: "Hayden Adams", type: "person", count: 8 },
    { id: "Andre Cronje", type: "person", count: 7 },
    { id: "Sam Kazemian", type: "person", count: 6 },
    { id: "Toly", type: "person", count: 8 },
    { id: "Real Yield", type: "concept", count: 14 },
    { id: "DCF Valuation", type: "concept", count: 12 },
    { id: "P/E Ratio", type: "concept", count: 11 },
    { id: "Buybacks", type: "concept", count: 11 },
    { id: "Restaking", type: "concept", count: 14 },
    { id: "Liquid Staking", type: "concept", count: 12 },
    { id: "Perp DEX", type: "concept", count: 13 },
    { id: "Stablecoin Yield", type: "concept", count: 11 },
    { id: "Basis Trade", type: "concept", count: 9 },
    { id: "RWA", type: "concept", count: 10 },
    { id: "MEV", type: "concept", count: 11 },
    { id: "AMM", type: "concept", count: 10 },
    { id: "ve-Tokenomics", type: "concept", count: 8 },
    { id: "Memecoin Cycle", type: "concept", count: 9 },
    { id: "Funding Rate", type: "metric", count: 8 },
    { id: "TVL", type: "metric", count: 12 },
    { id: "Open Interest", type: "metric", count: 9 },
    { id: "Daily Volume", type: "metric", count: 10 },
    { id: "Token Velocity", type: "metric", count: 7 },
    { id: "Active Addresses", type: "metric", count: 8 },
  ];

  const namedNodes: AggNode[] = named.map(n => ({
    id: n.id, type: n.type, count: n.count, label: n.id,
    x: 0, y: 0, vx: 0, vy: 0, named: true,
  }));

  const edges: AggEdge[] = [];
  const E = (from: string, to: string, weight = 3) => edges.push({ from, to, weight });

  E("Hyperliquid", "HYPE", 5); E("Hyperliquid", "Hyperliquid L1", 5); E("Hyperliquid", "Perp DEX", 5);
  E("Hyperliquid", "Funding Rate", 4); E("Hyperliquid", "Open Interest", 4);
  E("Ethena", "ENA", 5); E("Ethena", "USDe", 5); E("Ethena", "Stablecoin Yield", 5);
  E("Ethena", "Basis Trade", 5); E("Ethena", "Funding Rate", 4);
  E("MakerDAO", "MKR", 5); E("MakerDAO", "Sky", 4); E("MakerDAO", "RWA", 4); E("MakerDAO", "Real Yield", 3);
  E("Aave", "AAVE", 5); E("Aave", "Ethereum", 4); E("Aave", "Real Yield", 3); E("Aave", "TVL", 3);
  E("Uniswap", "UNI", 5); E("Uniswap", "Ethereum", 4); E("Uniswap", "Hayden Adams", 4); E("Uniswap", "AMM", 5);
  E("Lido", "LDO", 5); E("Lido", "Liquid Staking", 5); E("Lido", "ETH", 4);
  E("GMX", "Perp DEX", 4); E("GMX", "Arbitrum", 4); E("GMX", "Real Yield", 3);
  E("dYdX", "Perp DEX", 4);
  E("Pendle", "PENDLE", 5); E("Pendle", "Stablecoin Yield", 4); E("Pendle", "Real Yield", 4);
  E("Curve", "CRV", 5); E("Curve", "ve-Tokenomics", 5); E("Curve", "Convex", 4); E("Convex", "CRV", 3);
  E("Aerodrome", "AERO", 5); E("Aerodrome", "Base", 4); E("Aerodrome", "ve-Tokenomics", 4);
  E("Jupiter", "JUP", 5); E("Jupiter", "Solana", 4); E("Jupiter", "AMM", 3);
  E("Pump.fun", "PUMP", 5); E("Pump.fun", "Solana", 4); E("Pump.fun", "Memecoin Cycle", 5);
  E("EigenLayer", "EIGEN", 5); E("EigenLayer", "Restaking", 5); E("EigenLayer", "ETH", 4);
  E("Symbiotic", "Restaking", 4);
  E("Morpho", "Aave", 3); E("Morpho", "Real Yield", 3);
  E("Spark", "Sky", 4); E("Spark", "Stablecoin Yield", 3);
  E("Frax", "FXS", 5); E("Frax", "Sam Kazemian", 4); E("Frax", "Stablecoin Yield", 3);
  E("Drift", "Solana", 4); E("Drift", "Perp DEX", 4);
  E("Maple", "SYRUP", 4); E("Maple", "RWA", 3);
  E("Ondo", "ONDO", 5); E("Ondo", "RWA", 5);
  E("Pyth", "Solana", 3); E("Pyth", "Chainlink", 3);
  E("Chainlink", "Ethereum", 3);
  E("Ethereum", "ETH", 5); E("Solana", "SOL", 5);
  E("Base", "Ethereum", 5); E("Arbitrum", "Ethereum", 5); E("Optimism", "Ethereum", 5);
  E("Berachain", "Ethereum", 2); E("Monad", "Ethereum", 2); E("Sui", "Solana", 2);
  E("Vitalik Buterin", "Ethereum", 5); E("Toly", "Solana", 5); E("Andre Cronje", "Real Yield", 4);
  E("Paradigm", "Uniswap", 4); E("Paradigm", "Hyperliquid", 4); E("Paradigm", "EigenLayer", 4);
  E("Multicoin", "Solana", 4); E("Multicoin", "Jupiter", 3);
  E("a16z Crypto", "Aave", 3); E("a16z Crypto", "Uniswap", 3); E("a16z Crypto", "Lido", 3);
  E("Pantera", "Hyperliquid", 3); E("Polychain", "Berachain", 3); E("Variant", "Pump.fun", 3); E("Dragonfly", "Monad", 3);
  E("Restaking", "Liquid Staking", 4); E("Restaking", "ETH", 3); E("Liquid Staking", "ETH", 3);
  E("DCF Valuation", "P/E Ratio", 4); E("DCF Valuation", "Real Yield", 3); E("DCF Valuation", "Buybacks", 3);
  E("P/E Ratio", "Hyperliquid", 3); E("Buybacks", "Hyperliquid", 3); E("Buybacks", "Ethena", 3);
  E("Stablecoin Yield", "Real Yield", 4); E("Stablecoin Yield", "USDe", 3);
  E("USDC", "Ethereum", 3); E("USDT", "Ethereum", 3); E("USDC", "Solana", 2); E("USDT", "Solana", 2);
  E("BTC", "Ethereum", 2); E("BNB Chain", "BTC", 2);
  E("MEV", "Ethereum", 4); E("MEV", "Solana", 3);
  E("TVL", "Aave", 3); E("TVL", "Lido", 3); E("TVL", "MakerDAO", 3);
  E("Daily Volume", "Hyperliquid", 3); E("Daily Volume", "Uniswap", 3);
  E("Active Addresses", "Solana", 3); E("Active Addresses", "Base", 3);
  E("Token Velocity", "Memecoin Cycle", 3);
  E("Funding Rate", "Perp DEX", 4); E("Open Interest", "Perp DEX", 4);
  E("Basis Trade", "Funding Rate", 4); E("Basis Trade", "Perp DEX", 3);
  E("AMM", "Curve", 3); E("AMM", "Aerodrome", 3);
  E("RWA", "Real Yield", 4); E("ve-Tokenomics", "CRV", 3);

  const allNodes: AggNode[] = [...namedNodes];
  let satIdx = 0;
  for (const parent of namedNodes) {
    const fanout = parent.named && parent.count > 14 ? 5 : parent.count > 10 ? 3 : 2;
    for (let k = 0; k < fanout; k++) {
      const id = `__s${satIdx++}`;
      allNodes.push({
        id, type: parent.type, count: 1,
        x: 0, y: 0, vx: 0, vy: 0, named: false,
      });
      edges.push({ from: parent.id, to: id, weight: 1 });
    }
  }

  const protocols = namedNodes.filter(n => n.type === "protocol");
  const tokens = namedNodes.filter(n => n.type === "token");
  for (let i = 0; i < 20; i++) {
    const a = protocols[Math.floor(Math.random() * protocols.length)];
    const b = tokens[Math.floor(Math.random() * tokens.length)];
    if (a && b && a.id !== b.id) edges.push({ from: a.id, to: b.id, weight: 1 });
  }

  return { nodes: allNodes, edges };
}

function TypingDemo() {
  const inputs = [
    "What's Hyperliquid's real P/E ratio?",
    "Compare Ethena vs Maker revenue models",
    "Build a DCF model for PUMP token",
    "hyperliquid.xyz",
    "Show me protocol revenue vs token buybacks",
  ];
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pause" | "clearing">("typing");

  const current = inputs[idx];

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (charIdx < current.length) {
        timer = setTimeout(() => setCharIdx((c) => c + 1), 38 + Math.random() * 30);
      } else {
        timer = setTimeout(() => setPhase("pause"), 2200);
      }
    } else if (phase === "pause") {
      timer = setTimeout(() => setPhase("clearing"), 100);
    } else {
      if (charIdx > 0) {
        timer = setTimeout(() => setCharIdx((c) => c - 1), 15);
      } else {
        setIdx((i) => (i + 1) % inputs.length);
        setPhase("typing");
      }
    }
    return () => clearTimeout(timer);
  }, [charIdx, phase, current.length]);

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-4 py-3 max-w-md">
      <div className="flex items-center gap-2">
        <Brain className="w-3.5 h-3.5 text-muted-foreground/40" />
        <div className="font-mono text-sm">
          <span className="text-foreground">{current.slice(0, charIdx)}</span>
          <span className="inline-block w-[2px] h-[14px] bg-foreground animate-pulse ml-[1px] align-middle" />
        </div>
      </div>
    </div>
  );
}


export default function LandingPage() {
  const { login } = usePrivy();

  return (
    <div className="relative min-h-screen bg-background overflow-x-hidden" data-testid="landing-page">
      <FlowField />

      {/* Soft global vignette over the canvas to keep edges readable */}
      <div className="fixed inset-0 pointer-events-none" style={{
        zIndex: 1,
        background: "radial-gradient(ellipse 70% 60% at 50% 40%, transparent 0%, hsl(var(--background) / 0.55) 70%, hsl(var(--background) / 0.85) 100%)",
      }} />

      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md bg-background/40">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={sessionsLogo} alt="Sessions" className="w-5 h-5 object-contain" />
            <span className="text-sm font-semibold tracking-tight">Sessions</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground hover:text-foreground" onClick={() => login()} data-testid="button-nav-login">Sign in</Button>
            <Button size="sm" className="text-xs h-7" onClick={() => login()} data-testid="button-nav-signup">Get started</Button>
          </div>
        </div>
      </nav>

      <main className="relative" style={{ zIndex: 10 }}>
        {/* 01 — Hero: split, huge left headline, right column with demo + CTA */}
        <section className="min-h-[88vh] flex items-center px-8 lg:px-16 py-24">
          <div className="w-full max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
            <div className="lg:col-span-7">
              <div className="font-mono text-[10px] tracking-[0.32em] text-muted-foreground/60 mb-6">
                01 &nbsp;/&nbsp; SESSIONS
              </div>
              <h1 className="text-5xl sm:text-6xl lg:text-[88px] font-bold tracking-tight leading-[0.96] mb-6 whitespace-nowrap">
                Research that<br />
                <span className="text-muted-foreground/75">learns with you.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                An AI research platform for crypto. Run deep analysis, build
                financial models, generate reports, and have conversations with
                AI that remembers your work.
              </p>
            </div>
            <div className="lg:col-span-5 flex flex-col items-start lg:items-end gap-5">
              <TypingDemo />
              <div className="flex items-center gap-2">
                <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                  Start a session
                  <ArrowRight className="w-4 h-4" />
                </Button>
                <a href="#thesis">
                  <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                    Learn more
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* 02 — Thesis: section number in margin, headline left */}
        <section id="thesis" className="py-32 px-8 lg:px-16">
          <div className="w-full max-w-[1440px] mx-auto grid grid-cols-12 gap-10">
            <div className="hidden lg:block lg:col-span-2 font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 pt-3">
              02 / THESIS
            </div>
            <div className="col-span-12 lg:col-span-9">
              <div className="lg:hidden font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 mb-4">02 / THESIS</div>
              <h2 className="text-5xl sm:text-6xl lg:text-[88px] font-bold tracking-tight leading-[0.96] mb-6">
                AI is great.<br />
                <span className="text-muted-foreground/75">It lacks perspective.</span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                Sessions is the perspective layer for AI — your context, your
                questions, your judgment, compounding on top of every model
                you call.
              </p>
            </div>
          </div>
        </section>

        {/* 03 — Signal: mirrored right */}
        <section className="py-32 px-8 lg:px-16">
          <div className="w-full max-w-[1440px] mx-auto grid grid-cols-12 gap-10">
            <div className="col-span-12 lg:col-span-9 lg:col-start-3 lg:text-right">
              <div className="font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 mb-4">
                03 / SIGNAL
              </div>
              <h2 className="text-5xl sm:text-6xl lg:text-[88px] font-bold tracking-tight leading-[0.96] mb-6">
                Every session<br />leaves a trace.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl lg:ml-auto">
                Knowledge doesn't disappear at logout. It compounds, connects,
                and waits for the next question.
              </p>
            </div>
          </div>
        </section>

        {/* 04 — Compound: left again */}
        <section className="py-32 px-8 lg:px-16">
          <div className="w-full max-w-[1440px] mx-auto grid grid-cols-12 gap-10">
            <div className="hidden lg:block lg:col-span-2 font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 pt-3">
              04 / COMPOUND
            </div>
            <div className="col-span-12 lg:col-span-9">
              <div className="lg:hidden font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 mb-4">04 / COMPOUND</div>
              <h2 className="text-5xl sm:text-6xl lg:text-[88px] font-bold tracking-tight leading-[0.96] mb-6">
                Tomorrow's research<br />stands on today's.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                Models, reports, and on-chain data layer onto a brain that
                remembers what you've already learned.
              </p>
            </div>
          </div>
        </section>

        {/* 05 — Begin: CTA + wordmark in opposite corners */}
        <section className="py-32 px-8 lg:px-16">
          <div className="w-full max-w-[1440px] mx-auto grid grid-cols-12 gap-10 items-end">
            <div className="col-span-12 lg:col-span-8">
              <div className="font-mono text-[10px] tracking-[0.32em] text-muted-foreground/55 mb-4">
                05 / BEGIN
              </div>
              <h2 className="text-5xl sm:text-6xl lg:text-[88px] font-bold tracking-tight leading-[0.96] mb-6">
                Start your first<br />session.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-md mb-8">
                Sign in with email or wallet. Paste your first link and see
                what comes back.
              </p>
              <Button size="lg" className="h-12 px-8 gap-2" onClick={() => login()} data-testid="button-cta-bottom">
                Get started free
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="hidden lg:block lg:col-span-4 text-right pb-2">
              <p className="text-[10px] text-muted-foreground/50 font-mono tracking-[0.25em]">
                SESSIONS.XYZ
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
