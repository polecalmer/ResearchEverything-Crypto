import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Zap, ArrowRight, Search, FileSearch, ShieldCheck, Sparkles,
  Globe, Chrome, BarChart3, Users, TrendingUp, CheckCircle2,
} from "lucide-react";

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.03] via-transparent to-primary/[0.06] dark:from-primary/[0.08] dark:via-transparent dark:to-primary/[0.12]" />
      <div className="absolute inset-0">
        <div className="absolute top-20 left-[10%] w-72 h-72 bg-primary/[0.04] dark:bg-primary/[0.08] rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-[15%] w-96 h-96 bg-primary/[0.03] dark:bg-primary/[0.06] rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-6xl mx-auto px-6 pt-32 pb-24">
        <div className="text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/80 backdrop-blur-sm text-xs font-medium text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            Built-in hallucination firewall
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
            <span className="block">Turn any link into</span>
            <span className="block bg-gradient-to-r from-primary via-blue-500 to-primary bg-clip-text text-transparent">
              deal intelligence
            </span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg sm:text-xl text-muted-foreground leading-relaxed">
            Drop a URL, tweet, or founder profile. Three AI agents research, verify, and build
            a complete deal card — with every claim fact-checked before it hits your pipeline.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <Link href="/auth">
              <Button size="lg" className="text-base px-8 h-12 gap-2" data-testid="button-cta-start">
                Start for free
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <a href="#how-it-works">
              <Button variant="outline" size="lg" className="text-base px-8 h-12" data-testid="button-cta-how">
                See how it works
              </Button>
            </a>
          </div>

          <div className="flex items-center justify-center gap-8 pt-8 text-sm text-muted-foreground">
            {[
              { label: "AI-verified data", icon: ShieldCheck },
              { label: "3-agent pipeline", icon: Sparkles },
              { label: "Chrome extension", icon: Chrome },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-primary/70" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "01",
      icon: Globe,
      title: "Drop any input",
      description: "Paste a company website, a tweet, a founder's LinkedIn profile, a Product Hunt page, a GitHub repo — or just type a company name.",
      color: "from-blue-500/10 to-blue-500/5 dark:from-blue-500/20 dark:to-blue-500/10",
    },
    {
      step: "02",
      icon: Search,
      title: "3 AI agents go to work",
      description: "Agent 1 identifies the company. Agent 2 researches deeply with live web search. Agent 3 fact-checks every claim and strips anything unverified.",
      color: "from-violet-500/10 to-violet-500/5 dark:from-violet-500/20 dark:to-violet-500/10",
    },
    {
      step: "03",
      icon: BarChart3,
      title: "Clean deal card appears",
      description: "A verified deal card with founders, funding, competitive landscape, tags, and AI-generated next steps — all fact-checked and ready for your pipeline.",
      color: "from-emerald-500/10 to-emerald-500/5 dark:from-emerald-500/20 dark:to-emerald-500/10",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            From link to deal card in seconds
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No manual data entry. No hallucinated facts. Just verified deal intelligence.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {steps.map(({ step, icon: Icon, title, description, color }) => (
            <div key={step} className="relative group">
              <div className={`rounded-xl p-8 bg-gradient-to-b ${color} border transition-all duration-300`}>
                <div className="text-xs font-mono text-primary/60 mb-4">{step}</div>
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: Search,
      title: "Universal input",
      description: "Company websites, tweets, founder profiles, blog posts, GitHub repos, Product Hunt pages — works with anything.",
    },
    {
      icon: ShieldCheck,
      title: "Hallucination firewall",
      description: "Every claim is independently verified with live web search. Unverified data is stripped before it reaches you.",
    },
    {
      icon: Sparkles,
      title: "Smart next steps",
      description: "AI-generated, company-specific recommendations. A QA agent verifies each suggestion against actual deal data.",
    },
    {
      icon: FileSearch,
      title: "Deep research",
      description: "Funding history, competitive landscape, founder backgrounds, team size, business model — all researched and verified.",
    },
    {
      icon: Chrome,
      title: "Chrome extension",
      description: "Right-click on any webpage to instantly add it to your pipeline. The AI handles the rest.",
    },
    {
      icon: Users,
      title: "Pipeline management",
      description: "Kanban board view from Discovered to Invested. Tag, note, and track every deal in your funnel.",
    },
  ];

  return (
    <section className="py-24 px-6 border-t">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            Built for serious deal sourcing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Every feature designed to save you hours of manual research and data entry.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="p-6 rounded-xl border bg-card/50 hover:bg-card transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-base font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsSection() {
  const stats = [
    { value: "3", label: "AI agents per enrichment", icon: Sparkles },
    { value: "100%", label: "Claims fact-checked", icon: ShieldCheck },
    { value: "<60s", label: "Link to deal card", icon: TrendingUp },
    { value: "0", label: "Hallucinated facts tolerated", icon: CheckCircle2 },
  ];

  return (
    <section className="py-20 px-6 border-t bg-gradient-to-b from-transparent to-primary/[0.02] dark:to-primary/[0.04]">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {stats.map(({ value, label, icon: Icon }) => (
            <div key={label} className="text-center space-y-2">
              <Icon className="w-5 h-5 text-primary mx-auto mb-1" />
              <div className="text-3xl sm:text-4xl font-bold tracking-tight">{value}</div>
              <div className="text-sm text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="py-24 px-6 border-t">
      <div className="max-w-3xl mx-auto text-center space-y-8">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Your deal pipeline, supercharged
        </h2>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto">
          Stop spending hours on manual research. Let AI agents do the heavy lifting while you focus on making investment decisions.
        </p>
        <Link href="/auth">
          <Button size="lg" className="text-base px-10 h-12 gap-2" data-testid="button-cta-bottom">
            Get started
            <ArrowRight className="w-4 h-4" />
          </Button>
        </Link>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-lg">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-base font-semibold tracking-tight">BookMark</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth">
              <Button variant="ghost" size="sm" data-testid="button-nav-login">Sign in</Button>
            </Link>
            <Link href="/auth">
              <Button size="sm" data-testid="button-nav-signup">Get started</Button>
            </Link>
          </div>
        </div>
      </nav>

      <HeroSection />
      <HowItWorksSection />
      <FeaturesSection />
      <StatsSection />
      <CTASection />

      <footer className="border-t py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="w-3.5 h-3.5" />
            <span>BookMark</span>
          </div>
          <p className="text-xs text-muted-foreground">AI-powered deal intelligence for VCs</p>
        </div>
      </footer>
    </div>
  );
}
