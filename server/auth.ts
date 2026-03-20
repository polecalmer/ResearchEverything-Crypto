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
