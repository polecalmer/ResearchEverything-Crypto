import { Mppx, tempo } from "mppx/express";
import type { RequestHandler } from "express";
import { storage } from "./storage";
import { WALLETS, TOKENS, MPP_FLAT_FEE } from "./constants";

export const mppx = Mppx.create({
  methods: [
    tempo({
      currency: TOKENS.USDC,
      recipient: WALLETS.OWNER,
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
    amount: MPP_FLAT_FEE,
    description: `Sessions AI enrichment ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const nextStepsPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `AI next steps advisor ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const deepResearchPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `Deep research report ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const tokenIntelPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `Token intelligence analysis ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const duneQueryPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `Dune query execution ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const tokenSnapshotPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `Token snapshot fetch ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);

export const dataChartPaywall: RequestHandler = withAdminBypass(
  mppx.charge({
    amount: MPP_FLAT_FEE,
    description: `Data chart generation ($${MPP_FLAT_FEE})`,
  }) as RequestHandler
);
