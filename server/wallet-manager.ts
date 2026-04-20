import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, encodeFunctionData, type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo } from "viem/chains";

import { WALLETS, TOKENS } from "./constants";

const ESCROW = WALLETS.ESCROW;
const USDC = TOKENS.USDC;

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

  for (const cid of channelIds) {
    const r = await publicClient.readContract({
      address: ESCROW,
      abi: channelsAbi,
      functionName: "channels",
      args: [cid as any],
    }) as any;
    const [finalized, closeRequestedAt, , , , , deposit, settled] = r;
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

  let totalExternalIn = 0n;
  let protocolFees = 0n;
  let protocolFeeTxCount = 0;
  const fundingSources: Map<string, bigint> = new Map();

  for (let from = 0n; from <= currentBlock; from += CHUNK + 1n) {
    const to = from + CHUNK > currentBlock ? currentBlock : from + CHUNK;
    try {
      const logsIn = await publicClient.getLogs({
        address: USDC,
        event: transferEvent,
        args: { to: address },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logsIn) {
        if (log.args.from!.toLowerCase() !== ESCROW.toLowerCase()) {
          totalExternalIn += log.args.value!;
          const key = log.args.from!;
          fundingSources.set(key, (fundingSources.get(key) || 0n) + log.args.value!);
        }
      }

      const logsOut = await publicClient.getLogs({
        address: USDC,
        event: transferEvent,
        args: { from: address },
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logsOut) {
        if (log.args.to!.toLowerCase() !== ESCROW.toLowerCase()) {
          protocolFees += log.args.value!;
          protocolFeeTxCount++;
        }
      }
    } catch {
    }
  }

  const channelIds = await discoverChannelIds(publicClient, address);
  let escrowLocked = 0;
  for (const cid of channelIds) {
    try {
      const r = await publicClient.readContract({
        address: ESCROW,
        abi: channelsAbi,
        functionName: "channels",
        args: [cid as any],
      }) as any;
      const [finalized, , , , , , deposit, settled] = r;
      if (!finalized && deposit > 0n) {
        escrowLocked += (Number(deposit) - Number(settled)) / 1e6;
      }
    } catch {}
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
