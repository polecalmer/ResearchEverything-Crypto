/**
 * HIP-3 deployer registry — seeds one fact per known HIP-3 deployer so the
 * resolver's semantic consult surfaces stonksonchain when a chart is requested
 * for one of these protocols. Add new deployers as they're identified; each
 * fact is idempotent via dedupe_key so re-seeding is safe.
 *
 * Why these live as data-source-brain facts rather than a hardcoded list:
 * - Embedding fusion lets "tradexyz daily fees" → stonksonchain coverage even
 *   when the recipe extraction labels the protocol differently.
 * - Future deployers can be added at runtime via `observe()` without code
 *   changes (e.g. by the brain-synthesis pass when a research note classifies
 *   a new protocol as HIP-3).
 */

import type { Fact } from "../schema.js";
import { makeFact } from "./helpers.js";

const SRC = "stonksonchain" as const;
const SCOPE_REF = "stonksonchain:/api/v1/fees/history";

interface Hip3Deployer {
  slug: string;
  name: string;
  notes?: string;
}

// Conservative starter list. TradeXYZ is the primary case driving this work.
// Add more deployers (Felix, Hyperdrive, Pear, etc.) as they're verified —
// each entry produces a coverage fact that the resolver will surface for the
// matching protocol slug.
const HIP3_DEPLOYERS: Hip3Deployer[] = [
  {
    slug: "tradexyz",
    name: "TradeXYZ",
    notes: "perp DEX deployed on Hyperliquid via HIP-3, focus on long-tail markets",
  },
];

export function seedHip3Deployers(): Fact[] {
  return HIP3_DEPLOYERS.flatMap((d) => [
    makeFact({
      source: SRC,
      scope: "endpoint",
      scope_ref: SCOPE_REF,
      category: "coverage",
      content:
        `${d.name} (slug: ${d.slug}) is a HIP-3 deployer on Hyperliquid. ` +
        `Daily fees and notional volume for ${d.slug} are available via stonksonchain ` +
        `/api/v1/fees/history?coin=${d.slug}. Prefer stonksonchain for ${d.slug}-specific ` +
        `metrics; defillama does not break out HIP-3 deployer subaccounts. ${d.notes ? `Context: ${d.notes}.` : ""}`,
      confidence: "verified_doc",
      source_of_fact: "internal:hip3-deployer-registry",
    }),
  ]);
}
