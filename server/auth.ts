import { PrivyClient } from "@privy-io/node";
import { storage } from "./storage";
import type { Express, RequestHandler } from "express";
import type { User } from "@shared/schema";

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
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const token = authHeader.slice(7);
    const { userId: privyUserId } = await privy.verifyAuthToken(token);

    let user = await storage.getUserByPrivyId(privyUserId);

    if (!user) {
      const privyUser = await privy.getUser(privyUserId);

      const email = privyUser.email?.address || "";
      const walletAddress = privyUser.wallet?.address || "";
      const displayName = email.split("@")[0] || `user_${Date.now()}`;

      user = await storage.createPrivyUser({
        privyId: privyUserId,
        email,
        walletAddress,
        username: displayName,
      });
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
}
