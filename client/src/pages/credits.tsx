import { useQuery } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";

interface EnrichmentPricing {
  model: string;
  markupMultiplier: number;
  estimatedCost: string;
  lastEnrichment: {
    apiCost: string;
    totalCharge: string;
  } | null;
  currency: string;
  recipient: string;
}

export default function CreditsPage() {
  const { data: pricing, isLoading: pricingLoading } = useQuery<EnrichmentPricing>({
    queryKey: ["/api/enrichment/pricing"],
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="text-billing-title">Billing</h1>
          <p className="text-xs text-muted-foreground mt-1">Pay-per-use enrichment via your Tempo wallet.</p>
        </div>

        {pricingLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : pricing ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Item</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border/50">
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium">AI Deal Enrichment</span>
                      <p className="text-xs text-muted-foreground mt-0.5">Research, verification, and deal card generation</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-mono font-medium tabular-nums" data-testid="text-enrichment-price">
                        ~${pricing.estimatedCost}
                      </span>
                      <p className="text-[10px] text-muted-foreground">per enrichment</p>
                    </td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="px-4 py-3 text-sm text-muted-foreground">AI API cost (Claude Opus)</td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-muted-foreground">variable</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="px-4 py-3 text-sm text-muted-foreground">Platform fee</td>
                    <td className="px-4 py-3 text-right text-sm font-mono text-muted-foreground">+50% of API cost</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm font-medium">You pay</td>
                    <td className="px-4 py-3 text-right text-sm font-mono font-medium">{pricing.markupMultiplier}x API cost</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {pricing.lastEnrichment && (
              <div className="rounded-lg border border-border p-4">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Last Enrichment</p>
                <div className="flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">API cost</span>
                      <span className="text-sm font-mono">${pricing.lastEnrichment.apiCost}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Total charged</span>
                      <span className="text-sm font-mono font-medium">${pricing.lastEnrichment.totalCharge}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="border-t border-border pt-6">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">How it works</p>
          <div className="space-y-2">
            {[
              "Each enrichment is paid directly from your Tempo wallet",
              "Cost = 1.5x the actual AI API cost — no fixed fees",
              "50% of the API cost is routed as a platform fee",
              "Fund your wallet from the Wallet page",
              "Payments are processed via Machine Payments Protocol (MPP)",
            ].map((text, i) => (
              <div key={i} className="flex items-start gap-2">
                <Check className="w-3 h-3 mt-0.5 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
