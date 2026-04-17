import type { SeedFact, Source } from "../schema.js";
import { seedDeFiLlama } from "./defillama.js";
import { seedCoinGecko } from "./coingecko.js";
import { seedDune } from "./dune.js";
import { seedAllium } from "./allium.js";
import { seedStonksOnChain } from "./stonksonchain.js";

const SEEDERS: Record<Source, () => SeedFact[]> = {
  defillama: seedDeFiLlama,
  coingecko: seedCoinGecko,
  dune: seedDune,
  allium: seedAllium,
  stonksonchain: seedStonksOnChain,
};

export function getSeedFacts(source: Source): SeedFact[] {
  return SEEDERS[source]();
}

export function getAllSeedFacts(): SeedFact[] {
  return Object.values(SEEDERS).flatMap((s) => s());
}
