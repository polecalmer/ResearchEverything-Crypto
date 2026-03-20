import { Button } from "@/components/ui/button";
import {
  ArrowRight, ShieldCheck, Sparkles, Search, Bookmark,
  ArrowUpRight, Eye,
} from "lucide-react";
import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const TYPING_INPUTS = [
  "https://x.com/adi_baradwaj",
  "stripe.com",
  "AI infrastructure startup from YC W24",
  "https://github.com/fermi-labs",
];

function TypingDemo() {
  const [inputIndex, setInputIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [phase, setPhase] = useState<"typing" | "pause" | "clearing">("typing");

  const currentInput = TYPING_INPUTS[inputIndex];

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (phase === "typing") {
      if (charIndex < currentInput.length) {
        timer = setTimeout(() => setCharIndex((c) => c + 1), 45 + Math.random() * 35);
      } else {
        timer = setTimeout(() => setPhase("pause"), 2200);
      }
    } else if (phase === "pause") {
      timer = setTimeout(() => setPhase("clearing"), 100);
    } else if (phase === "clearing") {
      if (charIndex > 0) {
        timer = setTimeout(() => setCharIndex((c) => c - 1), 20);
      } else {
        setInputIndex((i) => (i + 1) % TYPING_INPUTS.length);
        setPhase("typing");
      }
    }

    return () => clearTimeout(timer);
  }, [charIndex, phase, currentInput.length]);

  return (
    <div className="font-mono text-sm">
      <span className="text-foreground">{currentInput.slice(0, charIndex)}</span>
      <span className="inline-block w-[2px] h-[14px] bg-foreground animate-pulse ml-[1px] align-middle" />
    </div>
  );
}

function DealCardPreview() {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 p-5 space-y-4 max-w-sm w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <span className="text-xs font-mono font-bold text-foreground">F</span>
          </div>
          <div>
            <p className="text-sm font-semibold">Fermi Labs</p>
            <p className="text-[10px] text-muted-foreground font-mono">AI Infra</p>
          </div>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">verified</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Building verifiable compute infrastructure for AI model inference, enabling cryptographic proofs that ML outputs were generated correctly.
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {["ZK Proofs", "AI Infra", "Seed"].map((tag) => (
          <span key={tag} className="text-[10px] px-2 py-0.5 rounded bg-accent text-muted-foreground font-mono">{tag}</span>
        ))}
      </div>
      <div className="border-t border-border/40 pt-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-3 h-3 text-emerald-500" />
          <span className="text-[10px] text-muted-foreground">3 claims verified, 1 removed</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-foreground" />
          <span className="text-[10px] text-muted-foreground">4 next steps generated</span>
        </div>
      </div>
    </div>
  );
}

