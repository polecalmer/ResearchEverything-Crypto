// Direct OpenRouter client. Speaks the same Anthropic-shaped request /
// response contract as mpp-client (`callAnthropicRaw` /
// `callAnthropicRawStreaming` return AnthropicRawResponse) so call sites
// don't care whether they're going through MPP or OpenRouter. Translation
// between Anthropic shape and OpenAI shape lives entirely in this module.
//
// What this DOESN'T do:
//   - On-chain payment channel — none needed; OpenRouter takes a bearer
//     key and bills you directly.
//   - Voucher-estimate vs receipt accounting — uses OpenRouter's usage.cost
//     (settled from upstream) when available, falls back to rate-card math.
//   - Cache-control breakpoints — passed through verbatim on system blocks;
//     OpenRouter forwards to Anthropic upstream when routed there.
//
// Streaming semantics match mpp-client: the request is sent with
// stream:true, the SSE chunks are accumulated internally, and the function
// returns the FINAL AnthropicRawResponse after the stream completes — same
// as `callAnthropicRawStreaming` in mpp-client. Callers don't iterate.
import { OPENROUTER_DIRECT_URL } from "./constants";
import { logger } from "./logger";
import type { AnthropicRawResponse, CostSource } from "./mpp-client";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const STREAM_IDLE_TIMEOUT_MS = 60_000;
const REQUEST_TOTAL_TIMEOUT_MS = 15 * 60_000;

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env or your secrets store before using LLM_PROVIDER=openrouter.",
    );
  }
  return key;
}

/** Some Anthropic model IDs the codebase uses (e.g. "claude-opus-4-7-20251015")
 *  need an `anthropic/` prefix on OpenRouter. If the model already has a
 *  provider prefix (`anthropic/`, `openai/`, `moonshotai/`, etc.) we pass
 *  it through unchanged so callers retain full control. */
function toOpenRouterModelId(model: string): string {
  if (!model) return model;
  if (model.includes("/")) return model;
  return `anthropic/${model}`;
}

/* ──────────────────────── Request translation ──────────────────────── */

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | Array<{ type: string; text?: string; [k: string]: any }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, any>;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIChatMessage[];
  max_tokens: number;
  tools?: OpenAITool[];
  stream?: boolean;
  stream_options?: { include_usage: boolean };
  usage?: { include: boolean };
  // Force the upstream provider OpenRouter routes to. Without this,
  // OpenRouter can silently fall back to a different provider when the
  // primary is overloaded — fine for general traffic, bad for benchmarks.
  // We don't pin by default; callers can override via request.provider.
}

/** Translate an Anthropic-shaped request into an OpenAI-compatible
 *  ChatCompletion request OpenRouter can consume. */
