// Coverage for the price-history router. Primary path is CoinGecko;
// DeFiLlama fires only when CoinGecko rate-limits, 404s, errors, or
// returns zero rows. If this regresses, every price chart is silently
// served through DeFiLlama's CoinGecko-proxy with extra latency and a
// stripped metadata response.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factories run BEFORE imports are resolved (vitest hoists
// them). vi.hoisted lets us declare mock fns alongside the factory so
// references inside the factory don't hit a TDZ.
const { cgMock, dlMock } = vi.hoisted(() => {
  return { cgMock: vi.fn(), dlMock: vi.fn() };
});

vi.mock("./coingecko-client", () => ({
  getCoinPriceHistory: cgMock,
  CoinGeckoRateLimitError: class CoinGeckoRateLimitError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CoinGeckoRateLimitError";
    }
  },
  CoinGeckoNotFoundError: class CoinGeckoNotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "CoinGeckoNotFoundError";
    }
  },
}));

vi.mock("./defillama-client", () => ({
  getCoinPriceHistory: dlMock,
}));

import { getCoinPriceHistory } from "./price-history";

beforeEach(() => {
  cgMock.mockReset();
  dlMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("price-history router — primary path", () => {
  it("uses CoinGecko when it succeeds with data", async () => {
    cgMock.mockResolvedValueOnce({
      prices: [{ date: 1700000000, price: 1.23 }],
      symbol: "octra",
    });
    const result = await getCoinPriceHistory("octra", 90);
    expect(cgMock).toHaveBeenCalledWith("octra", 90);
    expect(dlMock).not.toHaveBeenCalled();
    expect(result.source).toBe("coingecko");
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0].price).toBe(1.23);
  });
});

describe("price-history router — fallback to DeFiLlama", () => {
  it("falls back when CoinGecko rate-limits", async () => {
    const rateLimitErr = new Error("CoinGecko rate limited (429)");
    rateLimitErr.name = "CoinGeckoRateLimitError";
    cgMock.mockRejectedValueOnce(rateLimitErr);
    dlMock.mockResolvedValueOnce({
      prices: [{ date: 1700000000, price: 1.5 }],
      symbol: "octra",
    });
    const result = await getCoinPriceHistory("octra", 90);
    expect(dlMock).toHaveBeenCalledWith("octra", 90);
    expect(result.source).toBe("defillama");
    expect(result.prices[0].price).toBe(1.5);
  });

  it("falls back when CoinGecko 404s the coin id", async () => {
    const notFoundErr = new Error("CoinGecko coin id not found");
    notFoundErr.name = "CoinGeckoNotFoundError";
    cgMock.mockRejectedValueOnce(notFoundErr);
    dlMock.mockResolvedValueOnce({
      prices: [{ date: 1700000000, price: 0.5 }],
      symbol: "mystery-token",
    });
    const result = await getCoinPriceHistory("mystery-token", 30);
    expect(result.source).toBe("defillama");
  });

  it("falls back on generic CoinGecko errors", async () => {
    cgMock.mockRejectedValueOnce(new Error("Network error"));
    dlMock.mockResolvedValueOnce({
      prices: [{ date: 1700000000, price: 2 }],
      symbol: "hyperliquid",
    });
    const result = await getCoinPriceHistory("hyperliquid", 365);
    expect(result.source).toBe("defillama");
  });

  it("falls back when CoinGecko returns zero rows", async () => {
    cgMock.mockResolvedValueOnce({ prices: [], symbol: "obscure" });
    dlMock.mockResolvedValueOnce({
      prices: [{ date: 1700000000, price: 0.01 }],
      symbol: "obscure",
    });
    const result = await getCoinPriceHistory("obscure", 30);
    expect(result.source).toBe("defillama");
  });
});

describe("price-history router — both sources fail", () => {
  it("returns empty when both sources fail", async () => {
    cgMock.mockRejectedValueOnce(new Error("CG down"));
    dlMock.mockRejectedValueOnce(new Error("DL down"));
    const result = await getCoinPriceHistory("ghost-coin", 30);
    expect(result.prices).toEqual([]);
    expect(result.source).toBe("none");
  });

  it("handles invalid coinId without calling either source", async () => {
    const result = await getCoinPriceHistory("", 30);
    expect(cgMock).not.toHaveBeenCalled();
    expect(dlMock).not.toHaveBeenCalled();
    expect(result.source).toBe("none");
  });
});
