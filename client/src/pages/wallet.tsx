import { useQuery } from "@tanstack/react-query";
import { Wallet, ExternalLink, Loader2, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

interface Transaction {
  id: string;
  userId: string;
  type: string;
  description: string;
  amount: string;
  apiCost: string | null;
  companyName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: string;
}

export default function WalletPage() {
  const { privyUser } = useAuth();

  const embeddedWallet = privyUser?.wallet;
  const walletAddress = embeddedWallet?.address;
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const { data: txs, isLoading: txsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const handleFundWallet = () => {
    if (!walletAddress) return;
    window.open("https://docs.tempo.xyz/guide/use-accounts/add-funds", "_blank");
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const totalSpent = txs?.reduce((sum, tx) => sum + parseFloat(tx.amount || "0"), 0) ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight" data-testid="text-wallet-title">Wallet</h1>
          <p className="text-sm text-muted-foreground mt-1">Your Tempo wallet and transaction history.</p>
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
                  href={`https://explore.mainnet.tempo.xyz/address/${walletAddress}`}
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

        {txs && txs.length > 0 && (
          <div className="flex items-center gap-6 py-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Total Spent</p>
              <p className="text-lg font-bold tabular-nums" data-testid="text-total-spent">${totalSpent.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Enrichments</p>
              <p className="text-lg font-bold tabular-nums" data-testid="text-tx-count">{txs.length}</p>
            </div>
          </div>
        )}

        <div>
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-4">Transaction History</h2>
          {txsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !txs || txs.length === 0 ? (
            <div className="py-12 text-center">
              <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
              <p className="text-xs text-muted-foreground mt-1">Transactions will appear here when you run enrichments.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0"
                  data-testid={`row-tx-${tx.id}`}
                >
                  <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shrink-0">
                    {tx.type === "enrichment" ? (
                      <ArrowUpRight className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-tx-desc-${tx.id}`}>
                      {tx.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(tx.createdAt)}</span>
                      {tx.apiCost && (
                        <>
                          <span>·</span>
                          <span>API: ${tx.apiCost}</span>
                        </>
                      )}
                      {tx.inputTokens && tx.outputTokens && (
                        <>
                          <span>·</span>
                          <span>{(tx.inputTokens + tx.outputTokens).toLocaleString()} tokens</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-medium tabular-nums" data-testid={`text-tx-amount-${tx.id}`}>
                      -${parseFloat(tx.amount).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">pathUSD</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
