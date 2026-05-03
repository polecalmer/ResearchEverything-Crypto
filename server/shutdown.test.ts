import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { Response } from "express";
import {
  isShuttingDown,
  registerInFlightSse,
  getInFlightSseCount,
  notifyShutdownToInFlightSse,
  markShuttingDown,
} from "./shutdown";
import { logger } from "./logger";

beforeAll(() => {
  logger.level = "silent";
});

// Minimal Response shape — enough for shutdown.ts to call write/end without
// touching a real socket. Tracks what was written for assertions.
interface FakeRes {
  written: string[];
  ended: boolean;
  writableEnded: boolean;
  write(chunk: string): void;
  end(): void;
}

function makeFakeRes(): FakeRes {
  return {
    written: [],
    ended: false,
    writableEnded: false,
    write(chunk: string) {
      if (this.writableEnded) throw new Error("write after end");
      this.written.push(chunk);
    },
    end() {
      this.ended = true;
      this.writableEnded = true;
    },
  };
}

describe("shutdown.ts in-flight SSE tracking", () => {
  beforeEach(() => {
    // Drain any leftovers from prior tests (no-op when empty).
    notifyShutdownToInFlightSse("test-reset");
  });

  it("starts empty", () => {
    expect(getInFlightSseCount()).toBe(0);
  });

  it("registerInFlightSse adds; returned deregister removes", () => {
    const res = makeFakeRes() as unknown as Response;
    expect(getInFlightSseCount()).toBe(0);
    const deregister = registerInFlightSse(res);
    expect(getInFlightSseCount()).toBe(1);
    deregister();
    expect(getInFlightSseCount()).toBe(0);
  });

  it("tracks multiple SSEs independently", () => {
    const a = makeFakeRes() as unknown as Response;
    const b = makeFakeRes() as unknown as Response;
    const c = makeFakeRes() as unknown as Response;
    const dA = registerInFlightSse(a);
    const dB = registerInFlightSse(b);
    const dC = registerInFlightSse(c);
    expect(getInFlightSseCount()).toBe(3);
    dB();
    expect(getInFlightSseCount()).toBe(2);
    dA();
    dC();
    expect(getInFlightSseCount()).toBe(0);
  });

  it("deregister called twice is safe (idempotent)", () => {
    const res = makeFakeRes() as unknown as Response;
    const deregister = registerInFlightSse(res);
    deregister();
    deregister(); // no throw
    expect(getInFlightSseCount()).toBe(0);
  });
});

describe("notifyShutdownToInFlightSse", () => {
  beforeEach(() => {
    notifyShutdownToInFlightSse("test-reset");
  });

  it("is a no-op when nothing is in flight", () => {
    notifyShutdownToInFlightSse("nothing-to-do");
    expect(getInFlightSseCount()).toBe(0);
  });

  it("writes a shutdown event + end()s every tracked response", () => {
    const a = makeFakeRes();
    const b = makeFakeRes();
    registerInFlightSse(a as unknown as Response);
    registerInFlightSse(b as unknown as Response);

    notifyShutdownToInFlightSse("server shutting down (SIGTERM)");

    for (const res of [a, b]) {
      expect(res.ended).toBe(true);
      expect(res.written.length).toBe(1);
      expect(res.written[0]).toContain("event: shutdown");
      const dataLine = res.written[0].split("\n").find((l) => l.startsWith("data: "));
      expect(dataLine).toBeDefined();
      const payload = JSON.parse(dataLine!.slice("data: ".length));
      expect(payload.reason).toBe("server shutting down (SIGTERM)");
    }

    expect(getInFlightSseCount()).toBe(0);
  });

  it("skips already-ended responses without throwing", () => {
    const res = makeFakeRes();
    res.writableEnded = true;
    registerInFlightSse(res as unknown as Response);

    notifyShutdownToInFlightSse("late");
    // Nothing was written because writableEnded was already true.
    expect(res.written.length).toBe(0);
    // Set still gets cleared.
    expect(getInFlightSseCount()).toBe(0);
  });

  it("swallows errors from broken response objects", () => {
    const broken = {
      writableEnded: false,
      write: () => {
        throw new Error("socket gone");
      },
      end: () => {},
    } as unknown as Response;
    registerInFlightSse(broken);
    // Should not throw despite the write() failure.
    expect(() => notifyShutdownToInFlightSse("crash")).not.toThrow();
    expect(getInFlightSseCount()).toBe(0);
  });
});

describe("isShuttingDown / markShuttingDown", () => {
  // Ordered as one test on purpose — markShuttingDown is one-way (you can't
  // un-mark), so this case has to come after every other test that depends
  // on the initial-false state.
  it("starts false; flips to true after markShuttingDown", () => {
    expect(isShuttingDown()).toBe(false);
    markShuttingDown();
    expect(isShuttingDown()).toBe(true);
  });
});
