/**
 * Credit-gate middleware — enforces the per-turn entitlement.
 *
 * One turn (one POST /api/research/sessions/:id/messages) = one credit.
 * Beta users start with 20 credits granted at signup. After credits = 0
 * the user must purchase more via Stripe at $7/turn or $70 for 10.
 *
 * Sequencing inside a turn:
 *   1. requireCredits  ← this middleware. Reads balance, rejects 402
 *      if 0. Tags req with `creditGate.reserved = true` so the
 *      success-hook knows to decrement.
 *   2. ...agent loop runs...
 *   3. Post-success hook (called from the route handler when the turn
 *      completes successfully): consumeCredit(userId).
 *
 * Why reserve-then-consume instead of decrement-at-entry?
 *   - A turn that errors halfway shouldn't burn a credit. We only
 *     consume on a confirmed-good response.
 *   - Admin users (isAdmin) are exempt from both the gate AND the
 *     decrement — they have infinite practical credits.
 *   - The cost-ceiling middleware (USD-based) stays orthogonal and
 *     stacks cleanly on top: credits gate volume, cost ceiling gates
 *     spend.
 *
 * Concurrent turn protection: storage.deductCredit uses a WHERE
 * credits > 0 conditional update, so two parallel turns can't both
 * decrement below zero.
 */

import type { Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { logger } from "./logger";

/**
 * Middleware: refuses a request when the authenticated user has 0
 * credits. Does NOT decrement here — see consumeCredit() for that.
 * Mount BEFORE the LLM-firing route handler.
 *
 * Returns 402 Payment Required with a structured body the frontend
 * uses to render the purchase modal.
 */
export async function requireCredits(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id;
  if (!userId) {
    // Unauthenticated — the auth middleware should have rejected
    // already. If it didn't, fall through to whatever next() handles.
    return next();
  }

  try {
    const balance = await storage.getUserCredits(userId);
    // getUserCredits returns 999999 for admin users; this comparison
    // remains a no-op for them.
    if (balance <= 0) {
      logger.info?.({ userId }, "credit-gate blocked: zero balance");
      return res.status(402).json({
        error: "out_of_credits",
        message: "You've used all your free turns. Purchase more to continue.",
        balance: 0,
        purchaseOptions: [
          { sku: "session_single", label: "1 turn", priceUsd: 7, credits: 1 },
          { sku: "session_pack_10", label: "10 turns", priceUsd: 70, credits: 10 },
        ],
        checkoutEndpoint: "/api/credits/checkout",
      });
    }
    // Tag the request so the consume-hook knows the user was gated.
    (req as any).creditGate = { reserved: true, balanceAtEntry: balance };
    next();
  } catch (err: any) {
    // Open-fail. Never block a user because our balance check went
    // sideways. Cost-ceiling and rate-limit are independent backstops.
    logger.warn?.({ userId, err: err?.message }, "credit-gate check failed — allowing request");
    next();
  }
}

/**
 * Called from the route handler AFTER a turn has completed
 * successfully. Decrements the user's balance by 1 (or by `n` for
 * batched flows). Best-effort: a failure here is logged but never
 * surfaced to the user — we've already shipped a successful turn.
 *
 * Admin users are no-ops here (deductCredit returns true without
 * touching storage when isAdmin is true).
 */
export async function consumeCredit(userId: string, n: number = 1): Promise<void> {
  if (!userId || n <= 0) return;
  try {
    for (let i = 0; i < n; i++) {
      const ok = await storage.deductCredit(userId);
      if (!ok) {
        // Means the user's balance was already 0 when we tried to
        // consume — race between the entry-check and now. Log it but
        // don't fail; the turn already shipped.
        logger.warn?.({ userId, attempt: i + 1, of: n }, "consumeCredit: deduct returned false (balance race?)");
        break;
      }
    }
  } catch (err: any) {
    logger.warn?.({ userId, err: err?.message }, "consumeCredit failed (turn already shipped)");
  }
}
