// Standalone reclaim script.
// Reads MPP_SERVER_WALLET_KEY from .env, walks all on-chain channels for the
// server wallet, and progresses any recoverable ones:
//   - status "open"              → requestClose (starts challenge period)
//   - status "ready_to_finalize" → withdraw     (reclaims deposit to wallet)
// Run it, wait ~1-2 min for the challenge period, then run it again to finalize.
//
// Usage:
//   npx tsx scripts/reclaim-channels.ts

import "dotenv/config";
import { getWalletInfo, closeAllChannels } from "../server/wallet-manager";

async function main() {
  console.log("[reclaim] fetching wallet info…");
  const before = await getWalletInfo();
  console.log(`[reclaim] wallet: ${before.address}`);
  console.log(`[reclaim] USDC balance: $${before.usdcBalance.toFixed(4)}`);
  console.log(`[reclaim] channels: ${before.channels.length}`);
  for (const ch of before.channels) {
    const waitLabel = ch.status === "close_pending" && ch.waitMinutes > 0 ? `  waitMins=${ch.waitMinutes}` : "";
    console.log(`  • ${ch.id.slice(0, 18)}…  status=${ch.status}  deposit=$${ch.deposit.toFixed(4)}  settled=$${ch.settled.toFixed(4)}${waitLabel}`);
  }

  if (before.channels.length === 0) {
    console.log("[reclaim] no channels found. Done.");
    return;
  }

  console.log("\n[reclaim] running closeAllChannels()…");
  const result = await closeAllChannels();
  console.log(`[reclaim] requested: ${result.requested}`);
  console.log(`[reclaim] finalized: ${result.finalized}`);
  if (result.errors.length) {
    console.log(`[reclaim] errors:`);
    for (const e of result.errors) console.log(`  ${e}`);
  }

  console.log("\n[reclaim] fetching wallet info after…");
  const after = await getWalletInfo();
  console.log(`[reclaim] USDC balance: $${after.usdcBalance.toFixed(4)}`);
  console.log(`[reclaim] channels:`);
  for (const ch of after.channels) {
    console.log(`  • ${ch.id.slice(0, 18)}…  status=${ch.status}  deposit=$${ch.deposit.toFixed(4)}`);
  }

  const delta = after.usdcBalance - before.usdcBalance;
  if (delta > 0) {
    console.log(`\n[reclaim] reclaimed $${delta.toFixed(4)} to wallet.`);
  }
  if (result.requested > 0 && result.finalized === 0) {
    console.log(`[reclaim] NOTE: ${result.requested} channel(s) are in the challenge period.`);
    console.log(`[reclaim]       Wait ~1-2 minutes and run this script again to finalize and reclaim.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[reclaim] failed:", e);
    process.exit(1);
  });
