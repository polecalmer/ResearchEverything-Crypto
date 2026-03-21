import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const ALLIUM_MPP_URL = "https://allium.mpp.tempo.xyz/v1/token/snapshot";
const USDC_DECIMALS = 6;

export interface TokenSnapshot {
  contractAddress: string;
  chain: string;
  ticker: string;
  price: number | null;
  marketCap: number | null;
  volume24h: number | null;
  holderCount: number | null;
  priceChange24h: number | null;
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
};

let alliumMppClient: ReturnType<typeof Mppx.create> | null = null;
let alliumLastChallengeAmount = 0;

function getAlliumMppClient(): ReturnType<typeof Mppx.create> {
  if (alliumMppClient) return alliumMppClient;

  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Allium");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const sessionMethods = tempo({ account, maxDeposit: "2" });

  alliumMppClient = Mppx.create({
    methods: [sessionMethods],
    polyfill: false,
    onChallenge: async (challenge, helpers) => {
      const rawAmount = challenge.request?.amount;
      if (rawAmount) {
        const amountNum = typeof rawAmount === "string" ? parseInt(rawAmount, 10) : Number(rawAmount);
        alliumLastChallengeAmount = amountNum / Math.pow(10, USDC_DECIMALS);
        console.log(`[Allium-MPP] Challenge amount: $${alliumLastChallengeAmount.toFixed(6)} USDC`);
      } else {
        alliumLastChallengeAmount = 0;
      }
      return helpers.createCredential();
    },
  });

  console.log(`[Allium-MPP] Client initialized: ${account.address}`);
  return alliumMppClient;
}

async function fetchViaAlliumMpp(
  contractAddress: string,
  chain: string,
): Promise<{ data: any; mppCost: number }> {
  const client = getAlliumMppClient();
  alliumLastChallengeAmount = 0;

  const url = `${ALLIUM_MPP_URL}?address=${encodeURIComponent(contractAddress)}&chain=${encodeURIComponent(chain)}`;

  const response = await client.fetch(url, {
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

  const data = await response.json();
  return { data, mppCost: alliumLastChallengeAmount };
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
  };

  const platform = coingeckoChainMap[chain];
  if (!platform) {
    return { data: null, mppCost: 0 };
  }

  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contractAddress}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error (${response.status})`);
  }

  const json = await response.json();
  const tokenData = json[contractAddress.toLowerCase()];

  if (!tokenData) {
    return { data: null, mppCost: 0 };
  }

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

export async function fetchTokenSnapshot(
  contractAddress: string,
  chain: string,
  ticker: string,
): Promise<{ snapshot: TokenSnapshot; mppCost: number }> {
  const normalizedChain = CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase();

  let data: any = null;
  let mppCost = 0;
  let source = "allium-mpp";

  try {
    const result = await fetchViaAlliumMpp(contractAddress, normalizedChain);
    data = result.data;
    mppCost = result.mppCost;
    source = "allium-mpp";
    console.log(`[Allium] Fetched via MPP for ${ticker} on ${normalizedChain}`);
  } catch (err: any) {
    console.warn(`[Allium] MPP fetch failed, falling back to public API: ${err.message}`);

    try {
      const result = await fetchViaPublicApi(contractAddress, normalizedChain, ticker);
      data = result.data;
      mppCost = result.mppCost;
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
    fetchedAt: new Date().toISOString(),
    source,
  };

  return { snapshot, mppCost };
}
