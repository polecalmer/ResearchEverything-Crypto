import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Coins, Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CreditProduct {
  product_id: string;
  product_name: string;
  product_description: string;
  product_metadata: any;
  price_id: string;
  unit_amount: number;
  currency: string;
}

export default function CreditsPage() {
  const { toast } = useToast();

  const { data: creditsData } = useQuery<{ credits: number }>({
    queryKey: ["/api/credits"],
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<CreditProduct[]>({
    queryKey: ["/api/credits/products"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/credits/checkout", { priceId });
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

  const credits = creditsData?.credits ?? 0;

  const grouped = products.reduce<Record<string, CreditProduct>>((acc, p) => {
    if (!acc[p.product_id]) acc[p.product_id] = p;
    return acc;
  }, {});

  const productList = Object.values(grouped).sort((a, b) => a.unit_amount - b.unit_amount);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Credits</h1>
          <p className="text-sm text-muted-foreground mt-1">Each deal enrichment uses 1 credit. Purchase credits to continue adding deals.</p>
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

        <div>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Buy Credits</h2>

          {productsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : productList.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Credit packs are being set up. Please check back shortly.</p>
          ) : (
            <div className="grid gap-4">
              {productList.map((product) => {
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
                      onClick={() => checkoutMutation.mutate(product.price_id)}
                      disabled={checkoutMutation.isPending}
                      className="min-w-[100px]"
                      data-testid={`button-buy-${product.product_id}`}
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        `Buy`
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
              "Credits never expire — use them at your own pace",
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
