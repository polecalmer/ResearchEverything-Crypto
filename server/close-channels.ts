import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, type Hex, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempo } from "viem/chains";
import { prepareTransactionRequest, signTransaction, sendRawTransactionSync, signTypedData } from "viem/actions";

const ESCROW = "0x33b901018174DDabE4841042ab76ba85D4e24f25" as const;
const USDC = "0x20C000000000000000000000b9537d11c60E8b50" as const;
const SERVER_WALLET = "0x8518b315b3DFC4415Be7E75b2571Df635b27552a" as const;
const CHAIN_ID = 4217;

const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

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

const closeAbi = [{
  type: "function" as const,
  name: "close" as const,
  inputs: [
    { name: "channelId", type: "bytes32" as const },
    { name: "cumulativeAmount", type: "uint128" as const },
    { name: "signature", type: "bytes" as const },
  ],
  outputs: [],
  stateMutability: "nonpayable" as const,
}];

const CLOSE_GRACE_PERIOD = 900;

const voucherDomain = {
  name: "Tempo Stream Channel",
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: ESCROW,
} as const;

const voucherTypes = {
  Voucher: [
    { name: "channelId", type: "bytes32" },
    { name: "cumulativeAmount", type: "uint128" },
  ],
} as const;

async function sendFeePayerTx(
  client: any,
  account: Account,
  to: `0x${string}`,
  data: Hex,
): Promise<any> {
  const prepared = await prepareTransactionRequest(client, {
    account,
    calls: [{ to, data }],
    feePayer: true,
    feeToken: USDC,
  } as any);

  const serialized = await signTransaction(client, {
    ...prepared,
    account,
    feePayer: account,
  } as any);

  return sendRawTransactionSync(client as any, {
    serializedTransaction: serialized,
  } as any);
}

async function main() {
  const mode = process.argv[2] || "status";
  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    console.error("MPP_SERVER_WALLET_KEY not set");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const client = createWalletClient({ account, chain: tempo, transport: http("https://rpc.tempo.xyz") });
  const publicClient = createPublicClient({ chain: tempo, transport: http("https://rpc.tempo.xyz") });

  console.log(`Server wallet: ${account.address}`);
  console.log(`Mode: ${mode}\n`);

  const currentBlock = await publicClient.getBlockNumber();

  const CHUNK = 99000n;
  const depositBlocks: bigint[] = [];
  for (let from = 0n; from <= currentBlock; from += CHUNK) {
    const to = from + CHUNK - 1n > currentBlock ? currentBlock : from + CHUNK - 1n;
    const transfers = await publicClient.getLogs({
      address: USDC,
      event: transferAbi[0] as any,
      args: { from: SERVER_WALLET, to: ESCROW },
      fromBlock: from,
      toBlock: to,
    });
    for (const t of transfers) depositBlocks.push(t.blockNumber);
  }

  const channelIds: string[] = [];
  for (const blockNum of depositBlocks) {
    const logs = await publicClient.getLogs({ address: ESCROW, fromBlock: blockNum, toBlock: blockNum });
    for (const log of logs) {
      if (log.topics[1]) channelIds.push(log.topics[1]);
    }
  }

  console.log(`Found ${channelIds.length} channels\n`);

  const now = Math.floor(Date.now() / 1000);
  let totalRecoverable = 0;
  const toRequest: string[] = [];
  const toFinalize: Array<{ cid: string; settled: bigint }> = [];

  for (const cid of channelIds) {
    const r = await publicClient.readContract({
      address: ESCROW,
      abi: channelsAbi,
      functionName: "channels",
      args: [cid as any],
    }) as any;
    const [finalized, closeRequestedAt, payer, , , , deposit, settled] = r;
    const dep = Number(deposit) / 1e6;
    const set = Number(settled) / 1e6;
    const recoverable = dep - set;
    const closeTime = Number(closeRequestedAt);

    if (finalized || deposit === 0n) {
      console.log(`  ${cid.slice(0, 18)}... FINALIZED`);
      continue;
    }

    totalRecoverable += recoverable;

    if (closeTime === 0) {
      console.log(`  ${cid.slice(0, 18)}... OPEN — $${dep.toFixed(2)} deposit, $${recoverable.toFixed(2)} recoverable`);
      toRequest.push(cid);
    } else {
      const readyAt = closeTime + CLOSE_GRACE_PERIOD;
      const ready = now >= readyAt;
      const waitMins = ready ? 0 : Math.ceil((readyAt - now) / 60);
      console.log(`  ${cid.slice(0, 18)}... CLOSE PENDING — $${recoverable.toFixed(2)} recoverable, ${ready ? "READY to finalize" : `${waitMins}min until ready`}`);
      if (ready) toFinalize.push({ cid, settled });
    }
  }

  console.log(`\nTotal recoverable: $${totalRecoverable.toFixed(4)}`);
  console.log(`  ${toRequest.length} need requestClose`);
  console.log(`  ${toFinalize.length} ready to finalize`);

  if (mode === "status") {
    console.log('\nRun with "request" to send requestClose, or "finalize" to close ready channels.');
    return;
  }

  if (mode === "request" && toRequest.length > 0) {
    console.log(`\nSending requestClose for ${toRequest.length} channels...`);
    for (const cid of toRequest) {
      const data = encodeFunctionData({ abi: requestCloseAbi, functionName: "requestClose", args: [cid as `0x${string}`] });
      const receipt = await sendFeePayerTx(client, account, ESCROW, data);
      console.log(`  ${cid.slice(0, 18)}... TX: ${receipt.transactionHash} (${receipt.status})`);
    }
  }

  if (mode === "finalize" && toFinalize.length > 0) {
    console.log(`\nFinalizing ${toFinalize.length} channels with EIP-712 voucher signatures...`);
    for (const { cid, settled } of toFinalize) {
      try {
        const signature = await signTypedData(client, {
          account,
          domain: voucherDomain,
          types: voucherTypes,
          primaryType: "Voucher",
          message: {
            channelId: cid as `0x${string}`,
            cumulativeAmount: settled,
          },
        });

        const data = encodeFunctionData({
          abi: closeAbi,
          functionName: "close",
          args: [cid as `0x${string}`, settled, signature as Hex],
        });

        const receipt = await sendFeePayerTx(client, account, ESCROW, data);
        console.log(`  ${cid.slice(0, 18)}... TX: ${receipt.transactionHash} (${receipt.status})`);
      } catch (e: any) {
        console.error(`  ${cid.slice(0, 18)}... ERROR: ${e.shortMessage?.slice(0, 150) || e.message?.slice(0, 150)}`);
      }
    }
  }
}

main().catch(console.error);
