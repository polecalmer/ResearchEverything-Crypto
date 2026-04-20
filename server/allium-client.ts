import { tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";
import type { CostSource } from "./mpp-client";

const ALLIUM_MPP_URL = "https://allium.mpp.tempo.xyz/v1/token/snapshot";

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

interface AlliumMppState {
  session: ReturnType<typeof tempo.session>;
  totalSpent: number;
  totalVoucherAuthorized: number;
  requestCount: number;
}

let alliumClient: AlliumMppState | null = null;

function getOrCreateAlliumClient(): AlliumMppState {
  if (alliumClient) return alliumClient;

  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Allium");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const session = tempo.session({ account, maxDeposit: "0.5" });

  alliumClient = {
    session,
    totalSpent: 0,
    totalVoucherAuthorized: 0,
    requestCount: 0,
  };

  console.log(`[Allium-MPP] Session initialized: ${account.address}`);
  return alliumClient;
}

function extractAlliumCost(response: any, state: AlliumMppState): { cost: number; source: CostSource } {
  const prevSpent = state.totalSpent;
  const prevVoucher = state.totalVoucherAuthorized;
  let source: CostSource = "voucher_estimate";

  const rawVoucher = response.cumulative ? Number(response.cumulative) / 1e6 : null;
  if (rawVoucher !== null && rawVoucher >= prevVoucher) {
    state.totalVoucherAuthorized = rawVoucher;
  }

  const receipt = response.receipt;
  if (receipt?.spent) {
    const serverSpent = Number(BigInt(receipt.spent)) / 1e6;
    if (serverSpent >= prevSpent) {
      state.totalSpent = serverSpent;
    }
    source = "receipt";
  } else if (receipt?.acceptedCumulative) {
    const accepted = Number(BigInt(receipt.acceptedCumulative)) / 1e6;
    if (accepted >= prevSpent) {
      state.totalSpent = accepted;
    }
    source = "receipt";
  } else if (rawVoucher !== null) {
    state.totalSpent = state.totalVoucherAuthorized;
    source = "voucher_estimate";
  }

  return { cost: Math.max(0, state.totalSpent - prevSpent), source };
}

async function fetchViaAlliumMpp(
  contractAddress: string,
  chain: string,
): Promise<{ data: any; mppCost: number; costSource: CostSource }> {
  const state = getOrCreateAlliumClient();

  const url = `${ALLIUM_MPP_URL}?address=${encodeURIComponent(contractAddress)}&chain=${encodeURIComponent(chain)}`;

  const response = await state.session.fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "mpp",
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Allium MPP error (${response.status}): ${errorText}`);
  }

  const { cost: mppCost, source: costSource } = extractAlliumCost(response, state);
  state.requestCount++;

  console.log(`[Allium-MPP] Request #${state.requestCount}: cost $${mppCost.toFixed(6)} [${costSource}] (spent: $${state.totalSpent.toFixed(6)}, voucher: $${state.totalVoucherAuthorized.toFixed(6)})`);

  const data = await response.json();
  return { data, mppCost, costSource };
}

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

async function fetchViaCoinGeckoId(
  ticker: string,
): Promise<{ data: any; mppCost: number }> {
  let coinId = COINGECKO_TICKER_TO_ID[ticker.toLowerCase()];
  if (!coinId) {
    try {
      const searchUrl = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`;
      const searchRes = await fetch(searchUrl, { headers: { accept: "application/json" } });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const match = searchData.coins?.find((c: any) => c.symbol?.toLowerCase() === ticker.toLowerCase());
        if (match?.id) {
          coinId = match.id;
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
  let mppCost = 0;
  let costSource: CostSource = "voucher_estimate";
  let source = "allium-mpp";

  try {
    const result = await fetchViaAlliumMpp(contractAddress, normalizedChain);
    data = result.data;
    mppCost = result.mppCost;
    costSource = result.costSource;
    source = "allium-mpp";
    console.log(`[Allium] Fetched via MPP for ${ticker} on ${normalizedChain}`);
  } catch (err: any) {
    console.warn(`[Allium] MPP fetch failed, falling back to public API: ${err.message}`);

    try {
      const result = await fetchViaPublicApi(contractAddress, normalizedChain, ticker);
      data = result.data;
      mppCost = result.mppCost;
      costSource = "voucher_estimate";
      source = "coingecko-fallback";
      console.log(`[Allium] Fetched via CoinGecko fallback for ${ticker}`);
    } catch (fallbackErr: any) {
      console.error(`[Allium] All sources failed for ${ticker}:`, fallbackErr.message);
      source = "unavailable";
    }
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
    fetchedAt: new Date().toISOString(),
    source,
  };

  return { snapshot, mppCost, costSource };
}
