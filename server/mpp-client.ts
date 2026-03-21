import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const ANTHROPIC_MPP_URL = "https://anthropic.mpp.tempo.xyz/v1/messages";
const USDC_DECIMALS = 6;
const MPP_COST_PER_REQUEST = 0.035;

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
let sessionMethods: ReturnType<typeof tempo> | null = null;
let lastChallenge: any = null;

function getMppxClient() {
  if (mppxClient) return mppxClient;

  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Anthropic");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  sessionMethods = tempo({ account, maxDeposit: "3" });

  mppxClient = Mppx.create({
    methods: [sessionMethods],
    polyfill: false,
    onChallenge: async (challenge, helpers) => {
      lastChallenge = challenge;
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

async function closeMppSession() {
  if (!mppxClient || !sessionMethods || !lastChallenge) {
    console.log("[MPP-Client] No active session to close.");
    mppxClient = null;
    sessionMethods = null;
    lastChallenge = null;
    return;
  }

  try {
    console.log("[MPP-Client] Closing session, returning unspent funds...");
    const sessionMethod = sessionMethods.flat().find((m: any) => m?.createCredential);
    if (sessionMethod) {
      const credential = await sessionMethod.createCredential({
        challenge: lastChallenge,
        context: { action: "close" as const },
      });

      const response = await fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: { Authorization: credential },
      });
      console.log(`[MPP-Client] Close response: ${response.status}`);
    }
    console.log("[MPP-Client] Session closed, funds returned.");
  } catch (err) {
    console.error("[MPP-Client] Error closing session:", err);
  }
  mppxClient = null;
  sessionMethods = null;
  lastChallenge = null;
}

process.on("SIGTERM", async () => {
  await closeMppSession();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeMppSession();
  process.exit(0);
});

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

  const mppCost = MPP_COST_PER_REQUEST;

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
