/**
 * Cost ceiling middleware — bounds per-user LLM spend per rolling 24h
 * window. Belt-and-suspenders alongside the LLM rate limiter:
 *   - rate limiter caps REQUEST COUNT (~30/hr)
 *   - cost ceiling caps DOLLAR SPEND (~$20/day default)
 *
 * Either trigger returns 429 so the client renders a "budget exhausted"
 * message rather than a generic auth/server error.
 *
 * Mount on LLM-firing routes only. Pure-read routes (GET /messages,
 * etc.) should NOT carry this — the spend is on POST that calls the
 * agent loop.
 *
 * Open-fail: if the cost ledger query errors, allow the request. We
 * never block a paying user because our stats query went sideways.
 */

import type { Request, Response, NextFunction } from "express";
import { getUserDailySpend } from "./cost-ledger";
import { logger } from "./logger";

const DEFAULT_CEILING_USD = 20;

export interface CostCeilingOptions {
  ceilingUsd?: number;
  windowHours?: number;
}

export function makeCostCeiling(opts: CostCeilingOptions = {}) {
  const ceiling = opts.ceilingUsd ?? Number(process.env.USER_DAILY_COST_CEILING_USD || DEFAULT_CEILING_USD);
  const windowHours = opts.windowHours ?? 24;

  return async function enforceCostCeiling(req: Request, res: Response, next: NextFunction) {
    const userId = (req as any).user?.id || (req as any).user?.userId;
    // Unauthenticated routes shouldn't be mounting this middleware, but
    // if it slips through, don't block — just let the auth layer reject.
    if (!userId) return next();

    try {
      const currentSpend = await getUserDailySpend(String(userId), windowHours);
      if (currentSpend >= ceiling) {
        logger.warn?.(
          { userId, currentSpend, ceiling, windowHours },
          "cost-ceiling exceeded — request blocked",
        );
        return res.status(429).json({
          error: "Daily LLM budget exceeded",
          currentSpend: Number(currentSpend.toFixed(4)),
          ceiling,
          windowHours,
          resetsAt: new Date(Date.now() + windowHours * 3600_000).toISOString(),
          hint: "Wait for the window to roll forward, or contact support to raise the cap.",
        });
      }
    } catch (err: any) {
      // Open-fail. Never block a user because our stats query died.
      logger.debug?.({ err: err?.message, userId }, "cost-ceiling check failed — allowing request");
    }
    next();
  };
}
