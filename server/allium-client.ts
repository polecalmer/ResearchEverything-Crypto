// Token snapshot via CoinGecko. The module is named `allium-client.ts` for
// historical reasons — the original implementation tried Allium MPP first
// and fell back to CoinGecko. The MPP relay 404'd reliably and the
// fallback was always carrying the load, so the Allium-MPP path was
// removed in favor of going straight to CoinGecko. Kept the export
// signatures intact so callers (session-research-agent, token-agent,
// data-agent) didn't need to change.
import type { CostSource } from "./mpp-client";

export interface TokenSnapshot {
  contractAddress: string;
  chain: string;
  ticker: string;
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  holderCount: number | null;
  priceChange24h: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  // CoinGecko's "outstanding supply" — supply excluding permanently locked,
  // burned, or not-planned-for-circulation tokens (treasury reserves,
  // validator stakes, foundation allocations that won't be released).
  // Used as the basis for "Outstanding Token Value" / "Adjusted MCAP" in
  // valuation charts. Null when the token doesn't expose this field
  // (smaller / less-tracked tokens). When null, callers should fall back
  // to circulating supply or skip the Adj MCAP series entirely.
  outstandingSupply: number | null;
  outstandingTokenValue: number | null;
  fetchedAt: string;
  source: string;
}

const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  polygon: "polygon",
  matic: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  solana: "solana",
  sol: "solana",
  avalanche: "avalanche",
  avax: "avalanche",
  bsc: "bsc",
  bnb: "bsc",
  hyperliquid: "hyperliquid",
};

// Allium-MPP integration removed — the relay endpoint reliably 404'd and
// every call was falling through to CoinGecko anyway. We keep CoinGecko
// as the sole token-snapshot source. Module name retained for caller
// stability; the [TokenSnapshot] log prefix replaces the old [Allium]
// prefix below.

const COINGECKO_TICKER_TO_ID: Record<string, string> = {
  hype: "hyperliquid",
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  avax: "avalanche-2",
  bnb: "binancecoin",
  matic: "matic-network",
  pol: "matic-network",
  arb: "arbitrum",
  op: "optimism",
  sui: "sui",
  apt: "aptos",
  sei: "sei-network",
  tia: "celestia",
  jup: "jupiter-exchange-solana",
  pendle: "pendle",
  aave: "aave",
  mkr: "maker",
  link: "chainlink",
  uni: "uniswap",
  doge: "dogecoin",
  xrp: "ripple",
  ada: "cardano",
  dot: "polkadot",
  atom: "cosmos",
  near: "near",
  ftm: "fantom",
  inj: "injective-protocol",
  pump: "pump-fun",
  ena: "ethena",
  syrup: "maple-finance",
  hnt: "helium",
};

// Search-resolved tickers (NOT in the hardcoded TICKER_TO_ID map) below
// this market-cap threshold are refused. The TradeXYZ/TRADE incident
// (May 12 2026) had CoinGecko's search hot-match TradeXYZ → a $4M-FDV
// unrelated token named "polytrade"; that price data then poisoned an
// entire deep-research run's valuation tables. A protocol with real
// economic substance has at least tens of millions in mcap; a ticker
// collision with a micro-cap is almost certainly the wrong match.
// Hardcoded-map entries (HYPE, ETH, BTC, etc.) skip this check — they
// were explicitly curated.
const MIN_SEARCH_RESOLVED_MCAP_USD = 50_000_000;

