import { Mppx, tempo } from "mppx/express";
import { getEstimatedEnrichmentCost, MARKUP_MULTIPLIER } from "./enrichment";
import type { RequestHandler } from "express";

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

export const enrichmentPaywall: RequestHandler = (req, res, next) => {
  const estimated = getEstimatedEnrichmentCost();
  const amount = Math.max(0.01, estimated).toFixed(2);
  mppx.charge({
    amount,
    description: `BookMark AI research (est. $${amount})`,
  })(req, res, next);
};

export const nextStepsPaywall: RequestHandler = (req, res, next) => {
  const estimated = (0.08 * MARKUP_MULTIPLIER);
  const amount = Math.max(0.01, estimated).toFixed(2);
  mppx.charge({
    amount,
    description: `AI next steps advisor ($${amount})`,
  })(req, res, next);
};

export const deepResearchPaywall: RequestHandler = (req, res, next) => {
  const estimated = (1.00 * MARKUP_MULTIPLIER);
  const amount = Math.max(0.01, estimated).toFixed(2);
  mppx.charge({
    amount,
    description: `Deep research report ($${amount})`,
  })(req, res, next);
};
