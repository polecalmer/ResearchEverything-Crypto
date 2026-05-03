import { describe, it, expect, vi, beforeAll } from "vitest";
import { retryWithBackoff } from "./retry";
import { logger } from "./logger";

beforeAll(() => {
  // Silence the warn/error logs the retry helper emits — they're a feature
  // in prod but noise in test output.
  logger.level = "silent";
});

describe("retryWithBackoff", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await retryWithBackoff("test-success", fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and returns when an attempt succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    });
    const result = await retryWithBackoff("test-recover", fn, {
      minTimeout: 1,
      maxTimeout: 5,
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows the last error after retries exhausted", async () => {
    const fn = vi.fn(async () => {
      throw new Error("permanent");
    });
    await expect(
      retryWithBackoff("test-exhausted", fn, {
        retries: 2,
        minTimeout: 1,
        maxTimeout: 5,
      }),
    ).rejects.toThrow("permanent");
    // 1 initial + 2 retries = 3 attempts
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("forwards the attempt number to the wrapped function", async () => {
    const seen: number[] = [];
    await retryWithBackoff(
      "test-attempt-arg",
      async (attempt) => {
        seen.push(attempt);
        if (attempt < 2) throw new Error("retry me");
        return "ok";
      },
      { minTimeout: 1, maxTimeout: 5 },
    );
    expect(seen).toEqual([1, 2]);
  });
});
