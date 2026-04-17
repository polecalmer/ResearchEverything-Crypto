import { Button } from "@/components/ui/button";
import { ArrowRight, Brain } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import sessionsLogo from "@assets/sessions_logo.png";

const TYPE_COLORS: Record<string, string> = {
  protocol: "#7aa2f7",
  token: "#f7c97a",
  chain: "#bb9af7",
  person: "#f7768e",
  fund: "#9ece6a",
  concept: "#7dcfff",
};

const TYPE_LABELS: Record<string, string> = {
  protocol: "Protocols",
  token: "Tokens",
  chain: "Chains",
  person: "People",
  fund: "Funds",
  concept: "Concepts",
};

interface AggNode { id: string; type: string; count: number; users: number; x: number; y: number; vx: number; vy: number; }
interface AggEdge { from: string; to: string; type: string; weight: number; }

function BrainGraphHero() {
  const { data, isLoading } = useQuery<{
    nodes: Array<{ id: string; type: string; count: number; users: number }>;
    edges: AggEdge[];
    stats: { totalEntities: number; totalRelationships: number; totalResearchers: number; shownEntities: number };
  }>({
    queryKey: ["/api/brain/aggregate"],
    staleTime: 5 * 60 * 1000,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<AggNode[]>([]);
  const animRef = useRef<number>(0);
  const hoverRef = useRef<string | null>(null);
  const rotationRef = useRef(0);

  const useDemo = !data || data.nodes.length < 8;
  const graph = useDemo ? buildDemoGraph() : { nodes: data!.nodes, edges: data!.edges };

  useEffect(() => {
    nodesRef.current = graph.nodes.map((n, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2 + Math.random() * 0.3;
      const r = 180 + Math.random() * 160;
      return { ...n, x: Math.cos(angle) * r, y: Math.sin(angle) * r, vx: 0, vy: 0 };
    });
  }, [graph.nodes.length, useDemo]);

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
    const alpha = 0.18;
    for (const n of ns) { n.vx *= 0.86; n.vy *= 0.86; }
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const dx = ns[j].x - ns[i].x;
        const dy = ns[j].y - ns[i].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (900 / (d * d)) * alpha;
        const fx = (dx / d) * force, fy = (dy / d) * force;
        ns[i].vx -= fx; ns[i].vy -= fy;
        ns[j].vx += fx; ns[j].vy += fy;
      }
    }
    const map = new Map(ns.map(n => [n.id, n]));
    for (const edge of graph.edges) {
      const s = map.get(edge.from), t = map.get(edge.to);
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (d - 130) * 0.022 * alpha;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }
    for (const n of ns) {
      n.vx -= n.x * 0.0012 * alpha;
      n.vy -= n.y * 0.0012 * alpha;
      n.x += n.vx; n.y += n.vy;
    }

    rotationRef.current += 0.0008;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const cosR = Math.cos(rotationRef.current), sinR = Math.sin(rotationRef.current);

    ctx.save();
    ctx.translate(cx, cy);

    for (const edge of graph.edges) {
      const s = map.get(edge.from), t = map.get(edge.to);
      if (!s || !t) continue;
      const sx = s.x * cosR - s.y * sinR, sy = s.x * sinR + s.y * cosR;
      const tx = t.x * cosR - t.y * sinR, ty = t.x * sinR + t.y * cosR;
      const isHover = hoverRef.current && (edge.from === hoverRef.current || edge.to === hoverRef.current);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = isHover ? "rgba(125, 207, 255, 0.45)" : "rgba(125, 145, 200, 0.08)";
      ctx.lineWidth = isHover ? 1 : 0.5;
      ctx.stroke();
    }

    for (const n of ns) {
      const x = n.x * cosR - n.y * sinR;
      const y = n.x * sinR + n.y * cosR;
      const color = TYPE_COLORS[n.type] || "#6b7280";
      const r = Math.min(2 + Math.sqrt(n.count) * 1.4, 7);
      const isHover = hoverRef.current === n.id;
      ctx.beginPath();
      ctx.arc(x, y, isHover ? r + 2 : r, 0, Math.PI * 2);
      ctx.fillStyle = isHover ? color : `${color}cc`;
      ctx.fill();
      if (isHover) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(n.id, x, y - r - 8);
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
      const dx = n.x - lx, dy = n.y - ly;
      const d = dx * dx + dy * dy;
      const r = Math.min(2 + Math.sqrt(n.count) * 1.4, 7);
      if (d < (r + 6) * (r + 6) && d < bestD) { bestD = d; found = n.id; }
    }
    if (found !== hoverRef.current) {
      hoverRef.current = found;
    }
  };

  const types = Array.from(new Set(graph.nodes.map(n => n.type)));
  const stats = data?.stats;

  return (
    <div className="relative w-full" style={{ height: "560px" }}>
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
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[t] || "#6b7280" }} />
              <span>{TYPE_LABELS[t] || t}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border/30 text-muted-foreground/40">
          <div>{stats ? `${stats.shownEntities} / ${stats.totalEntities}` : graph.nodes.length} ENTITIES</div>
          <div>{stats ? stats.totalRelationships : graph.edges.length} CONNECTIONS</div>
          {stats && stats.totalResearchers > 0 ? (
            <div className="mt-1">{stats.totalResearchers} RESEARCHER{stats.totalResearchers === 1 ? "" : "S"}</div>
          ) : null}
          {useDemo ? <div className="mt-1 text-muted-foreground/30">SAMPLE PREVIEW</div> : null}
        </div>
      </div>

      <div className="absolute top-4 right-4 font-mono text-[10px] tracking-wider text-muted-foreground/50 select-none">
        THE COLLECTIVE BRAIN
      </div>

      {isLoading ? (
        <div className="absolute bottom-4 right-4 font-mono text-[10px] text-muted-foreground/40">loading…</div>
      ) : null}

      <div className="pointer-events-none absolute inset-0" style={{
        background: "radial-gradient(ellipse at center, transparent 50%, hsl(var(--background)) 100%)",
      }} />
    </div>
  );
}

