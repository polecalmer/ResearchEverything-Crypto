import { tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, type Hex } from "viem";
import { EXTERNAL_URLS, TOKENS, WALLETS } from "./constants";
import { dlog } from "./debug-log";

const ANTHROPIC_MPP_URL = EXTERNAL_URLS.ANTHROPIC_MPP;

const tempoChain = {
  id: 4217,
  name: "Tempo",
  network: "tempo",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.tempo.xyz"] } },
} as const;
const balanceOfAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
let cachedReadClient: ReturnType<typeof createPublicClient> | null = null;
function getReadClient() {
  if (!cachedReadClient) cachedReadClient = createPublicClient({ chain: tempoChain, transport: http() });
  return cachedReadClient;
}

async function getUsdcBalance(address: `0x${string}`): Promise<number> {
  try {
    const raw = await getReadClient().readContract({
      address: TOKENS.USDC as `0x${string}`,
      abi: balanceOfAbi,
      functionName: "balanceOf",
      args: [address],
    }) as bigint;
    return Number(raw) / 1e6;
  } catch (err: any) {
    console.warn(`[MPP-Channel] Could not read USDC balance: ${err?.message}`);
    return -1;
  }
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string; max_uses?: number }>;
}

export type CostSource = "receipt" | "voucher_estimate";

export interface AnthropicResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
  costSource: CostSource;
}

export interface AnthropicRawResponse {
  content: any[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  mppCost: number;
  costSource: CostSource;
}

// Channel sizing: normal app sessions are capped so we can't lose more than
// CHANNEL_DEPOSIT_DEFAULT_CAP per channel if anything goes sideways. Benchmark
// runs need much more headroom (a single full-cycle can cost $50+) and
// opt in via setBenchmarkMode(true) — they get the full wallet balance.
const CHANNEL_DEPOSIT_MIN = 2.0;            // never open a channel smaller than this
const CHANNEL_DEPOSIT_DEFAULT_CAP = 35;     // app-session cap
const CHANNEL_BALANCE_RESERVE = 0.5;        // leave a small reserve (gas / dust)
const SHUTDOWN_TIMEOUT_MS = 15000;

let useFullDeposit = false;

/**
 * Opt the current process into full-balance channels. Call from benchmark
 * entry points (cli.ts, runner.ts) BEFORE any MPP request fires. Normal app
 * server doesn't call this — gets capped deposits by default.
 */
export function setBenchmarkMode(on: boolean): void {
  useFullDeposit = on;
}

interface MppClientState {
  session: ReturnType<typeof tempo.session>;
  deposit: number;
  totalSpent: number;
  totalVoucherAuthorized: number;
  requestCount: number;
  createdAt: number;
}

let sharedClient: MppClientState | null = null;
let isShuttingDown = false;

function getAccount() {
  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Anthropic");
  }
  return privateKeyToAccount(privateKey as `0x${string}`);
}

async function getOrCreateClient(): Promise<MppClientState> {
  if (sharedClient) return sharedClient;

  const account = getAccount();

  // Deposit the full usable balance (minus reserve). On RPC failure we'd rather
  // fail loudly than guess a small deposit that re-introduces the drain risk.
  const balance = await getUsdcBalance(account.address as `0x${string}`);
  if (balance < 0) {
    throw new Error(
      `MPP server wallet (${account.address}) USDC balance unreadable — cannot size channel deposit. Check Tempo RPC connectivity.`
    );
  }
  const usable = Math.max(0, balance - CHANNEL_BALANCE_RESERVE);
  if (usable < CHANNEL_DEPOSIT_MIN) {
    throw new Error(
      `MPP server wallet (${account.address}) has only $${balance.toFixed(4)} USDC — needs at least $${CHANNEL_DEPOSIT_MIN + CHANNEL_BALANCE_RESERVE} USDC to open a payment channel. Please top up the wallet.`
    );
  }
  const depositUsd = useFullDeposit ? usable : Math.min(usable, CHANNEL_DEPOSIT_DEFAULT_CAP);
  const depositStr = depositUsd.toFixed(2);

  const session = tempo.session({
    account,
    maxDeposit: depositStr,
  });

  const state: MppClientState = {
    session,
    deposit: depositUsd,
    totalSpent: 0,
    totalVoucherAuthorized: 0,
    requestCount: 0,
    createdAt: Date.now(),
  };

  sharedClient = state;
  console.log(`[MPP-Channel] Opened shared session (deposit: $${depositStr}, wallet bal: $${balance.toFixed(4)}): ${account.address}`);
  return state;
}

