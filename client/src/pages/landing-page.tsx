import { Button } from "@/components/ui/button";
import {
  ArrowRight, Brain, MessageSquare, FileText, BarChart3, GitBranch, Zap, BookOpen,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

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

function MiniBarChart() {
  const bars = [35, 52, 44, 68, 55, 82, 74, 90, 65, 78, 95, 88];
  return (
    <div className="flex items-end gap-[3px] h-10">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${h}%`,
            backgroundColor: ["#5b8def", "#7ca3f4", "#4a7de0", "#6690ed"][i % 4],
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function MiniAreaChart() {
  const points = [15, 22, 18, 35, 30, 45, 42, 55, 50, 68, 62, 78, 72, 85];
  const w = 200, h = 40;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - (p / 100) * h;
    return `${i === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10">
      <path d={path} fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
      <path d={`${path} L${w},${h} L0,${h} Z`} fill="#10b981" opacity="0.08" />
    </svg>
  );
}

function HeroVisual() {
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setActiveTab(t => (t + 1) % 4), 3500);
    return () => clearInterval(timer);
  }, []);

  const tabs = ["Session", "Research", "Data", "Brain"];

  return (
    <div className="w-full max-w-lg">
      <div className="rounded-xl border border-border/30 bg-[#0d1117] overflow-hidden shadow-2xl shadow-black/30">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/20 bg-[#0d1117]">
          <div className="flex gap-1.5 mr-3">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/40" />
          </div>
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-2.5 py-1 rounded text-[10px] font-mono transition-all ${
                activeTab === i
                  ? "bg-white/10 text-white"
                  : "text-white/30 hover:text-white/50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-4 min-h-[280px]">
          {activeTab === 0 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-mono text-blue-400">Session with Hyperliquid analyst</span>
              </div>
              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[8px] text-blue-400">Y</span>
                  </div>
                  <div className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-white/70 leading-relaxed max-w-[85%]">
                    What's Hyperliquid's actual revenue vs what they spend on token buybacks?
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Brain className="w-2.5 h-2.5 text-emerald-400" />
                  </div>
                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2 text-[11px] text-white/70 leading-relaxed max-w-[85%]">
                    <p className="text-emerald-400 text-[9px] font-mono mb-1">Querying Dune Analytics + DeFiLlama...</p>
                    Hyperliquid generated <span className="text-white font-medium">$584M</span> in cumulative trading fees. Of that, <span className="text-white font-medium">$180M</span> was used for HYPE buybacks — a <span className="text-white font-medium">30.8%</span> payout ratio. This is aggressive compared to peers...
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-2.5 h-2.5 text-amber-400" />
                  </div>
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-[10px] text-amber-300/80 leading-relaxed">
                    <span className="font-mono text-[9px] text-amber-400">Brain updated:</span> Added "HYPE buyback ratio = 30.8%" to knowledge graph
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 1 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] font-mono text-violet-400">Deep Research Report — Ethena</span>
              </div>
              <div className="space-y-2">
                <div className="rounded bg-white/[0.03] border border-border/10 p-2.5">
                  <p className="text-[9px] font-mono text-white/40 mb-1">EXECUTIVE SUMMARY</p>
                  <p className="text-[11px] text-white/60 leading-relaxed">
                    Ethena has built a synthetic dollar protocol generating <span className="text-white font-medium">$127M annualized revenue</span> through basis trade yields. The sUSDe product captures 78% of TVL...
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded bg-white/[0.03] border border-border/10 p-2">
                    <p className="text-[8px] text-white/30 font-mono">TVL</p>
                    <p className="text-xs font-mono text-white/80">$5.2B</p>
                  </div>
                  <div className="rounded bg-white/[0.03] border border-border/10 p-2">
                    <p className="text-[8px] text-white/30 font-mono">Revenue (Ann.)</p>
                    <p className="text-xs font-mono text-white/80">$127M</p>
                  </div>
                </div>
                <div className="rounded bg-white/[0.03] border border-border/10 p-2.5">
                  <p className="text-[9px] font-mono text-white/40 mb-1">KEY RISKS</p>
                  <div className="space-y-1">
                    {["Negative funding rate environments", "Custodial concentration (Fireblocks)", "Regulatory classification of sUSDe"].map(r => (
                      <div key={r} className="flex items-start gap-1.5">
                        <span className="text-red-400/60 text-[8px] mt-0.5">●</span>
                        <span className="text-[10px] text-white/50">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 mt-1">
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-mono">47 sources cited</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">Fact-checked</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 2 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-mono text-blue-400">Data — Revenue vs Buybacks</span>
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-3">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[9px] font-medium text-white/60">Monthly Protocol Revenue</p>
                  <p className="text-[9px] font-mono text-emerald-400">+342% YoY</p>
                </div>
                <MiniBarChart />
                <div className="flex gap-3 mt-2">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-sm bg-[#5b8def]" />
                    <span className="text-[8px] text-white/30">Revenue</span>
                  </div>
                </div>
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-3">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[9px] font-medium text-white/60">Cumulative Buyback Value</p>
                  <p className="text-[9px] font-mono text-white/40">$180M total</p>
                </div>
                <MiniAreaChart />
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-2.5">
                <p className="text-[9px] font-mono text-white/40 mb-1.5">Financial Model — DCF Valuation</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[7px] text-white/25">Bear Case</p>
                    <p className="text-[10px] font-mono text-red-400/70">$12.40</p>
                  </div>
                  <div>
                    <p className="text-[7px] text-white/25">Base Case</p>
                    <p className="text-[10px] font-mono text-white/70">$28.50</p>
                  </div>
                  <div>
                    <p className="text-[7px] text-white/25">Bull Case</p>
                    <p className="text-[10px] font-mono text-emerald-400/70">$54.20</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 3 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] font-mono text-amber-400">Knowledge Brain — 847 nodes</span>
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-3">
                <p className="text-[9px] font-mono text-white/40 mb-2">KNOWLEDGE GRAPH</p>
                <div className="relative h-28 overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 200 100">
                    {[
                      { x: 100, y: 50, r: 8, label: "DeFi", color: "#5b8def" },
                      { x: 50, y: 30, r: 5, label: "Ethena", color: "#8b5cf6" },
                      { x: 150, y: 25, r: 6, label: "HYPE", color: "#10b981" },
                      { x: 40, y: 70, r: 4, label: "Maker", color: "#f59e0b" },
                      { x: 155, y: 70, r: 5, label: "Perps", color: "#ef4444" },
                      { x: 80, y: 15, r: 4, label: "USDe", color: "#8b5cf6" },
                      { x: 125, y: 80, r: 4, label: "Fees", color: "#5b8def" },
                      { x: 70, y: 55, r: 3, label: "TVL", color: "#10b981" },
                    ].map((node, i) => (
                      <g key={i}>
                        <line x1={100} y1={50} x2={node.x} y2={node.y} stroke={node.color} strokeWidth="0.5" opacity="0.2" />
                        <circle cx={node.x} cy={node.y} r={node.r} fill={node.color} opacity="0.15" stroke={node.color} strokeWidth="0.5" />
                        <text x={node.x} y={node.y + 2} textAnchor="middle" className="fill-white/50" style={{ fontSize: "5px" }}>{node.label}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-[9px] font-mono text-white/40">RECENTLY LEARNED</p>
                {[
                  { fact: "HYPE buyback ratio = 30.8% of revenue", source: "Session #12", time: "2m ago" },
                  { fact: "Ethena sUSDe captures 78% of protocol TVL", source: "Deep Research", time: "1h ago" },
                  { fact: "Hyperliquid 24h volume exceeds $8B regularly", source: "Data query", time: "3h ago" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2 rounded bg-white/[0.02] px-2 py-1.5">
                    <GitBranch className="w-2.5 h-2.5 text-amber-400/50 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-white/60 truncate">{item.fact}</p>
                      <div className="flex gap-2">
                        <span className="text-[8px] text-white/25">{item.source}</span>
                        <span className="text-[8px] text-white/15">{item.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <BookOpen className="w-3 h-3 text-amber-400/40" />
                <span className="text-[9px] text-white/30 italic">Your brain gets smarter with every session</span>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border/10 flex items-center gap-3">
          {tabs.map((tab, i) => (
            <div
              key={tab}
              className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${
                activeTab === i ? "bg-white/30" : "bg-white/5"
              }`}
            />
          ))}
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
            <Brain className="w-4 h-4 text-foreground" />
            <span className="text-sm font-semibold tracking-tight">Sessions</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground hover:text-foreground" onClick={() => login()} data-testid="button-nav-login">Sign in</Button>
            <Button size="sm" className="text-xs h-7" onClick={() => login()} data-testid="button-nav-signup">Get started</Button>
          </div>
        </div>
      </nav>

      <section className="pt-28 pb-20 px-6">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-16 items-start">
          <div className="space-y-8 pt-8">
            <div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12] mb-5">
                Research that<br />
                <span className="text-muted-foreground">learns with you.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                An AI research platform that doesn't outsource learning — it captures it.
                Drop a link, run deep analysis, build models, and have conversations
                with AI agents that remember everything.
              </p>
            </div>

            <TypingDemo />

            <div className="flex items-center gap-3">
              <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                Start a session
                <ArrowRight className="w-4 h-4" />
              </Button>
              <a href="#how-it-works">
                <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                  How it works
                </Button>
              </a>
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end pt-4">
            <HeroVisual />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/50 mb-3">The platform</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              A complete research suite.
            </h2>
            <p className="text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Sessions combines AI agents, conversational research, deep reports,
              financial modeling, on-chain data, and a persistent knowledge brain
              into one platform. Everything compounds.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: MessageSquare,
                title: "Session Research",
                detail: "Conversational AI that queries live data, builds models, and writes analysis — with full tool use. Every insight feeds your brain.",
                color: "text-blue-400",
              },
              {
                icon: FileText,
                title: "Deep Research Reports",
                detail: "Long-form, fact-checked reports with cited sources. Executive summaries, competitive analysis, risk assessments, tokenomics deep-dives.",
                color: "text-violet-400",
              },
              {
                icon: BarChart3,
                title: "Data & Modeling",
                detail: "Ask any question, get a chart. Build DCF models, compare protocols, track revenue. Data from Dune, DeFiLlama, CoinGecko, Allium.",
                color: "text-emerald-400",
              },
              {
                icon: Brain,
                title: "Knowledge Brain",
                detail: "An Obsidian-style persistent graph that captures every insight. Your research suite gets smarter and adapts to your standards.",
                color: "text-amber-400",
              },
            ].map(({ icon: Icon, title, detail, color }) => (
              <div key={title} className="rounded-xl border border-border/20 bg-card/10 p-5 space-y-3" data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className={`w-5 h-5 ${color}`} />
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/50 mb-3">The workflow</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              Start with a link. End with conviction.
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Eight AI agents run in parallel to build your research foundation.
              Then go deeper with sessions, reports, data, and models.
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-0">
              {[
                {
                  step: "1",
                  title: "Drop any input",
                  detail: "A link, a token ticker, a tweet, a vague description. Eight agents fan out — scraping, identifying, verifying, researching.",
                },
                {
                  step: "2",
                  title: "Get a verified research foundation",
                  detail: "Company profile, founder intel, token snapshot, competitive landscape, contract verification — all fact-checked against live sources.",
                },
                {
                  step: "3",
                  title: "Go deep with sessions",
                  detail: "Open a research session. Ask questions in plain language. The AI queries live data, builds charts, creates models, and writes analysis — all in conversation.",
                },
                {
                  step: "4",
                  title: "Generate reports and models",
                  detail: "Create deep research reports with 40+ cited sources. Build DCF valuations, compare protocol economics, model scenarios with bear/base/bull cases.",
                },
                {
                  step: "5",
                  title: "Your brain captures everything",
                  detail: "Every insight, every data point, every conclusion feeds into your persistent knowledge graph. Your research suite gets smarter the more you use it.",
                },
              ].map(({ step, title, detail }) => (
                <div key={step} className="flex gap-5 py-4 group" data-testid={`step-${step}`}>
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full border border-border/30 bg-card/30 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono text-muted-foreground/60">{step}</span>
                    </div>
                    {step !== "5" && <div className="w-px flex-1 bg-border/15 mt-1" />}
                  </div>
                  <div className="pb-2">
                    <h3 className="text-sm font-semibold mb-1">{title}</h3>
                    <p className="text-[13px] text-muted-foreground leading-relaxed">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr,1.2fr] gap-20 items-start">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">The difference</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
                Capture learning.<br />
                Don't outsource it.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                Other tools give you answers then forget. Sessions builds a persistent
                knowledge brain that compounds with every research session, every report,
                every data query. Your standards evolve. Your brain adapts.
              </p>

              <div className="space-y-6">
                {[
                  {
                    title: "Persistent knowledge graph",
                    body: "Every fact, metric, and conclusion is captured in an Obsidian-style brain. Import notes, export insights, build connections between projects.",
                  },
                  {
                    title: "Adaptive research standards",
                    body: "The AI learns what matters to you. Your frameworks, your diligence criteria, your analytical preferences — all encoded in the brain.",
                  },
                  {
                    title: "Cross-session intelligence",
                    body: "Research from one session informs the next. Compare Ethena to Maker? The brain already knows both from your prior work.",
                  },
                  {
                    title: "Shareable sessions",
                    body: "Share any research session with a link. Colleagues see the full conversation, analysis, and data — no login required.",
                  },
                ].map(({ title, body }) => (
                  <div key={title} data-testid={`input-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <h3 className="text-sm font-semibold mb-1">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-xl border border-border/30 bg-card/10 p-6">
                <p className="text-[10px] font-mono text-muted-foreground/40 mb-5">What your research suite produces</p>
                <div className="space-y-4">
                  {[
                    { label: "Verified Research Foundation", detail: "Company profile, founders, token data, competitive landscape" },
                    { label: "AI Research Sessions", detail: "Conversational analysis with live data, tool use, and brain context" },
                    { label: "Deep Research Reports", detail: "Long-form analysis with 40+ cited sources, fact-checked" },
                    { label: "Financial Models", detail: "DCF valuations, scenario analysis, protocol economics" },
                    { label: "On-Chain Data & Charts", detail: "Revenue, volume, TVL, fees — from Dune, DeFiLlama, Allium" },
                    { label: "Token Intelligence", detail: "Live snapshots, contract verification, on-chain metrics" },
                    { label: "Persistent Knowledge Brain", detail: "Every insight captured, connected, and compounding" },
                  ].map(({ label, detail }, i) => (
                    <div key={label} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded bg-accent/50 flex items-center justify-center mt-0.5 shrink-0">
                        <span className="text-[9px] font-mono text-muted-foreground">{i + 1}</span>
                      </div>
                      <div>
                        <p className="text-xs font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground/60">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
            Your research suite is ready
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
            Sign in with email or wallet. Start your first session and watch
            your research brain start learning.
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
            <Brain className="w-3 h-3" />
            <span>Sessions</span>
          </div>
          <p className="text-[10px] text-muted-foreground/40 font-mono">sessions.xyz</p>
        </div>
      </footer>
    </div>
  );
}
