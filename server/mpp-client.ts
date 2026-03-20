import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const serverWalletKey = process.env.MPP_SERVER_WALLET_KEY as `0x${string}`;
if (!serverWalletKey) {
  throw new Error("MPP_SERVER_WALLET_KEY is required");
}

const serverAccount = privateKeyToAccount(serverWalletKey);

export const mppxClient = Mppx.create({
  methods: [tempo({ account: serverAccount })],
  polyfill: false,
});

export const mppFetch = mppxClient.fetch;

export const SERVER_WALLET_ADDRESS = serverAccount.address;
