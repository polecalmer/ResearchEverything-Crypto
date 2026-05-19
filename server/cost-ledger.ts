/**
 * Per-call LLM cost ledger.
 *
 * Every openrouter.request that fires anywhere in the agent loop also
 * writes a row to llm_cost_events (fire-and-forget — never blocks the
 * request). Two cost fields:
 *
 *   cost_estimate — sessions' internal voucher_estimate (token×rate)
 *   cost_actual   — reconciled from OpenRouter receipts later
 *
 * Why this exists: server logs rotate on every restart. Without this
 * ledger, we can't reconstruct historical spend from the database.
 * Reconciliation: when costSource === "receipt", cost_actual is set
 * immediately. Otherwise null until a nightly job pulls OR's daily
 * usage API and back-fills.
 *
 * Errors are SILENTLY SWALLOWED — cost tracking must never break a
 * user-facing request.
 */

import { db } from "./db";
import { llmCostEvents } from "@shared/schema";
import { getRequestContext } from "./request-context";
import { logger } from "./logger";
import { sql } from "drizzle-orm";

export type CostCallKind =
  | "agent_loop"
  | "classifier"
  | "planner"
  | "synthesis"
  | "validator_retry"
  | "extraction"
  | "observer"
  | "analyst_perspective"
  | "wrap_up"
  | "chart_shaper"
  | "perspective_persona"
  | "unknown";

export interface CostRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cost: number;                            // sessions' voucher_estimate
  costSource: "voucher_estimate" | "receipt";
  path?: string;
  callKind?: CostCallKind;
  conversationId?: number | null;
  messageId?: number | null;
}

/**
 * Fire-and-forget cost insert. Pulls conversation/user context from
 * AsyncLocalStorage when not provided. Never throws.
 */
export function recordCostEvent(rec: CostRecord): void {
  const ctx = getRequestContext();
  const convId = rec.conversationId ?? (ctx?.sessionId ? Number(ctx.sessionId) : null);
  const userId = ctx?.userId ?? null;
  const requestId = ctx?.requestId ?? null;

  // Fire-and-forget — don't await, don't propagate errors. The ledger
  // is best-effort; user-facing requests must not block on it.
  void (async () => {
    try {
      await db.insert(llmCostEvents).values({
        conversationId: convId && !Number.isNaN(convId) ? convId : null,
        messageId: rec.messageId ?? null,
        userId,
        requestId,
        model: rec.model,
        callKind: rec.callKind ?? "agent_loop",
        path: rec.path ?? null,
        inputTokens: rec.inputTokens || 0,
        outputTokens: rec.outputTokens || 0,
        cacheReadTokens: rec.cacheReadTokens || 0,
        cacheWriteTokens: rec.cacheWriteTokens || 0,
        // Drizzle numeric columns want strings to preserve precision
        costEstimate: String(rec.cost),
        costActual: rec.costSource === "receipt" ? String(rec.cost) : null,
        costSource: rec.costSource,
      });
    } catch (err: any) {
      // Don't log loudly — cost ledger insert failure should not
      // surface unless explicitly hunted. Debug-level only.
      logger.debug?.({ err: err?.message }, "cost-ledger insert failed");
    }
  })();
}

/**
 * Returns true if any LLM cost was written for this request_id.
 * Used by the credit-gate's failure-path consumer: if the turn
 * errored after firing one or more LLM calls, the user already
 * burned dollars and should be charged a credit for the attempt.
 * Returns false on any DB error (open-fail).
 */
export async function requestIncurredCost(requestId: string | undefined): Promise<boolean> {
  if (!requestId) return false;
  try {
    const r = await db.execute(sql`
      SELECT 1 FROM llm_cost_events WHERE request_id = ${requestId} LIMIT 1
    `);
    const row: any = (r as any).rows?.[0] || (r as any)[0];
    return !!row;
  } catch (err: any) {
    logger.debug?.({ err: err?.message, requestId }, "requestIncurredCost query failed");
    return false;
  }
}

/**
 * Sum the cost_estimate column for a user over the last `windowHours`
 * (default 24). Returns 0 on any error (open-fail — never block users
 * because of a stats query going sideways).
 *
 * Uses cost_estimate (not cost_actual) because actuals are reconciled
 * asynchronously and may be 24h+ stale. Estimates over-state actuals by
 * ~25-40% which means our ceiling is conservative by design.
 */
export async function getUserDailySpend(userId: string, windowHours = 24): Promise<number> {
  if (!userId) return 0;
  try {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(cost_estimate), 0)::numeric AS spend
      FROM llm_cost_events
      WHERE user_id = ${userId}
        AND created_at > now() - (${windowHours} * interval '1 hour')
    `);
    const row: any = (r as any).rows?.[0] || (r as any)[0];
    return Number(row?.spend || 0);
  } catch (err: any) {
    logger.debug?.({ err: err?.message, userId }, "getUserDailySpend failed");
    return 0;
  }
}
