import { Mppx, tempo } from "mppx/express";
import { getEstimatedEnrichmentCost } from "./enrichment";
import type { RequestHandler } from "express";

const OWNER_WALLET = "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d";
const PATH_USD = "0x20c0000000000000000000000000000000000000";

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: PATH_USD,
      recipient: OWNER_WALLET,
    }),
  ],
});

export const enrichmentPaywall: RequestHandler = (req, res, next) => {
  const estimated = getEstimatedEnrichmentCost();
  const amount = Math.max(0.01, estimated).toFixed(2);
  const middleware = mppx.charge({
    amount,
    description: `BookMark AI enrichment (est. $${amount})`,
  });
  middleware(req, res, next);
};