// Tempo channel close starts an on-chain grace period (CLOSE_GRACE_PERIOD =
// 900s / 15 min). After that elapses, the payer must call escrow.withdraw(channelId)
// to actually move the unspent deposit back to the wallet — the chain does NOT
// auto-release. We add 1 min of margin so on-chain state has clearly transitioned.
const CHANNEL_RECLAIM_DELAY_MS = 16 * 60 * 1000;

const channelsAbi = [{
  type: "function" as const,
  name: "channels" as const,
  inputs: [{ name: "", type: "bytes32" as const }],
  outputs: [
    { name: "finalized", type: "bool" as const },
    { name: "closeRequestedAt", type: "uint64" as const },
    { name: "payer", type: "address" as const },
    { name: "payee", type: "address" as const },
    { name: "token", type: "address" as const },
    { name: "authorizedSigner", type: "address" as const },
    { name: "deposit", type: "uint128" as const },
    { name: "settled", type: "uint128" as const },
  ],
  stateMutability: "view" as const,
}];

const withdrawAbi = [{
  type: "function" as const,
  name: "withdraw" as const,
  inputs: [{ name: "channelId", type: "bytes32" as const }],
  outputs: [],
  stateMutability: "nonpayable" as const,
}];

const transferEventAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

let cachedWriteClient: ReturnType<typeof createWalletClient> | null = null;
function getWriteClient() {
  if (!cachedWriteClient) {
    cachedWriteClient = createWalletClient({
      account: getAccount(),
      chain: tempoChain as any,
      transport: http(),
    });
  }
  return cachedWriteClient;
}

