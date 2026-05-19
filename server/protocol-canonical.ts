/**
 * Single source of truth for protocol ↔ token canonicalization.
 *
 * Why: the brain fragments writes across multiple labels for the same
 * entity. A user mentioning "HYPE" creates entries under "HYPE" while
 * a session that mentioned "Hyperliquid" creates entries under
 * "Hyperliquid". By the time prior-work-preflight runs, the same
 * underlying entity is split across two namespaces and we miss matches.
 *
 * Observed fragmentation (May 2026 audit):
 *   - brain_entities: "Hyperliquid", "HYPE", "Hyperliquid Strategies" — 3 rows
 *   - brain_facts:    ~140 with topic LIKE '%hype%', ~20 with '%hyperliquid%'
 *   - proven_queries: protocol="hyperliquid" (7), protocol="hype" (1)
 *
 * Same pattern for Ethena/ENA/USDe/sUSDe, Lido/stETH/LDO,
 * Aerodrome/AERO, Maker/MKR/DAI/Sky, etc.
 *
 * Fix: every write site that touches a protocol/ticker field calls
 * `canonicalProtocolName(input)` before storing. Future reads find
 * a unified namespace. Existing fragmented rows aren't backfilled
 * (separate migration if/when it becomes worth doing) — the
 * prior-work-preflight already does ILIKE matching that catches the
 * fragmented older data.
 *
 * Add new entries by appending to ALIASES below. The regex is the
 * SAME shape prior-work-preflight uses, so adding here updates BOTH
 * the entity extractor on read AND the canonicalizer on write.
 */

interface ProtocolAlias {
  /** Single canonical lowercase identifier ("hyperliquid"). All write
   *  sites store this string. */
  canonical: string;
  /** Regex matching all known aliases (case-insensitive, word-bounded).
   *  Tested against the input string at canonicalization time. */
  re: RegExp;
  /** Human-readable display name ("Hyperliquid"). Used by the
   *  prior-work-preflight when rendering the `<prior_work_detected>`
   *  block. Optional. */
  display?: string;
}

/**
 * Authoritative protocol/token alias table. Order matters only when
 * one regex could match a substring of another (e.g. ETH would match
 * inside ETHEREUM); use word boundaries (`\b`) in every regex to
 * avoid that. New entries should append to the END so canonical
 * order is stable.
 */
const ALIASES: ProtocolAlias[] = [
  { canonical: "hyperliquid", display: "Hyperliquid", re: /\bhyperliquid\b|\bhype\b|\bhlp\b|\bhip-?3\b/i },
  { canonical: "ethena",      display: "Ethena",      re: /\bethena\b|\busde\b|\bsusde\b|\bena\b/i },
  { canonical: "pumpfun",     display: "Pump.fun",    re: /\bpump\.?fun\b|\bpumpfun\b/i },
  { canonical: "tradexyz",    display: "TradeXYZ",    re: /\btradexyz\b/i },
  { canonical: "jupiter",     display: "Jupiter",     re: /\bjupiter\b|\bjup\b/i },
  { canonical: "jito",        display: "Jito",        re: /\bjito\b|\bjto\b/i },
  { canonical: "morpho",      display: "Morpho",      re: /\bmorpho\b/i },
  { canonical: "uniswap",     display: "Uniswap",     re: /\buniswap\b|\buni\b/i },
  { canonical: "aave",        display: "Aave",        re: /\baave\b/i },
  { canonical: "lido",        display: "Lido",        re: /\blido\b|\bsteth\b|\bldo\b/i },
  { canonical: "aerodrome",   display: "Aerodrome",   re: /\baerodrome\b|\baero\b/i },
  { canonical: "maker",       display: "MakerDAO",    re: /\bmakerdao\b|\bmaker\b|\bdai\b|\bsky\b|\bmkr\b/i },
  { canonical: "curve",       display: "Curve",       re: /\bcurve\b|\bcrv\b/i },
  { canonical: "eigenlayer",  display: "EigenLayer",  re: /\beigenlayer\b|\beigen\b/i },
  { canonical: "pendle",      display: "Pendle",      re: /\bpendle\b|\bpt-?[a-z]+\b/i },
  { canonical: "gmx",         display: "GMX",         re: /\bgmx\b/i },
  { canonical: "dydx",        display: "dYdX",        re: /\bdydx\b/i },
  { canonical: "synthetix",   display: "Synthetix",   re: /\bsynthetix\b|\bsnx\b/i },
  { canonical: "compound",    display: "Compound",    re: /\bcompound\b|\bcomp\b/i },
  { canonical: "venice",      display: "Venice AI",   re: /\bvenice\b/i },
  { canonical: "service",     display: "Service Protocol", re: /\bservice protocol\b|\bserv\b/i },
  { canonical: "octra",       display: "Octra",       re: /\boctra\b|\boct\b/i },
  { canonical: "helium",      display: "Helium",      re: /\bhelium\b|\bhnt\b/i },
  { canonical: "solana",      display: "Solana",      re: /\bsolana\b|\bsol\b/i },
  { canonical: "ethereum",    display: "Ethereum",    re: /\bethereum\b|\beth\b/i },
  { canonical: "bitcoin",     display: "Bitcoin",     re: /\bbitcoin\b|\bbtc\b/i },
];

/**
 * Normalize a protocol/token string to its canonical key. Pass
 * anything — "HYPE", "Hyperliquid", "hyperliquid", "hype-perps", a
 * user prompt fragment — and get back the canonical form
 * ("hyperliquid"). Strings that don't match any alias get returned
 * lowercased + trimmed (no-op normalization).
 */
export function canonicalProtocolName(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  const trimmed = input.trim();
  if (!trimmed) return "";
  for (const a of ALIASES) {
    if (a.re.test(trimmed)) return a.canonical;
  }
  return trimmed.toLowerCase();
}

/**
 * Get the human-readable display name for a canonical key, or fall
 * back to the input if it's not a known alias.
 */
export function displayProtocolName(canonical: string | undefined | null): string {
  if (!canonical) return "";
  const a = ALIASES.find((x) => x.canonical === canonical.toLowerCase());
  return a?.display ?? canonical;
}

/**
 * Extract ALL canonical entity keys mentioned in a free-form string.
 * Returns deduped lowercase canonical keys, in alias-table order.
 * Used by prior-work-preflight + brain ingestion.
 */
export function extractCanonicalEntities(text: string | undefined | null): string[] {
  if (!text || typeof text !== "string") return [];
  const found = new Set<string>();
  for (const a of ALIASES) {
    if (a.re.test(text)) found.add(a.canonical);
  }
  return Array.from(found);
}

/**
 * Build a deduplicated entities array for brain_facts.entities[].
 * Takes raw input strings (e.g. payload.protocol, payload.ticker, any
 * comparison protocols) and returns a sorted lowercase array of
 * canonical keys. The output goes straight into the text[] column.
 */
export function buildCanonicalEntitiesArray(
  ...raw: Array<string | undefined | null>
): string[] {
  const canonicals = new Set<string>();
  for (const r of raw) {
    const c = canonicalProtocolName(r);
    if (c) canonicals.add(c);
  }
  return Array.from(canonicals).sort();
}
