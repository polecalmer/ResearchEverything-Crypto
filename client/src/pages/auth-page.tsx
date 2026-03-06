import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Bookmark, ArrowRight, Loader2, ShieldCheck, Search, FileSearch, Sparkles } from "lucide-react";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginMutation, registerMutation } = useAuth();
  const [, navigate] = useLocation();

  const isPending = loginMutation.isPending || registerMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    const mutation = isLogin ? loginMutation : registerMutation;
    mutation.mutate(
      { username: username.trim(), password },
      { onSuccess: () => navigate("/") },
    );
  };

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
              {isLogin ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isLogin
                ? "Sign in to access your deal pipeline"
                : "Start managing your deal flow with AI"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoFocus
                disabled={isPending}
                data-testid="input-username"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? "Enter your password" : "Choose a password (6+ chars)"}
                disabled={isPending}
                data-testid="input-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={isPending || !username.trim() || !password.trim()} data-testid="button-auth-submit">
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              {isLogin ? "Sign In" : "Create Account"}
            </Button>
          </form>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-auth"
            >
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <span className="text-primary font-medium">{isLogin ? "Sign up" : "Sign in"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex items-center justify-center bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 dark:from-primary/10 dark:via-primary/20 dark:to-primary/5 p-12 border-l">
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
              { icon: Sparkles, title: "Smart next steps", desc: "AI-generated actions verified by QA agent" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-lg bg-background/50 dark:bg-background/30">
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
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
