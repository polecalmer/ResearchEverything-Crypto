/**
 * Waitlist routes.
 *
 * Public endpoints (no auth):
 *   POST /api/waitlist  — anyone can self-add by email or wallet.
 *
 * Admin endpoints (admin-only):
 *   GET  /api/admin/waitlist            — list pending invitations.
 *   POST /api/admin/waitlist/:id/invite — mark an entry as invited.
 *   GET  /api/admin/users/count         — current cohort size.
 *
 * Note: the auth middleware ALSO auto-adds users to the waitlist when
 * a Privy signup hits the BETA_USER_CAP (see server/auth.ts). This
 * route exists for self-service signups BEFORE the user authenticates
 * (e.g. landing-page email capture form).
 */

import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { logger } from "../logger";

export function registerWaitlistRoutes(app: Express) {
  // Public self-signup. Accepts { email?, walletAddress?, notes? } —
  // at least one of email or walletAddress is required.
  app.post("/api/waitlist", async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === "string" && req.body.email.trim()
        ? req.body.email.trim().toLowerCase()
        : undefined;
      const walletAddress = typeof req.body?.walletAddress === "string" && req.body.walletAddress.trim()
        ? req.body.walletAddress.trim()
        : undefined;
      const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 500) : undefined;

      if (!email && !walletAddress) {
        return res.status(400).json({ error: "Provide an email or wallet address." });
      }

      // Validate email shape if provided.
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Invalid email." });
      }

      const entry = await storage.addToWaitlist({ email, walletAddress, notes });
      logger.info?.({ entryId: entry.id, email, walletAddress }, "waitlist self-signup");
      return res.json({
        ok: true,
        message: "You're on the list. We'll email when a slot opens.",
        position: undefined, // we could compute position via count(*) WHERE joined_at <= entry.joined_at — defer
      });
    } catch (err: any) {
      logger.warn?.({ err: err?.message }, "waitlist signup failed");
      return res.status(500).json({ error: "Failed to add to waitlist." });
    }
  });

  // Admin-only — gate via the existing checkIsAdmin helper.
  app.get("/api/admin/waitlist", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const isAdmin = await storage.checkIsAdmin(userId);
    if (!isAdmin) return res.status(403).json({ error: "Admin only." });
    const onlyPending = req.query.pending !== "false";
    const list = await storage.listWaitlist({ onlyPending, limit: 200 });
    return res.json({ count: list.length, entries: list });
  });

  app.post("/api/admin/waitlist/:id/invite", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const isAdmin = await storage.checkIsAdmin(userId);
    if (!isAdmin) return res.status(403).json({ error: "Admin only." });
    await storage.markWaitlistInvited(String(req.params.id));
    return res.json({ ok: true });
  });

  app.get("/api/admin/users/count", requireAuth, async (req: Request, res: Response) => {
    const userId = (req as any).user?.id;
    const isAdmin = await storage.checkIsAdmin(userId);
    if (!isAdmin) return res.status(403).json({ error: "Admin only." });
    const total = await storage.countActiveUsers();
    return res.json({ total, betaCap: 20 });
  });
}