function AgentPipelineVisual() {
  return (
    <div className="space-y-2 max-w-sm w-full">
      {[
        { label: "Identify", detail: "Resolving company from X profile...", color: "bg-blue-500", done: true },
        { label: "Research", detail: "Deep web search + founder backgrounds...", color: "bg-violet-500", done: true },
        { label: "Verify & Clean", detail: "Fact-checking 12 claims...", color: "bg-emerald-500", done: false },
      ].map((agent, i) => (
        <div key={agent.label} className="flex items-center gap-3">
          <div className={`w-1.5 h-1.5 rounded-full ${agent.done ? agent.color : agent.color + " animate-pulse"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{agent.label}</span>
              {agent.done && <span className="text-[9px] text-emerald-500">done</span>}
              {!agent.done && <span className="text-[9px] text-muted-foreground animate-pulse">running</span>}
            </div>
            <p className="text-[10px] text-muted-foreground truncate">{agent.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function LandingPage() {
  const { login } = usePrivy();

  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-lg border-b border-border/50">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-foreground" />
            <span className="text-sm font-semibold tracking-tight">BookMark</span>
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
                Paste a Link.<br />
                <span className="text-muted-foreground">Retain Your Context.</span><br />
                Kickstart Your Diligence.
              </h1>
              <p className="text-base text-muted-foreground leading-relaxed max-w-md">
                Watch it evolve — all in one place. No more useless bookmarks and dead links.
              </p>
            </div>

            <div className="rounded-lg border bg-card/50 p-4 max-w-md">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 font-medium">Try any input</p>
              <TypingDemo />
            </div>

            <div className="flex items-center gap-3">
              <Button size="lg" className="h-11 px-6 gap-2 text-sm" onClick={() => login()} data-testid="button-cta-start">
                Start for free
                <ArrowRight className="w-4 h-4" />
              </Button>
              <a href="#how">
                <Button variant="ghost" size="lg" className="h-11 px-4 text-sm text-muted-foreground" data-testid="button-how-it-works">
                  How it works
                </Button>
              </a>
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end gap-6 pt-4">
            <DealCardPreview />
            <AgentPipelineVisual />
          </div>
        </div>
      </section>

      <section id="how" className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr,2fr] gap-16">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">How it works</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
                Three agents.<br />Zero hallucinations.
              </h2>
            </div>

            <div className="grid sm:grid-cols-3 gap-8">
              {[
                {
                  num: "01",
                  icon: Eye,
                  title: "Identify",
                  body: "Paste anything — a tweet, a GitHub repo, a founder's LinkedIn, a company name. The Identifier agent figures out exactly which company you mean.",
                },
                {
                  num: "02",
                  icon: Search,
                  title: "Research",
                  body: "Live web search pulls real funding data, founder backgrounds, competitive landscape, and social profiles. No training-data guesses.",
                },
                {
                  num: "03",
                  icon: ShieldCheck,
                  title: "Verify & Clean",
                  body: "Every claim is independently fact-checked. Unverified funding amounts, fabricated URLs, and embellished bios are stripped before you see them.",
                },
              ].map(({ num, icon: Icon, title, body }) => (
                <div key={num} data-testid={`step-${title.toLowerCase()}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono text-muted-foreground/40">{num}</span>
                    <Icon className="w-4 h-4 text-foreground" />
                  </div>
                  <h3 className="text-sm font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6 border-t">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr,2fr] gap-16">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">What you get</p>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight leading-snug">
                Everything a deal memo needs. Nothing it doesn't.
              </h2>
            </div>

            <div className="grid sm:grid-cols-2 gap-x-12 gap-y-8">
              {[
                {
                  title: "Verified deal cards",
                  body: "Company overview, sector, business model, stage, and competitive landscape — all fact-checked against live web data.",
                },
                {
                  title: "Founder intelligence",
                  body: "Backgrounds, prior companies, and verified social profiles. Hallucinated LinkedIn URLs are caught and stripped.",
                },
                {
                  title: "AI next steps",
                  body: "Stage-aware recommendations specific to each deal. A QA agent verifies every suggestion against actual company data.",
                },
                {
                  title: "Pipeline management",
                  body: "Six stages from Discovered to Invested. Drag deals through your funnel. Tag, note, and track everything.",
                },
                {
                  title: "Chrome extension",
                  body: "Right-click any webpage to add it to your pipeline. The 3-agent system handles research automatically.",
                },
                {
                  title: "Universal input",
                  body: "Company websites, tweets, GitHub repos, Product Hunt pages, LinkedIn profiles, plain text — it all works.",
                },
              ].map(({ title, body }) => (
                <div key={title} data-testid={`feature-${title.toLowerCase().replace(/\s+/g, "-")}`}>
                  <h3 className="text-sm font-semibold mb-1.5 flex items-center gap-1.5">
                    {title}
                    <ArrowUpRight className="w-3 h-3 text-muted-foreground/30" />
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t py-6 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bookmark className="w-3 h-3" />
            <span>BookMark</span>
          </div>
          <p className="text-[10px] text-muted-foreground/40 font-mono">BookMark</p>
        </div>
      </footer>
    </div>
  );
}
