import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bookmark, ArrowRight, Loader2, ShieldCheck, Search, FileSearch, Sparkles, Wallet } from "lucide-react";

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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
                <Bookmark className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold tracking-tight">BookMark</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-auth-title">
              Get started
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in with your email or wallet to access your deal pipeline. You'll get an embedded Tempo wallet automatically.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              className="w-full h-12 text-base"
              onClick={() => login()}
              data-testid="button-auth-submit"
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Sign In / Sign Up
            </Button>

            <div className="flex items-center gap-2 pt-2">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Powered by Privy — email or wallet login with embedded Tempo wallet
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-accent/50 p-12 border-l">
        <div className="max-w-md space-y-8">
          <div className="space-y-4">
            <h2 className="text-3xl font-bold tracking-tight">
              AI-powered deal intelligence
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Turn any link into a structured deal card. Our 3-agent AI pipeline identifies, researches, and verifies every claim — so you never deal with hallucinated data.
            </p>
          </div>

          <div className="space-y-3">
            {[
              { icon: Search, title: "Drop any link", desc: "URL, tweet, founder profile, blog post" },
              { icon: FileSearch, title: "AI researches deeply", desc: "3 agents build a verified deal card" },
              { icon: ShieldCheck, title: "Hallucination firewall", desc: "Every claim fact-checked before saving" },
              { icon: Sparkles, title: "Pay per use", desc: "Micropayments via Tempo — pay only for what you use" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-lg bg-background/50 dark:bg-background/30">
                <div className="w-8 h-8 rounded-md bg-background flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-foreground" />
                </div>
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
