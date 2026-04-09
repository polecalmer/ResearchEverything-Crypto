import { Mppx, tempo } from "mppx/express";
import type { RequestHandler } from "express";
import { storage } from "./storage";

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

function withAdminBypass(chargeMiddleware: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    const userId = (req as any).user?.id;
    if (userId) {
      const isAdmin = await storage.checkIsAdmin(userId);
      if (isAdmin) return next();
    }
    return chargeMiddleware(req, res, next);
  };
}

export const enrichmentPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Research Everything AI enrichment ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const nextStepsPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `AI next steps advisor ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const deepResearchPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Deep research report ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const tokenIntelPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Token intelligence analysis ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const duneQueryPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Dune query execution ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const tokenSnapshotPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Token snapshot fetch ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const dataChartPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `Data chart generation ($${FLAT_FEE})`,
  }) as RequestHandler
);

export const reportEditPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: FLAT_FEE,
    description: `AI report section edit ($${FLAT_FEE})`,
  }) as RequestHandler
);