// Walks recent USDC Transfer logs from server wallet → escrow to enumerate
// channels this wallet has ever opened, then returns the channelIds that are
// currently in close-pending state with grace period elapsed.
async function findEligibleChannelsForWithdraw(): Promise<Hex[]> {
  const account = getAccount();
  const escrow = WALLETS.ESCROW as `0x${string}`;
  const usdc = TOKENS.USDC as `0x${string}`;
  const publicClient = getReadClient();

  const currentBlock = await publicClient.getBlockNumber();
  const CHUNK = 99000n;

  const depositBlocks: bigint[] = [];
  for (let from = 0n; from <= currentBlock; from += CHUNK) {
    const to = from + CHUNK - 1n > currentBlock ? currentBlock : from + CHUNK - 1n;
    const transfers = await publicClient.getLogs({
      address: usdc,
      event: transferEventAbi[0] as any,
      args: { from: account.address, to: escrow },
      fromBlock: from,
      toBlock: to,
    });
    for (const t of transfers) depositBlocks.push(t.blockNumber);
  }

  const channelIds = new Set<Hex>();
  for (const blockNum of depositBlocks) {
    const logs = await publicClient.getLogs({ address: escrow, fromBlock: blockNum, toBlock: blockNum });
    for (const log of logs) {
      if (log.topics[1]) channelIds.add(log.topics[1] as Hex);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const CLOSE_GRACE_PERIOD = 900; // contract constant
  const eligible: Hex[] = [];
  for (const cid of channelIds) {
    const r = await publicClient.readContract({
      address: escrow,
      abi: channelsAbi,
      functionName: "channels",
      args: [cid as any],
    }) as any;
    const [finalized, closeRequestedAt, , , , , deposit] = r;
    if (finalized || deposit === 0n) continue;
    const closeTime = Number(closeRequestedAt);
    if (closeTime === 0) continue; // not in close-pending state
    const readyAt = closeTime + CLOSE_GRACE_PERIOD;
    if (now >= readyAt) eligible.push(cid);
  }
  return eligible;
}

async function reclaimEligibleChannels() {
  let channels: Hex[];
  try {
    channels = await findEligibleChannelsForWithdraw();
  } catch (err: any) {
    console.warn(`[MPP-Channel] Reclaim scan failed: ${err?.message || err}`);
    return;
  }
  if (channels.length === 0) {
    console.log(`[MPP-Channel] T+16min reclaim check: no channels eligible for withdraw right now.`);
    return;
  }

  const account = getAccount();
  const escrow = WALLETS.ESCROW as `0x${string}`;
  const writeClient = getWriteClient();
  const balanceBefore = await getUsdcBalance(account.address as `0x${string}`);

  for (const cid of channels) {
    try {
      const data = encodeFunctionData({ abi: withdrawAbi, functionName: "withdraw", args: [cid] });
      const hash = await writeClient.sendTransaction({
        account: account as any,
        to: escrow,
        data,
        chain: tempoChain as any,
      });
      console.log(`[MPP-Channel] withdraw(${cid.slice(0, 10)}…) → ${hash}`);
    } catch (err: any) {
      console.warn(`[MPP-Channel] withdraw(${cid.slice(0, 10)}…) failed: ${err?.shortMessage?.slice(0, 200) || err?.message?.slice(0, 200)}`);
    }
  }

  // Give the chain a moment, then report the wallet delta.
  await new Promise(r => setTimeout(r, 4000));
  try {
    const balanceAfter = await getUsdcBalance(account.address as `0x${string}`);
    const delta = balanceAfter - balanceBefore;
    if (delta > 0) {
      console.log(`[MPP-Channel] Reclaim complete: wallet +$${delta.toFixed(4)} ($${balanceBefore.toFixed(4)} → $${balanceAfter.toFixed(4)}) across ${channels.length} channel(s).`);
    } else {
      console.warn(`[MPP-Channel] Reclaim attempted on ${channels.length} channel(s) but wallet balance unchanged ($${balanceBefore.toFixed(4)}). Withdraw txs may have reverted — check above for tx errors.`);
    }
  } catch {}
}

function forceNewChannel() {
  const old = sharedClient;
  console.log(`[MPP-Channel] Forcing new channel (previous: ${old?.requestCount || 0} requests, $${old?.totalSpent.toFixed(4) || 0} spent, voucher: $${old?.totalVoucherAuthorized.toFixed(4) || 0})`);
  sharedClient = null;
  if (!old?.session) return;

  const sessionRef = old.session;
  // Phase 1: submit close (this calls escrow.close, starts the grace period).
  sessionRef
    .close()
    .then(() => console.log(`[MPP-Channel] Channel close submitted — grace period started (~15min until withdraw eligible).`))
    .catch((err: any) => console.warn(`[MPP-Channel] Channel close error: ${err?.message || err}`));

  // Phase 2: at T+16min, scan for any close-pending channels owned by this
  // wallet and call escrow.withdraw on each one whose grace period has elapsed.
  // We don't track individual channelIds because mppx doesn't expose them on
  // the session object — easier to enumerate from on-chain state.
  const handle = setTimeout(() => void reclaimEligibleChannels(), CHANNEL_RECLAIM_DELAY_MS);
  if (typeof handle.unref === "function") handle.unref();
  console.log(`[MPP-Channel] Reclaim scheduled for T+16min (will scan + withdraw any eligible channels).`);
}

export function resetMppChannel(): { previousState: ReturnType<typeof getChannelStats> } {
  const prev = getChannelStats();
  forceNewChannel();
  return { previousState: prev };
}

function extractCostFromResponse(response: any, state: MppClientState): { cost: number; source: CostSource } {
  const prevSpent = state.totalSpent;
  const prevVoucher = state.totalVoucherAuthorized;
  let source: CostSource = "voucher_estimate";

  const rawVoucher = response.cumulative ? Number(response.cumulative) / 1e6 : null;
  if (rawVoucher !== null && rawVoucher >= prevVoucher) {
    state.totalVoucherAuthorized = rawVoucher;
  }

  const receipt = response.receipt;
  if (receipt?.spent) {
    const serverSpent = Number(BigInt(receipt.spent)) / 1e6;
    if (serverSpent >= prevSpent) {
      state.totalSpent = serverSpent;
    }
    source = "receipt";
  } else if (receipt?.acceptedCumulative) {
    const accepted = Number(BigInt(receipt.acceptedCumulative)) / 1e6;
    if (accepted >= prevSpent) {
      state.totalSpent = accepted;
    }
    source = "receipt";
  } else if (rawVoucher !== null) {
    state.totalSpent = state.totalVoucherAuthorized;
    source = "voucher_estimate";
  }

  return { cost: Math.max(0, state.totalSpent - prevSpent), source };
}

export function isServerMppReady(): boolean {
  return !!process.env.MPP_SERVER_WALLET_KEY;
}

export function getChannelStats() {
  if (!sharedClient) return null;
  return {
    deposit: sharedClient.deposit,
    totalSpent: sharedClient.totalSpent,
    totalVoucherAuthorized: sharedClient.totalVoucherAuthorized,
    requestCount: sharedClient.requestCount,
    uptime: Math.round((Date.now() - sharedClient.createdAt) / 1000),
  };
}

async function closeChannel(): Promise<void> {
  if (!sharedClient) {
    console.log(`[MPP-Channel] No active channel to close.`);
    return;
  }

  const { session, requestCount, totalSpent } = sharedClient;

  try {
    console.log(`[MPP-Channel] Closing channel (${requestCount} requests, $${totalSpent.toFixed(4)} spent, voucher: $${sharedClient.totalVoucherAuthorized.toFixed(4)})...`);
    const receipt = await Promise.race([
      session.close(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Channel close timed out")), SHUTDOWN_TIMEOUT_MS - 2000)
      ),
    ]);
    if (receipt) {
      console.log(`[MPP-Channel] Channel closed successfully. Unspent deposit reclaimed.`);
    } else {
      console.log(`[MPP-Channel] Channel close completed (no receipt).`);
    }
  } catch (err: any) {
    console.error(`[MPP-Channel] Error closing channel: ${err?.message || err}`);
  }
  sharedClient = null;
}

export { closeChannel };

export function markMppShuttingDown() {
  isShuttingDown = true;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;
const STREAM_IDLE_TIMEOUT_MS = 60_000; // abort if no chunk received within this window
const REQUEST_TOTAL_TIMEOUT_MS = 15 * 60_000; // absolute ceiling per streaming request

interface IdleAbortHandle {
  signal: AbortSignal;
  reset: () => void;
  cancel: () => void;
}

function armIdleAbort(idleMs: number, totalMs: number): IdleAbortHandle {
  const ctrl = new AbortController();
  let idleTimer: NodeJS.Timeout | null = null;
  let totalTimer: NodeJS.Timeout | null = null;

  const reset = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      ctrl.abort(new Error(`stream idle for ${idleMs}ms — aborting (terminated)`));
    }, idleMs);
  };
  reset();

  totalTimer = setTimeout(() => {
    ctrl.abort(new Error(`stream exceeded ${totalMs}ms total — aborting`));
  }, totalMs);

  const cancel = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (totalTimer) clearTimeout(totalTimer);
  };
  return { signal: ctrl.signal, reset, cancel };
}

