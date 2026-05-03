// Central shutdown state. Used by:
//   - server/index.ts SIGTERM handler — flips the flag, drains
//   - server/routes/research-routes.ts SSE handler — registers itself
//
// `httpServer.close()` alone won't end SSE streams (they're long-lived
// by design), so we have to track them and either wait them out or
// signal them to wrap up. This module owns that tracking.

import type { Response } from "express";
import { logger } from "./logger";

let shuttingDown = false;
const inFlightSse = new Set<Response>();

export function markShuttingDown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Add an SSE response to the in-flight set. Returns the deregister
 *  function the caller wires into req.on("close") so the set self-prunes
 *  on any close path (client disconnect, error, normal completion). */
export function registerInFlightSse(res: Response): () => void {
  inFlightSse.add(res);
  return () => {
    inFlightSse.delete(res);
  };
}

export function getInFlightSseCount(): number {
  return inFlightSse.size;
}

/** Send a `shutdown` event to every in-flight SSE response and end the
 *  stream. Called only after the soft drain timeout — gives the agent
 *  loop a chance to finish naturally first. The client should react by
 *  treating the response as truncated and letting the user retry. */
export function notifyShutdownToInFlightSse(reason: string): void {
  if (inFlightSse.size === 0) return;
  logger.info({ count: inFlightSse.size, reason }, "shutdown.sse.force-end");
  for (const res of inFlightSse) {
    try {
      if (!res.writableEnded) {
        res.write(
          `event: shutdown\ndata: ${JSON.stringify({ reason })}\n\n`,
        );
        res.end();
      }
    } catch {
      // Socket already gone; nothing we can do.
    }
  }
  inFlightSse.clear();
}