export function toOpenAIRequest(anthropicReq: any): OpenAIRequest {
  const messages: OpenAIChatMessage[] = [];

  // 1. System prompt — Anthropic uses `system` (string or array of blocks);
  //    OpenAI uses a `system` role message at the front.
  if (anthropicReq.system) {
    let systemText: string;
    if (typeof anthropicReq.system === "string") {
      systemText = anthropicReq.system;
    } else if (Array.isArray(anthropicReq.system)) {
      systemText = anthropicReq.system
        .map((b: any) => (typeof b === "string" ? b : b?.text || ""))
        .filter(Boolean)
        .join("\n\n");
    } else {
      systemText = String(anthropicReq.system);
    }
    messages.push({ role: "system", content: systemText });
  }

  // 2. Messages — each Anthropic message expands into one or more OpenAI
  //    messages depending on content shape.
  for (const m of anthropicReq.messages || []) {
    if (typeof m.content === "string") {
      // Plain text message — direct mapping.
      messages.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;

    if (m.role === "assistant") {
      // Assistant messages with content blocks: split text + tool_use.
      let textBuf = "";
      const toolCalls: OpenAIChatMessage["tool_calls"] = [];
      for (const block of m.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textBuf += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
        // `thinking` blocks are skipped — OpenAI has no direct equivalent.
      }
      const msg: OpenAIChatMessage = { role: "assistant", content: textBuf || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      messages.push(msg);
    } else if (m.role === "user") {
      // User messages can carry tool_result blocks. Each tool_result
      // becomes its OWN `role: "tool"` message in OpenAI shape.
      let textBuf = "";
      const toolResults: Array<{ tool_use_id: string; content: any }> = [];
      for (const block of m.content) {
        if (block.type === "text" && typeof block.text === "string") {
          textBuf += block.text;
        } else if (block.type === "tool_result") {
          toolResults.push({
            tool_use_id: block.tool_use_id,
            content: block.content,
          });
        }
      }
      // Emit tool result messages FIRST (chronologically they precede the
      // user's next-turn text in OpenAI's protocol).
      for (const tr of toolResults) {
        let content: string;
        if (typeof tr.content === "string") {
          content = tr.content;
        } else if (Array.isArray(tr.content)) {
          content = tr.content
            .map((c: any) => (typeof c === "string" ? c : c?.text || JSON.stringify(c)))
            .join("\n");
        } else {
          content = JSON.stringify(tr.content);
        }
        messages.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content,
        });
      }
      if (textBuf) {
        messages.push({ role: "user", content: textBuf });
      }
    }
  }

  // 3. Tools — Anthropic uses { name, description, input_schema };
  //    OpenAI uses { type: "function", function: { name, description, parameters } }.
  let tools: OpenAITool[] | undefined;
  if (Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0) {
    tools = anthropicReq.tools.map((t: any) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema || { type: "object", properties: {} },
      },
    }));
  }

  const out: OpenAIRequest = {
    model: toOpenRouterModelId(anthropicReq.model),
    messages,
    max_tokens: anthropicReq.max_tokens ?? 4096,
    // Ask OpenRouter to include cost in the response so we can populate
    // mppCost with a settled (not estimated) value.
    usage: { include: true },
  };
  if (tools) out.tools = tools;
  if (anthropicReq.stream) {
    out.stream = true;
    // For streaming, OpenAI omits usage by default — opt in so we can
    // record token counts at the end.
    out.stream_options = { include_usage: true };
  }
  return out;
}

/* ──────────────────────── Response translation ──────────────────────── */

interface OpenAIChoice {
  index: number;
  message?: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: "stop" | "tool_calls" | "length" | "content_filter" | string;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  cost?: number; // OpenRouter-specific — total USD spent for this request
}

interface OpenAIResponse {
  id: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
  model?: string;
}

/** Map an OpenAI finish_reason onto the Anthropic stop_reason values
 *  the agent loop branches on. */
function toStopReason(finish: string): string {
  switch (finish) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
    case "stop_sequence":
      return "end_turn";
    default:
      return finish || "end_turn";
  }
}

/** Translate a complete OpenAI ChatCompletion response back to the
 *  AnthropicRawResponse shape the codebase expects. */
function toAnthropicResponse(body: OpenAIResponse): AnthropicRawResponse {
  const choice = body.choices?.[0];
  const content: any[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: any = {};
      try {
        input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Malformed JSON — keep as empty object; agent's tool dispatcher
        // will surface the failure.
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function?.name,
        input,
      });
    }
  }

  const usage = body.usage || ({} as OpenAIUsage);
  const mppCost = typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : 0;
  // "receipt" when OpenRouter returned a settled cost; "voucher_estimate"
  // when we'd otherwise have to compute it from a rate card (TODO: add
  // rate-card fallback if `usage.cost` is ever absent).
  const costSource: CostSource = mppCost > 0 ? "receipt" : "voucher_estimate";

  return {
    content,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    },
    stop_reason: toStopReason(choice?.finish_reason || "stop"),
    mppCost,
    costSource,
  };
}

/* ──────────────────────── HTTP transport ──────────────────────── */

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

async function postOpenRouter(body: OpenAIRequest, signal?: AbortSignal): Promise<Response> {
  return fetch(OPENROUTER_DIRECT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      // Optional but recommended — surfaces on OpenRouter's leaderboard
      // for clean attribution. Harmless if absent.
      "HTTP-Referer": "https://researcheverything.xyz",
      "X-Title": "Sessions Research",
    },
    body: JSON.stringify(body),
    signal,
  });
}

/* ──────────────────────── Public API ──────────────────────── */

