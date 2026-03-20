import { useQuery } from "@tanstack/react-query";
import { Wallet, ExternalLink, Loader2, Clock, Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { queryClient } from "@/lib/queryClient";

async function fetchWalletBalance(address: string): Promise<string> {
  const res = await fetch("https://rpc.mainnet.tempo.xyz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_getBalance", params: [address, "latest"], id: 1 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const wei = BigInt(data.result);
  const whole = wei / 1000000000000000000n;
  const frac = wei % 1000000000000000000n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 6);
  return `${whole.toString()}.${fracStr}`;
}

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
  const [copied, setCopied] = useState(false);

  const embeddedWallet = privyUser?.wallet;
  const walletAddress = embeddedWallet?.address;
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const { data: txs, isLoading: txsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const { data: balance, isLoading: balanceLoading } = useQuery<string>({
    queryKey: ["wallet-balance", walletAddress],
    queryFn: () => fetchWalletBalance(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const handleFundWallet = () => {
    if (!walletAddress) return;
    window.open("https://docs.tempo.xyz/guide/use-accounts/add-funds", "_blank");
  };

  const handleCopy = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          <span>Wallet</span>
          {walletAddress && (
            <>
              <span className="text-muted-foreground/40">&gt;</span>
              <span className="font-mono">{truncatedAddress}</span>
            </>
          )}
        </div>

        <div className="flex gap-6 flex-col lg:flex-row">
          <div className="lg:w-64 shrink-0 space-y-4">
            <div className="rounded-lg border border-border p-4 space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Address</p>
                {walletAddress ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-mono text-foreground break-all leading-relaxed" data-testid="text-wallet-address">
                      {walletAddress}
                    </p>
                    <button
                      onClick={handleCopy}
                      className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      data-testid="button-copy-address"
                      aria-label="Copy wallet address"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Not connected</p>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Balance</p>
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["wallet-balance", walletAddress] })}
                    className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    aria-label="Refresh balance"
                    data-testid="button-refresh-balance"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${balanceLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                <p className="text-lg font-mono font-semibold tabular-nums" data-testid="text-wallet-balance">
                  {balanceLoading ? (
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  ) : balance ? (
                    <>{balance} <span className="text-xs text-muted-foreground font-normal">TEMPO</span></>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </p>
              </div>
              <div className="flex justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Spent</p>
                  <p className="text-sm font-mono font-semibold tabular-nums" data-testid="text-total-spent">
                    ${totalSpent.toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Txns</p>
                  <p className="text-sm font-mono font-semibold tabular-nums" data-testid="text-tx-count">
                    {txs?.length ?? 0}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {walletAddress && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={handleFundWallet}
                      data-testid="button-fund-wallet"
                    >
                      Fund Wallet
                    </Button>
                    <a
                      href={`https://explore.mainnet.tempo.xyz/address/${walletAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="link-explorer"
                    >
                      <Button variant="outline" size="sm" className="text-xs" aria-label="View on Tempo Explorer">
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Time</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Description</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Fee</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {txsLoading ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12">
                        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mx-auto" />
                      </td>
                    </tr>
                  ) : !txs || txs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12">
                        <Clock className="w-5 h-5 text-muted-foreground/40 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">No transactions yet</p>
                      </td>
                    </tr>
                  ) : (
                    txs.map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-border/50 last:border-b-0 hover:bg-accent/30 transition-colors"
                        data-testid={`row-tx-${tx.id}`}
                      >
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(tx.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-tx-desc-${tx.id}`}>
                            {tx.companyName ? (
                              <>
                                <span className="text-muted-foreground">Enrichment </span>
                                <span className="font-medium">{tx.companyName}</span>
                              </>
                            ) : (
                              <span>{tx.description}</span>
                            )}
                          </span>
                          {tx.inputTokens && tx.outputTokens && (
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              {tx.inputTokens.toLocaleString()} in · {tx.outputTokens.toLocaleString()} out
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {tx.apiCost && (
                            <span className="text-xs text-muted-foreground/60 font-mono">
                              ${parseFloat(tx.apiCost).toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right" data-testid={`text-tx-amount-${tx.id}`}>
                          <span className="text-sm font-mono font-medium tabular-nums">
                            ${parseFloat(tx.amount).toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {txs && txs.length > 0 && (
                <div className="flex items-center justify-end px-4 py-2.5 border-t border-border/50">
                  <span className="text-xs text-muted-foreground font-mono">
                    {txs.length} transaction{txs.length !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
