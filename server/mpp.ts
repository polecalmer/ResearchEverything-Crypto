import { Mppx, tempo } from "mppx/express";
import { getEstimatedEnrichmentCost, DEEP_RESEARCH_CHARGE, TOKEN_ANALYSIS_CHARGE } from "./enrichment";
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
  const amount = getEstimatedEnrichmentCost().toFixed(2);
  mppx.charge({
    amount,
    description: `BookMark AI research ($${amount})`,
  })(req, res, next);
};

export const nextStepsPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: "0.10",
    description: "AI next steps advisor ($0.10)",
  })(req, res, next);
};

export const deepResearchPaywall: RequestHandler = (req, res, next) => {
  const amount = DEEP_RESEARCH_CHARGE.toFixed(2);
  mppx.charge({
    amount,
    description: `Deep research report ($${amount})`,
  })(req, res, next);
};

export const tokenIntelPaywall: RequestHandler = (req, res, next) => {
  const amount = TOKEN_ANALYSIS_CHARGE.toFixed(2);
  mppx.charge({
    amount,
    description: `Token intelligence analysis ($${amount})`,
  })(req, res, next);
};

export const duneQueryPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: "0.05",
    description: "Dune query execution ($0.05)",
  })(req, res, next);
};

export const tokenSnapshotPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: "0.15",
    description: "Token snapshot fetch ($0.15)",
  })(req, res, next);
};
