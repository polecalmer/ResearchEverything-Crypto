import { Mppx, tempo } from "mppx/client";
import { createWalletClient, custom, type EIP1193Provider } from "viem";

const tempoMainnet = {
  id: 4217,
  name: "Tempo Mainnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.tempo.xyz"] } },
} as const;

let mppxInstance: ReturnType<typeof Mppx.create> | null = null;

export async function initMppx(provider: EIP1193Provider) {
  if (mppxInstance) return mppxInstance;

  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  const address = accounts[0] as `0x${string}`;

  const walletClient = createWalletClient({
    account: address,
    chain: tempoMainnet,
    transport: custom(provider),
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
