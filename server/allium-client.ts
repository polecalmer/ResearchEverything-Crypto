import { callAnthropicServer } from "./mpp-client";

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

export async function fetchTokenSnapshot(
  contractAddress: string,
  chain: string,
  ticker: string
): Promise<{ snapshot: TokenSnapshot; mppCost: number }> {
  const chainMap: Record<string, string> = {
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

  const normalizedChain = chainMap[chain.toLowerCase()] || chain.toLowerCase();

  const result = await callAnthropicServer({
    model: "claude-opus-4-6",
    max_tokens: 2048,
    system: `You are a crypto data assistant. When given a token contract address and chain, use your web search capability to find the most current data available for that token. Return ONLY a valid JSON object with these exact fields (use null for any data you cannot find):
{
  "price": <number or null>,
  "marketCap": <number or null>,
  "volume24h": <number or null>,
  "holderCount": <number or null>,
  "priceChange24h": <number or null as percentage, e.g. -5.2 for -5.2%>
}
Do not include any text before or after the JSON. Only output the JSON object.`,
    messages: [
      {
        role: "user",
        content: `Find current market data for token ${ticker} (contract: ${contractAddress}) on ${normalizedChain}. Return the JSON with price in USD, market cap in USD, 24h volume in USD, holder count, and 24h price change percentage.`,
      },
    ],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
  });

  let parsed: any = {};
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("[Allium] Failed to parse AI response:", e);
  }

  const snapshot: TokenSnapshot = {
    contractAddress,
    chain: normalizedChain,
    ticker,
    price: typeof parsed.price === "number" ? parsed.price : null,
    marketCap: typeof parsed.marketCap === "number" ? parsed.marketCap : null,
    volume24h: typeof parsed.volume24h === "number" ? parsed.volume24h : null,
    holderCount: typeof parsed.holderCount === "number" ? parsed.holderCount : null,
    priceChange24h: typeof parsed.priceChange24h === "number" ? parsed.priceChange24h : null,
    fetchedAt: new Date().toISOString(),
    source: "ai-web-search",
  };

  return { snapshot, mppCost: result.mppCost };
}
