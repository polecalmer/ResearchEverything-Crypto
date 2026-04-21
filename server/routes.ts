import type { Express } from "express";
import { createServer, type Server } from "http";
import { requireAuth } from "./auth";
import { callAnthropicServer, isServerMppReady } from "./mpp-client";
import { generateTelegramLinkCode } from "./telegram";
import { registerBillingRoutes } from "./routes/billing-routes";
import { registerEnrichmentRoutes } from "./routes/enrichment-routes";
import { registerCompanyRoutes } from "./routes/company-routes";
import { registerTokenRoutes } from "./routes/token-routes";
import { registerDataRoutes } from "./routes/data-routes";
import { registerAdminRoutes } from "./routes/admin-routes";
import { registerResearchRoutes } from "./routes/research-routes";
import { registerSecurityAuditRoutes } from "./routes/security-audit-routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/ai/proxy", requireAuth, async (req, res) => {
    try {
      if (!isServerMppReady()) {
        return res.status(503).json({ message: "AI service not configured — server wallet not set" });
      }
      const { model, max_tokens, system, messages, tools } = req.body;
      if (!model || !max_tokens || !messages) {
        return res.status(400).json({ message: "Invalid request: model, max_tokens, and messages required" });
      }
      const result = await callAnthropicServer({ model, max_tokens, system, messages, tools });
      res.json(result);
    } catch (error: any) {
      console.error("[AI Proxy] Error:", error.message);
      res.status(502).json({ message: error.message || "AI call failed" });
    }
  });

  app.post("/api/telegram/link-code", requireAuth, async (req, res) => {
    const code = generateTelegramLinkCode(req.user!.id);
    res.json({ code, expiresIn: "10 minutes" });
  });

  registerBillingRoutes(app);
  registerEnrichmentRoutes(app);
  registerCompanyRoutes(app);
  registerTokenRoutes(app);
  registerDataRoutes(app);
  registerAdminRoutes(app);
  registerResearchRoutes(app);
  registerSecurityAuditRoutes(app);

  return httpServer;
}
