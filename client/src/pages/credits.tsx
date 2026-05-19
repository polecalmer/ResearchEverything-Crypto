/**
 * Credits / pricing page.
 *
 * Beta pricing: 20 free turns at signup, then $7 per turn (or $70 for
 * a 10-pack — same per-turn rate, one transaction). Stripe Checkout
 * handles the payment; the webhook in server/webhookHandlers.ts grants
 * credits on success.
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Coins, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

interface PurchaseOption {
  lookupKey: string;
  label: string;
  priceUsd: number;
  credits: number;
  highlight?: boolean;
  note?: string;
}

const PURCHASE_OPTIONS: PurchaseOption[] = [
  {
    lookupKey: "session_single",
    label: "1 turn",
    priceUsd: 7,
    credits: 1,
    note: "One-off top-up.",
  },
  {
    lookupKey: "session_pack_10",
    label: "10 turns",
    priceUsd: 70,
    credits: 10,
    highlight: true,
    note: "Same rate, one transaction. Most users pick this.",
  },
];

export default function CreditsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const [loadingSku, setLoadingSku] = useState<string | null>(null);

  const credits = (user as any)?.credits ?? 0;
  const isAdmin = credits >= 999_000;
  const balanceDisplay = isAdmin ? "Unlimited (admin)" : `${credits} ${credits === 1 ? "turn" : "turns"}`;

  // Stripe Checkout redirects back to /credits?checkout=success or =cancelled.
  // Surface that with a toast and refresh the user query so the new balance
  // shows up immediately.
  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] || "");
    const result = params.get("checkout");
    if (result === "success") {
      toast({ title: "Payment received", description: "Your credits will appear in a moment." });
    } else if (result === "cancelled") {
      toast({ title: "Checkout cancelled", description: "No charge was made.", variant: "destructive" });
    }
  }, [location, toast]);

  const handlePurchase = async (lookupKey: string) => {
    setLoadingSku(lookupKey);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ lookupKey }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Checkout failed (${res.status})`);
      }
      const { url } = await res.json();
      if (!url) throw new Error("Checkout returned no URL");
      window.location.href = url;
    } catch (err: any) {
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
      setLoadingSku(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="text-billing-title">
            Credits
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Beta pricing: 20 free turns on signup, then $7 per turn.
          </p>
        </div>

        {/* Current balance card */}
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-amber-900/30 p-2">
              <Coins className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Your balance</div>
              <div className="text-base font-semibold" data-testid="credits-balance">{balanceDisplay}</div>
            </div>
          </div>
          {credits === 0 && !isAdmin && (
            <div className="text-xs text-rose-300">Out of turns — purchase below to continue.</div>
          )}
        </div>

        {/* Purchase grid */}
        {!isAdmin && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PURCHASE_OPTIONS.map((opt) => {
              const isLoading = loadingSku === opt.lookupKey;
              const perTurn = opt.priceUsd / opt.credits;
              return (
                <div
                  key={opt.lookupKey}
                  className={`rounded-lg border p-4 flex flex-col gap-3 ${
                    opt.highlight
                      ? "border-amber-700/50 bg-amber-900/10"
                      : "border-border/40 bg-card/40"
                  }`}
                  data-testid={`purchase-card-${opt.lookupKey}`}
                >
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        ${perTurn.toFixed(0)} per turn
                      </div>
                    </div>
                    <div className="text-xl font-semibold">${opt.priceUsd}</div>
                  </div>
                  {opt.note && (
                    <div className="text-[11px] text-muted-foreground/80">{opt.note}</div>
                  )}
                  <Button
                    size="sm"
                    onClick={() => handlePurchase(opt.lookupKey)}
                    disabled={!!loadingSku}
                    className="w-full"
                  >
                    {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Purchase"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* How it works */}
        <div className="space-y-2 pt-2">
          <h2 className="text-sm font-medium">How turns work</h2>
          {[
            "1 turn = 1 prompt you send to the research agent.",
            "Every new account starts with 20 free turns (beta).",
            "After your free turns are used, top up at $7 per turn.",
            "Payments are one-time via Stripe — no subscription, no recurring charges.",
            "Wallet-only signups: we'll collect an email at first purchase for the Stripe receipt.",
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check className="w-3 h-3 mt-1 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
