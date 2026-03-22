import { Button } from "@/components/ui/button";
import {
  ArrowRight, Search, BarChart3, Brain, Database,
  Zap, Globe, Shield, TrendingUp, Layers, Bot,
  ArrowUpRight, LineChart, ShieldCheck, Sparkles, Eye,
  FileText, Link2, Twitter,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const CHART_COLORS = ["#5b8def", "#7ca3f4", "#4a7de0", "#6690ed"];

function TypingDemo() {
  const inputs = [
    "https://x.com/pumpdotfun",
    "hyperliquid.xyz",
    "AI infrastructure startup from YC W24",
    "https://github.com/fermi-labs",
    "Show me HYPE P/E ratio over time",
    "ethena.fi",
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
        <Search className="w-3.5 h-3.5 text-muted-foreground/40" />
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
    <div className="flex items-end gap-[3px] h-12">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${h}%`,
            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}

function MiniLineChart() {
  const points = [20, 35, 28, 45, 40, 55, 48, 62, 58, 72, 65, 80];
  const width = 200;
  const height = 48;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - (p / 100) * height;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-12">
      <path d={path} fill="none" stroke="#5b8def" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`${path} L${width},${height} L0,${height} Z`} fill="url(#lineGrad)" opacity="0.12" />
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b8def" />
          <stop offset="100%" stopColor="#5b8def" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function HeroVisual() {
  return (
    <div className="space-y-4 w-full max-w-lg">
      <div className="rounded-xl border border-border/40 bg-card/30 backdrop-blur p-4 space-y-3">
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground/50 font-mono">
          <Twitter className="w-3 h-3" />
          <span>x.com/pumpdotfun</span>
          <ArrowRight className="w-2.5 h-2.5" />
          <span className="text-emerald-500">identified</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
              <span className="text-xs font-mono font-bold">P</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">Pump.fun</p>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">PUMP</span>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">Solana Token Launchpad</p>
            </div>
          </div>
          <span className="text-[9px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">liquid token</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-border/20 bg-background/40 p-2">
            <p className="text-[8px] text-muted-foreground/40">Price</p>
            <p className="text-xs font-mono font-medium">$0.00188</p>
          </div>
          <div className="rounded border border-border/20 bg-background/40 p-2">
            <p className="text-[8px] text-muted-foreground/40">Mcap</p>
            <p className="text-xs font-mono font-medium">$1.1B</p>
          </div>
          <div className="rounded border border-border/20 bg-background/40 p-2">
            <p className="text-[8px] text-muted-foreground/40">24h Vol</p>
            <p className="text-xs font-mono font-medium">$40.5M</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-border/20 bg-background/40 p-2.5">
            <p className="text-[9px] font-medium mb-1">Daily Revenue</p>
            <MiniBarChart />
          </div>
          <div className="rounded border border-border/20 bg-background/40 p-2.5">
            <p className="text-[9px] font-medium mb-1">Buyback Analysis</p>
            <MiniLineChart />
          </div>
        </div>

        <div className="border-t border-border/20 pt-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] text-muted-foreground">5 claims verified, 2 flagged</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-foreground/60" />
            <span className="text-[10px] text-muted-foreground">Deep research report ready</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3 text-blue-400/60" />
            <span className="text-[10px] text-muted-foreground">3 AI-generated charts from on-chain data</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/30 bg-card/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="w-3 h-3 text-blue-400/50" />
          <span className="text-[9px] text-muted-foreground/40 font-mono">7-agent pipeline</span>
        </div>
        <div className="flex items-center gap-3">
          {["Identify", "Research", "Verify", "Enrich", "Token Intel", "Charts", "Report"].map((step, i) => (
            <div key={step} className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full ${i < 6 ? "bg-emerald-500" : "bg-blue-400 animate-pulse"}`} />
              <span className="text-[8px] text-muted-foreground/50 font-mono">{step}</span>
            </div>
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
            <Search className="w-4 h-4 text-foreground" />
            <span className="text-sm font-semibold tracking-tight">Research Everything</span>
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
              <p className="text-xs font-mono uppercase tracking-widest text-blue-400/80 mb-4">From Any Link to Full Research Hub</p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12] mb-5">
                Paste a link.<br />
                <span className="text-muted-foreground">Get the full picture.</span>
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed max-w-md">
                A tweet, a website, a GitHub repo — our AI agent team identifies the company,
                researches it, fact-checks every claim, and builds a complete research hub.
                For liquid tokens, you also get live price data, on-chain analytics, and AI-generated charts powered by Dune, Allium, and more.
              </p>
            </div>

            <TypingDemo />

            <div className="flex items-center gap-3">
              <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                Start researching
                <ArrowRight className="w-4 h-4" />
              </Button>
              <a href="#how">
                <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                  How it works
                </Button>
              </a>
            </div>

            <div className="flex items-center gap-6 pt-2">
              {[
                { label: "AI Agents", value: "7" },
                { label: "Data Sources", value: "5+" },
                { label: "Time to Report", value: "<60s" },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-sm font-semibold font-mono">{value}</p>
                  <p className="text-[10px] text-muted-foreground/50">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end pt-4">
            <HeroVisual />
          </div>
        </div>
      </section>

      <section id="how" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              One input. Complete intelligence.
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Whether it's a pre-seed startup or a billion-dollar token, the same pipeline delivers
              everything you need to form a thesis.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                num: "01",
                icon: Eye,
                title: "Identify",
                body: "Paste anything — a tweet, a website, a founder's name. The AI figures out exactly which company or token you mean.",
              },
              {
                num: "02",
                icon: Search,
                title: "Research",
                body: "Live web search pulls funding data, founder backgrounds, competitive landscape, social profiles, and market positioning.",
              },
              {
                num: "03",
                icon: ShieldCheck,
                title: "Verify",
                body: "Every claim is independently fact-checked. Fabricated URLs, embellished bios, and unverified funding rounds are flagged or stripped.",
              },
              {
                num: "04",
                icon: BarChart3,
                title: "Analyze",
                body: "For liquid tokens: live price, on-chain metrics, and AI-generated charts from Dune, Allium, and other data APIs. For early-stage: structured deal intelligence.",
              },
            ].map(({ num, icon: Icon, title, body }) => (
              <div key={num} data-testid={`step-${title.toLowerCase()}`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] font-mono text-muted-foreground/30">{num}</span>
                  <Icon className="w-4 h-4 text-foreground" />
                </div>
                <h3 className="text-sm font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-20">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-blue-400/80 mb-3">Early-Stage Deals</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-6">
                From tweet to deal memo
              </h2>
              <div className="space-y-5">
                {[
                  {
                    icon: Zap,
                    title: "7-Agent Pipeline",
                    body: "Identifier, Researcher, Fact-Checker, Enrichment, QA, Next Steps, and Deep Research agents work in sequence to build a complete profile.",
                  },
                  {
                    icon: FileText,
                    title: "Verified Deal Cards",
                    body: "Company overview, sector, business model, stage, competitive landscape, and founder intelligence — all fact-checked against live web data.",
                  },
                  {
                    icon: Globe,
                    title: "Deep Research Reports",
                    body: "Long-form AI research with live web search. Adjacent reads, regulatory landscape, and actionable next steps for your diligence process.",
                  },
                  {
                    icon: Layers,
                    title: "Pipeline Management",
                    body: "Six stages from Discovered to Invested. Tag, note, score excitement, and track deals through your funnel.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-3" data-testid={`feature-early-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Icon className="w-4 h-4 text-foreground/50 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold mb-1">{title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-blue-400/80 mb-3">Liquid Tokens</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-6">
                From ticker to thesis
              </h2>
              <div className="space-y-5">
                {[
                  {
                    icon: TrendingUp,
                    title: "Live Token Snapshots",
                    body: "Real-time price, market cap, volume, and 24h change pulled from CoinGecko and on-chain sources across 15+ chains.",
                  },
                  {
                    icon: Brain,
                    title: "Natural Language Charts",
                    body: "Ask for \"revenue vs buybacks\" or \"P/E ratio over time\" — the AI picks the right data source and renders a chart instantly.",
                  },
                  {
                    icon: Database,
                    title: "Multi-Source Data Layer",
                    body: "Dune Analytics, Allium on-chain data, CoinGecko, and any API. The AI knows how to query each source and generate the right visualization.",
                  },
                  {
                    icon: LineChart,
                    title: "Custom Data Dashboard",
                    body: "Build a personalized dashboard with AI-generated charts. Drag to reorder, refresh for live data, ask follow-up questions.",
                  },
                ].map(({ icon: Icon, title, body }) => (
                  <div key={title} className="flex gap-3" data-testid={`feature-liquid-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <Icon className="w-4 h-4 text-blue-400/60 mt-0.5 shrink-0" />
                    <div>
                      <h3 className="text-sm font-semibold mb-1">{title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Universal Input</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
              Works with everything you already share
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { icon: Twitter, label: "Twitter / X" },
              { icon: Globe, label: "Websites" },
              { icon: Link2, label: "GitHub" },
              { icon: FileText, label: "Product Hunt" },
              { icon: Search, label: "Plain text" },
              { icon: TrendingUp, label: "Tickers" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="rounded-lg border border-border/20 bg-card/10 p-4 text-center" data-testid={`input-${label.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-4 h-4 text-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground font-mono">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
            Start researching in 30 seconds
          </h2>
          <p className="text-sm text-muted-foreground mb-8">
            Sign in with email or wallet. No credit card required.
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
            <Search className="w-3 h-3" />
            <span>Research Everything</span>
          </div>
          <p className="text-[10px] text-muted-foreground/40 font-mono">researcheverything.xyz</p>
        </div>
      </footer>
    </div>
  );
}
