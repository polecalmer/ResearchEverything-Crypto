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

const CHANNEL_DEPOSIT = "0.5";

interface MppClientState {
  client: ReturnType<typeof Mppx.create>;
  sessionMethods: ReturnType<typeof tempo>;
  lastChallenge: any;
  lastChallengeAmount: number;
  totalSpent: number;
  requestCount: number;
  createdAt: number;
}

let sharedClient: MppClientState | null = null;

function getAccount() {
  const privateKey = process.env.MPP_SERVER_WALLET_KEY;
  if (!privateKey) {
    throw new Error("MPP_SERVER_WALLET_KEY not set — server cannot pay Anthropic");
  }
  return privateKeyToAccount(privateKey as `0x${string}`);
}

function getOrCreateClient(): MppClientState {
  if (sharedClient) return sharedClient;

  const account = getAccount();
  const sessionMethods = tempo({ account, maxDeposit: CHANNEL_DEPOSIT });

  const state: MppClientState = {
    sessionMethods,
    lastChallenge: null,
    lastChallengeAmount: 0,
    totalSpent: 0,
    requestCount: 0,
    createdAt: Date.now(),
    client: Mppx.create({
      methods: [sessionMethods],
      polyfill: false,
      onChallenge: async (challenge, helpers) => {
        state.lastChallenge = challenge;
        const rawAmount = challenge.request?.amount;
        if (rawAmount) {
          const amountNum = typeof rawAmount === "string" ? parseInt(rawAmount, 10) : Number(rawAmount);
          state.lastChallengeAmount = amountNum / Math.pow(10, USDC_DECIMALS);
          console.log(`[MPP-Channel] Challenge: $${state.lastChallengeAmount.toFixed(6)} USDC (channel deposit: $${CHANNEL_DEPOSIT}, total spent: $${state.totalSpent.toFixed(4)}, requests: ${state.requestCount})`);
        } else {
          state.lastChallengeAmount = 0;
        }
        return helpers.createCredential();
      },
    }),
  };

  sharedClient = state;
  console.log(`[MPP-Channel] Opened shared channel (deposit: $${CHANNEL_DEPOSIT}): ${account.address}`);
  return state;
}

function forceNewChannel() {
  console.log(`[MPP-Channel] Forcing new channel (previous: ${sharedClient?.requestCount || 0} requests, $${sharedClient?.totalSpent.toFixed(4) || 0} spent)`);
  sharedClient = null;
}

export function isServerMppReady(): boolean {
  return !!process.env.MPP_SERVER_WALLET_KEY;
}

export function getChannelStats() {
  if (!sharedClient) return null;
  return {
    deposit: CHANNEL_DEPOSIT,
    totalSpent: sharedClient.totalSpent,
    requestCount: sharedClient.requestCount,
    uptime: Math.round((Date.now() - sharedClient.createdAt) / 1000),
  };
}

async function closeChannel() {
  if (!sharedClient || !sharedClient.lastChallenge) return;

  try {
    console.log(`[MPP-Channel] Closing channel (${sharedClient.requestCount} requests, $${sharedClient.totalSpent.toFixed(4)} spent)...`);
    const sessionMethod = sharedClient.sessionMethods.flat().find((m: any) => m?.createCredential);
    if (sessionMethod) {
      const credential = await sessionMethod.createCredential({
        challenge: sharedClient.lastChallenge,
        context: { action: "close" as const },
      });
      await fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: { Authorization: credential },
      });
    }
    console.log(`[MPP-Channel] Channel closed.`);
  } catch (err) {
    console.error(`[MPP-Channel] Error closing:`, err);
  }
  sharedClient = null;
}

process.on("SIGTERM", async () => {
  await closeChannel();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await closeChannel();
  process.exit(0);
});

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4000;

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function isChannelError(errMsg: string): boolean {
  return errMsg.includes("channel") || errMsg.includes("deposit") ||
    errMsg.includes("insufficient") || errMsg.includes("closed") ||
    errMsg.includes("expired");
}

async function callAnthropic(request: AnthropicRequest): Promise<AnthropicResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = getOrCreateClient();
    state.lastChallengeAmount = 0;

    try {
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
        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const mppCost = state.lastChallengeAmount;
      state.totalSpent += mppCost;
      state.requestCount++;
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
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("InsufficientBalance") || errMsg.includes("insufficient funds")) {
        console.error(`[MPP-Channel] Server wallet has insufficient USDC.e balance for channel deposit`);
        forceNewChannel();
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up. Please try again later.");
      }

      if (errMsg.includes("Execution reverted")) {
        console.error(`[MPP-Channel] Transaction reverted: "${errMsg.slice(0, 120)}"`);
        forceNewChannel();
        throw new Error("AI service payment failed — please try again in a moment.");
      }

      if (isChannelError(errMsg)) {
        console.log(`[MPP-Channel] Channel error detected, opening new channel: "${errMsg.slice(0, 80)}"`);
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }

      const isRetryableError = errMsg.includes("fetch") ||
        errMsg.includes("524") || errMsg.includes("502") || errMsg.includes("503") ||
        errMsg.includes("timeout") || errMsg.includes("ECONNRESET") ||
        errMsg.includes("429") || errMsg.includes("paymentauth");
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP call failed after retries");
}

export async function callAnthropicServer(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callAnthropic(request);
}

export async function callAnthropicServerHeavy(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callAnthropic(request);
}
