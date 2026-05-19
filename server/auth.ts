import { PrivyClient } from "@privy-io/node";
import { storage } from "./storage";
import type { Express, RequestHandler } from "express";
import type { User } from "@shared/schema";
import { trackEvent } from "./usage-tracker";

const privy = new PrivyClient({
  appId: process.env.PRIVY_APP_ID!,
  appSecret: process.env.PRIVY_APP_SECRET!,
});

declare global {
  namespace Express {
    interface Request {
      privyUserId?: string;
      user?: User;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const privyToken = req.headers["x-privy-token"] as string | undefined;

    let token: string | undefined;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else if (privyToken) {
      token = privyToken;
    }

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const { user_id: privyUserId } = await privy.utils().auth().verifyAuthToken(token);

    let user = await storage.getUserByPrivyId(privyUserId);

    if (!user) {
      const privyUser = await privy.users()._get(privyUserId);

      const emailAccount = privyUser.linked_accounts?.find(
        (a: any) => a.type === "email"
      ) as any;
      const walletAccount = privyUser.linked_accounts?.find(
        (a: any) => a.type === "wallet"
      ) as any;

      const email = emailAccount?.address || "";
      const walletAddress = walletAccount?.address || "";
      const displayName = email.split("@")[0] || `user_${Date.now()}`;

      try {
        user = await storage.createPrivyUser({
          privyId: privyUserId,
          email,
          walletAddress,
          username: displayName,
        });
        trackEvent(user.id, "user_signup", { email, walletAddress });
      } catch (createErr: any) {
        if (createErr?.code === "BETA_FULL") {
          // Beta cap reached. Add to waitlist and return a structured
          // 403 the client can render as a "you're on the list" page.
          // Use onConflictDoNothing-style insert: if the same person
          // tries again, we don't pile up duplicate waitlist entries.
          try {
            await storage.addToWaitlist({
              email: email || undefined,
              walletAddress: walletAddress || undefined,
              privyId: privyUserId,
              notes: "auto-added on signup attempt during full beta",
            });
          } catch {
            // ignore — duplicate or already on waitlist is fine
          }
          trackEvent(privyUserId, "waitlist_signup", { email, walletAddress });
          return res.status(403).json({
            error: "beta_full",
            message: "The beta is at capacity. You've been added to the waitlist — we'll email when a slot opens.",
            waitlist: true,
            contactEmail: email || null,
          });
        }
        throw createErr;
      }
    }

    req.user = user;
    next();
  } catch (error: any) {
    console.error("Auth error:", error.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

export function setupAuth(app: Express): void {
  app.get("/api/user", requireAuth, async (req, res) => {
    const user = req.user!;
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      walletAddress: user.walletAddress,
      credits: user.credits ?? 0,
    });
  });

  // Email-capture endpoint for wallet-only users. Stripe checkout
  // requires a customer email; this route lets the frontend modal
  // collect one and update the user record before retrying.
  app.patch("/api/user/email", requireAuth, async (req, res) => {
    try {
      const { email } = req.body || {};
      if (typeof email !== "string" || !email.trim()) {
        return res.status(400).json({ error: "Email required" });
      }
      await storage.updateUserEmail(req.user!.id, email);
      // Invalidate the user query on the client by returning the new
      // shape (frontend just re-fetches).
      const updated = await storage.getUser(req.user!.id);
      res.json({
        ok: true,
        email: updated?.email,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || "Failed to update email" });
    }
  });
}
