import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, encodeFunctionData, type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo } from "viem/chains";

import { WALLETS, TOKENS } from "./constants";

const ESCROW = WALLETS.ESCROW;
const USDC = TOKENS.USDC;

/**
 * Bounded-concurrency parallel map. Runs up to `limit` promises in flight
 * at once and returns results in input order. Each item is wrapped so a
 * rejection produces a tagged error result rather than failing the whole
 * batch — caller decides how to handle partial failures.
 *
 * Used by getWalletInfo and getOnChainCostReport: a naive Promise.all over
 * 20+ channel reads against the Tempo RPC silently drops channels on rate-
 * limit (the failing reads land in our catch handler and get filtered out
 * — exactly the "doesn't show all open channels" symptom we hit). A cap of
 * 6 keeps the speedup while staying under the RPC's effective concurrency.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Array<{ ok: true; value: R } | { ok: false; error: any; item: T; index: number }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: any; item: T; index: number }> = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const cap = Math.min(limit, items.length);
  for (let w = 0; w < cap; w++) {
    workers.push((async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          const value = await fn(items[i], i);
          results[i] = { ok: true, value };
        } catch (error) {
          results[i] = { ok: false, error, item: items[i], index: i };
        }
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

const channelOpenedEvent = parseAbiItem("event ChannelOpened(bytes32 indexed channelId, address indexed payer, address indexed payee, address token, address authorizedSigner, bytes32 salt, uint256 deposit)");

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

const requestCloseAbi = [{
  type: "function" as const,
  name: "requestClose" as const,
  inputs: [{ name: "channelId", type: "bytes32" as const }],
  outputs: [],
  stateMutability: "nonpayable" as const,
}];

const withdrawAbi = [{
  type: "function" as const,
  name: "withdraw" as const,
  inputs: [{ name: "channelId", type: "bytes32" as const }],
  outputs: [],
  stateMutability: "nonpayable" as const,
}];

const balanceOfAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

const CLOSE_GRACE_PERIOD = 900;

let cachedChannelIds: Set<string> = new Set();
let lastScannedBlock: bigint = 10_000_000n;

function getClients() {
  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) throw new Error("MPP_SERVER_WALLET_KEY not set");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: tempo, transport: http("https://rpc.tempo.xyz") });
  const publicClient = createPublicClient({ chain: tempo, transport: http("https://rpc.tempo.xyz") });
  return { account, walletClient, publicClient };
}

export interface ChannelInfo {
  id: string;
  status: "finalized" | "open" | "close_pending" | "ready_to_finalize";
  deposit: number;
  settled: number;
  recoverable: number;
  closeRequestedAt: number;
  readyToFinalize: boolean;
  waitMinutes: number;
}

export interface WalletInfo {
  address: string;
  usdcBalance: number;
  channels: ChannelInfo[];
  totalRecoverable: number;
  openCount: number;
  pendingCount: number;
  readyCount: number;
}

async function discoverChannelIds(publicClient: any, walletAddress: `0x${string}`): Promise<Set<string>> {
  const currentBlock = await publicClient.getBlockNumber();

  const startBlock = lastScannedBlock > 0n ? lastScannedBlock + 1n : 0n;
  if (startBlock > currentBlock) return cachedChannelIds;

  const CHUNK = 99000n;
  for (let from = startBlock; from <= currentBlock; from += CHUNK) {
    const to = from + CHUNK - 1n > currentBlock ? currentBlock : from + CHUNK - 1n;
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW,
        event: channelOpenedEvent,
        args: { payer: walletAddress },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (log.args?.channelId) {
          cachedChannelIds.add(log.args.channelId);
        }
      }
    } catch {
      const logs = await publicClient.getLogs({
        address: ESCROW,
        event: channelOpenedEvent,
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (log.args?.payer?.toLowerCase() === walletAddress.toLowerCase() && log.args?.channelId) {
          cachedChannelIds.add(log.args.channelId);
        }
      }
    }
  }

  lastScannedBlock = currentBlock;
  return cachedChannelIds;
}

export async function getWalletInfo(): Promise<WalletInfo> {
  const { account, publicClient } = getClients();
  const address = account.address;

  const usdcRaw = await publicClient.readContract({
    address: USDC,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [address],
  }) as bigint;
  const usdcBalance = Number(usdcRaw) / 1e6;

  const channelIds = await discoverChannelIds(publicClient, address);

  const now = Math.floor(Date.now() / 1000);
  const channels: ChannelInfo[] = [];
  let totalRecoverable = 0;
  let openCount = 0;
  let pendingCount = 0;
  let readyCount = 0;

  // Filter out channels we've already confirmed are finalized — the
  // contract guarantees they never reanimate. For a wallet with 429
  // lifetime channels and ~20 active, this cuts per-load RPC cost from
  // 429 to ~20 reads. The cache is in-process; on restart we re-warm.
  const cidArr = Array.from(channelIds).filter((cid) => !finalizedChannelIds.has(cid));
  // Bounded-concurrency reads. Cap of 4 (was 6) because the Tempo RPC was
  // dropping ~5% of reads at 6 concurrent. Failed reads get a sequential
  // retry pass before we surface to the admin page — guarantees a clean
  // (or at least known-incomplete) result rather than silently missing
  // entries.
  const firstPass = await mapWithConcurrency(cidArr, 4, (cid) =>
    publicClient.readContract({
      address: ESCROW,
      abi: channelsAbi,
      functionName: "channels",
      args: [cid as any],
    }) as Promise<any>,
  );
  const failedAfterFirst: number[] = [];
  for (let i = 0; i < firstPass.length; i++) {
    if (!firstPass[i].ok) failedAfterFirst.push(i);
  }
  // Sequential retry for whatever the first pass dropped. Backed off so we
  // don't immediately re-trip the rate limit. Empirically this catches
  // virtually all of the rate-limit-induced failures.
  if (failedAfterFirst.length > 0) {
    console.log(`[Wallet] First pass: ${failedAfterFirst.length}/${cidArr.length} channel reads failed; retrying sequentially.`);
    for (const idx of failedAfterFirst) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const r = await publicClient.readContract({
          address: ESCROW,
          abi: channelsAbi,
          functionName: "channels",
          args: [cidArr[idx] as any],
        });
        firstPass[idx] = { ok: true, value: r };
      } catch (err) {
        // leave as failed
      }
    }
  }
  const stillFailed = firstPass.filter((r) => !r.ok).map((r: any) => r.item);
  if (stillFailed.length > 0) {
    console.warn(`[Wallet] ${stillFailed.length}/${cidArr.length} channel reads still failed after retry; admin page will be missing those entries. First few: ${stillFailed.slice(0, 3).join(", ")}`);
  }
  for (let i = 0; i < firstPass.length; i++) {
    const result = firstPass[i];
    const cid = cidArr[i];
    if (!result.ok) continue;
    const r = result.value;
    if (!r) continue;
    const [finalized, closeRequestedAt, , , , , deposit, settled] = r;
    // Add finalized/zero-deposit channels to the persistent skip list so
    // we never re-read them after this turn.
    if (finalized || deposit === 0n) {
      finalizedChannelIds.add(cid);
    }
    const dep = Number(deposit) / 1e6;
    const set = Number(settled) / 1e6;
    const recoverable = dep - set;
    const closeTime = Number(closeRequestedAt);

    if (finalized || deposit === 0n) continue;

    totalRecoverable += recoverable;

    if (closeTime === 0) {
      openCount++;
      channels.push({
        id: cid,
        status: "open",
        deposit: dep,
        settled: set,
        recoverable,
        closeRequestedAt: 0,
        readyToFinalize: false,
        waitMinutes: 0,
      });
    } else {
      const readyAt = closeTime + CLOSE_GRACE_PERIOD;
      const ready = now >= readyAt;
      const waitMins = ready ? 0 : Math.ceil((readyAt - now) / 60);
      if (ready) readyCount++;
      else pendingCount++;
      channels.push({
        id: cid,
        status: ready ? "ready_to_finalize" : "close_pending",
        deposit: dep,
        settled: set,
        recoverable,
        closeRequestedAt: closeTime,
        readyToFinalize: ready,
        waitMinutes: waitMins,
      });
    }
  }

  return {
    address,
    usdcBalance,
    channels,
    totalRecoverable,
    openCount,
    pendingCount,
    readyCount,
  };
}

async function sendTempoTx(to: `0x${string}`, data: Hex): Promise<string> {
  const { account, walletClient } = getClients();
  const { prepareTransactionRequest, signTransaction, sendRawTransactionSync } = await import("viem/actions");

  const prepared = await prepareTransactionRequest(walletClient, {
    account,
    calls: [{ to, data }],
    feeToken: USDC,
  } as any);

  const serialized = await signTransaction(walletClient, {
    ...prepared,
    account,
  } as any);

  const receipt = await (sendRawTransactionSync as any)(walletClient, {
    serializedTransaction: serialized,
  });

  if (receipt?.status === "success") return receipt.transactionHash;
  if (receipt?.transactionHash) return receipt.transactionHash;
  if (typeof receipt === "string") return receipt;
  throw new Error(`Transaction reverted: ${JSON.stringify(receipt)}`);
}

export async function requestCloseChannel(channelId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const data = encodeFunctionData({
      abi: requestCloseAbi,
      functionName: "requestClose",
      args: [channelId as `0x${string}`],
    });
    const txHash = await sendTempoTx(ESCROW, data);
    return { success: true, txHash };
  } catch (e: any) {
    console.error(`[Wallet] requestClose error:`, e.shortMessage || e.message);
    return { success: false, error: e.shortMessage || e.message };
  }
}

export async function withdrawChannel(channelId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const data = encodeFunctionData({
      abi: withdrawAbi,
      functionName: "withdraw",
      args: [channelId as `0x${string}`],
    });
    const txHash = await sendTempoTx(ESCROW, data);
    return { success: true, txHash };
  } catch (e: any) {
    console.error(`[Wallet] withdraw error:`, e.shortMessage || e.message);
    return { success: false, error: e.shortMessage || e.message };
  }
}

export interface OnChainCostReport {
  totalFunded: number;
  currentBalance: number;
  netCost: number;
  protocolFees: number;
  protocolFeeTxCount: number;
  escrowLocked: number;
  fundingSources: Array<{ from: string; amount: number }>;
  generatedAt: string;
}

let costReportCache: { report: OnChainCostReport; cachedAt: number } | null = null;
const COST_REPORT_TTL = 60_000;

/**
 * Incremental running totals from past block-range scans. Lets a cold cache
 * (every 60s past TTL) skip rescanning the entire chain history — we only
 * scan blocks newer than `lastScannedBlock`. Without this, a wallet with
 * millions of blocks of history paid the full O(N_blocks) RPC cost on
 * every cache miss, and the admin page repeatedly took 30+s to load.
 */