function buildDemoGraph(): { nodes: Array<{ id: string; type: string; count: number; users: number }>; edges: AggEdge[] } {
  const nodes = [
    { id: "Hyperliquid", type: "protocol", count: 24 },
    { id: "Ethena", type: "protocol", count: 22 },
    { id: "MakerDAO", type: "protocol", count: 18 },
    { id: "Aave", type: "protocol", count: 17 },
    { id: "Uniswap", type: "protocol", count: 16 },
    { id: "Lido", type: "protocol", count: 15 },
    { id: "GMX", type: "protocol", count: 13 },
    { id: "dYdX", type: "protocol", count: 12 },
    { id: "Pendle", type: "protocol", count: 11 },
    { id: "Curve", type: "protocol", count: 10 },
    { id: "HYPE", type: "token", count: 19 },
    { id: "ENA", type: "token", count: 17 },
    { id: "USDe", type: "token", count: 15 },
    { id: "MKR", type: "token", count: 13 },
    { id: "ETH", type: "token", count: 22 },
    { id: "BTC", type: "token", count: 20 },
    { id: "SOL", type: "token", count: 14 },
    { id: "PUMP", type: "token", count: 9 },
    { id: "Ethereum", type: "chain", count: 26 },
    { id: "Solana", type: "chain", count: 18 },
    { id: "Base", type: "chain", count: 14 },
    { id: "Arbitrum", type: "chain", count: 13 },
    { id: "Optimism", type: "chain", count: 11 },
    { id: "Hyperliquid L1", type: "chain", count: 10 },
    { id: "Paradigm", type: "fund", count: 12 },
    { id: "Multicoin", type: "fund", count: 10 },
    { id: "a16z Crypto", type: "fund", count: 11 },
    { id: "Pantera", type: "fund", count: 8 },
    { id: "Vitalik Buterin", type: "person", count: 14 },
    { id: "Hayden Adams", type: "person", count: 8 },
    { id: "Andre Cronje", type: "person", count: 7 },
    { id: "Real Yield", type: "concept", count: 12 },
    { id: "DCF Valuation", type: "concept", count: 11 },
    { id: "P/E Ratio", type: "concept", count: 10 },
    { id: "Buybacks", type: "concept", count: 10 },
    { id: "Restaking", type: "concept", count: 13 },
    { id: "Liquid Staking", type: "concept", count: 11 },
    { id: "Perp DEX", type: "concept", count: 12 },
    { id: "Stablecoin Yield", type: "concept", count: 9 },
  ].map(n => ({ ...n, users: Math.max(1, Math.floor(n.count / 3)) }));

  const edges: AggEdge[] = [
    { from: "Hyperliquid", to: "HYPE", type: "issues", weight: 5 },
    { from: "Hyperliquid", to: "Hyperliquid L1", type: "deployed_on", weight: 4 },
    { from: "Hyperliquid", to: "Perp DEX", type: "is_a", weight: 4 },
    { from: "Ethena", to: "ENA", type: "issues", weight: 5 },
    { from: "Ethena", to: "USDe", type: "issues", weight: 5 },
    { from: "Ethena", to: "Stablecoin Yield", type: "is_a", weight: 4 },
    { from: "MakerDAO", to: "MKR", type: "issues", weight: 5 },
    { from: "MakerDAO", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "Aave", to: "Ethereum", type: "deployed_on", weight: 4 },
    { from: "Uniswap", to: "Ethereum", type: "deployed_on", weight: 4 },
    { from: "Uniswap", to: "Hayden Adams", type: "founded_by", weight: 3 },
    { from: "Lido", to: "Liquid Staking", type: "is_a", weight: 5 },
    { from: "Lido", to: "ETH", type: "uses", weight: 4 },
    { from: "GMX", to: "Perp DEX", type: "is_a", weight: 4 },
    { from: "GMX", to: "Arbitrum", type: "deployed_on", weight: 4 },
    { from: "dYdX", to: "Perp DEX", type: "is_a", weight: 4 },
    { from: "Pendle", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "Curve", to: "Ethereum", type: "deployed_on", weight: 3 },
    { from: "Ethereum", to: "ETH", type: "issues", weight: 5 },
    { from: "Solana", to: "SOL", type: "issues", weight: 5 },
    { from: "Solana", to: "PUMP", type: "deployed_on", weight: 3 },
    { from: "Base", to: "Ethereum", type: "rollup_of", weight: 4 },
    { from: "Arbitrum", to: "Ethereum", type: "rollup_of", weight: 4 },
    { from: "Optimism", to: "Ethereum", type: "rollup_of", weight: 4 },
    { from: "Vitalik Buterin", to: "Ethereum", type: "founded_by", weight: 5 },
    { from: "Paradigm", to: "Uniswap", type: "invested_in", weight: 3 },
    { from: "Paradigm", to: "Hyperliquid", type: "invested_in", weight: 3 },
    { from: "Multicoin", to: "Solana", type: "invested_in", weight: 3 },
    { from: "a16z Crypto", to: "Aave", type: "invested_in", weight: 3 },
    { from: "Restaking", to: "ETH", type: "uses", weight: 4 },
    { from: "Liquid Staking", to: "Restaking", type: "related_to", weight: 4 },
    { from: "DCF Valuation", to: "P/E Ratio", type: "related_to", weight: 4 },
    { from: "DCF Valuation", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "Buybacks", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "P/E Ratio", to: "Hyperliquid", type: "related_to", weight: 3 },
    { from: "Buybacks", to: "Hyperliquid", type: "related_to", weight: 3 },
    { from: "Stablecoin Yield", to: "Real Yield", type: "related_to", weight: 4 },
    { from: "Pendle", to: "Stablecoin Yield", type: "related_to", weight: 3 },
    { from: "Aave", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "MakerDAO", to: "Stablecoin Yield", type: "related_to", weight: 3 },
    { from: "Andre Cronje", to: "Real Yield", type: "related_to", weight: 3 },
    { from: "BTC", to: "Ethereum", type: "related_to", weight: 2 },
  ];
  return { nodes: nodes.map(n => ({ ...n, users: n.users })), edges };
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
    <div className="min-h-screen bg-background" data-testid="landing-page">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
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

      <section className="pt-28 pb-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center">
          <img src={sessionsLogo} alt="Sessions" className="w-20 h-20 sm:w-24 sm:h-24 object-contain rounded-2xl mb-8" />
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.12] mb-5">
            Research that<br />
            <span className="text-muted-foreground">learns with you.</span>
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-lg mb-8">
            An AI research platform for crypto. Run deep analysis, build
            financial models, generate reports, and have conversations with
            AI that remembers your work.
          </p>

          <TypingDemo />

          <div className="flex items-center gap-3 mt-8">
            <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
              Start a session
              <ArrowRight className="w-4 h-4" />
            </Button>
            <a href="#what-you-get">
              <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                Learn more
              </Button>
            </a>
          </div>
        </div>
      </section>

      <section className="py-8 px-6">
        <div className="max-w-6xl mx-auto">
          <BrainGraphHero />
          <p className="text-center text-xs text-muted-foreground/60 mt-2 font-mono tracking-wider">
            Every session adds to the brain. Every researcher makes it sharper.
          </p>
        </div>
      </section>

      <section id="what-you-get" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              What you get
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Institutional-quality research output, without the team.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                title: "Deep research reports",
                body: "Long-form, verified analysis with cited sources. Executive summaries, competitive landscapes, risk assessments, and actionable next steps.",
              },
              {
                title: "Financial models",
                body: "DCF valuations, scenario analysis, protocol economics comparisons. Bear/base/bull cases built from live data.",
              },
              {
                title: "On-chain data & charts",
                body: "Ask any question in plain English. Revenue over time, P/E ratios, buyback analysis — rendered as charts instantly.",
              },
              {
                title: "Conversational research",
                body: "Go beyond static reports. Have back-and-forth sessions where the AI pulls live data, builds models, and iterates on your analysis.",
              },
              {
                title: "Verified intelligence",
                body: "Every claim is checked against primary sources. No hallucinated numbers. No fabricated citations. Research you can actually use.",
              },
              {
                title: "It remembers",
                body: "Your research compounds. Previous work informs future sessions. Your platform gets sharper the more you use it.",
              },
            ].map(({ title, body }) => (
              <div key={title} data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <h3 className="text-sm font-semibold mb-2">{title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              Built for how researchers actually work
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Not another chatbot. A research environment where analysis, data, and memory work together.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-x-16 gap-y-10">
            {[
              {
                title: "Drop a link, get a foundation",
                body: "Paste a website, a tweet, a token ticker — the platform builds a verified research foundation automatically.",
              },
              {
                title: "Go deep in sessions",
                body: "Ask follow-up questions, request charts, build models, challenge assumptions. It's a conversation, not a one-shot query.",
              },
              {
                title: "Generate publishable reports",
                body: "Multi-section research reports with sourced claims, quantitative analysis, and structured risk assessments.",
              },
              {
                title: "Everything compounds",
                body: "Work from one session carries into the next. Insights accumulate. Your research environment adapts to your standards over time.",
              },
            ].map(({ title, body }) => (
              <div key={title} data-testid={`workflow-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
            Start your first session
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
            Sign in with email or wallet. Paste your first link and see what comes back.
          </p>
          <Button size="lg" className="h-12 px-8 gap-2" onClick={() => login()} data-testid="button-cta-bottom">
            Get started free
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </section>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <img src={sessionsLogo} alt="Sessions" className="w-4 h-4 object-contain" />
            <span>Sessions</span>
          </div>
          <p className="text-[10px] text-muted-foreground/40 font-mono">sessions.xyz</p>
        </div>
      </footer>
    </div>
  );
}
