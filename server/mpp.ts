import { Mppx, tempo } from "mppx/express";
import { Request as MppxRequest } from "mppx/server";
import { Receipt } from "mppx";
import { getEstimatedEnrichmentCost, MARKUP_MULTIPLIER } from "./enrichment";
import type { RequestHandler, Request, Response, NextFunction } from "express";

const OWNER_WALLET = "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d";
const USDC = "0x20c000000000000000000000b9537d11c60e8b50";

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: USDC,
      recipient: OWNER_WALLET,
    }),
  ],
});

declare global {
  namespace Express {
    interface Request {
      mppReceipt?: { method: string; reference: string; timestamp: string };
    }
  }
}

function createPaywall(options: { amount: string; description: string }): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const intent = mppx.charge;
    const handler = intent(options);
    const fetchRequest = MppxRequest.fromNodeListener(req, res);
    const result = await handler(fetchRequest);

    if (result.status === 402) {
      const challenge = result.challenge;
      res.status(402);
      for (const [key, value] of challenge.headers) {
        res.setHeader(key, value);
      }
      res.send(await challenge.text());
      return;
    }

    const dummyResponse = new globalThis.Response(null);
    const withReceiptResponse = result.withReceipt(dummyResponse);
    const receiptHeader = withReceiptResponse.headers.get("Payment-Receipt");

    if (receiptHeader) {
      try {
        const receipt = Receipt.deserialize(receiptHeader);
        req.mppReceipt = {
          method: receipt.method,
          reference: receipt.reference,
          timestamp: receipt.timestamp,
        };
      } catch (e) {
        console.error("[MPP] Failed to deserialize receipt:", e);
      }
      res.setHeader("Payment-Receipt", receiptHeader);
    }

    next();
  };
}

export const enrichmentPaywall: RequestHandler = (req, res, next) => {
  const estimated = getEstimatedEnrichmentCost();
  const amount = Math.max(0.01, estimated).toFixed(2);
  createPaywall({
    amount,
    description: `BookMark AI enrichment (est. $${amount})`,
  })(req, res, next);
};

export const nextStepsPaywall: RequestHandler = (req, res, next) => {
  const estimated = (0.08 * MARKUP_MULTIPLIER);
  const amount = Math.max(0.01, estimated).toFixed(2);
  createPaywall({
    amount,
    description: `AI next steps advisor ($${amount})`,
  })(req, res, next);
};

export const deepResearchPaywall: RequestHandler = (req, res, next) => {
  const estimated = (1.00 * MARKUP_MULTIPLIER);
  const amount = Math.max(0.01, estimated).toFixed(2);
  createPaywall({
    amount,
    description: `Deep research report ($${amount})`,
  })(req, res, next);
};