async function fetchViaCoinGeckoId(
  ticker: string,
): Promise<{ data: any; mppCost: number }> {
  const hardcodedHit = COINGECKO_TICKER_TO_ID[ticker.toLowerCase()];
  let coinId = hardcodedHit;
  let wasSearchResolved = false;
  if (!coinId) {
    try {
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`;
      const searchRes = await fetch(searchUrl, { headers: { accept: "application/json" } });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const match = searchData.coins?.find((c: any) => c.symbol?.toLowerCase() === ticker.toLowerCase());
        if (match?.id) {
          coinId = match.id;
          wasSearchResolved = true;
          console.log(`[CoinGecko] Resolved ticker ${ticker} → ${coinId} via search`);
        }
      }
    } catch {}
    if (!coinId) {
      return { data: null, mppCost: 0 };
    }
  }

  const url = `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    console.warn(`[CoinGecko] Coin API error (${response.status}) for ${coinId}`);
    return { data: null, mppCost: 0 };
  }

  const json = await response.json();
  const market = json.market_data;
  if (!market) {
    return { data: null, mppCost: 0 };
  }

  // Sanity check: refuse search-resolved micro-cap matches. See
  // MIN_SEARCH_RESOLVED_MCAP_USD comment.
  if (wasSearchResolved) {
    const mcap = market.market_cap?.usd;
    if (typeof mcap === "number" && Number.isFinite(mcap) && mcap < MIN_SEARCH_RESOLVED_MCAP_USD) {
      console.warn(
        `[CoinGecko] Refused search-resolved ticker ${ticker} → ${coinId}: market cap $${(mcap / 1e6).toFixed(1)}M below sanity threshold $${MIN_SEARCH_RESOLVED_MCAP_USD / 1e6}M. Likely a ticker collision with an unrelated token.`,
      );
      return { data: null, mppCost: 0 };
    }
  }

  return {
    data: {
      price: market.current_price?.usd ?? null,
      marketCap: market.market_cap?.usd ?? null,
      volume24h: market.total_volume?.usd ?? null,
      priceChange24h: market.price_change_percentage_24h ?? null,
      holderCount: null,
      fdv: market.fully_diluted_valuation?.usd ?? null,
      circulatingSupply: market.circulating_supply ?? null,
      totalSupply: market.total_supply ?? null,
      maxSupply: market.max_supply ?? null,
      outstandingSupply: market.outstanding_supply ?? null,
      outstandingTokenValue: market.outstanding_token_value_usd ?? null,
    },
    mppCost: 0,
  };
}

async function fetchViaPublicApi(
  contractAddress: string,
  chain: string,
  ticker: string,
): Promise<{ data: any; mppCost: number }> {
  const coingeckoChainMap: Record<string, string> = {
    ethereum: "ethereum",
    polygon: "polygon-pos",
    arbitrum: "arbitrum-one",
    optimism: "optimistic-ethereum",
    base: "base",
    avalanche: "avalanche",
    bsc: "binance-smart-chain",
    solana: "solana",
  };

  const platform = coingeckoChainMap[chain];
  if (platform && contractAddress) {
    const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;

    const response = await fetch(url, {
      headers: { accept: "application/json" },
    });

    if (response.ok) {
      const json = await response.json();
      const tokenData = json[contractAddress.toLowerCase()];

      if (tokenData) {
        return {
          data: {
            price: tokenData.usd ?? null,
            marketCap: tokenData.usd_market_cap ?? null,
            volume24h: tokenData.usd_24h_vol ?? null,
            priceChange24h: tokenData.usd_24h_change ?? null,
            holderCount: null,
          },
          mppCost: 0,
        };
      }
    }
  }

  const coinResult = await fetchViaCoinGeckoId(ticker);
  if (coinResult.data) {
    return coinResult;
  }

  return { data: null, mppCost: 0 };
}

export async function fetchTokenSnapshot(
  contractAddress: string,
  chain: string,
  ticker: string,
): Promise<{ snapshot: TokenSnapshot; mppCost: number; costSource: CostSource }> {
  const normalizedChain = CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase();

  let data: any = null;
  let source = "coingecko";

  try {
    const result = await fetchViaPublicApi(contractAddress, normalizedChain, ticker);
    data = result.data;
    if (data) {
      console.log(`[TokenSnapshot] Fetched via CoinGecko for ${ticker} on ${normalizedChain}`);
    } else {
      source = "unavailable";
    }
  } catch (err: any) {
    console.error(`[TokenSnapshot] CoinGecko fetch failed for ${ticker}:`, err.message);
    source = "unavailable";
  }

  const snapshot: TokenSnapshot = {
    contractAddress,
    chain: normalizedChain,
    ticker,
    price: data?.price ?? null,
    marketCap: data?.marketCap ?? null,
    volume24h: data?.volume24h ?? null,
    holderCount: data?.holderCount ?? null,
    priceChange24h: data?.priceChange24h ?? null,
    fdv: data?.fdv ?? null,
    circulatingSupply: data?.circulatingSupply ?? null,
    totalSupply: data?.totalSupply ?? null,
    maxSupply: data?.maxSupply ?? null,
    outstandingSupply: data?.outstandingSupply ?? null,
    outstandingTokenValue: data?.outstandingTokenValue ?? null,
    fetchedAt: new Date().toISOString(),
    source,
  };

  // CoinGecko is free; the call carries no MPP cost. Returning zero +
  // voucher_estimate keeps the existing CostSource type stable for
  // callers without re-typing them.
  return { snapshot, mppCost: 0, costSource: "voucher_estimate" };
}