const incrementalState = {
  lastScannedBlock: -1n,
  totalExternalIn: 0n,
  protocolFees: 0n,
  protocolFeeTxCount: 0,
  fundingSources: new Map<string, bigint>(),
};

/**
 * Channels that have transitioned to `finalized = true` are immutable —
 * the contract guarantees they don't reanimate. Once we've read one and
 * confirmed finalized, we never need to read it again. For a wallet
 * with 429 lifetime channels but ~10-20 currently active, this cuts the
 * per-load RPC cost from ~429 reads to ~20.
 *
 * Population: any channel read returning `finalized=true` OR `deposit=0n`
 * gets added. Survives until process restart (we re-warm on first load
 * post-restart by reading every non-cached channel).
 */
const finalizedChannelIds: Set<string> = new Set();

export async function getOnChainCostReport(): Promise<OnChainCostReport> {
  if (costReportCache && Date.now() - costReportCache.cachedAt < COST_REPORT_TTL) {
    return costReportCache.report;
  }

  const { account, publicClient } = getClients();
  const address = account.address;

  const usdcRaw = await publicClient.readContract({
    address: USDC,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [address],
  }) as bigint;
  const currentBalance = Number(usdcRaw) / 1e6;

  const transferEvent = parseAbiItem(
    "event Transfer(address indexed from, address indexed to, uint256 value)"
  );

  const currentBlock = await publicClient.getBlockNumber();
  const CHUNK = 99000n;

  // Resume from the last successfully-scanned block. On first call this is
  // -1 (so we scan from 0); on subsequent cold-cache calls we only scan the
  // new block range since the last full pass. Failed log-range chunks
  // ("[CostReport] N/M log-range scans failed") regress lastScannedBlock to
  // the lowest failed `from - 1` so the next call rescans them.
  const scanStart = incrementalState.lastScannedBlock + 1n;
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  if (scanStart <= currentBlock) {
    for (let from = scanStart; from <= currentBlock; from += CHUNK + 1n) {
      const to = from + CHUNK > currentBlock ? currentBlock : from + CHUNK;
      ranges.push({ from, to });
    }
  }
  const channelIdsPromise = discoverChannelIds(publicClient, address);
  // Bounded concurrency on getLogs too — each chunk fans out to 2 RPC
  // calls (in + out). Past ~12 in-flight chunks the Tempo RPC starts
  // dropping; bound to 6 chunks (12 concurrent calls) to be safe.
  const logBatches = await mapWithConcurrency(ranges, 6, async ({ from, to }) => {
    try {
      const [logsIn, logsOut] = await Promise.all([
        publicClient.getLogs({
          address: USDC,
          event: transferEvent,
          args: { to: address },
          fromBlock: from,
          toBlock: to,
        }),
        publicClient.getLogs({
          address: USDC,
          event: transferEvent,
          args: { from: address },
          fromBlock: from,
          toBlock: to,
        }),
      ]);
      return { logsIn, logsOut };
    } catch {
      return { logsIn: [] as any[], logsOut: [] as any[] };
    }
  });
  // Accumulate into LOCAL counters first, then merge into incrementalState
  // only on full success. If any range failed, regress lastScannedBlock to
  // just before the lowest failed range so the next call rescans the gap
  // (don't merge totals for partial failures — would double-count later).
  let newExternalIn = 0n;
  let newProtocolFees = 0n;
  let newProtocolFeeTxCount = 0;
  const newFundingSources = new Map<string, bigint>();
  let lowestFailedFrom: bigint | null = null;
  for (let i = 0; i < logBatches.length; i++) {
    const b = logBatches[i];
    if (!b.ok) {
      const failedRange = ranges[i];
      if (lowestFailedFrom === null || failedRange.from < lowestFailedFrom) {
        lowestFailedFrom = failedRange.from;
      }
      continue;
    }
    const { logsIn, logsOut } = b.value;
    for (const log of logsIn) {
      if (log.args.from!.toLowerCase() !== ESCROW.toLowerCase()) {
        newExternalIn += log.args.value!;
        const key = log.args.from!;
        newFundingSources.set(key, (newFundingSources.get(key) || 0n) + log.args.value!);
      }
    }
    for (const log of logsOut) {
      if (log.args.to!.toLowerCase() !== ESCROW.toLowerCase()) {
        newProtocolFees += log.args.value!;
        newProtocolFeeTxCount++;
      }
    }
  }
  const failedRanges = logBatches.filter((b) => !b.ok).length;
  if (failedRanges > 0) {
    console.warn(`[CostReport] ${failedRanges}/${ranges.length} log-range scans failed; will rescan from block ${lowestFailedFrom?.toString() ?? "?"} on next call.`);
  }

  // Merge new totals into the persistent incremental state.
  incrementalState.totalExternalIn += newExternalIn;
  incrementalState.protocolFees += newProtocolFees;
  incrementalState.protocolFeeTxCount += newProtocolFeeTxCount;
  for (const [k, v] of newFundingSources.entries()) {
    incrementalState.fundingSources.set(k, (incrementalState.fundingSources.get(k) || 0n) + v);
  }
  // Advance lastScannedBlock to either currentBlock (clean run) or just
  // before the lowest failed range (so we resume there next time).
  if (lowestFailedFrom !== null) {
    incrementalState.lastScannedBlock = lowestFailedFrom - 1n;
  } else if (ranges.length > 0) {
    incrementalState.lastScannedBlock = currentBlock;
  }
  // Working values for the response — use the current cumulative totals.
  const totalExternalIn = incrementalState.totalExternalIn;
  const protocolFees = incrementalState.protocolFees;
  const protocolFeeTxCount = incrementalState.protocolFeeTxCount;
  const fundingSources = incrementalState.fundingSources;

  const channelIds = await channelIdsPromise;
  // Skip channels already known finalized (escrowLocked is, by definition,
  // 0 for those — they can't contribute). Same cache as getWalletInfo,
  // shared across both endpoints.
  const liveCids = Array.from(channelIds).filter((cid) => !finalizedChannelIds.has(cid));
  const channelReads = await mapWithConcurrency(liveCids, 4, (cid) =>
    publicClient.readContract({
      address: ESCROW,
      abi: channelsAbi,
      functionName: "channels",
      args: [cid as any],
    }) as Promise<any>,
  );
  const failedChannels = channelReads.filter((r) => !r.ok).length;
  if (failedChannels > 0) {
    console.warn(`[CostReport] ${failedChannels}/${channelReads.length} channel reads failed; escrowLocked may be partial.`);
  }
  let escrowLocked = 0;
  for (let i = 0; i < channelReads.length; i++) {
    const result = channelReads[i];
    if (!result.ok || !result.value) continue;
    const [finalized, , , , , , deposit, settled] = result.value;
    if (finalized || deposit === 0n) {
      finalizedChannelIds.add(liveCids[i]);
      continue;
    }
    if (deposit > 0n) {
      escrowLocked += (Number(deposit) - Number(settled)) / 1e6;
    }
  }

  const totalFunded = Number(totalExternalIn) / 1e6;
  const protoFeesUsd = Number(protocolFees) / 1e6;
  const netCost = totalFunded - currentBalance;

  const sources = Array.from(fundingSources.entries()).map(([addr, val]) => ({
    from: addr,
    amount: Number(val) / 1e6,
  }));

  const report: OnChainCostReport = {
    totalFunded,
    currentBalance,
    netCost,
    protocolFees: protoFeesUsd,
    protocolFeeTxCount,
    escrowLocked,
    fundingSources: sources,
    generatedAt: new Date().toISOString(),
  };

  costReportCache = { report, cachedAt: Date.now() };
  return report;
}

export async function closeAllChannels(): Promise<{ requested: number; finalized: number; errors: string[] }> {
  const info = await getWalletInfo();
  let requested = 0;
  let finalized = 0;
  const errors: string[] = [];

  for (const ch of info.channels) {
    if (ch.status === "open") {
      const result = await requestCloseChannel(ch.id);
      if (result.success) {
        requested++;
        console.log(`[Wallet] requestClose sent for ${ch.id.slice(0, 18)}...`);
      } else {
        errors.push(`${ch.id.slice(0, 18)}: ${result.error}`);
      }
    } else if (ch.status === "ready_to_finalize") {
      const result = await withdrawChannel(ch.id);
      if (result.success) {
        finalized++;
        console.log(`[Wallet] withdraw sent for ${ch.id.slice(0, 18)}...`);
      } else {
        errors.push(`${ch.id.slice(0, 18)}: ${result.error}`);
      }
    }
  }

  return { requested, finalized, errors };
}