// Exposed for sibling MPP clients (e.g. OpenRouter) that reuse the same payment channel.
export function _mppInternals() {
  return {
    getOrCreateClient,
    forceNewChannel,
    extractCostFromResponse,
    isRetryable,
    isChannelError,
    isTransientChainError,
    isShuttingDown: () => isShuttingDown,
    MAX_RETRIES,
    RETRY_DELAY_MS,
  };
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function isChannelError(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return (
    m.includes("channel closed") ||
    m.includes("channel expired") ||
    m.includes("channel not found") ||
    m.includes("channel terminated") ||
    m.includes("deposit exceeded") ||
    m.includes("deposit exhausted") ||
    m.includes("invalid channel") ||
    m.includes("insufficientbalance")
  );
}

function isTransientChainError(errMsg: string): boolean {
  return errMsg.includes("Execution reverted") || errMsg.includes("nonce too low") || errMsg.includes("replacement");
}

async function callAnthropic(request: AnthropicRequest): Promise<AnthropicResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = await getOrCreateClient();

    try {
      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "mpp",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");

        if (response.status === 402 && errorText.includes("amount-exceeds-deposit")) {
          console.log(`[MPP-Channel] Deposit exceeded — forcing new channel and retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          forceNewChannel();
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }

        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      dlog(`[MPP-Channel] Request #${state.requestCount}: cost $${mppCost.toFixed(4)} [${costSource}] (spent: $${state.totalSpent.toFixed(4)}, voucher: $${state.totalVoucherAuthorized.toFixed(4)})`);

      const data = await response.json();
      const text = data.content
        ?.filter((b: any) => b.type === "text")
        ?.map((b: any) => b.text)
        ?.join("") || "";

      return {
        text,
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
        mppCost,
        costSource,
      };
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("insufficient funds")) {
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }
      if (isTransientChainError(errMsg)) {
        if (attempt < MAX_RETRIES) {
          console.log(`[MPP-Channel] Transient chain error: "${errMsg.slice(0, 80)}", retrying same channel in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error("AI service payment failed — please try again.");
      }
      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }
      const is524 = errMsg.includes("524") || errMsg.includes("timeout");
      const isRetryableError = errMsg.includes("fetch") || is524 ||
        errMsg.includes("502") || errMsg.includes("503") ||
        errMsg.includes("ECONNRESET") || errMsg.includes("429") || errMsg.includes("paymentauth");
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = is524 ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP call failed after retries");
}

export async function callAnthropicServer(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callAnthropic(request);
}

export async function callAnthropicServerHeavy(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callAnthropic(request);
}

export async function callAnthropicRaw(request: any): Promise<AnthropicRawResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = await getOrCreateClient();

    try {
      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "mpp",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        if (response.status === 402 && errorText.includes("amount-exceeds-deposit")) {
          console.log(`[MPP-Channel] Deposit exceeded — forcing new channel and retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          forceNewChannel();
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }
        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay = (response.status === 524 || response.status === 408) ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      dlog(`[MPP-Channel] Request #${state.requestCount}: cost $${mppCost.toFixed(4)} [${costSource}] (spent: $${state.totalSpent.toFixed(4)}, voucher: $${state.totalVoucherAuthorized.toFixed(4)})`);

      const data = await response.json();

      return {
        content: data.content || [],
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
        stop_reason: data.stop_reason || "end_turn",
        mppCost,
        costSource,
      };
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("insufficient funds")) {
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }
      if (isTransientChainError(errMsg)) {
        if (attempt < MAX_RETRIES) {
          console.log(`[MPP-Channel] Transient chain error: "${errMsg.slice(0, 80)}", retrying same channel in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error("AI service payment failed — please try again.");
      }
      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }
      const is524 = errMsg.includes("524") || errMsg.includes("timeout");
      const isRetryableError = errMsg.includes("fetch") || is524 || errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("ECONNRESET") || errMsg.includes("429");
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = is524 ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP call failed after retries");
}

export async function callAnthropicRawStreaming(request: any): Promise<AnthropicRawResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = await getOrCreateClient();

    const idleAbort = armIdleAbort(STREAM_IDLE_TIMEOUT_MS, REQUEST_TOTAL_TIMEOUT_MS);
    try {
      const streamRequest = { ...request, stream: true };
      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "mpp",
        },
        body: JSON.stringify(streamRequest),
        signal: idleAbort.signal,
      } as any);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        if (response.status === 402 && errorText.includes("amount-exceeds-deposit")) {
          console.log(`[MPP-Stream] Deposit exceeded — forcing new channel and retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          forceNewChannel();
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }
        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay = (response.status === 524 || response.status === 408) ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Stream] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      const contentBlocks: any[] = [];
      let stopReason = "end_turn";
      let inputTokens = 0;
      let outputTokens = 0;
      const blockBuffers: Map<number, any> = new Map();

      const body = response.body;
      if (!body) {
        throw new Error("No response body for streaming request");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        idleAbort.reset();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") continue;

            try {
              const event = JSON.parse(jsonStr);

              switch (event.type) {
                case "message_start":
                  if (event.message?.usage) {
                    inputTokens = event.message.usage.input_tokens || 0;
                  }
                  break;

                case "content_block_start":
                  blockBuffers.set(event.index, {
                    type: event.content_block?.type || "text",
                    ...(event.content_block?.type === "text" ? { text: event.content_block.text || "" } : {}),
                    ...(event.content_block?.type === "thinking" ? { thinking: event.content_block.thinking || "" } : {}),
                    ...(event.content_block?.type === "tool_use" ? {
                      id: event.content_block.id,
                      name: event.content_block.name,
                      input: "",
                    } : {}),
                  });
                  break;

                case "content_block_delta": {
                  const block = blockBuffers.get(event.index);
                  if (block && event.delta) {
                    if (event.delta.type === "text_delta") {
                      block.text = (block.text || "") + event.delta.text;
                    } else if (event.delta.type === "thinking_delta") {
                      block.thinking = (block.thinking || "") + event.delta.thinking;
                    } else if (event.delta.type === "input_json_delta") {
                      block.input = (block.input || "") + event.delta.partial_json;
                    }
                  }
                  break;
                }

                case "content_block_stop": {
                  const finishedBlock = blockBuffers.get(event.index);
                  if (finishedBlock) {
                    if (finishedBlock.type === "tool_use" && typeof finishedBlock.input === "string") {
                      try {
                        finishedBlock.input = JSON.parse(finishedBlock.input);
                      } catch {
                        finishedBlock.input = {};
                      }
                    }
                    contentBlocks.push(finishedBlock);
                    blockBuffers.delete(event.index);
                  }
                  break;
                }

                case "message_delta":
                  if (event.delta?.stop_reason) {
                    stopReason = event.delta.stop_reason;
                  }
                  if (event.usage?.output_tokens) {
                    outputTokens = event.usage.output_tokens;
                  }
                  break;
              }
            } catch {
            }
          }
        }
      }

      console.log(`[MPP-Stream] Request #${state.requestCount}: cost $${mppCost.toFixed(4)} [${costSource}] | ${inputTokens} in, ${outputTokens} out, ${contentBlocks.length} blocks`);

      idleAbort.cancel();
      return {
        content: contentBlocks,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        stop_reason: stopReason,
        mppCost,
        costSource,
      };
    } catch (err) {
      idleAbort.cancel();
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("insufficient funds")) {
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }
      if (isTransientChainError(errMsg)) {
        if (attempt < MAX_RETRIES) {
          console.log(`[MPP-Stream] Transient chain error: "${errMsg.slice(0, 80)}", retrying same channel in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error("AI service payment failed — please try again.");
      }
      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }
      const is524 = errMsg.includes("524") || errMsg.includes("timeout");
      const isIdleAbort = errMsg.includes("stream idle for") || errMsg.includes("stream exceeded");
      const isRetryableError = errMsg.includes("fetch") || is524 || errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("ECONNRESET") || errMsg.includes("429") || errMsg.includes("terminated") || errMsg.includes("network") || errMsg.includes("aborted") || isIdleAbort;
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = is524 ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Stream] ${isIdleAbort ? "Idle abort" : "Error"}: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP streaming call failed after retries");
}
