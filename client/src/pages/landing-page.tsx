import { Button } from "@/components/ui/button";
import {
  ArrowRight, Search, BarChart3, Brain,
  Zap, Globe, Shield, TrendingUp,
  ArrowUpRight, ShieldCheck, Sparkles, Twitter,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const CHART_COLORS = ["#5b8def", "#7ca3f4", "#4a7de0", "#6690ed"];

function TypingDemo() {
  const inputs = [
    "https://x.com/pumpdotfun",
    "hyperliquid.xyz",
    "AI infrastructure startup from YC W24",
    "Show me revenue vs buybacks for PUMP",
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
          <span className="text-emerald-500">complete</span>
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
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] text-muted-foreground">All claims independently verified</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-foreground/60" />
            <span className="text-[10px] text-muted-foreground">Research report ready</span>
          </div>
          <div className="flex items-center gap-1.5">
            <BarChart3 className="w-3 h-3 text-blue-400/60" />
            <span className="text-[10px] text-muted-foreground">3 charts generated</span>
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
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.12] mb-5">
                Paste a link.<br />
                <span className="text-muted-foreground">Know everything.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-md">
                Drop a tweet, a website, or a token name. In under a minute, you'll have
                a verified research hub — company intelligence, market data, and charts you
                can actually make decisions with.
              </p>
            </div>

            <TypingDemo />

            <div className="flex items-center gap-3">
              <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                Start researching
                <ArrowRight className="w-4 h-4" />
              </Button>
              <a href="#what-you-get">
                <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                  See what you get
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
              From curiosity to conviction
            </h2>
            <p className="text-base text-muted-foreground max-w-xl mx-auto leading-relaxed">
              You found something interesting. Now you need to know if it's real.
              Research Everything takes you from "this looks cool" to "here's my thesis"
              — for early-stage companies and liquid tokens alike.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-10">
            {[
              {
                icon: Zap,
                title: "Instant intelligence",
                body: "One input is all it takes. You get back a complete company profile, verified claims, founder backgrounds, and competitive context — in under a minute.",
              },
              {
                icon: TrendingUp,
                title: "Market data that matters",
                body: "For liquid tokens, see live pricing, volume, and on-chain analytics. Ask any question in plain English and get a chart back instantly.",
              },
              {
                icon: Shield,
                title: "Nothing fabricated",
                body: "Every fact is checked against live sources. If something can't be verified, you'll know. No hallucinated URLs, no made-up funding rounds.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-5 h-5 text-foreground/60 mb-4" />
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
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground/60 mb-3">The experience</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
                You ask. We deliver.
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                No setup, no configuration, no dashboards to maintain. Just tell us
                what you're looking at and we'll build your research hub in real time.
              </p>

              <div className="space-y-6">
                {[
                  {
                    title: "Works with anything",
                    body: "Tweets, company websites, GitHub repos, token names, or just a description — we figure out what you mean.",
                  },
                  {
                    title: "Charts on demand",
                    body: "\"Show me revenue over time\" or \"What's the P/E ratio?\" — ask in plain English. Get a publication-ready chart back.",
                  },
                  {
                    title: "Research that goes deep",
                    body: "When a quick snapshot isn't enough, generate a long-form report covering competitive landscape, regulatory risk, and adjacent opportunities.",
                  },
                  {
                    title: "Your pipeline, organized",
                    body: "Track everything from first look to final decision. Every deal you research stays in your pipeline, enriched and ready when you need it.",
                  },
                ].map(({ title, body }) => (
                  <div key={title} data-testid={`experience-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                    <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                      {title}
                      <ArrowUpRight className="w-3 h-3 text-muted-foreground/20" />
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden lg:block">
              <div className="rounded-xl border border-border/30 bg-card/10 p-6">
                <p className="text-[10px] font-mono text-muted-foreground/40 mb-5">What a research hub looks like</p>
                <div className="space-y-4">
                  {[
                    { label: "Company Profile", detail: "Verified overview, sector, stage, business model" },
                    { label: "Founder Intelligence", detail: "Backgrounds, prior exits, verified social links" },
                    { label: "Competitive Landscape", detail: "Key competitors, positioning, market dynamics" },
                    { label: "Token Snapshot", detail: "Live price, market cap, volume, 24h change" },
                    { label: "On-Demand Charts", detail: "Revenue, volume, staking, protocol-specific metrics" },
                    { label: "Deep Research Report", detail: "Long-form analysis with cited sources" },
                    { label: "AI Next Steps", detail: "What to ask in the call, who to reference check" },
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

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug mb-4">
              Built for how VCs actually work
            </h2>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
              You're scanning Twitter, getting pinged deals on Telegram, clicking through
              pitch decks — and none of it is connected. Until now.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Globe,
                title: "Capture from anywhere",
                body: "Right-click any webpage with our browser extension, paste a link in the app, or forward a deal via Telegram. It all ends up in one place.",
              },
              {
                icon: Brain,
                title: "Ask, don't search",
                body: "Stop digging through dashboards. Just ask what you want to know — in plain language — and get an answer with the data to back it up.",
              },
              {
                icon: BarChart3,
                title: "Early-stage or liquid",
                body: "Same workflow whether you're evaluating a pre-seed founder or a $1B token. The research adapts to what you're looking at.",
              },
              {
                icon: Shield,
                title: "Trust what you read",
                body: "We verify before we show. If we can't confirm a claim, we tell you. Your research hub is clean, not impressive.",
              },
              {
                icon: Sparkles,
                title: "Know what to do next",
                body: "Every research hub comes with AI-generated next steps — who to talk to, what to ask, and what to watch out for.",
              },
              {
                icon: TrendingUp,
                title: "Stay current",
                body: "Token prices update live. Charts refresh on demand. Your research doesn't go stale the moment you save it.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-border/20 bg-card/10 p-5" data-testid={`value-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                <Icon className="w-4 h-4 text-foreground/50 mb-3" />
                <h3 className="text-sm font-semibold mb-1.5">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 border-t">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
            Your next conviction starts here
          </h2>
          <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
            Sign in with email or wallet. Drop your first link and see your research hub
            come together in real time. No credit card required.
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
