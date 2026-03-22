import { Button } from "@/components/ui/button";
import {
  ArrowRight, Search, BarChart3, Brain, Database,
  Zap, Globe, Shield, TrendingUp, Layers, Bot,
  ArrowUpRight, LineChart,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const CHART_COLORS = ["#5b8def", "#7ca3f4", "#4a7de0", "#6690ed"];

function MiniBarChart() {
  const bars = [35, 52, 44, 68, 55, 82, 74, 90, 65, 78, 95, 88];
  return (
    <div className="flex items-end gap-[3px] h-16">
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px] transition-all duration-700"
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
  const height = 60;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - (p / 100) * height;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-16">
      <path d={path} fill="none" stroke="#5b8def" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`${path} L${width},${height} L0,${height} Z`} fill="url(#lineGrad)" opacity="0.15" />
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b8def" />
          <stop offset="100%" stopColor="#5b8def" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function DataDashboardPreview() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 backdrop-blur p-5 space-y-4 w-full max-w-lg">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
            <span className="text-[10px] font-mono font-bold">P</span>
          </div>
          <span className="text-sm font-semibold">Pump.fun</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono">PUMP</span>
        </div>
        <span className="text-[9px] text-muted-foreground/40 font-mono">Token Intelligence</span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/20 bg-background/50 p-2.5">
          <p className="text-[9px] text-muted-foreground/50 mb-1">Price</p>
          <p className="text-sm font-mono font-medium">$0.00188</p>
          <p className="text-[9px] text-emerald-500 font-mono">+1.3%</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-background/50 p-2.5">
          <p className="text-[9px] text-muted-foreground/50 mb-1">Market Cap</p>
          <p className="text-sm font-mono font-medium">$1.1B</p>
        </div>
        <div className="rounded-lg border border-border/20 bg-background/50 p-2.5">
          <p className="text-[9px] text-muted-foreground/50 mb-1">24h Volume</p>
          <p className="text-sm font-mono font-medium">$40.5M</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/20 bg-background/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-medium">Daily Revenue</p>
            <p className="text-[10px] font-mono text-muted-foreground">$580K</p>
          </div>
          <MiniBarChart />
        </div>
        <div className="rounded-lg border border-border/20 bg-background/50 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-medium">Buyback Analysis</p>
            <p className="text-[10px] font-mono text-muted-foreground">$2.9M</p>
          </div>
          <MiniLineChart />
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <div className="flex -space-x-1">
          {["Dune", "CoinGecko", "Allium"].map((s, i) => (
            <div key={s} className="w-5 h-5 rounded-full border-2 border-card bg-accent flex items-center justify-center">
              <span className="text-[7px] font-mono font-bold">{s[0]}</span>
            </div>
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground/40">3 data sources connected</span>
      </div>
    </div>
  );
}

function PromptDemo() {
  const prompts = [
    "Show me Pump.fun revenue vs buybacks",
    "HYPE P/E ratio over time",
    "Ethena USDe staking rewards",
    "Compare perp DEX volumes",
  ];
  const [idx, setIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pause" | "clearing">("typing");

  const current = prompts[idx];

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (charIdx < current.length) {
        timer = setTimeout(() => setCharIdx((c) => c + 1), 40 + Math.random() * 30);
      } else {
        timer = setTimeout(() => setPhase("pause"), 2500);
      }
    } else if (phase === "pause") {
      timer = setTimeout(() => setPhase("clearing"), 100);
    } else {
      if (charIdx > 0) {
        timer = setTimeout(() => setCharIdx((c) => c - 1), 15);
      } else {
        setIdx((i) => (i + 1) % prompts.length);
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
              <p className="text-xs font-mono uppercase tracking-widest text-blue-400/80 mb-4">AI-Powered Research Intelligence</p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12] mb-5">
                Ask for any chart.<br />
                <span className="text-muted-foreground">Get it instantly.</span>
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed max-w-md">
                Natural language queries across Dune Analytics, on-chain data, and token metrics.
                AI generates publication-ready charts from your Dune query library — no SQL, no dashboards to maintain.
              </p>
            </div>

            <PromptDemo />

            <div className="flex items-center gap-3">
              <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                Start researching
                <ArrowRight className="w-4 h-4" />
              </Button>
              <a href="#platform">
                <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-see-platform">
                  See the platform
                </Button>
              </a>
            </div>

            <div className="flex items-center gap-6 pt-2">
              {[
                { label: "Data Sources", value: "5+" },
                { label: "Charts Generated", value: "Instant" },
                { label: "On-chain Tokens", value: "Any" },
              ].map(({ label, value }) => (
                <div key={label} className="text-center">
                  <p className="text-sm font-semibold font-mono">{value}</p>
                  <p className="text-[10px] text-muted-foreground/50">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end gap-6 pt-4">
            <DataDashboardPreview />
          </div>
        </div>
      </section>

      <section id="data" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-blue-400/80 mb-3">The Data Product</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              Your research analyst, on demand
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Type what you want to see in plain English. The AI agent selects the right data source,
              builds the chart config, and renders it — all in seconds.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-8">
            {[
              {
                icon: Brain,
                title: "Natural Language Charts",
                body: "Ask for \"revenue vs buybacks\" or \"P/E ratio over time\" — the AI agent picks the right Dune query, maps columns to axes, and renders a chart automatically.",
              },
              {
                icon: Database,
                title: "Your Dune Library, Supercharged",
                body: "Connect your saved Dune queries. The AI knows every column in every query and generates the right visualization on demand. No more copy-pasting CSVs.",
              },
              {
                icon: TrendingUp,
                title: "Live Token Snapshots",
                body: "Price, market cap, volume, and 24h change — pulled from CoinGecko and on-chain sources. Supports Ethereum, Solana, Base, Arbitrum, and 15+ chains.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border/30 bg-card/20 p-6" data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-5 h-5 text-blue-400/80 mb-4" />
                <h3 className="text-sm font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">How It Works</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-6">
                From prompt to chart in 10 seconds
              </h2>
              <div className="space-y-6">
                {[
                  {
                    num: "01",
                    title: "You ask a question",
                    detail: "\"Show me PUMP revenue metrics\" — natural language, no syntax to learn.",
                  },
                  {
                    num: "02",
                    title: "AI selects the data source",
                    detail: "Matches your prompt against your Dune query library, DeFiLlama, CoinGecko, or Allium on-chain APIs.",
                  },
                  {
                    num: "03",
                    title: "Chart renders instantly",
                    detail: "Bar, line, area, or table — with proper axis labels, formatting, and an AI-generated analytical subtitle.",
                  },
                  {
                    num: "04",
                    title: "Drag, reorder, iterate",
                    detail: "Build a custom dashboard. Refresh any chart for live data. Ask follow-up questions to drill deeper.",
                  },
                ].map(({ num, title, detail }) => (
                  <div key={num} className="flex gap-4" data-testid={`step-${num}`}>
                    <span className="text-[10px] font-mono text-muted-foreground/30 pt-1 w-6 shrink-0">{num}</span>
                    <div>
                      <h3 className="text-sm font-semibold mb-1">{title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-xl border border-border/30 bg-card/20 p-6 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="w-4 h-4 text-blue-400/60" />
                  <span className="text-xs text-muted-foreground/60 font-mono">data agent</span>
                </div>
                <div className="space-y-3">
                  {[
                    { step: "Analyzing prompt...", done: true },
                    { step: "Selected: Dune query #5934433 (PUMP Revenue Metrics)", done: true },
                    { step: "Mapped columns: date → x, daily_revenue → y", done: true },
                    { step: "Rendering line chart with currency formatting", done: true },
                    { step: "Generated subtitle: \"Annualized ~$413M on 30D MA basis\"", done: false },
                  ].map(({ step, done }, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-blue-400 animate-pulse"}`} />
                      <span className="text-[11px] text-muted-foreground font-mono">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">Full Platform</p>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
              Research to conviction, all in one place
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: "AI Deal Enrichment",
                body: "Paste any link — tweet, GitHub, website. A 7-agent pipeline identifies, researches, and fact-checks the company in under a minute.",
              },
              {
                icon: BarChart3,
                title: "Smart Data Dashboard",
                body: "Ask for any chart in plain English. AI generates visualizations from your Dune queries, DeFiLlama, and on-chain data sources.",
              },
              {
                icon: LineChart,
                title: "Token Intelligence",
                body: "Live price snapshots, Dune query library, and AI-generated research reports with on-chain analysis for liquid tokens.",
              },
              {
                icon: Globe,
                title: "Deep Research Reports",
                body: "Long-form AI research with live web search. Adjacent reads, competitive landscape, and regulatory analysis.",
              },
              {
                icon: Layers,
                title: "Pipeline Management",
                body: "Six stages from Discovered to Invested. Kanban board, tagging, notes, and excitement scoring.",
              },
              {
                icon: Shield,
                title: "Verified Intelligence",
                body: "Every claim fact-checked. Fabricated URLs stripped. Unverified funding amounts flagged. Zero hallucinations policy.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border/30 bg-card/20 p-5" data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-4 h-4 text-foreground/60 mb-3" />
                <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                  {title}
                  <ArrowUpRight className="w-3 h-3 text-muted-foreground/20" />
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
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
