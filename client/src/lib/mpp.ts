import { Mppx, tempo } from "mppx/client";
import { createWalletClient, custom, type EIP1193Provider } from "viem";

const tempoMainnet = {
  id: 4217,
  name: "Tempo Mainnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.tempo.xyz"] } },
} as const;

let mppxInstance: ReturnType<typeof Mppx.create> | null = null;

function wrapProvider(provider: EIP1193Provider): EIP1193Provider {
  return {
    ...provider,
    request: async (args: any) => {
      if (args.method === "wallet_sendCalls") {
        const calls = args.params?.[0]?.calls || args.params?.calls || [];
        const from = args.params?.[0]?.from || args.params?.from;
        const results: string[] = [];
        for (const call of calls) {
          const txHash = await provider.request({
            method: "eth_sendTransaction",
            params: [{ from, to: call.to, data: call.data, value: call.value }],
          });
          results.push(txHash as string);
        }
        const lastHash = results[results.length - 1];
        return { receipts: [{ transactionHash: lastHash }] };
      }
      return provider.request(args);
    },
    on: provider.on?.bind(provider),
    removeListener: provider.removeListener?.bind(provider),
  } as EIP1193Provider;
}

export async function initMppx(provider: EIP1193Provider) {
  if (mppxInstance) return mppxInstance;

  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0] as `0x${string}`;

  const wrapped = wrapProvider(provider);

  const walletClient = createWalletClient({
    account: address,
    chain: tempoMainnet,
    transport: custom(wrapped),
  });

  mppxInstance = Mppx.create({
    methods: [
      tempo({
        account: address,
        getClient: () => walletClient,
      }),
    ],
    polyfill: true,
  });

  return mppxInstance;
}

export function resetMppx() {
  if (mppxInstance) {
    Mppx.restore();
    mppxInstance = null;
  }
}

export function isMppxReady(): boolean {
  return mppxInstance !== null;
}
