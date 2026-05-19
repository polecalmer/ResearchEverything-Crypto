// Per-request context, propagated invisibly through async/await via Node's
// AsyncLocalStorage. Set once at the request boundary (SSE handler), read
// from anywhere downstream — no need to thread params through 5500 LOC of
// agent code.
//
// Primary use: AbortSignal so tool clients can drop polling / fetch calls
// when the SSE client disconnects mid-stream (was the worst offender:
// Dune polled for up to 180s after the user closed the tab).
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  signal?: AbortSignal;
  requestId?: string;
  userId?: string;
  /** Active research session id — set by the SSE handler when the
   *  request is for /api/research/sessions/:id/messages. Read by
   *  file-artifact tools (write_xlsx / write_csv) so they can scope
   *  generated files to the correct session's artifact directory
   *  without threading sessionId through 5500 LOC of agent code. */
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestSignal(): AbortSignal | undefined {
  return storage.getStore()?.signal;
}

/** Sleep that rejects with AbortError if the signal fires before the
 *  timeout. Use in polling loops so a client disconnect doesn't leave us
 *  snoozing for the next interval (worst case: a 3s Dune poll wait
 *  blocking cancellation by 3s). */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