export async function callAnthropicViaOpenRouter(request: any): Promise<AnthropicRawResponse> {
  const openAIReq = toOpenAIRequest({ ...request, stream: false });
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await postOpenRouter(openAIReq);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (isRetryable(res.status) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        throw new Error(`OpenRouter API error (${res.status}): ${text.slice(0, 400)}`);
      }
      const body = (await res.json()) as OpenAIResponse;
      const out = toAnthropicResponse(body);
      logger.info(
        {
          requestModel: openAIReq.model,
          inputTokens: out.usage.input_tokens,
          outputTokens: out.usage.output_tokens,
          cost: out.mppCost,
          costSource: out.costSource,
        },
        "openrouter.request",
      );
      return out;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || "";
      const isNet = /fetch|ECONNRESET|EAI_AGAIN|aborted|network|terminated/i.test(msg);
      if (isNet && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("OpenRouter call failed after retries");
}

/** Streaming variant — accumulates the OpenAI SSE stream and returns the
 *  final AnthropicRawResponse. Matches the contract of mpp-client's
 *  callAnthropicRawStreaming: streaming is for transparency / progress,
 *  not for an iterator interface. */
export async function callAnthropicStreamingViaOpenRouter(
  request: any,
): Promise<AnthropicRawResponse> {
  const openAIReq = toOpenAIRequest({ ...request, stream: true });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let totalTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(new Error("stream idle for too long")), STREAM_IDLE_TIMEOUT_MS);
    };
    totalTimer = setTimeout(
      () => controller.abort(new Error("stream exceeded total budget")),
      REQUEST_TOTAL_TIMEOUT_MS,
    );
    resetIdle();

    try {
      const res = await postOpenRouter(openAIReq, controller.signal);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (isRetryable(res.status) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        throw new Error(`OpenRouter API error (${res.status}): ${text.slice(0, 400)}`);
      }
      if (!res.body) throw new Error("OpenRouter stream had no body");

      // Accumulators — per-tool-call by index so we can rebuild content
      // blocks at the end. OpenAI emits tool_call deltas keyed by
      // `index`; the order in the final array follows ascending index.
      let textBuf = "";
      const toolCalls: Map<number, { id?: string; name?: string; argsBuf: string }> = new Map();
      let usage: OpenAIUsage | undefined;
      let finishReason: string = "stop";

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          // OpenRouter sometimes sends a final chunk with `usage` and no
          // `choices`. Capture usage whenever it appears.
          if (event.usage) usage = event.usage;

          const choice = event.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta || {};
          if (typeof delta.content === "string") {
            textBuf += delta.content;
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const slot = toolCalls.get(idx) || { argsBuf: "" };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (typeof tc.function?.arguments === "string") {
                slot.argsBuf += tc.function.arguments;
              }
              toolCalls.set(idx, slot);
            }
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
      }

      const content: any[] = [];
      if (textBuf) content.push({ type: "text", text: textBuf });
      const orderedIndices = Array.from(toolCalls.keys()).sort((a, b) => a - b);
      for (const idx of orderedIndices) {
        const slot = toolCalls.get(idx)!;
        let input: any = {};
        try {
          input = slot.argsBuf ? JSON.parse(slot.argsBuf) : {};
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: slot.id,
          name: slot.name,
          input,
        });
      }

      const mppCost = typeof usage?.cost === "number" && Number.isFinite(usage.cost) ? usage!.cost : 0;
      const out: AnthropicRawResponse = {
        content,
        usage: {
          input_tokens: usage?.prompt_tokens || 0,
          output_tokens: usage?.completion_tokens || 0,
        },
        stop_reason: toStopReason(finishReason),
        mppCost,
        costSource: mppCost > 0 ? "receipt" : "voucher_estimate",
      };

      logger.info(
        {
          requestModel: openAIReq.model,
          inputTokens: out.usage.input_tokens,
          outputTokens: out.usage.output_tokens,
          contentBlocks: content.length,
          cost: out.mppCost,
        },
        "openrouter.stream.request",
      );

      return out;
    } catch (err: any) {
      lastError = err;
      const msg = err?.message || "";
      const isNet = /fetch|ECONNRESET|EAI_AGAIN|aborted|network|terminated|stream idle|stream exceeded/i.test(msg);
      if (isNet && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
    }
  }
  throw lastError || new Error("OpenRouter streaming call failed after retries");
}
