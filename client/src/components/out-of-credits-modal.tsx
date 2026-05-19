/**
 * Out-of-credits modal — surfaces when POST /messages returns 402.
 * Renders the purchase options from the server's structured response
 * (1 turn for $7, or 10 turns for $70) and kicks off Stripe Checkout.
 */

import { useState } from "react";
import { Coins, Loader2, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PurchaseOption {
  sku: string;
  label: string;
  priceUsd: number;
  credits: number;
}

interface OutOfCreditsModalProps {
  open: boolean;
  message: string;
  balance: number;
  purchaseOptions: PurchaseOption[];
  checkoutEndpoint: string;
  onClose: () => void;
}

export function OutOfCreditsModal({
  open,
  message,
  balance,
  purchaseOptions,
  checkoutEndpoint,
  onClose,
}: OutOfCreditsModalProps) {
  const [loadingSku, setLoadingSku] = useState<string | null>(null);
  // When checkout returns 400 email_required, switch the modal into
  // email-collection mode. After the user submits a valid email we
  // retry the originally-requested purchase.
  const [emailCapture, setEmailCapture] = useState<null | { pendingSku: string }>(null);
  const [emailInput, setEmailInput] = useState("");
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const { toast } = useToast();

  if (!open) return null;

  const handlePurchase = async (sku: string) => {
    setLoadingSku(sku);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(checkoutEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ lookupKey: sku }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // Wallet-only users — pivot to email capture, then retry.
        if (res.status === 400 && err?.error === "email_required") {
          setLoadingSku(null);
          setEmailCapture({ pendingSku: sku });
          return;
        }
        throw new Error(err.message || `Checkout failed (${res.status})`);
      }
      const { url } = await res.json();
      if (!url) throw new Error("Checkout returned no redirect URL.");
      window.location.href = url;
    } catch (err: any) {
      toast({
        title: "Checkout failed",
        description: err.message || "Try again in a moment.",
        variant: "destructive",
      });
      setLoadingSku(null);
    }
  };

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailCapture) return;
    setSubmittingEmail(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/user/email", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({ email: emailInput.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not save email.");
      }
      // Invalidate the user query so the new email shows up everywhere.
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      const pendingSku = emailCapture.pendingSku;
      setEmailCapture(null);
      setEmailInput("");
      // Retry the original purchase the user wanted.
      await handlePurchase(pendingSku);
    } catch (err: any) {
      toast({
        title: "Couldn't save email",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSubmittingEmail(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 bg-card border border-border/40 rounded-lg shadow-2xl p-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground/50 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {emailCapture ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="rounded-full bg-amber-900/30 p-1.5">
                <Mail className="h-4 w-4 text-amber-400" />
              </div>
              <h2 className="text-base font-semibold">Where should we send the receipt?</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Your account is wallet-only. Stripe needs an email for the receipt. We'll keep it on file for future purchases.
            </p>
            <form onSubmit={submitEmail} className="space-y-3">
              <input
                type="email"
                required
                autoFocus
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3 py-2 rounded-md bg-muted/40 border border-border/40 text-sm focus:outline-none focus:border-amber-700/60"
                data-testid="email-capture-input"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setEmailCapture(null);
                    setEmailInput("");
                  }}
                  disabled={submittingEmail}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button type="submit" size="sm" disabled={submittingEmail} className="flex-1">
                  {submittingEmail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Continue to checkout"}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="rounded-full bg-amber-900/30 p-1.5">
                <Coins className="h-4 w-4 text-amber-400" />
              </div>
              <h2 className="text-base font-semibold">You're out of turns</h2>
            </div>

            <p className="text-sm text-muted-foreground mb-5">{message}</p>

            <div className="space-y-2">
              {purchaseOptions.map((opt) => {
                const perTurn = opt.priceUsd / opt.credits;
                const isLoading = loadingSku === opt.sku;
                return (
                  <button
                    key={opt.sku}
                    onClick={() => handlePurchase(opt.sku)}
                    disabled={!!loadingSku}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-md border border-border/40 bg-muted/20 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid={`purchase-${opt.sku}`}
                  >
                    <div className="text-left">
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-muted-foreground">
                        ${perTurn.toFixed(0)} per turn
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-base font-semibold">${opt.priceUsd}</div>
                      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-3 border-t border-border/30 text-[11px] text-muted-foreground/70">
              Beta pricing: $7 per turn. Pack saves no margin but is one transaction instead of ten.
              Cancel anytime — purchases are one-time, no subscription.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
