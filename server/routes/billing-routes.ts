import type { Express } from "express";
import { storage } from "../storage";
import { WALLETS } from "../constants";
import { requireAuth } from "../auth";
import { getEstimatedEnrichmentCost, getLastEnrichmentCost, MARKUP_MULTIPLIER } from "../enrichment";
import { getUncachableStripeClient } from "../stripeClient";
import { db } from "../db";
import { sql } from "drizzle-orm";

export function registerBillingRoutes(app: Express) {
  app.get("/api/enrichment/pricing", (_req, res) => {
    const estimated = getEstimatedEnrichmentCost();
    const lastCost = getLastEnrichmentCost();
    res.json({
      model: "cost-plus",
      markupMultiplier: MARKUP_MULTIPLIER,
      estimatedCost: estimated.toFixed(2),
      lastEnrichment: lastCost ? {
        apiCost: lastCost.apiCost.toFixed(4),
        totalCharge: lastCost.totalCharge.toFixed(4),
      } : null,
      currency: "USDC",
      recipient: WALLETS.OWNER,
    });
  });

  app.get("/api/transactions", requireAuth, async (req, res) => {
    try {
      const txs = await storage.getTransactions(req.user!.id);
      res.json(txs);
    } catch (error: any) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ message: "Failed to fetch transactions" });
    }
  });

  app.get("/api/credits", requireAuth, async (req, res) => {
    const credits = await storage.getUserCredits(req.user!.id);
    res.json({ credits });
  });

  app.get("/api/credits/products", requireAuth, async (req, res) => {
    try {
      const result = await db.execute(sql`
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.type as price_type,
          pr.recurring_interval,
          pr.recurring_interval_count
        FROM stripe_products p
        JOIN stripe_prices pr ON pr.product_id = p.id
        WHERE p.active = true AND pr.active = true
        ORDER BY pr.unit_amount ASC
      `);
      const rows = result.rows || result;
      const products = rows.map((row: any) => ({
        productId: row.product_id,
        name: row.product_name,
        description: row.product_description,
        metadata: row.product_metadata,
        priceId: row.price_id,
        unitAmount: row.unit_amount,
        currency: row.currency,
        priceType: row.price_type,
        recurringInterval: row.recurring_interval,
        recurringIntervalCount: row.recurring_interval_count,
      }));
      res.json(products);
    } catch (error: any) {
      console.error("Error fetching credit products:", error);
      res.status(500).json({ message: "Failed to fetch products" });
    }
  });

  app.post("/api/credits/checkout", requireAuth, async (req, res) => {
    try {
      const { priceId: rawPriceId, lookupKey, mode } = req.body;
      // Resolve priceId from either an explicit Stripe price id OR a
      // stable lookup_key (session_single, session_pack_10). The
      // lookup_key path is what the out-of-credits modal uses so the
      // frontend doesn't need to know Stripe-specific ids.
      let priceId = rawPriceId;
      const stripe = await getUncachableStripeClient();

      if (!priceId && lookupKey) {
        const prices = await stripe.prices.list({
          lookup_keys: [String(lookupKey)],
          limit: 1,
          active: true,
        });
        if (prices.data.length === 0) {
          return res.status(404).json({ message: `No active price for lookupKey "${lookupKey}". Run script/stripe-setup-beta-products.ts to create products.` });
        }
        priceId = prices.data[0].id;
      }
      if (!priceId) return res.status(400).json({ message: "priceId or lookupKey required" });

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ message: "User not found" });

      // Wallet-only users land here with `email === ""`. Stripe accepts
      // an empty email on a customer record, but receipts won't reach
      // anyone, and Stripe's anti-fraud heuristics dislike missing
      // emails on $7-$70 charges. Demand one before sending to checkout.
      if (!user.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
        return res.status(400).json({
          error: "email_required",
          message: "We need an email for your Stripe receipt. PATCH /api/user/email with { email } and retry.",
        });
      }

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user.id, username: user.username },
        });
        await storage.updateStripeCustomerId(user.id, customer.id);
        customerId = customer.id;
      }

      const price = await stripe.prices.retrieve(priceId);
      const isRecurring = price.type === "recurring";
      const isSubscription = isRecurring;

      if (mode === "subscription" && !isRecurring) {
        return res.status(400).json({ message: "This price does not support subscriptions" });
      }
      if (mode === "payment" && isRecurring) {
        return res.status(400).json({ message: "This price requires a subscription" });
      }

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: isSubscription ? "subscription" : "payment",
        success_url: `${baseUrl}/credits?checkout=success`,
        cancel_url: `${baseUrl}/credits?checkout=cancelled`,
        metadata: { userId: user.id },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Checkout error:", error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });

  app.post("/api/subscription/cancel", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.user!.id);
      if (!user || !user.subscriptionId) {
        return res.status(400).json({ message: "No active subscription" });
      }

      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.subscriptionId, {
        cancel_at_period_end: true,
      });

      res.json({ message: "Subscription will cancel at end of billing period" });
    } catch (error: any) {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });
}
