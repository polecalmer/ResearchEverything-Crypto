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
import { recordCostEvent } from "./cost-ledger";

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
  //
  // Filter out Anthropic-only SERVER-SIDE tools (e.g. "web_search_20250305").
  // Those are executed on Anthropic's infrastructure and only resolve when the
  // call lands on a Claude model. If we naively forwarded them as OpenAI
  // function specs, the non-Anthropic model would see a tool with no schema
  // and either ignore it or emit a malformed call that we can't service.
  // Pattern: a `type` field that is NOT one of the standard Anthropic client-
  // tool shapes ("custom" / "function" / undefined) AND looks like a server-
  // tool (versioned-suffix `_YYYYMMDD` or contains "server"). The capability
  // gap is handled at the call site — agents should use the locally-implemented
  // `web_search` / `web_fetch` tools instead, which work on any provider.
  let tools: OpenAITool[] | undefined;
  if (Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0) {
    const dropped: string[] = [];
    const kept = anthropicReq.tools.filter((t: any) => {
      const ty = typeof t?.type === "string" ? t.type : "";
      const isServerTool =
        /_\d{8}$/.test(ty) || // versioned server tools, e.g. web_search_20250305
        ty.startsWith("server_") ||
        ty === "code_execution_20250522" ||
        ty === "computer_20250124";
      if (isServerTool) {
        dropped.push(t?.name || ty);
        return false;
      }
      return true;
    });
    if (dropped.length > 0) {
      console.warn(
        `[openrouter-client] Dropped ${dropped.length} Anthropic server-side tool(s) when routing to non-Anthropic model: ${dropped.join(", ")}. The agent should use locally-implemented equivalents (web_search, web_fetch).`,
      );
    }
    if (kept.length > 0) {
      tools = kept.map((t: any) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema || { type: "object", properties: {} },
        },
      }));
    }
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

/** OpenRouter's Anthropic-compatible endpoint — uses native /v1/messages
 *  protocol so cache_control markers, thinking blocks, tool_use shape,
 *  cache_creation_input_tokens, and cache_read_input_tokens are all
 *  preserved end-to-end. Use this for `anthropic/*` models. */
async function postOpenRouterMessages(body: any, signal?: AbortSignal): Promise<Response> {
  return fetch("https://openrouter.ai/api/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      // Opt into the Anthropic prompt-caching beta header — required for
      // cache_control markers to actually create / read cache entries.
      "anthropic-beta": "prompt-caching-2024-07-31",
      "HTTP-Referer": "https://researcheverything.xyz",
      "X-Title": "Sessions Research",
    },
    body: JSON.stringify(body),
    signal,
  });
}

function isAnthropicTargetModel(model: string): boolean {
  const resolved = toOpenRouterModelId(model);
  return resolved.startsWith("anthropic/");
}

/** Strip Anthropic server-side tools from the tool list. These are
 *  Anthropic-managed (web_search_20250305, code_execution_*, etc.) and
 *  must be filtered when routing through OpenRouter's native messages
 *  endpoint because OpenRouter doesn't run them. Same filter as the
 *  OpenAI translator; centralised here so both paths agree. */
function filterServerTools(tools: any[] | undefined): { kept: any[]; dropped: string[] } {
  if (!Array.isArray(tools) || tools.length === 0) return { kept: [], dropped: [] };
  const dropped: string[] = [];
  const kept = tools.filter((t: any) => {
    const ty = typeof t?.type === "string" ? t.type : "";
    const isServerTool =
      /_\d{8}$/.test(ty) ||
      ty.startsWith("server_") ||
      ty === "code_execution_20250522" ||
      ty === "computer_20250124";
    if (isServerTool) {
      dropped.push(t?.name || ty);
      return false;
    }
    return true;
  });
  return { kept, dropped };
}

/** Compute cost from Anthropic-native usage. Treats cache reads as 0.1×
 *  input pricing and cache writes (cache_creation) as 1.25×, matching
 *  Anthropic's published rate card.
 *
 *  Rate-card fallback used when OpenRouter doesn't return usage.cost.
 *  Source: Anthropic public pricing as of 2026-05; safe to overestimate
 *  slightly because we treat the returned cost as authoritative when
 *  available. */
function fallbackCostFromAnthropicUsage(model: string, usage: any): number {
  const inputRate = model.includes("opus") ? 15 : model.includes("sonnet") ? 3 : 0.8; // $/M input
  const outputRate = model.includes("opus") ? 75 : model.includes("sonnet") ? 15 : 4; // $/M output
  const inputTok = Number(usage?.input_tokens || 0);
  const outputTok = Number(usage?.output_tokens || 0);
  const cacheReadTok = Number(usage?.cache_read_input_tokens || 0);
  const cacheWriteTok = Number(usage?.cache_creation_input_tokens || 0);
  // input_tokens reported by Anthropic is the NON-cached input. cache_read
  // and cache_creation are separate.
  const inputUSD = (inputTok / 1e6) * inputRate;
  const outputUSD = (outputTok / 1e6) * outputRate;
  const cacheReadUSD = (cacheReadTok / 1e6) * inputRate * 0.1;
  const cacheWriteUSD = (cacheWriteTok / 1e6) * inputRate * 1.25;
  return inputUSD + outputUSD + cacheReadUSD + cacheWriteUSD;
}

