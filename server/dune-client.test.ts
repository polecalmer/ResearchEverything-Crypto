// Failure-path coverage for the Dune client wired up in B.4 (signal
// propagation) + B.5 (circuit breaker).
//
// Each test resets modules so the dune-execute / dune-results circuits
// start fresh — without this, a few error tests in a row would trip the
// breaker and subsequent tests would see "Breaker is open" instead of
// the actual fetch error we're trying to assert on.
//
// IMPORTANT: vi.resetModules() also gives request-context.ts a fresh
// AsyncLocalStorage instance, so the test's `withRequestContext` MUST
// be imported from the same fresh module that the dune client just
// resolved — otherwise the test and the production code talk to two
// different ALS instances and the signal never propagates.
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import { logger } from "./logger";

beforeAll(() => {
  logger.level = "silent";
});

interface DuneFetchSpy {
  calls: Array<{ url: string; init?: RequestInit }>;
}

async function loadDuneWith(
  script: (call: number, url: string) => Response | Promise<Response>,
) {
  vi.resetModules();
  process.env.DUNE_API_KEY = "test-key";
  const spy: DuneFetchSpy = { calls: [] };
  let n = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    spy.calls.push({ url: String(url), init });
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    // Honor the signal during in-flight script execution — real fetch
    // rejects mid-flight on abort; the mock must too or the abort
    // tests pass through and assert wrong things.
    return Promise.race<Response>([
      Promise.resolve(script(n++, String(url))),
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    ]);
  });
  const dune = await import("./dune-client");
  const { withRequestContext } = await import("./request-context");
  return { dune, spy, withRequestContext };
}

const okJson = (body: any): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const errJson = (status: number, body = "boom"): Response =>
  new Response(body, { status, headers: { "Content-Type": "text/plain" } });

describe("dune-client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("isDuneConfigured returns false when DUNE_API_KEY is unset", async () => {
    vi.resetModules();
    const oldKey = process.env.DUNE_API_KEY;
    delete process.env.DUNE_API_KEY;
    try {
      const dune = await import("./dune-client");
      expect(dune.isDuneConfigured()).toBe(false);
    } finally {
      if (oldKey != null) process.env.DUNE_API_KEY = oldKey;
    }
  });

  it("executeDuneQuery: completes the execute -> poll -> results flow", async () => {
    const { dune, spy } = await loadDuneWith((_, url) => {
      if (url.endsWith("/execute")) return okJson({ execution_id: "exec-1" });
      if (url.includes("/status")) return okJson({ state: "QUERY_STATE_COMPLETED" });
      if (url.includes("/results")) {
        return okJson({
          result: {
            metadata: { column_names: ["a"], total_row_count: 1 },
            rows: [{ a: 1 }],
          },
        });
      }
      return errJson(404, "unmapped");
    });
    const result = await dune.executeDuneQuery(123);
    expect(result.metadata.queryId).toBe(123);
    expect(result.rows).toEqual([{ a: 1 }]);
    expect(spy.calls[0].url).toContain("/query/123/execute");
    // B.4 wiring — signal slot present on every fetch init we send.
    expect(spy.calls.every((c) => "signal" in (c.init || {}))).toBe(true);
  }, 10_000);

  it("executeDuneQuery: bubbles the HTTP error when /execute returns 429", async () => {
    const { dune } = await loadDuneWith((_, url) => {
      if (url.endsWith("/execute")) return errJson(429, "rate limited");
      return errJson(404);
    });
    await expect(dune.executeDuneQuery(789)).rejects.toThrow(/429|Dune execute failed/);
  });

  it("executeDuneQuery: aborts mid-poll when the request signal fires", async () => {
    // Status always pending — without abort, we'd loop 60 times (~3 min).
    const { dune, withRequestContext } = await loadDuneWith((_, url) => {
      if (url.endsWith("/execute")) return okJson({ execution_id: "exec-3" });
      if (url.includes("/status")) return okJson({ state: "QUERY_STATE_PENDING" });
      return errJson(404);
    });
    const ac = new AbortController();
    const inflight = withRequestContext({ signal: ac.signal }, () =>
      dune.executeDuneQuery(999),
    );
    setTimeout(() => ac.abort(), 50);
    await expect(inflight).rejects.toThrow(/abort/i);
  }, 10_000);

  it("getLatestDuneResults: returns rows from the cached results endpoint", async () => {
    const { dune, spy } = await loadDuneWith((_, url) => {
      if (url.includes("/results")) {
        return okJson({
          result: {
            metadata: { column_names: ["x"], total_row_count: 2 },
            rows: [{ x: 1 }, { x: 2 }],
          },
        });
      }
      return errJson(404);
    });
    const result = await dune.getLatestDuneResults(42);
    expect(result.rows.length).toBe(2);
    expect(spy.calls[0].url).toContain("/query/42/results");
  });
});
