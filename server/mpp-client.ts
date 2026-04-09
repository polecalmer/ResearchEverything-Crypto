import { tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const ANTHROPIC_MPP_URL = "https://anthropic.mpp.tempo.xyz/v1/messages";

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: string; content: any }>;
  tools?: Array<{ type: string; name: string; max_uses?: number; description?: string; input_schema?: any }>;
  tool_choice?: any;
}

export interface AnthropicResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
}

export interface AnthropicRawResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: any }>;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
}

const CHANNEL_DEPOSIT = "4.0";
const SHUTDOWN_TIMEOUT_MS = 15000;

interface MppClientState {
  session: ReturnType<typeof tempo.session>;
  totalSpent: number;
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
    requestCount: 0,
    createdAt: Date.now(),
  };

  sharedClient = state;
  console.log(`[MPP-Channel] Opened shared session (deposit: $${CHANNEL_DEPOSIT}): ${account.address}`);
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

async function closeChannel(): Promise<void> {
  if (!sharedClient) {
    console.log(`[MPP-Channel] No active channel to close.`);
    return;
  }

  const { session, requestCount, totalSpent } = sharedClient;

  try {
    console.log(`[MPP-Channel] Closing channel (${requestCount} requests, $${totalSpent.toFixed(4)} spent)...`);
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
const RETRY_DELAY_MS = 8000;

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

function isChannelError(errMsg: string): boolean {
  return errMsg.includes("channel") || errMsg.includes("deposit") ||
    errMsg.includes("insufficient") || errMsg.includes("closed") ||
    errMsg.includes("expired");
}

interface CallOptions {
  maxRetries?: number;
  failFastOn524?: boolean;
}

async function callAnthropic(request: AnthropicRequest, options?: CallOptions): Promise<AnthropicResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  const maxRetries = options?.maxRetries ?? MAX_RETRIES;
  const failFastOn524 = options?.failFastOn524 ?? false;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
        if (failFastOn524 && (response.status === 524 || response.status === 502)) {
          console.log(`[MPP-Channel] Gateway ${response.status} on heavy call — failing fast for caller to retry with smaller payload`);
          forceNewChannel();
          throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
        }
        if (isRetryable(response.status) && attempt < maxRetries) {
          if (response.status === 524 || response.status === 502) {
            console.log(`[MPP-Channel] Gateway error ${response.status} — refreshing channel before retry`);
            forceNewChannel();
          }
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const mppCost = response.receipt
        ? Number(response.cumulative) / 1e6
        : 0;
      state.totalSpent = Number(response.cumulative || 0n) / 1e6;
      state.requestCount++;

      console.log(`[MPP-Channel] Request #${state.requestCount}: cost ~$${(mppCost - (state.totalSpent - mppCost)).toFixed(4)} (cumulative: $${state.totalSpent.toFixed(4)})`);

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
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }

      if (failFastOn524 && (errMsg.includes("524") || errMsg.includes("502"))) {
        throw err;
      }

      const isRetryableError = errMsg.includes("fetch") ||
        errMsg.includes("524") || errMsg.includes("502") || errMsg.includes("503") ||
        errMsg.includes("timeout") || errMsg.includes("ECONNRESET") ||
        errMsg.includes("429") || errMsg.includes("paymentauth");
      if (attempt < maxRetries && isRetryableError) {
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})...`);
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

export async function callAnthropicRaw(request: AnthropicRequest): Promise<AnthropicRawResponse> {
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
          if (response.status === 524 || response.status === 502) {
            forceNewChannel();
          }
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Raw retryable error ${response.status}, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      const mppCost = response.receipt ? Number(response.cumulative) / 1e6 : 0;
      state.totalSpent = Number(response.cumulative || 0n) / 1e6;
      state.requestCount++;

      const data = await response.json();

      return {
        content: data.content || [],
        stop_reason: data.stop_reason || "end_turn",
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
        forceNewChannel();
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }

      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }

      const isRetryableError = errMsg.includes("fetch") || errMsg.includes("524") ||
        errMsg.includes("502") || errMsg.includes("503") || errMsg.includes("timeout") ||
        errMsg.includes("ECONNRESET") || errMsg.includes("429");
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Raw error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP raw call failed after retries");
}

async function callAnthropicStreaming(request: AnthropicRequest): Promise<AnthropicResponse> {
  if (isShuttingDown) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = getOrCreateClient();

    try {
      const streamRequest = { ...request, stream: true };

      console.log(`[MPP-Channel] Starting streaming request (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`);

      const response = await state.session.fetch(ANTHROPIC_MPP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "mpp",
        },
        body: JSON.stringify(streamRequest),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          if (response.status === 524 || response.status === 502) {
            forceNewChannel();
          }
          const delay = RETRY_DELAY_MS * (attempt + 1);
          console.log(`[MPP-Channel] Stream error ${response.status}, retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
      }

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let streamTerminated = false;

      const body = response.body;
      if (!body) {
        throw new Error("No response body for streaming request");
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const THINKING_TIMEOUT = 5 * 60 * 1000;
      const INTER_TOKEN_TIMEOUT = 90 * 1000;

      function readWithTimeout(timeoutMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reader.cancel().catch(() => {});
            reject(new Error(`Stream read timed out after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs);
          reader.read().then(
            (result) => { clearTimeout(timer); resolve(result); },
            (err) => { clearTimeout(timer); reject(err); },
          );
        });
      }

      try {
        let gotFirstTextToken = false;
        while (true) {
          const timeout = gotFirstTextToken ? INTER_TOKEN_TIMEOUT : THINKING_TIMEOUT;
          const { done, value } = await readWithTimeout(timeout);
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
                fullText += event.delta.text;
                if (!gotFirstTextToken) {
                  gotFirstTextToken = true;
                  console.log(`[MPP-Channel] First text token received, switching to inter-token timeout`);
                }
              } else if (event.type === "message_delta" && event.usage) {
                outputTokens = event.usage.output_tokens || outputTokens;
              } else if (event.type === "message_start" && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || 0;
              }
            } catch {
            }
          }
        }
      } catch (streamErr) {
        const streamErrMsg = (streamErr as any)?.message || String(streamErr);
        console.warn(`[MPP-Channel] Stream interrupted after ${fullText.length} chars: ${streamErrMsg.slice(0, 100)}`);
        streamTerminated = true;
        if (fullText.length < 500) {
          throw streamErr;
        }
      }

      const mppCost = response.receipt
        ? Number(response.cumulative) / 1e6
        : 0;
      state.totalSpent = Number(response.cumulative || 0n) / 1e6;
      state.requestCount++;

      console.log(`[MPP-Channel] Stream ${streamTerminated ? "partial" : "complete"}: ${fullText.length} chars, ${inputTokens}+${outputTokens} tokens (cost ~$${mppCost.toFixed(4)}, cumulative: $${state.totalSpent.toFixed(4)})`);

      return {
        text: fullText,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        mppCost,
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
        throw new Error("AI service payment failed — please try again in a moment.");
      }

      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }

      const isRetryableError = errMsg.includes("fetch") ||
        errMsg.includes("timeout") || errMsg.includes("timed out") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("terminated") ||
        errMsg.includes("503") || errMsg.includes("429");
      if (attempt < MAX_RETRIES && isRetryableError) {
        if (errMsg.includes("terminated") || errMsg.includes("timed out")) {
          console.log(`[MPP-Channel] Forcing new channel after: ${errMsg.slice(0, 60)}`);
          forceNewChannel();
        }
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.log(`[MPP-Channel] Stream error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP streaming call failed after retries");
}

export async function callAnthropicServerHeavy(request: AnthropicRequest): Promise<AnthropicResponse> {
  return callAnthropicStreaming(request);
}
