import { tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const ANTHROPIC_MPP_URL = "https://anthropic.mpp.tempo.xyz/v1/messages";

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ type: string; name: string; max_uses?: number }>;
}

export type CostSource = "receipt" | "voucher_estimate";

export interface AnthropicResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
  costSource: CostSource;
}

export interface AnthropicRawResponse {
  content: any[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
  mppCost: number;
  costSource: CostSource;
}

const CHANNEL_DEPOSIT = "50.0";
const SHUTDOWN_TIMEOUT_MS = 15000;

interface MppClientState {
  session: ReturnType<typeof tempo.session>;
  totalSpent: number;
  totalVoucherAuthorized: number;
  requestCount: number;
  createdAt: number;
}

let sharedClient: MppClientState | null = null;
let isShuttingDown = false;

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
  const session = tempo.session({
    account,
    maxDeposit: CHANNEL_DEPOSIT,
  });

  const state: MppClientState = {
    session,
    totalSpent: 0,
    totalVoucherAuthorized: 0,
    requestCount: 0,
    createdAt: Date.now(),
  };

  sharedClient = state;
  console.log(`[MPP-Channel] Opened shared session (deposit: $${CHANNEL_DEPOSIT}): ${account.address}`);
  return state;
}

function forceNewChannel() {
  console.log(`[MPP-Channel] Forcing new channel (previous: ${sharedClient?.requestCount || 0} requests, $${sharedClient?.totalSpent.toFixed(4) || 0} spent, voucher: $${sharedClient?.totalVoucherAuthorized.toFixed(4) || 0})`);
  sharedClient = null;
}

function extractCostFromResponse(response: any, state: MppClientState): { cost: number; source: CostSource } {
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

export function isServerMppReady(): boolean {
  return !!process.env.MPP_SERVER_WALLET_KEY;
}

export function getChannelStats() {
  if (!sharedClient) return null;
  return {
    deposit: CHANNEL_DEPOSIT,
    totalSpent: sharedClient.totalSpent,
    totalVoucherAuthorized: sharedClient.totalVoucherAuthorized,
    requestCount: sharedClient.requestCount,
    uptime: Math.round((Date.now() - sharedClient.createdAt) / 1000),
  };
}

async function closeChannel(): Promise<void> {
  if (!sharedClient) {
    console.log(`[MPP-Channel] No active channel to close.`);
    return;
  }

  const { session, requestCount, totalSpent } = sharedClient;

  try {
    console.log(`[MPP-Channel] Closing channel (${requestCount} requests, $${totalSpent.toFixed(4)} spent, voucher: $${sharedClient.totalVoucherAuthorized.toFixed(4)})...`);
    const receipt = await Promise.race([
      session.close(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Channel close timed out")), SHUTDOWN_TIMEOUT_MS - 2000)
      ),
    ]);
    if (receipt) {
      console.log(`[MPP-Channel] Channel closed successfully. Unspent deposit reclaimed.`);
    } else {
      console.log(`[MPP-Channel] Channel close completed (no receipt).`);
    }
  } catch (err: any) {
    console.error(`[MPP-Channel] Error closing channel: ${err?.message || err}`);
  }
  sharedClient = null;
}

export { closeChannel };

let shutdownHandled = false;

async function gracefulShutdown(signal: string) {
  if (shutdownHandled) return;
  shutdownHandled = true;
  isShuttingDown = true;

  console.log(`[MPP-Channel] ${signal} received — closing channel before exit...`);

  const shutdownTimer = setTimeout(() => {
    console.error(`[MPP-Channel] Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  shutdownTimer.unref();

  await closeChannel();
  clearTimeout(shutdownTimer);
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

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
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = getOrCreateClient();

    try {
      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
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

        if (response.status === 402 && errorText.includes("amount-exceeds-deposit")) {
          console.log(`[MPP-Channel] Deposit exceeded — forcing new channel and retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          forceNewChannel();
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }

        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      console.log(`[MPP-Channel] Request #${state.requestCount}: cost $${mppCost.toFixed(4)} [${costSource}] (spent: $${state.totalSpent.toFixed(4)}, voucher: $${state.totalVoucherAuthorized.toFixed(4)})`);

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
        costSource,
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

export async function callAnthropicRaw(request: any): Promise<AnthropicRawResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = getOrCreateClient();

    try {
      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
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
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      console.log(`[MPP-Channel] Request #${state.requestCount}: cost $${mppCost.toFixed(4)} [${costSource}] (spent: $${state.totalSpent.toFixed(4)}, voucher: $${state.totalVoucherAuthorized.toFixed(4)})`);

      const data = await response.json();

      return {
        content: data.content || [],
        usage: {
          input_tokens: data.usage?.input_tokens || 0,
          output_tokens: data.usage?.output_tokens || 0,
        },
        stop_reason: data.stop_reason || "end_turn",
        mppCost,
        costSource,
      };
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("InsufficientBalance") || errMsg.includes("insufficient funds")) {
        forceNewChannel();
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }
      if (errMsg.includes("Execution reverted")) {
        forceNewChannel();
        throw new Error("AI service payment failed — please try again.");
      }
      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }
      const isRetryableError = errMsg.includes("fetch") || errMsg.includes("524") || errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("timeout") || errMsg.includes("ECONNRESET") || errMsg.includes("429");
      if (attempt < MAX_RETRIES && isRetryableError) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP call failed after retries");
}
