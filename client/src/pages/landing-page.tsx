import { Button } from "@/components/ui/button";
import {
  ArrowRight, Brain, MessageSquare, FileText, BarChart3, Zap,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import sessionsLogo from "@assets/sessions_logo.png";

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
    const timer = setInterval(() => setActiveTab(t => (t + 1) % 3), 3500);
    return () => clearInterval(timer);
  }, []);

  const tabs = ["Session", "Report", "Data"];

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
                <span className="text-[10px] font-mono text-blue-400">Active session</span>
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
                    <p className="text-emerald-400 text-[9px] font-mono mb-1">Pulling live data...</p>
                    Hyperliquid generated <span className="text-white font-medium">$584M</span> in cumulative trading fees. Of that, <span className="text-white font-medium">$180M</span> was used for HYPE buybacks — a <span className="text-white font-medium">30.8%</span> payout ratio. This is aggressive compared to peers...
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-2.5 h-2.5 text-amber-400" />
                  </div>
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-[10px] text-amber-300/80 leading-relaxed">
                    Insight captured — available in future sessions
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 1 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] font-mono text-violet-400">Deep Research — Ethena</span>
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
                    {["Negative funding rate environments", "Custodial concentration risk", "Regulatory classification uncertainty"].map(r => (
                      <div key={r} className="flex items-start gap-1.5">
                        <span className="text-red-400/60 text-[8px] mt-0.5">●</span>
                        <span className="text-[10px] text-white/50">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 mt-1">
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-mono">47 sources cited</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">Verified</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 2 && (
            <div className="space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-mono text-blue-400">Revenue vs Buybacks</span>
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-3">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[9px] font-medium text-white/60">Monthly Protocol Revenue</p>
                  <p className="text-[9px] font-mono text-emerald-400">+342% YoY</p>
                </div>
                <MiniBarChart />
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-3">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-[9px] font-medium text-white/60">Cumulative Buyback Value</p>
                  <p className="text-[9px] font-mono text-white/40">$180M total</p>
                </div>
                <MiniAreaChart />
              </div>
              <div className="rounded bg-white/[0.03] border border-border/10 p-2.5">
                <p className="text-[9px] font-mono text-white/40 mb-1.5">DCF Valuation</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[7px] text-white/25">Bear</p>
                    <p className="text-[10px] font-mono text-red-400/70">$12.40</p>
                  </div>
                  <div>
                    <p className="text-[7px] text-white/25">Base</p>
                    <p className="text-[10px] font-mono text-white/70">$28.50</p>
                  </div>
                  <div>
                    <p className="text-[7px] text-white/25">Bull</p>
                    <p className="text-[10px] font-mono text-emerald-400/70">$54.20</p>
                  </div>
                </div>
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
            <img src={sessionsLogo} alt="Sessions" className="w-5 h-5 object-contain" />
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
                An AI research platform for crypto. Run deep analysis, build
                financial models, generate reports, and have conversations with
                AI that remembers your work.
              </p>
            </div>

            <TypingDemo />

            <div className="flex items-center gap-3">
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

          <div className="hidden lg:flex flex-col items-end pt-4">
            <HeroVisual />
          </div>
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
