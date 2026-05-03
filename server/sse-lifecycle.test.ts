// Integration tests for the cancellation chain B.2 + B.4 introduced.
//
// The SSE handler in research-routes.ts is too entangled (express auth +
// storage + agent loop) to exercise from a unit test. What we CAN cover —
// and what actually breaks if any of the wiring drifts — is the chain:
//
//   request boundary (AbortController + withRequestContext)
//        ↓ AsyncLocalStorage propagation
//   tool client body (getRequestSignal + abortableSleep / fetch signal)
//        ↓
//   abort propagates through and the downstream call rejects
//
// Plus the property that two concurrent requests don't see each other's
// signals (ALS isolation) — without this, one user's cancel could nuke
// another user's in-flight Dune query.
import { describe, it, expect, beforeAll } from "vitest";
import {
  withRequestContext,
  getRequestSignal,
  abortableSleep,
} from "./request-context";
import { logger } from "./logger";

beforeAll(() => {
  logger.level = "silent";
});

describe("SSE cancellation chain", () => {
  it("aborting the request signal cancels a downstream polling tool", async () => {
    const ac = new AbortController();

    // Simulate the agent calling a tool that polls (Dune-shaped).
    const tool = async () => {
      const signal = getRequestSignal();
      // Long sleep mimics the 180s Dune wait — should NOT actually wait
      // 10s here because we abort below.
      await abortableSleep(10_000, signal);
      return "completed";
    };

    const inflight = withRequestContext({ signal: ac.signal }, tool);

    // Simulate client disconnect mid-tool.
    setTimeout(() => ac.abort(), 30);

    await expect(inflight).rejects.toThrow(/abort/i);
  });

  it("multiple in-flight requests don't see each other's signals", async () => {
    const acA = new AbortController();
    const acB = new AbortController();

    let bSignalSeen: AbortSignal | undefined;

    const reqA = withRequestContext({ signal: acA.signal, requestId: "A" }, async () => {
      // While A is sleeping, kick off B in a separate context. B should
      // see B's signal, never A's.
      const bResult = withRequestContext({ signal: acB.signal, requestId: "B" }, async () => {
        bSignalSeen = getRequestSignal();
        return "B done";
      });
      await bResult;
      return getRequestSignal(); // A's signal, even after B's nested context returned
    });

    const aSignalSeen = await reqA;
    expect(aSignalSeen).toBe(acA.signal);
    expect(bSignalSeen).toBe(acB.signal);
  });

  it("aborting request A doesn't cancel request B's in-flight tool", async () => {
    const acA = new AbortController();
    const acB = new AbortController();

    const reqA = withRequestContext({ signal: acA.signal }, async () => {
      await abortableSleep(10_000, getRequestSignal());
    });

    const reqB = withRequestContext({ signal: acB.signal }, async () => {
      await abortableSleep(50, getRequestSignal());
      return "B succeeded";
    });

    // Abort A; B should still complete normally.
    setTimeout(() => acA.abort(), 10);

    await expect(reqA).rejects.toThrow(/abort/i);
    await expect(reqB).resolves.toBe("B succeeded");
  });

  it("a tool that doesn't read the signal still completes if the request isn't aborted", async () => {
    // Sanity check: not every downstream call HAS to read the signal —
    // existing untouched call sites continue to work.
    const ac = new AbortController();
    const result = await withRequestContext({ signal: ac.signal }, async () => {
      // Doesn't even ask for the signal.
      return 42;
    });
    expect(result).toBe(42);
  });
});
