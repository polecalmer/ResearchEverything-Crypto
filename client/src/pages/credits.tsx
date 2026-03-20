import { useQuery } from "@tanstack/react-query";
import { Wallet, Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useFundWallet } from "@privy-io/react-auth";

interface EnrichmentPricing {
  pricePerEnrichment: string;
  currency: string;
  recipient: string;
}

export default function CreditsPage() {
  const { privyUser } = useAuth();
  const { fundWallet } = useFundWallet();

  const { data: pricing, isLoading: pricingLoading } = useQuery<EnrichmentPricing>({
    queryKey: ["/api/enrichment/pricing"],
  });

  const embeddedWallet = privyUser?.wallet;
  const walletAddress = embeddedWallet?.address;
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const handleFundWallet = async () => {
    if (!walletAddress) return;
    try {
      await fundWallet(walletAddress, { chain: { id: 4217 } as any });
    } catch (err) {
      console.error("Fund wallet error:", err);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">Pay-per-use enrichment via your Tempo wallet.</p>
        </div>

        <div className="flex items-center gap-3 py-4 border-t border-b">
          <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center">
            <Wallet className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Tempo Wallet</p>
            {walletAddress ? (
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono" data-testid="text-wallet-address">{truncatedAddress}</p>
                <a
                  href={`https://explorer.tempo.xyz/address/${walletAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="link-explorer"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No wallet connected</p>
            )}
          </div>
          {walletAddress && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleFundWallet}
              data-testid="button-fund-wallet"
            >
              Fund Wallet
            </Button>
          )}
        </div>

        <div>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Enrichment Pricing</h2>
          {pricingLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : pricing ? (
            <div className="p-5 rounded-lg border">
              <div className="flex items-baseline justify-between">
                <div>
                  <h3 className="font-semibold">AI Deal Enrichment</h3>
                  <p className="text-sm text-muted-foreground mt-1">Automatic company research, founder discovery, and data verification</p>
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-enrichment-price">
                  ${pricing.pricePerEnrichment}
                  <span className="text-sm font-normal text-muted-foreground"> / enrichment</span>
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="border-t pt-6">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-3">How it works</h2>
          <div className="space-y-3">
            {[
              "Each enrichment is paid directly from your Tempo wallet",
              `$${pricing?.pricePerEnrichment ?? "0.10"} per enrichment — transparent, no subscriptions needed`,
              "Fund your wallet with USD via the button above",
              "Payments are processed via the Machine Payments Protocol (MPP)",
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
