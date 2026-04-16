import { Button } from "@/components/ui/button";
import {
  ArrowRight, Brain, Twitter,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const CHART_COLORS = ["#5b8def", "#7ca3f4", "#4a7de0", "#6690ed"];

function TypingDemo() {
  const inputs = [
    "https://x.com/pumpdotfun",
    "hyperliquid.xyz",
    "ethena.fi",
    "Show me revenue vs buybacks for PUMP",
    "Who founded Morpho?",
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

function CircleCheck() {
  return (
    <span className="w-3 h-3 rounded-full border border-emerald-500/40 bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
      <svg className="w-1.5 h-1.5 text-emerald-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5L5 9L9.5 3.5" /></svg>
    </span>
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
          <span className="text-emerald-500">8 agents complete</span>
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
            <p className="text-[9px] font-medium mb-1">Revenue Trend</p>
            <MiniBarChart />
          </div>
          <div className="rounded border border-border/20 bg-background/40 p-2.5">
            <p className="text-[9px] font-medium mb-1">Buyback Analysis</p>
            <MiniLineChart />
          </div>
        </div>

        <div className="border-t border-border/20 pt-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <CircleCheck />
            <span className="text-[10px] text-muted-foreground">All claims independently verified</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CircleCheck />
            <span className="text-[10px] text-muted-foreground">Deep research report generated</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CircleCheck />
            <span className="text-[10px] text-muted-foreground">3 charts generated from on-chain data</span>
          </div>
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
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/50 mb-3">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              One input. Eight agents. Complete intelligence.
            </h2>
            <p className="text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Drop a link, a name, or even a vague description. Our agent team
              fans out — scraping the web, identifying the project, detecting
              tokens, verifying contracts, fact-checking claims, and building
              your research foundation — all in parallel.
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="space-y-0">
              {[
                {
                  step: "1",
                  agent: "Web Scraper",
                  detail: "Fetches and extracts content from the URL you provide — websites, tweets, GitHub repos, LinkedIn profiles, blog posts.",
                },
                {
                  step: "2",
                  agent: "Identifier",
                  detail: "Determines the company name, sector, and key facts from the scraped content, even from partial or ambiguous inputs.",
                },
                {
                  step: "3",
                  agent: "Token Scanner",
                  detail: "Detects if the company has a liquid token, identifies the ticker and tier, and routes to contract verification if found.",
                },
                {
                  step: "4",
                  agent: "Contract Finder + Verifier",
                  detail: "Searches for contract addresses across chains, then verifies each against block explorers and official documentation.",
                },
                {
                  step: "5",
                  agent: "Research Agent",
                  detail: "Builds the full research profile — competitive landscape, funding history, founder backgrounds, business model analysis.",
                },
                {
                  step: "6",
                  agent: "Fact Checker",
                  detail: "Cross-references every claim against live sources. Flags anything unverifiable. Cleans hallucinated URLs and fabricated data.",
                },
                {
                  step: "7",
                  agent: "DD Reads Finder",
                  detail: "Surfaces the most relevant external research — CFTC filings, governance proposals, audit reports, analyst deep-dives.",
                },
              ].map(({ step, agent, detail }) => (
                <div key={step} className="flex gap-5 py-4 group" data-testid={`agent-step-${step}`}>
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full border border-border/30 bg-card/30 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-mono text-muted-foreground/60">{step}</span>
                    </div>
                    {step !== "7" && <div className="w-px flex-1 bg-border/15 mt-1" />}
                  </div>
                  <div className="pb-2">
                    <h3 className="text-sm font-semibold mb-1">{agent}</h3>
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
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight leading-snug mb-4">
              What you get back
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Every session produces a living intelligence hub — not a
              static report. Build models, generate charts, write reports, go deeper.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-10">
            {[
              {
                title: "Verified intelligence",
                body: "Company profile, founder backgrounds, funding history, competitive landscape — all fact-checked against live sources. Nothing fabricated.",
              },
              {
                title: "On-chain data on demand",
                body: "Ask any question in plain English. \"Show me revenue over time\" or \"What's Hyperliquid's P/E?\" — get a chart back instantly from Dune, DeFiLlama, or CoinGecko.",
              },
              {
                title: "Deep research reports",
                body: "When a quick snapshot isn't enough, generate a long-form analysis covering market dynamics, regulatory risk, tokenomics, and adjacent opportunities.",
              },
            ].map(({ title, body }) => (
              <div key={title} data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <h3 className="text-base font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr,1.2fr] gap-20 items-start">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">The input layer</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
                Capture from anywhere.<br />
                The agents do the rest.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                Sessions accepts anything — a tweet you saw, a website someone
                shared, a token ticker, a vague description. The agents figure
                out what you mean and build the intelligence from there.
              </p>

              <div className="space-y-6">
                {[
                  {
                    title: "Browser extension",
                    body: "Right-click any webpage and send it directly to your research queue. The agents start working immediately.",
                  },
                  {
                    title: "Telegram bot",
                    body: "Forward a message to @SessionsBot. It extracts the link, runs the agents, and replies with a summary.",
                  },
                  {
                    title: "Plain language",
                    body: "Don't have a link? Just describe what you're looking at. \"AI infra startup from YC W24\" is enough to get started.",
                  },
                  {
                    title: "Charts on demand",
                    body: "Once a company is researched, ask any data question. The system queries Dune, DeFiLlama, and CoinGecko to build the chart.",
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
                <p className="text-[10px] font-mono text-muted-foreground/40 mb-5">What the agents produce</p>
                <div className="space-y-4">
                  {[
                    { label: "Company Profile", detail: "Verified overview, sector, stage, business model" },
                    { label: "Founder Intelligence", detail: "Backgrounds, prior exits, verified social links" },
                    { label: "Token Snapshot", detail: "Live price, market cap, volume, contract addresses" },
                    { label: "Competitive Landscape", detail: "Key competitors, positioning, market dynamics" },
                    { label: "On-Demand Charts", detail: "Revenue, volume, TVL, protocol-specific metrics" },
                    { label: "Deep Research Report", detail: "Long-form analysis with cited sources" },
                    { label: "AI Next Steps", detail: "What to ask, who to reference check, what to watch" },
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
            the agents build your research foundation in real time.
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
