import { Mppx, tempo } from "mppx/express";
import type { RequestHandler } from "express";

const OWNER_WALLET = "0x342fFFBcEbb761bC2c7B512333AF5E397b4cB72d";
const USDC = "0x20c000000000000000000000b9537d11c60e8b50";
const FLAT_FEE = "0.50";

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: USDC,
      recipient: OWNER_WALLET,
    }),
  ],
});

export const enrichmentPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Research Everything AI enrichment ($${FLAT_FEE})`,
  })(req, res, next);
};

export const nextStepsPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `AI next steps advisor ($${FLAT_FEE})`,
  })(req, res, next);
};

export const deepResearchPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Deep research report ($${FLAT_FEE})`,
  })(req, res, next);
};

export const tokenIntelPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Token intelligence analysis ($${FLAT_FEE})`,
  })(req, res, next);
};

export const duneQueryPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Dune query execution ($${FLAT_FEE})`,
  })(req, res, next);
};

export const tokenSnapshotPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Token snapshot fetch ($${FLAT_FEE})`,
  })(req, res, next);
};

export const dataChartPaywall: RequestHandler = (req, res, next) => {
  mppx.charge({
    amount: FLAT_FEE,
    description: `Data chart generation ($${FLAT_FEE})`,
  })(req, res, next);
};
