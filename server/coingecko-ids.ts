/**
 * Canonical CoinGecko ID mappings for DeFi protocols.
 *
 * Price history AND market cap must use the SAME token ID to avoid
 * scale mismatches (e.g., using USDe stablecoin mcap with ENA token price).
 *
 * Used by: data-agent.ts (P/E execution), benchmark runner, cross-validate
 */

/** Maps protocol names/slugs → CoinGecko coin ID for the governance token */
export const COINGECKO_IDS: Record<string, string> = {
  // Stablecoin yield
  ethena: "ethena",           // ENA governance token (NOT USDe stablecoin)

  // Lending
  aave: "aave",
  morpho: "morpho",
  compound: "compound-governance-token",

  // DEX
  uniswap: "uniswap",
  curve: "curve-dao-token",
  sushiswap: "sushi",
  pancakeswap: "pancakeswap-token",

  // Liquid staking
  lido: "lido-dao",
  "lido-dao": "lido-dao",

  // CDP / Stablecoin
  makerdao: "sky",            // MKR → SKY rebrand
  maker: "sky",
  sky: "sky",

  // Derivatives
  hyperliquid: "hyperliquid",
  lighter: "lighter",
  gmx: "gmx",
  dydx: "dydx-chain",
  "jupiter-perpetual": "jupiter-exchange-solana",
  synthetix: "havven",
  aevo: "aevo-exchange",
};

/** Maps protocol names/slugs → DeFiLlama revenue slug (with fallbacks) */
export const DEFILLAMA_REVENUE_SLUGS: Record<string, string[]> = {
  makerdao: ["makerdao", "maker", "sky"],
  maker: ["maker", "makerdao", "sky"],
  sky: ["sky", "makerdao", "maker"],
};

/**
 * Resolve a protocol name/slug to its canonical CoinGecko ID.
 * Returns the input unchanged if no mapping exists.
 */
export function resolveCoinGeckoId(protocolOrSlug: string): string {
  return COINGECKO_IDS[protocolOrSlug.toLowerCase()] || protocolOrSlug;
}

/**
 * Get revenue slug fallbacks for a protocol.
 * Returns [slug] if no fallbacks defined.
 */
export function getRevenueSlugs(slug: string): string[] {
  return DEFILLAMA_REVENUE_SLUGS[slug.toLowerCase()] || [slug];
}
