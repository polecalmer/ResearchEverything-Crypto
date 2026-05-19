// Coverage for the credit-gate middleware. If this regresses, paying
// users get blocked, admin users get charged, or the gate stops
// blocking unauthenticated turns.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getUserCreditsMock, deductCreditMock } = vi.hoisted(() => ({
  getUserCreditsMock: vi.fn(),
  deductCreditMock: vi.fn(),
}));

vi.mock("./storage", () => ({
  storage: {
    getUserCredits: getUserCreditsMock,
    deductCredit: deductCreditMock,
  },
}));

import { requireCredits, consumeCredit } from "./credit-gate";

function makeReqRes(userId?: string) {
  const req: any = { user: userId ? { id: userId } : undefined };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  getUserCreditsMock.mockReset();
  deductCreditMock.mockReset();
});

describe("requireCredits — gate behavior", () => {
  it("allows a request with positive balance", async () => {
    getUserCreditsMock.mockResolvedValueOnce(5);
    const { req, res, next } = makeReqRes("user-1");
    await requireCredits(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(req.creditGate?.reserved).toBe(true);
    expect(req.creditGate?.balanceAtEntry).toBe(5);
  });

  it("returns 402 with structured body at zero balance", async () => {
    getUserCreditsMock.mockResolvedValueOnce(0);
    const { req, res, next } = makeReqRes("user-empty");
    await requireCredits(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toBe("out_of_credits");
    expect(res.body.balance).toBe(0);
    expect(res.body.purchaseOptions).toHaveLength(2);
    expect(res.body.purchaseOptions[0].sku).toBe("session_single");
    expect(res.body.purchaseOptions[1].sku).toBe("session_pack_10");
    expect(res.body.checkoutEndpoint).toBe("/api/credits/checkout");
  });

  it("treats admin sentinel (999999) as positive", async () => {
    getUserCreditsMock.mockResolvedValueOnce(999_999);
    const { req, res, next } = makeReqRes("admin-1");
    await requireCredits(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("passes through when no user (auth layer's job to reject)", async () => {
    const { req, res, next } = makeReqRes(undefined);
    await requireCredits(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(getUserCreditsMock).not.toHaveBeenCalled();
  });

  it("open-fails on storage error (never blocks)", async () => {
    getUserCreditsMock.mockRejectedValueOnce(new Error("DB down"));
    const { req, res, next } = makeReqRes("user-error");
    await requireCredits(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});

describe("consumeCredit — post-turn consumption", () => {
  it("decrements once on success", async () => {
    deductCreditMock.mockResolvedValueOnce(true);
    await consumeCredit("user-1", 1);
    expect(deductCreditMock).toHaveBeenCalledTimes(1);
    expect(deductCreditMock).toHaveBeenCalledWith("user-1");
  });

  it("decrements n times for batched flows", async () => {
    deductCreditMock.mockResolvedValue(true);
    await consumeCredit("user-1", 3);
    expect(deductCreditMock).toHaveBeenCalledTimes(3);
  });

  it("stops if deduct returns false (balance race)", async () => {
    deductCreditMock.mockResolvedValueOnce(true);
    deductCreditMock.mockResolvedValueOnce(false); // race
    await consumeCredit("user-1", 3);
    expect(deductCreditMock).toHaveBeenCalledTimes(2);
  });

  it("swallows errors silently (turn already shipped)", async () => {
    deductCreditMock.mockRejectedValueOnce(new Error("DB blip"));
    await expect(consumeCredit("user-1", 1)).resolves.toBeUndefined();
  });

  it("no-ops on empty userId or n <= 0", async () => {
    await consumeCredit("", 1);
    await consumeCredit("user-1", 0);
    await consumeCredit("user-1", -1);
    expect(deductCreditMock).not.toHaveBeenCalled();
  });
});
