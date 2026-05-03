import { describe, it, expect } from "vitest";
import {
  withRequestContext,
  getRequestContext,
  getRequestSignal,
  abortableSleep,
} from "./request-context";

describe("request-context", () => {
  describe("withRequestContext / getRequestContext", () => {
    it("returns undefined outside any context", () => {
      expect(getRequestContext()).toBeUndefined();
      expect(getRequestSignal()).toBeUndefined();
    });

    it("makes the context visible to synchronous callers", () => {
      const signal = new AbortController().signal;
      const result = withRequestContext({ signal, requestId: "r1", userId: "u1" }, () => {
        return getRequestContext();
      });
      expect(result?.requestId).toBe("r1");
      expect(result?.userId).toBe("u1");
      expect(result?.signal).toBe(signal);
    });

    it("propagates through async/await", async () => {
      const signal = new AbortController().signal;
      const result = await withRequestContext({ signal, requestId: "r2" }, async () => {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 1));
        return getRequestSignal();
      });
      expect(result).toBe(signal);
    });

    it("clears the context after the callback returns", async () => {
      const signal = new AbortController().signal;
      await withRequestContext({ signal }, async () => {
        expect(getRequestSignal()).toBe(signal);
      });
      expect(getRequestContext()).toBeUndefined();
    });

    it("nested contexts shadow outer ones", () => {
      const outer = new AbortController().signal;
      const inner = new AbortController().signal;
      const result = withRequestContext({ signal: outer, requestId: "outer" }, () => {
        return withRequestContext({ signal: inner, requestId: "inner" }, () => {
          return getRequestContext();
        });
      });
      expect(result?.requestId).toBe("inner");
      expect(result?.signal).toBe(inner);
    });
  });

  describe("abortableSleep", () => {
    it("resolves after the timeout when no signal fires", async () => {
      const start = Date.now();
      await abortableSleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    });

    it("rejects with AbortError when signal aborts mid-sleep", async () => {
      const ac = new AbortController();
      const sleep = abortableSleep(10_000, ac.signal);
      setTimeout(() => ac.abort(), 20);
      await expect(sleep).rejects.toThrow(/abort/i);
    });

    it("rejects immediately when signal is already aborted", async () => {
      const ac = new AbortController();
      ac.abort();
      const start = Date.now();
      await expect(abortableSleep(10_000, ac.signal)).rejects.toThrow(/abort/i);
      expect(Date.now() - start).toBeLessThan(50);
    });

    it("ignores signal aborts that happen after resolution", async () => {
      const ac = new AbortController();
      await abortableSleep(20, ac.signal);
      // No throw if we abort later.
      ac.abort();
    });
  });
});
