// Failure-path coverage for the DeFiLlama client. fetchJson is the
// chokepoint every JSON call routes through — covering it covers the
// whole client.
//
// Same vi.resetModules pattern as dune-client.test.ts: the test's
// withRequestContext MUST come from the same fresh request-context.ts
// instance the defillama client just imported, or AsyncLocalStorage
// won't share state between them.
import { describe, it, expect, beforeEach, vi, beforeAll } from "vitest";
import { logger } from "./logger";

beforeAll(() => {
  logger.level = "silent";
});

async function loadDefillamaWith(
  script: (url: string) => Response | Promise<Response>,
) {
  vi.resetModules();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (init?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    // Honor the signal during in-flight script execution — real fetch
    // rejects mid-flight on abort; mock must too or abort tests pass
    // through and assert wrong things.
    return Promise.race<Response>([
      Promise.resolve(script(String(url))),
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    ]);
  });
  const defillama = await import("./defillama-client");
  const { withRequestContext } = await import("./request-context");
  return { defillama, calls, withRequestContext };
}

const okJson = (body: any): Response =>
  new Response(JSON.stringify(body), { status: 200 });

const errStatus = (status: number): Response =>
  new Response("err", { status });

describe("defillama-client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("getProtocolTvl: returns parsed history on 200", async () => {
    const fakeHistory = [
      { date: 1700000000, totalLiquidityUSD: 1_000_000 },
      { date: 1700100000, totalLiquidityUSD: 1_100_000 },
    ];
    const { defillama, calls } = await loadDefillamaWith((url) => {
      if (url.includes("/protocol/aave")) return okJson(fakeHistory);
      return errStatus(404);
    });
    const data = await defillama.getProtocolTvl("aave");
    expect(Array.isArray(data)).toBe(true);
    expect(calls.some((c) => c.url.includes("/protocol/aave"))).toBe(true);
  });

  it("fetchJson chokepoint throws when the HTTP response is non-OK", async () => {
    const { defillama } = await loadDefillamaWith(() => errStatus(503));
    // getStablecoins is the cheapest call that goes through fetchJson.
    await expect(defillama.getStablecoins()).rejects.toThrow(/DeFiLlama API error.*503/);
  });

  it("aborting the request signal cancels an in-flight DeFiLlama call", async () => {
    const { defillama, withRequestContext } = await loadDefillamaWith(async () => {
      await new Promise((r) => setTimeout(r, 5_000));
      return okJson([]);
    });
    const ac = new AbortController();
    const inflight = withRequestContext({ signal: ac.signal }, () =>
      defillama.getStablecoins(),
    );
    setTimeout(() => ac.abort(), 30);
    await expect(inflight).rejects.toThrow(/abort/i);
  }, 10_000);

  it("threads the request signal into every fetch invocation", async () => {
    const { defillama, calls, withRequestContext } = await loadDefillamaWith(() =>
      okJson([]),
    );
    const ac = new AbortController();
    await withRequestContext({ signal: ac.signal }, () => defillama.getStablecoins());
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].init?.signal).toBe(ac.signal);
  });
});
