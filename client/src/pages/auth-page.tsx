import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, ShieldCheck, Brain, FileSearch, Sparkles, Wallet } from "lucide-react";
import { SessionsMark } from "@/components/sessions-mark";

export default function AuthPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-background relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 20% 20%, rgba(125,207,255,0.10) 0%, transparent 60%), radial-gradient(50% 40% at 80% 80%, rgba(187,154,247,0.08) 0%, transparent 60%)",
        }}
      />

      <div className="relative flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-10">
          <div className="flex items-center gap-2.5 mb-2">
            <SessionsMark size={20} />
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent">
                Sessions
              </span>
              <span className="text-[9px] uppercase tracking-[0.32em] text-muted-foreground/55 mt-1">
                the perspective layer
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground/55">
              <span className="text-cyan-400/80">01</span> &nbsp; Enter
            </p>
            <h1
              className="text-[40px] font-semibold tracking-[-0.025em] leading-[0.96] bg-gradient-to-b from-foreground to-foreground/65 bg-clip-text text-transparent"
              data-testid="text-auth-title"
            >
              Begin a<br />
              <span className="text-muted-foreground/55">session.</span>
            </h1>
            <p className="text-sm text-muted-foreground/75 leading-relaxed max-w-[28ch]">
              Sign in with email or wallet. An embedded Tempo wallet is provisioned for you automatically.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              className="w-full h-11 text-sm group"
              onClick={() => login()}
              data-testid="button-auth-submit"
            >
              Sign in / Sign up
              <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </Button>

            <div className="flex items-center gap-2 pt-1">
              <Wallet className="w-3 h-3 text-muted-foreground/60" />
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/55">
                Powered by Privy
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative hidden lg:flex items-center justify-center border-l border-border/40 p-12">
        <div className="max-w-md space-y-10">
          <div className="space-y-4">
            <p className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground/55">
              <span className="text-cyan-400/80">02</span> &nbsp; What you get
            </p>
            <h2 className="text-[34px] font-semibold tracking-[-0.025em] leading-[0.98] bg-gradient-to-b from-foreground to-foreground/65 bg-clip-text text-transparent">
              A research brain<br />
              <span className="text-muted-foreground/55">that compounds.</span>
            </h2>
            <p className="text-sm text-muted-foreground/70 leading-relaxed max-w-[34ch]">
              Conversational research, deep reports, financial models, and on-chain data — every session adds to your perspective.
            </p>
          </div>

          <div className="space-y-px">
            {[
              { icon: Brain, title: "Conversational research", desc: "Multi-turn sessions with citations" },
              { icon: FileSearch, title: "Deep reports & DCF models", desc: "Generated from your prompts" },
              { icon: ShieldCheck, title: "Hallucination firewall", desc: "Every claim verified before saving" },
              { icon: Sparkles, title: "Pay per session", desc: "Micropayments via Tempo wallet" },
            ].map(({ icon: Icon, title, desc }, i) => (
              <div
                key={title}
                className="flex items-center gap-4 py-3.5 border-b border-border/30 last:border-b-0"
                data-testid={`row-feature-${i}`}
              >
                <span className="text-[10px] tabular-nums text-muted-foreground/40 font-mono w-5">
                  0{i + 1}
                </span>
                <Icon className="w-3.5 h-3.5 text-cyan-400/70 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium tracking-tight">{title}</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
