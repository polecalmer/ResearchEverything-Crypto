import { Check } from "lucide-react";

export default function CreditsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" data-testid="text-billing-title">How It Works</h1>
          <p className="text-xs text-muted-foreground mt-1">Pay-per-use research via your Tempo wallet.</p>
        </div>

        <div className="space-y-2">
          {[
            "Each research is paid directly from your Tempo wallet",
            "Cost = 1.5x the actual AI API cost — no fixed fees",
            "50% of the API cost is routed as a platform fee",
            "Fund your wallet from the Wallet page",
            "Payments are processed via Machine Payments Protocol (MPP)",
          ].map((text, i) => (
            <div key={i} className="flex items-start gap-2">
              <Check className="w-3 h-3 mt-1 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
