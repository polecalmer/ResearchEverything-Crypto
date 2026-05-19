/**
 * Anthropic LLM client — OpenRouter shim.
 *
 * Historical note: this file was previously the Tempo blockchain
 * payment-channel client that settled every LLM call on-chain via
 * `mppx` + USDC escrow. With the Stripe + credit-gate billing model
 * introduced for the beta cohort (2026-05-19), on-chain settlement is
 * no longer needed — users pay via Stripe for credits, the
 * credit-gate middleware decrements per-turn, and LLM calls go
 * directly through OpenRouter at API rates.
 *
 * To avoid touching the ~30 call sites that import from "./mpp-client",
 * this file is now a THIN PASS-THROUGH to `openrouter-client.ts`:
 *   - callAnthropicRaw          → callAnthropicViaOpenRouter
 *   - callAnthropicRawStreaming → callAnthropicStreamingViaOpenRouter
 *   - callAnthropicServer       → callAnthropicViaOpenRouter (wrapped)
 *   - callAnthropicServerHeavy  → callAnthropicViaOpenRouter (wrapped)
 *
 * Filename + symbol names are kept for back-compat with imports
 * scattered across the codebase. A follow-up rename to
 * `anthropic-client.ts` would be cosmetic — they call the same
 * thing under the hood now.
 *
 * Deleted in the migration:
 *   - Tempo session opening, channel deposits, on-chain settlement
 *   - Receipt cost parsing (now uses OpenRouter usage tokens directly)
 *   - Reclaim cron, channel rotation, balance checks
 *   - MPP_SERVER_WALLET_KEY env var requirement
 *
 * Diagnostic functions (isServerMppReady, getChannelStats, closeChannel,
 * resetMppChannel, markMppShuttingDown) survive as no-ops returning
 * stub values so the admin-routes and shutdown-handler imports
 * compile. They can be removed alongside the callers in a follow-up.
 */

import { callAnthropicViaOpenRouter, callAnthropicStreamingViaOpenRouter } from "./openrouter-client";

/* ──────────────────────── Public types ──────────────────────── */

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

/* ──────────────────────── Public API ──────────────────────── */

/**
 * Raw (Anthropic-shaped) LLM call. Used by the session research agent
 * loop, chart validator, prompt classifier, etc. Returns the native
 * Anthropic response shape with content blocks, tool_use blocks, and
 * cache-hit usage tokens.
 */
export async function callAnthropicRaw(request: any): Promise<AnthropicRawResponse> {
  return callAnthropicViaOpenRouter(request);
}

/**
 * Streaming raw LLM call. Same contract as callAnthropicRaw but
 * accumulates from SSE deltas. Used for long-context Opus synthesis
 * that would otherwise hit Cloudflare's 100s edge timeout on
 * non-streaming.
 */
export async function callAnthropicRawStreaming(request: any): Promise<AnthropicRawResponse> {
  return callAnthropicStreamingViaOpenRouter(request);
}

/**
 * Convenience wrapper: returns the joined text content plus usage,
 * for callers that only want the prose (token-agent, data-agent
 * recipe path, dune-sql-author, telegram, benchmark runners, etc.).
 */
export async function callAnthropicServer(request: AnthropicRequest): Promise<AnthropicResponse> {
  return runJoined(request);
}

/**
 * "Heavy" variant — historically routed through a larger MPP channel
 * deposit. Now identical to callAnthropicServer; the size hint is
 * meaningless without an on-chain channel.
 */
export async function callAnthropicServerHeavy(request: AnthropicRequest): Promise<AnthropicResponse> {
  return runJoined(request);
}

async function runJoined(request: AnthropicRequest): Promise<AnthropicResponse> {
  const raw = await callAnthropicViaOpenRouter(request as any);
  const text = (raw.content || [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("");
  return {
    text,
    usage: raw.usage || { input_tokens: 0, output_tokens: 0 },
    mppCost: raw.mppCost || 0,
    costSource: raw.costSource || "voucher_estimate",
  };
}

/* ──────────────────────── Diagnostic / lifecycle stubs ──────────────────────── */
// These are no-ops kept for back-compat with callers that import from
// this module (admin-routes, security-audit-agent, shutdown handler,
// telegram). All return inert values so the surrounding logic
// degrades gracefully — there's no channel to query, close, or reset.

/** Returns true unconditionally — LLM calls are always available via OR. */
export function isServerMppReady(): boolean {
  return true;
}

/** No-op: there are no payment channels anymore. */
export async function closeChannel(): Promise<void> {
  // intentional no-op
}

/** No-op stub: there's no channel to reset. */
export function resetMppChannel(): { previousState: ReturnType<typeof getChannelStats> } {
  return { previousState: getChannelStats() };
}

/** Returns zeroed stats — preserved so admin-routes can render
 *  without surfacing an empty/undefined state. */
export function getChannelStats() {
  return {
    address: null as string | null,
    deposit: 0,
    totalSpent: 0,
    totalVoucherAuthorized: 0,
    requestCount: 0,
    createdAt: null as number | null,
    isActive: false,
  };
}

/** No-op: setBenchmarkMode controlled deposit sizing on the old MPP
 *  path. Benchmarks now hit OR with the same per-call billing as
 *  app traffic. Flag is retained for call-site compatibility. */
let _benchmarkMode = false;
export function setBenchmarkMode(on: boolean): void {
  _benchmarkMode = on;
}

/** No-op: there's no graceful shutdown path needed without on-chain
 *  channels. Server can exit immediately. */
export function markMppShuttingDown(): void {
  // intentional no-op
}

/** Internals previously consumed by openrouter-mpp-client.ts. That
 *  file is deleted; this stub stays in case anything else imports it. */
export function _mppInternals() {
  return null;
}
