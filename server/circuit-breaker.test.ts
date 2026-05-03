import { describe, it, expect, vi, beforeAll } from "vitest";
import { wrapInCircuit } from "./circuit-breaker";
import { logger } from "./logger";

beforeAll(() => {
  // Open/close events log via Pino — silence so test output stays clean.
  logger.level = "silent";
});

describe("wrapInCircuit", () => {
  it("forwards args and return value when the circuit is closed", async () => {
    const fn = vi.fn(async (a: number, b: number) => a + b);
    const wrapped = wrapInCircuit("add", fn);
    const result = await wrapped(2, 3);
    expect(result).toBe(5);
    expect(fn).toHaveBeenCalledWith(2, 3);
  });

  it("propagates errors thrown by the wrapped function", async () => {
    const fn = vi.fn(async () => {
      throw new Error("downstream-bad");
    });
    const wrapped = wrapInCircuit("err", fn, { volumeThreshold: 100 });
    await expect(wrapped()).rejects.toThrow("downstream-bad");
  });

  it("opens after sustained failures and short-circuits subsequent calls", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always fails");
    });
    const wrapped = wrapInCircuit("flap", fn, {
      errorThresholdPercentage: 50,
      volumeThreshold: 3,
      resetTimeout: 60_000, // long enough that we don't half-open mid-test
    });

    // Drive 3 failures to trip the breaker (volumeThreshold).
    for (let i = 0; i < 3; i++) {
      await expect(wrapped()).rejects.toThrow();
    }
    expect(fn).toHaveBeenCalledTimes(3);

    // The next call should fast-fail without invoking fn — opossum throws
    // a "Breaker is open" error rather than calling the wrapped function.
    await expect(wrapped()).rejects.toThrow(/breaker is open/i);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("recovers (closes) on a successful probe after resetTimeout", async () => {
    let shouldFail = true;
    const fn = vi.fn(async () => {
      if (shouldFail) throw new Error("x");
      return "good";
    });
    const wrapped = wrapInCircuit("recover", fn, {
      errorThresholdPercentage: 50,
      volumeThreshold: 2,
      resetTimeout: 30, // short — we wait it out below
    });

    // Trip it.
    await expect(wrapped()).rejects.toThrow();
    await expect(wrapped()).rejects.toThrow();
    await expect(wrapped()).rejects.toThrow(/breaker is open/i);

    // Let it cool, then succeed once — should close.
    shouldFail = false;
    await new Promise((r) => setTimeout(r, 50));
    const result = await wrapped();
    expect(result).toBe("good");

    // Now subsequent calls go through normally.
    const result2 = await wrapped();
    expect(result2).toBe("good");
  });
});
