import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const ANTHROPIC_MPP_URL = "https://anthropic.mpp.tempo.xyz/v1/messages";
const USDC_DECIMALS = 6;

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string; max_uses?: number }>;
}

export interface AnthropicResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
}

let mppxClient: ReturnType<typeof Mppx.create> | null = null;
let lastChallengeAmount = 0;

function getMppxClient() {
  if (mppxClient) return mppxClient;

  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Anthropic");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  mppxClient = Mppx.create({
    methods: [tempo({ account, maxDeposit: "0.15" })],
    polyfill: false,
    onChallenge: async (challenge, helpers) => {
      const rawAmount = challenge.request?.amount;
      if (rawAmount) {
        const amountNum = typeof rawAmount === "string" ? parseInt(rawAmount, 10) : Number(rawAmount);
        lastChallengeAmount = amountNum / Math.pow(10, USDC_DECIMALS);
        console.log(`[MPP-Client] Challenge amount: ${rawAmount} raw = $${lastChallengeAmount.toFixed(6)} USDC`);
      } else {
        lastChallengeAmount = 0;
        console.log(`[MPP-Client] Challenge received (no amount field)`);
      }
      return helpers.createCredential();
    },
  });

  console.log(`[MPP-Client] Server wallet initialized: ${account.address}`);
  return mppxClient;
}

export function isServerMppReady(): boolean {
  return !!process.env.MPP_SERVER_WALLET_KEY;
}

export async function callAnthropicServer(request: AnthropicRequest): Promise<AnthropicResponse> {
  const client = getMppxClient();

  lastChallengeAmount = 0;

  const response = await client.fetch(ANTHROPIC_MPP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "mpp",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const mppCost = lastChallengeAmount;

  const data = await response.json();

  let text = "";
  if (data.content) {
    for (const block of data.content) {
      if (block.type === "text") {
        text += block.text;
      }
    }
  }

  return {
    text,
    usage: {
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    },
    mppCost,
  };
}
