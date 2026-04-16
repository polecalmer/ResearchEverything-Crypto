import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, Loader2, ShieldCheck, Brain, FileSearch, Sparkles, Wallet } from "lucide-react";
import sessionsLogo from "@assets/sessions_logo.png";

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
    <div className="min-h-screen grid lg:grid-cols-2 bg-background">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-8">
              <img src={sessionsLogo} alt="Sessions" className="w-5 h-5 object-contain" />
              <span className="text-sm font-semibold tracking-tight">Sessions</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-auth-title">
              Get started
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sign in with your email or wallet. You'll get an embedded Tempo wallet automatically.
            </p>
          </div>

          <div className="space-y-4">
            <Button
              className="w-full h-11 text-sm"
              onClick={() => login()}
              data-testid="button-auth-submit"
            >
              Sign In / Sign Up
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            <div className="flex items-center gap-2">
              <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Powered by Privy — email or wallet login
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex items-center justify-center border-l border-border p-12">
        <div className="max-w-md space-y-8">
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-mono">How it works</p>
            <h2 className="text-2xl font-bold tracking-tight">
              AI-powered deal intelligence
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Turn any link into a structured deal card. Our 3-agent pipeline identifies, researches, and verifies every claim.
            </p>
          </div>

          <div className="space-y-1">
            {[
              { icon: Brain, title: "Drop any link", desc: "URL, tweet, founder profile, blog post" },
              { icon: FileSearch, title: "AI researches deeply", desc: "4 agents build a verified deal card" },
              { icon: ShieldCheck, title: "Hallucination firewall", desc: "Every claim fact-checked before saving" },
              { icon: Sparkles, title: "Pay per use", desc: "Micropayments via Tempo wallet" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-accent/30 transition-colors">
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
