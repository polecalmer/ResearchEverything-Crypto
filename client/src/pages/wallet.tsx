import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Clock, Copy, Check, RefreshCw, AlertTriangle, Send, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useState, useCallback } from "react";
import { queryClient } from "@/lib/queryClient";
import { useWallets } from "@privy-io/react-auth";

const TEMPO_RPC = "https://rpc.mainnet.tempo.xyz";
const BALANCE_OF_SELECTOR = "0x70a08231";
const TRANSFER_SELECTOR = "0xa9059cbb";
const TEMPO_EXPLORER = "https://explore.mainnet.tempo.xyz";

const TOKENS = [
  { symbol: "pathUSD", contract: "0x20c0000000000000000000000000000000000000", decimals: 6 },
  { symbol: "USDC", contract: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
] as const;

interface TokenBalance { symbol: string; amount: string }

async function fetchTokenBalance(token: string, address: string, decimals: number): Promise<string> {
  const paddedAddr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  const res = await fetch(TEMPO_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_call",
      params: [{ to: token, data: `${BALANCE_OF_SELECTOR}${paddedAddr}` }, "latest"],
      id: 1,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.result || data.result === "0x") return "0.00";
  const raw = BigInt(data.result);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}`;
}

async function fetchWalletBalances(address: string): Promise<TokenBalance[]> {
  const results = await Promise.all(
    TOKENS.map(async (t) => ({
      symbol: t.symbol,
      amount: await fetchTokenBalance(t.contract, address, t.decimals),
    }))
  );
  return results;
}

function toHex(n: bigint): string {
  return "0x" + n.toString(16);
}

function buildTransferData(to: string, amount: bigint): string {
  const paddedTo = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `${TRANSFER_SELECTOR}${paddedTo}${paddedAmount}`;
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
  txHash: string | null;
  status: string;
  createdAt: string;
}

const TX_TYPE_LABELS: Record<string, string> = {
  enrichment: "Research",
  next_steps: "Next Steps",
  deep_research: "Deep Research",
};

function SendDialog({
  open,
  onClose,
  walletAddress,
  balances,
}: {
  open: boolean;
  onClose: () => void;
  walletAddress: string;
  balances: TokenBalance[] | undefined;
}) {
  const { wallets } = useWallets();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedToken, setSelectedToken] = useState<typeof TOKENS[number]>(TOKENS[0]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showTokenSelect, setShowTokenSelect] = useState(false);

  const selectedBalance = balances?.find((b) => b.symbol === selectedToken.symbol)?.amount ?? "0.00";

  const handleMaxClick = useCallback(() => {
    setAmount(selectedBalance);
  }, [selectedBalance]);

  const resetForm = useCallback(() => {
    setRecipient("");
    setAmount("");
    setError(null);
    setTxHash(null);
    setSending(false);
    setShowTokenSelect(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const isValidAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr);

  const handleSend = async () => {
    setError(null);

    if (!recipient || !isValidAddress(recipient)) {
      setError("Enter a valid address (0x...)");
      return;
    }
    if (recipient.toLowerCase() === walletAddress.toLowerCase()) {
      setError("Cannot send to yourself");
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid amount");
      return;
    }

    const balanceNum = parseFloat(selectedBalance);
    if (parsedAmount > balanceNum) {
      setError(`Insufficient ${selectedToken.symbol} balance`);
      return;
    }

    setSending(true);

    try {
      const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
      if (!embeddedWallet) throw new Error("No embedded wallet found");

      const provider = await embeddedWallet.getEthereumProvider();

      const rawAmount = BigInt(Math.round(parsedAmount * (10 ** selectedToken.decimals)));
      const data = buildTransferData(recipient, rawAmount);

      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from: walletAddress,
          to: selectedToken.contract,
          data,
          value: "0x0",
        }],
      });

      setTxHash(hash as string);
      queryClient.invalidateQueries({ queryKey: ["wallet-balances", walletAddress] });
    } catch (err: any) {
      const msg = err?.message || "Transaction failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Transaction cancelled");
      } else {
        setError(msg.length > 100 ? msg.slice(0, 100) + "..." : msg);
      }
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative border border-border bg-background w-full max-w-md mx-4" data-testid="dialog-send">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Send Tokens</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-close-send"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {txHash ? (
            <div className="space-y-4">
              <div className="border border-emerald-500/20 bg-emerald-500/5 p-4">
                <p className="text-sm text-emerald-400 font-medium mb-1">Transaction Sent</p>
                <p className="text-xs text-muted-foreground mb-3">
                  {amount} {selectedToken.symbol} → {recipient.slice(0, 6)}...{recipient.slice(-4)}
                </p>
                <a
                  href={`${TEMPO_EXPLORER}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid="link-send-tx"
                >
                  {txHash.slice(0, 16)}...{txHash.slice(-8)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={handleClose}
                data-testid="button-send-done"
              >
                Done
              </Button>
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Token
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowTokenSelect(!showTokenSelect)}
                    className="w-full flex items-center justify-between border border-border px-3 py-2 text-sm font-mono hover:border-muted-foreground/40 transition-colors"
                    data-testid="button-select-token"
                  >
                    <span>{selectedToken.symbol}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">${selectedBalance}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </button>
                  {showTokenSelect && (
                    <div className="absolute top-full left-0 right-0 mt-1 border border-border bg-background z-10">
                      {TOKENS.map((t) => {
                        const bal = balances?.find((b) => b.symbol === t.symbol)?.amount ?? "0.00";
                        return (
                          <button
                            key={t.symbol}
                            type="button"
                            onClick={() => {
                              setSelectedToken(t);
                              setShowTokenSelect(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-mono hover:bg-accent/30 transition-colors ${
                              selectedToken.symbol === t.symbol ? "bg-accent/20" : ""
                            }`}
                            data-testid={`option-token-${t.symbol}`}
                          >
                            <span>{t.symbol}</span>
                            <span className="text-xs text-muted-foreground">${bal}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 block">
                  Recipient Address
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder="0x..."
                  className="w-full border border-border bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:border-muted-foreground/40 transition-colors"
                  data-testid="input-recipient"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Amount
                  </label>
                  <button
                    type="button"
                    onClick={handleMaxClick}
                    className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
                    data-testid="button-max-amount"
                  >
                    Max
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^[0-9]*\.?[0-9]*$/.test(val)) setAmount(val);
                    }}
                    placeholder="0.00"
                    className="w-full border border-border bg-transparent px-3 py-2 pr-16 text-sm font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:border-muted-foreground/40 transition-colors"
                    data-testid="input-amount"
                    autoComplete="off"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                    {selectedToken.symbol}
                  </span>
                </div>
              </div>

              {error && (
                <div className="border border-red-500/20 bg-red-500/5 px-3 py-2" data-testid="text-send-error">
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              )}

              <Button
                variant="outline"
                className="w-full text-xs"
                onClick={handleSend}
                disabled={sending || !recipient || !amount}
                data-testid="button-confirm-send"
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Confirming...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="w-3 h-3" />
                    Send {selectedToken.symbol}
                  </span>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WalletPage() {
  const { privyUser } = useAuth();
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const { wallets } = useWallets();
  const embeddedWallet = privyUser?.wallet;
  const walletAddress = embeddedWallet?.address
    || wallets[0]?.address
    || null;
  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const { data: txs, isLoading: txsLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions"],
  });

  const { data: balances, isLoading: balanceLoading } = useQuery<TokenBalance[]>({
    queryKey: ["wallet-balances", walletAddress],
    queryFn: () => fetchWalletBalances(walletAddress!),
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

  const totalTokensIn = txs?.filter(tx => tx.status === "success").reduce((sum, tx) => sum + (tx.inputTokens || 0), 0) ?? 0;
  const totalTokensOut = txs?.filter(tx => tx.status === "success").reduce((sum, tx) => sum + (tx.outputTokens || 0), 0) ?? 0;
  const txCount = txs?.filter(tx => tx.status === "success").length ?? 0;

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
            <div className="border border-border p-4 space-y-4">
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
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Balances</p>
                  <button
                    onClick={() => queryClient.invalidateQueries({ queryKey: ["wallet-balances", walletAddress] })}
                    className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    aria-label="Refresh balances"
                    data-testid="button-refresh-balance"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${balanceLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {balanceLoading ? (
                  <span className="text-muted-foreground text-sm">Loading...</span>
                ) : balances ? (
                  <div className="space-y-1.5">
                    {balances.map((b) => (
                      <div key={b.symbol} className="flex items-baseline justify-between" data-testid={`balance-${b.symbol}`}>
                        <span className="text-[10px] font-mono text-muted-foreground">{b.symbol}</span>
                        <span className="text-sm font-mono font-semibold tabular-nums">${b.amount}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm">—</span>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Token Usage</p>
                    <p className="text-xs font-mono tabular-nums text-foreground/70 mt-0.5" data-testid="text-total-tokens">
                      {totalTokensIn.toLocaleString()} in · {totalTokensOut.toLocaleString()} out
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">API Calls</p>
                    <p className="text-sm font-mono font-semibold tabular-nums" data-testid="text-tx-count">
                      {txCount}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {walletAddress && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => setSendOpen(true)}
                      data-testid="button-send"
                    >
                      <Send className="w-3 h-3 mr-1" />
                      Send
                    </Button>
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
                      href={`${TEMPO_EXPLORER}/address/${walletAddress}`}
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
            <div className="border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Time</th>
                    <th className="text-left text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Description</th>
                    <th className="text-right text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-4 py-3">Tokens</th>
                    <th className="text-center text-[10px] uppercase tracking-widest text-muted-foreground font-medium px-2 py-3 w-10">Tx</th>
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
                    txs.map((tx) => {
                      const isFailed = tx.status === "failed";
                      const typeLabel = TX_TYPE_LABELS[tx.type] || tx.type;

                      return (
                        <tr
                          key={tx.id}
                          className={`border-b border-border/50 last:border-b-0 hover:bg-accent/30 transition-colors ${isFailed ? "opacity-60" : ""}`}
                          data-testid={`row-tx-${tx.id}`}
                        >
                          <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                            {formatDate(tx.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {isFailed && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
                              <span className="text-sm" data-testid={`text-tx-desc-${tx.id}`}>
                                <span className="text-muted-foreground">{typeLabel} </span>
                                {tx.companyName ? (
                                  <span className="font-medium">{tx.companyName}</span>
                                ) : isFailed ? (
                                  <span className="text-red-400 text-xs">failed</span>
                                ) : null}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right" data-testid={`text-tx-tokens-${tx.id}`}>
                            {tx.inputTokens || tx.outputTokens ? (
                              <span className="text-xs text-muted-foreground/60 font-mono">
                                {(tx.inputTokens || 0).toLocaleString()} / {(tx.outputTokens || 0).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-center">
                            {tx.txHash ? (
                              <a
                                href={`${TEMPO_EXPLORER}/tx/${tx.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground/40 hover:text-foreground transition-colors inline-flex"
                                data-testid={`link-tx-${tx.id}`}
                                title={`View on explorer: ${tx.txHash.slice(0, 10)}...`}
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {txs && txs.length > 0 && (
                <div className="flex items-center justify-end px-4 py-2.5 border-t border-border/50">
                  <span className="text-xs text-muted-foreground font-mono">
                    {txs.length} transaction{txs.length !== 1 ? "s" : ""}
                    {txs.some(tx => tx.status === "failed") && (
                      <span className="text-red-400/60 ml-2">
                        ({txs.filter(tx => tx.status === "failed").length} failed)
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {walletAddress && (
        <SendDialog
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          walletAddress={walletAddress}
          balances={balances}
        />
      )}
    </div>
  );
}