/** Native Anthropic /v1/messages call via OpenRouter. Preserves the
 *  request shape verbatim (system, messages, tools, cache_control markers,
 *  thinking blocks) and returns the response in AnthropicRawResponse
 *  shape. Use this for Anthropic-family models so prompt caching works. */
export async function callAnthropicNativeViaOpenRouter(request: any): Promise<AnthropicRawResponse> {
  // Filter Anthropic server-side tools (web_search_20250305 etc.) — they
  // only work on Anthropic direct, not through OpenRouter's proxy.
  const { kept: tools, dropped } = filterServerTools(request.tools);
  if (dropped.length > 0) {
    console.warn(
      `[openrouter-client] Native path: dropped ${dropped.length} server-side tool(s): ${dropped.join(", ")}. Use the local web_search/web_fetch tools instead.`,
    );
  }

  const body: any = {
    model: toOpenRouterModelId(request.model),
    max_tokens: request.max_tokens ?? 4096,
    messages: request.messages,
  };
  if (request.system) body.system = request.system;
  if (tools.length > 0) body.tools = tools;
  if (request.tool_choice) body.tool_choice = request.tool_choice;
  if (request.temperature != null) body.temperature = request.temperature;
  if (request.top_p != null) body.top_p = request.top_p;
  if (request.top_k != null) body.top_k = request.top_k;
  if (request.thinking) body.thinking = request.thinking;
  if (request.metadata) body.metadata = request.metadata;
  if (request.stop_sequences) body.stop_sequences = request.stop_sequences;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await postOpenRouterMessages(body);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (isRetryable(res.status) && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        throw new Error(`OpenRouter (messages) error ${res.status}: ${text.slice(0, 400)}`);
      }
      const anthropic = await res.json();
      // Anthropic-native response: { content, usage, stop_reason, ... }
      // Wrap in AnthropicRawResponse with costSource discrimination.
      const usage = anthropic.usage || {};
      // OpenRouter may include `cost` in some response envelopes; if so use it.
      const reportedCost = typeof anthropic.cost === "number" ? anthropic.cost : null;
      const cost = reportedCost ?? fallbackCostFromAnthropicUsage(body.model, usage);
      const costSource: CostSource = reportedCost != null ? "receipt" : "voucher_estimate";

      logger.info(
        {
          requestModel: body.model,
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          cacheReadTokens: usage.cache_read_input_tokens || 0,
          cacheWriteTokens: usage.cache_creation_input_tokens || 0,
          cost,
          costSource,
          path: "native",
        },
        "openrouter.request",
      );

      // Persist to the cost ledger (fire-and-forget; never blocks).
      recordCostEvent({
        model: body.model,
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        cacheWriteTokens: usage.cache_creation_input_tokens || 0,
        cost,
        costSource,
        path: "native",
      });

      return {
        id: anthropic.id || "unknown",
        type: "message",
        role: "assistant",
        content: anthropic.content || [],
        model: anthropic.model || body.model,
        stop_reason: anthropic.stop_reason || "end_turn",
        stop_sequence: anthropic.stop_sequence || null,
        usage: {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        } as any,
        mppCost: cost,
        costSource,
      };
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
  throw lastError || new Error("OpenRouter native messages call failed after retries");
}

/* ──────────────────────── Public API ──────────────────────── */

export async function callAnthropicViaOpenRouter(request: any): Promise<AnthropicRawResponse> {
  // Native path for Anthropic models — preserves cache_control,
  // thinking blocks, native tool_use shape, and reports cache hit tokens
  // back in the usage. Caching is the dominant cost lever on long-context
  // agent loops (5-20x cheaper input on cache reads).
  if (isAnthropicTargetModel(request.model)) {
    return callAnthropicNativeViaOpenRouter(request);
  }
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
      // Persist to cost ledger (fire-and-forget).
      recordCostEvent({
        model: openAIReq.model,
        inputTokens: out.usage.input_tokens,
        outputTokens: out.usage.output_tokens,
        cacheReadTokens: (out.usage as any).cache_read_input_tokens || 0,
        cacheWriteTokens: (out.usage as any).cache_creation_input_tokens || 0,
        cost: out.mppCost,
        costSource: out.costSource,
        path: "openai_shape",
      });
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
 *  not for an iterator interface.
 *
 *  For Anthropic models, currently falls back to non-streaming via the
 *  native path. The native /v1/messages streaming protocol (SSE with
 *  message_start / content_block_delta events) is incompatible with the
 *  OpenAI SSE parser below; rather than fork a second streaming
 *  implementation tonight, we route Anthropic models through non-streaming
 *  native (cache_control still works, just no chunk-by-chunk UI feedback).
 *  Followup: add native Anthropic SSE parser for full streaming + caching. */
export async function callAnthropicStreamingViaOpenRouter(
  request: any,
): Promise<AnthropicRawResponse> {
  if (isAnthropicTargetModel(request.model)) {
    // Non-streaming native path preserves cache_control. Caller's onStep
    // callbacks just won't fire mid-stream — they fire on completion.
    // Acceptable tradeoff for the caching win.
    return callAnthropicNativeViaOpenRouter(request);
  }
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
      // Persist to cost ledger (fire-and-forget).
      recordCostEvent({
        model: openAIReq.model,
        inputTokens: out.usage.input_tokens,
        outputTokens: out.usage.output_tokens,
        cost: out.mppCost,
        costSource: out.costSource,
        path: "streaming",
      });

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
