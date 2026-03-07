import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Coins, Loader2, Check, Crown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreditProduct {
  product_id: string;
  product_name: string;
  product_description: string;
  product_metadata: any;
  price_id: string;
  unit_amount: number;
  currency: string;
  recurring_interval: string | null;
  price_type: string;
}

interface SubscriptionInfo {
  subscriptionStatus: string | null;
  subscriptionId: string | null;
  subscriptionPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export default function CreditsPage() {
  const { toast } = useToast();

  const { data: creditsData } = useQuery<{ credits: number }>({
    queryKey: ["/api/credits"],
  });

  const { data: subscription } = useQuery<SubscriptionInfo>({
    queryKey: ["/api/subscription"],
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<CreditProduct[]>({
    queryKey: ["/api/credits/products"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async ({ priceId, mode }: { priceId: string; mode: string }) => {
      const res = await apiRequest("POST", "/api/credits/checkout", { priceId, mode });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast({ title: "Checkout failed", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/cancel");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
      toast({ title: "Subscription will cancel at end of billing period" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to cancel", description: error.message, variant: "destructive" });
    },
  });

  const credits = creditsData?.credits ?? 0;
  const isSubscribed = subscription?.subscriptionStatus === "active" || subscription?.subscriptionStatus === "trialing";
  const isCanceling = isSubscribed && subscription?.cancelAtPeriodEnd;

  const subscriptionProducts = products.filter((p) => p.recurring_interval);
  const creditProducts = products.filter((p) => !p.recurring_interval);

  const monthlyPlan = subscriptionProducts.find((p) => p.recurring_interval === "month");
  const annualPlan = subscriptionProducts.find((p) => p.recurring_interval === "year");

  const creditPackList = creditProducts.reduce<Record<string, CreditProduct>>((acc, p) => {
    if (!acc[p.product_id]) acc[p.product_id] = p;
    return acc;
  }, {});
  const creditPackArray = Object.values(creditPackList).sort((a, b) => a.unit_amount - b.unit_amount);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your subscription and credits.</p>
        </div>

        <div className="flex items-center gap-3 py-4 border-t border-b">
          <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center">
            <Coins className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Current Balance</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="text-credit-balance">{credits} credits</p>
          </div>
        </div>

        {isSubscribed && subscription?.subscriptionPeriodEnd && (
          <div className="flex items-center justify-between p-4 rounded-lg border border-foreground/10 bg-accent/30">
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5 text-foreground" />
              <div>
                <p className="text-sm font-semibold">BookMark Pro</p>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="w-3 h-3" />
                  {isCanceling ? (
                    <span>Cancels {new Date(subscription.subscriptionPeriodEnd).toLocaleDateString()}</span>
                  ) : (
                    <span>Renews {new Date(subscription.subscriptionPeriodEnd).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>
            {isCanceling ? (
              <span className="text-xs text-muted-foreground">Canceling</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                data-testid="button-cancel-subscription"
              >
                {cancelMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Cancel"}
              </Button>
            )}
          </div>
        )}

        {!isSubscribed && (
          <div>
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Subscribe</h2>
            <p className="text-sm text-muted-foreground mb-4">Get 33 enrichment credits each billing period, included with your subscription.</p>

            {productsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {monthlyPlan && (
                  <div className="p-5 rounded-lg border" data-testid="card-plan-monthly">
                    <div className="space-y-1 mb-4">
                      <h3 className="font-semibold">Monthly</h3>
                      <p className="text-2xl font-bold tabular-nums">$20<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                      <p className="text-xs text-muted-foreground">33 credits included</p>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => checkoutMutation.mutate({ priceId: monthlyPlan.price_id, mode: "subscription" })}
                      disabled={checkoutMutation.isPending}
                      data-testid="button-subscribe-monthly"
                    >
                      {checkoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
                    </Button>
                  </div>
                )}
                {annualPlan && (
                  <div className="p-5 rounded-lg border border-foreground/20 bg-accent/30 relative" data-testid="card-plan-annual">
                    <span className="absolute -top-2.5 left-4 text-[10px] font-medium bg-foreground text-background px-2 py-0.5 rounded">Save $90</span>
                    <div className="space-y-1 mb-4">
                      <h3 className="font-semibold">Annual</h3>
                      <p className="text-2xl font-bold tabular-nums">$150<span className="text-sm font-normal text-muted-foreground">/yr</span></p>
                      <p className="text-xs text-muted-foreground">33 credits/mo included · $12.50/mo</p>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => checkoutMutation.mutate({ priceId: annualPlan.price_id, mode: "subscription" })}
                      disabled={checkoutMutation.isPending}
                      data-testid="button-subscribe-annual"
                    >
                      {checkoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Buy Extra Credits</h2>
          <p className="text-sm text-muted-foreground mb-4">Need more? Purchase additional credits any time.</p>

          {productsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : creditPackArray.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Credit packs are being set up. Please check back shortly.</p>
          ) : (
            <div className="grid gap-4">
              {creditPackArray.map((product) => {
                const creditsAmount = parseInt(product.product_metadata?.credits || "0", 10);
                const priceFormatted = (product.unit_amount / 100).toFixed(2);
                const perCredit = creditsAmount > 0 ? (product.unit_amount / creditsAmount / 100).toFixed(2) : "0.00";
                const isBestValue = creditsAmount >= 50;

                return (
                  <div
                    key={product.product_id}
                    className={`flex items-center justify-between p-5 rounded-lg border transition-colors ${isBestValue ? "border-foreground/20 bg-accent/30" : "border-border"}`}
                    data-testid={`card-credit-pack-${product.product_id}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{product.product_name}</h3>
                        {isBestValue && (
                          <span className="text-[10px] font-medium bg-foreground text-background px-1.5 py-0.5 rounded">Best Value</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">${priceFormatted} — ${perCredit}/credit</p>
                    </div>
                    <Button
                      onClick={() => checkoutMutation.mutate({ priceId: product.price_id, mode: "payment" })}
                      disabled={checkoutMutation.isPending}
                      className="min-w-[100px]"
                      data-testid={`button-buy-${product.product_id}`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "Buy"
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t pt-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">How it works</h2>
          <div className="space-y-3">
            {[
              "Each deal enrichment (via Add Deal or Quick Capture) uses 1 credit",
              "Subscribers get 33 credits each billing period, automatically",
              "Buy extra credit packs any time — credits never expire",
              "Payments are processed securely via Stripe",
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
