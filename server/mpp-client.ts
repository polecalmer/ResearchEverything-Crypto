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

type DepositTier = "enrichment" | "heavy";

const DEPOSIT_CAPS: Record<DepositTier, string> = {
  enrichment: "0.5",
  heavy: "1.5",
};

interface MppClientState {
  client: ReturnType<typeof Mppx.create>;
  sessionMethods: ReturnType<typeof tempo>;
  lastChallenge: any;
  lastChallengeAmount: number;
}

const clients: Record<DepositTier, MppClientState | null> = {
  enrichment: null,
  heavy: null,
};

function getAccount() {
  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Anthropic");
  }
  return privateKeyToAccount(privateKey as `0x${string}`);
}

function getMppClient(tier: DepositTier): MppClientState {
  if (clients[tier]) return clients[tier]!;

  const account = getAccount();
  const maxDeposit = DEPOSIT_CAPS[tier];
  const sessionMethods = tempo({ account, maxDeposit });

  const state: MppClientState = {
    sessionMethods,
    lastChallenge: null,
    lastChallengeAmount: 0,
    client: Mppx.create({
      methods: [sessionMethods],
      polyfill: false,
      onChallenge: async (challenge, helpers) => {
        state.lastChallenge = challenge;
        const rawAmount = challenge.request?.amount;
        if (rawAmount) {
          const amountNum = typeof rawAmount === "string" ? parseInt(rawAmount, 10) : Number(rawAmount);
          state.lastChallengeAmount = amountNum / Math.pow(10, USDC_DECIMALS);
          console.log(`[MPP-Client:${tier}] Challenge: $${state.lastChallengeAmount.toFixed(6)} USDC (deposit cap: $${maxDeposit})`);
        } else {
          state.lastChallengeAmount = 0;
        }
        return helpers.createCredential();
      },
    }),
  };

  clients[tier] = state;
  console.log(`[MPP-Client:${tier}] Initialized (maxDeposit: $${maxDeposit}): ${account.address}`);
  return state;
}

export function isServerMppReady(): boolean {
  return !!process.env.MPP_SERVER_WALLET_KEY;
}

async function closeAllSessions() {
  for (const tier of Object.keys(clients) as DepositTier[]) {
    const state = clients[tier];
    if (!state || !state.lastChallenge) continue;

    try {
      console.log(`[MPP-Client:${tier}] Closing session...`);
      const sessionMethod = state.sessionMethods.flat().find((m: any) => m?.createCredential);
      if (sessionMethod) {
        const credential = await sessionMethod.createCredential({
          challenge: state.lastChallenge,
          context: { action: "close" as const },
        });
        await fetch(ANTHROPIC_MPP_URL, {
          method: "POST",
          headers: { Authorization: credential },
        });
      }
      console.log(`[MPP-Client:${tier}] Session closed.`);
    } catch (err) {
      console.error(`[MPP-Client:${tier}] Error closing:`, err);
    }
    clients[tier] = null;
  }
}

process.on("SIGTERM", async () => {
  await closeAllSessions();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeAllSessions();
  process.exit(0);
});

async function callWithTier(tier: DepositTier, request: AnthropicRequest): Promise<AnthropicResponse> {
  const state = getMppClient(tier);
  state.lastChallengeAmount = 0;

  const response = await state.client.fetch(ANTHROPIC_MPP_URL, {
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

  const mppCost = state.lastChallengeAmount;
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

export async function callAnthropicServer(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callWithTier("enrichment", request);
}

export async function callAnthropicServerHeavy(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callWithTier("heavy", request);
}
