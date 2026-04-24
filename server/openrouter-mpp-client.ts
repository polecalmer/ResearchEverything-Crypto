// OpenRouter client that pays via Tempo MPP, reusing the shared payment channel
// plumbing from mpp-client.ts. Keep this file additive — nothing here replaces
// callAnthropic* yet. Benchmark a model on the new path before cutting over any
// production call site.

import { _mppInternals, type CostSource } from "./mpp-client";
import { EXTERNAL_URLS } from "./constants";

const OPENROUTER_MPP_URL = EXTERNAL_URLS.OPENROUTER_MPP;

// OpenAI-compatible chat message shape. `content` can be a string or an array
// of content parts (text/image). Tool results are sent as role: "tool".
export type OpenRouterMessage =
  | { role: "system" | "user" | "assistant"; content: string | Array<any>; tool_calls?: OpenRouterToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface OpenRouterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenRouterTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
  };
}

export interface OpenRouterRequest {
  model: string; // e.g. "moonshotai/kimi-k2", "anthropic/claude-sonnet-4"
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: OpenRouterTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  stream?: false; // streaming handled separately
  // OpenRouter-specific routing / provider preferences
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
    require_parameters?: boolean;
    data_collection?: "allow" | "deny";
  };
  transforms?: string[]; // e.g. ["middle-out"]
}

export interface OpenRouterRawResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenRouterToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  mppCost: number;
  costSource: CostSource;
}

export interface OpenRouterResponse {
  text: string;
  toolCalls: OpenRouterToolCall[];
  finishReason: string;
  usage: { input_tokens: number; output_tokens: number };
  mppCost: number;
  costSource: CostSource;
}

export async function callOpenRouterRaw(request: OpenRouterRequest): Promise<OpenRouterRawResponse> {
  const {
    getOrCreateClient,
    forceNewChannel,
    extractCostFromResponse,
    isRetryable,
    isChannelError,
    isTransientChainError,
    isShuttingDown,
    MAX_RETRIES,
    RETRY_DELAY_MS,
  } = _mppInternals();

  if (isShuttingDown()) {
    throw new Error("Server is shutting down — please retry in a moment.");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const state = await getOrCreateClient();

    try {
      const response = await state.session.fetch(OPENROUTER_MPP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // MPP gateway accepts "mpp" as a sentinel; the real auth is the
          // on-chain channel bound to state.session.
          "Authorization": "Bearer mpp",
          // OpenRouter sometimes surfaces these in dashboards for quota/routing.
          "HTTP-Referer": "https://sessions.xyz",
          "X-Title": "Sessions - Research Everything",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");

        if (response.status === 402 && errorText.includes("amount-exceeds-deposit")) {
          console.log(`[OpenRouter-MPP] Deposit exceeded — forcing new channel and retrying (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          forceNewChannel();
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
        }

        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          const delay =
            response.status === 524 || response.status === 408
              ? Math.min(30000, 10000 * (attempt + 1))
              : RETRY_DELAY_MS * (attempt + 1);
          console.log(`[OpenRouter-MPP] Retryable error ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const { cost: mppCost, source: costSource } = extractCostFromResponse(response, state);
      state.requestCount++;

      const data = await response.json();
      console.log(`[OpenRouter-MPP] Request #${state.requestCount} [${data.model || request.model}]: cost $${mppCost.toFixed(4)} [${costSource}] (spent: $${state.totalSpent.toFixed(4)})`);

      return {
        id: data.id,
        model: data.model || request.model,
        choices: data.choices || [],
        usage: {
          prompt_tokens: data.usage?.prompt_tokens || 0,
          completion_tokens: data.usage?.completion_tokens || 0,
          total_tokens: data.usage?.total_tokens || 0,
        },
        mppCost,
        costSource,
      };
    } catch (err) {
      lastError = err as Error;
      const errMsg = (err as any)?.message || "";

      if (errMsg.includes("insufficient funds")) {
        throw new Error("AI service temporarily unavailable — server wallet needs to be topped up.");
      }
      if (isTransientChainError(errMsg)) {
        if (attempt < MAX_RETRIES) {
          console.log(`[OpenRouter-MPP] Transient chain error: "${errMsg.slice(0, 80)}", retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        throw new Error("AI service payment failed — please try again.");
      }
      if (isChannelError(errMsg)) {
        forceNewChannel();
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      }
      const is524 = errMsg.includes("524") || errMsg.includes("timeout");
      const isRetryableError =
        errMsg.includes("fetch") ||
        is524 ||
        errMsg.includes("502") ||
        errMsg.includes("503") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("429");
      if (attempt < MAX_RETRIES && isRetryableError) {
        const delay = is524 ? Math.min(30000, 10000 * (attempt + 1)) : RETRY_DELAY_MS * (attempt + 1);
        console.log(`[OpenRouter-MPP] Error: "${errMsg.slice(0, 80)}", retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("MPP OpenRouter call failed after retries");
}

// Convenience wrapper for the common text-only case.
export async function callOpenRouter(request: OpenRouterRequest): Promise<OpenRouterResponse> {
  const raw = await callOpenRouterRaw(request);
  const choice = raw.choices[0];
  const msg = choice?.message;
  const text = typeof msg?.content === "string" ? msg.content : "";
  return {
    text,
    toolCalls: msg?.tool_calls || [],
    finishReason: choice?.finish_reason || "stop",
    usage: {
      input_tokens: raw.usage.prompt_tokens,
      output_tokens: raw.usage.completion_tokens,
    },
    mppCost: raw.mppCost,
    costSource: raw.costSource,
  };
}
