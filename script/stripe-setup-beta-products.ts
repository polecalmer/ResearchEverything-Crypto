/**
 * One-shot script that creates the two beta Stripe products with the
 * metadata the webhook handler expects. Run once per environment
 * (Stripe test mode + production):
 *
 *   tsx script/stripe-setup-beta-products.ts
 *
 * Idempotent: looks up products by name first and skips creating
 * duplicates. Prices are immutable in Stripe — if you need to change
 * a price, archive the old one in the Stripe dashboard and re-run
 * this script.
 *
 * Products created:
 *   1. "Sessions — 1 Turn"        $7   one-time   metadata.credits=1
 *   2. "Sessions — 10-Turn Pack"  $70  one-time   metadata.credits=10
 *
 * The webhook handler (server/webhookHandlers.ts) reads
 * `product.metadata.credits` on `checkout.session.completed` to grant
 * the right number of credits.
 */

import "dotenv/config";
import { getUncachableStripeClient } from "../server/stripeClient";

interface ProductSpec {
  name: string;
  description: string;
  amountCents: number;
  credits: number;
  /** Lookup key on the Price object — lets the checkout endpoint
   *  find the Price by a stable identifier instead of a dashboard id. */
  lookupKey: string;
}

const BETA_PRODUCTS: ProductSpec[] = [
  {
    name: "Sessions — 1 Turn",
    description: "1 additional research turn after your free 20 are used.",
    amountCents: 7_00,
    credits: 1,
    lookupKey: "session_single",
  },
  {
    name: "Sessions — 10-Turn Pack",
    description: "10 additional research turns. Same per-turn rate as the single, one transaction.",
    amountCents: 70_00,
    credits: 10,
    lookupKey: "session_pack_10",
  },
];

async function findOrCreateProduct(stripe: any, spec: ProductSpec): Promise<{ productId: string; priceId: string; created: boolean }> {
  // Look up by lookup_key first (most reliable identifier).
  const existingPrices = await stripe.prices.list({
    lookup_keys: [spec.lookupKey],
    limit: 1,
    active: true,
  });
  if (existingPrices.data.length > 0) {
    const price = existingPrices.data[0];
    return { productId: price.product as string, priceId: price.id, created: false };
  }

  // Search by product name (fuzzy fallback).
  const products = await stripe.products.search({
    query: `name:"${spec.name}"`,
    limit: 1,
  });

  let product;
  if (products.data.length > 0) {
    product = products.data[0];
    // Make sure metadata is up to date — Stripe metadata can drift.
    if (product.metadata?.credits !== String(spec.credits)) {
      product = await stripe.products.update(product.id, {
        description: spec.description,
        metadata: { credits: String(spec.credits) },
      });
    }
  } else {
    product = await stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: { credits: String(spec.credits) },
    });
  }

  // Always create a fresh Price with the right amount + lookup_key.
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: spec.amountCents,
    lookup_key: spec.lookupKey,
  });

  return { productId: product.id, priceId: price.id, created: true };
}

async function main() {
  if (process.env.ENABLE_STRIPE !== "1") {
    console.error("ENABLE_STRIPE is not 1 — refusing to run.");
    process.exit(1);
  }
  const stripe = await getUncachableStripeClient();
  console.log(`Stripe mode: ${stripe.getApiField("auth")?.startsWith("Bearer sk_test_") ? "test" : "live"}`);

  for (const spec of BETA_PRODUCTS) {
    const { productId, priceId, created } = await findOrCreateProduct(stripe, spec);
    console.log(`${created ? "✓ created" : "= existing"}  ${spec.name}`);
    console.log(`    product:    ${productId}`);
    console.log(`    price:      ${priceId}`);
    console.log(`    lookup_key: ${spec.lookupKey}`);
    console.log(`    metadata.credits: ${spec.credits}`);
    console.log("");
  }

  console.log("Done. Frontend can now reference products by lookup_key in the checkout flow.");
}

main().catch((err) => {
  console.error("setup failed:", err);
  process.exit(1);
});
