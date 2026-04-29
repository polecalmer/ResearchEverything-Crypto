/**
 * One-shot seed for canonical aggregation rules.
 *
 * Domain knowledge that the system cannot derive on its own — the
 * exception to the "no manual seeds" rule. Each entry should have a
 * specific real-world failure case justifying its inclusion (cited in
 * the rationale comment on each rule).
 *
 * Run: `npx tsx server/numeric-provenance/seed-canonical.ts`
 *
 * Idempotent: ON CONFLICT (entity, metric_name) DO UPDATE keeps the
 * latest definition without duplicating rows.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

interface SeedRule {
  entity: string;
  metricName: string;
  description: string;
  requiredSources: Array<{
    source_label_pattern: string;
    role: string;
    required: boolean;
    notes?: string;
  }>;
  aggregationMethod: string;
  notes: string;
}

// Architectural principle for canonical rules:
//   ONE foundational source per metric (DefiLlama for fees/revenue,
//   CoinGecko for price/MCAP, etc.). Nuance sources are OPTIONAL and
//   never summed into the headline — they're for adjustments,
//   attributions, or commentary. Multi-source composition is dangerous
//   (double-counting) and should be the exception, not the default.
//
// `required_sources` array structure:
//   - required: true  → MUST appear in compute()'s source_label trail.
//                       Validator rejects if missing.
//   - required: false → informational only. Tells the agent "if you want
//                       to discuss X nuance, also fetch this." Not
//                       enforced. Never gets summed in.
const SEED_RULES: SeedRule[] = [
  {
    // RATIONALE: HYPE financial-statement runs (Apr 26 2026) emitted
    // wrong LTM fee numbers, not because of a coverage gap — DefiLlama
    // natively covers HIP-3 fees — but because the LLM did mental
    // arithmetic on a 485-row daily series. The compute() tool fixes
    // that. This rule's job: pin DefiLlama as the foundational source
    // so the agent doesn't go looking for "extra" sources to combine.
    entity: "hyperliquid",
    metricName: "ltm_gross_fees",
    description:
      "Total Hyperliquid trading fees over the trailing 365 days, including HIP-3 external markets. Use DefiLlama as the single foundational source — it captures perps + spot + HIP-3 in one series.",
    requiredSources: [
      {
        source_label_pattern: "defillama_fees_revenue:hyperliquid",
        role: "foundational_source",
        required: true,
        notes:
          "DefiLlama's fees series for hyperliquid INCLUDES HIP-3. Use fees.totalDataChart, sum_trailing_days(365). Do NOT add a separate HIP-3 source — that would double-count.",
      },
      {
        source_label_pattern: "stonksonchain:growth_mode_summary",
        role: "nuance_growth_mode_breakdown",
        required: false,
        notes:
          "OPTIONAL. Use ONLY for commentary on growth-mode subsidy (HIP-3 assets in growth mode are charged 1bps vs 5.95bps normalized). Lets you say 'realized fees vs normalized fees if growth mode exits.' Do NOT add to the headline LTM number.",
      },
    ],
    aggregationMethod: "single_source",
    notes:
      "Foundational-source pattern: take the value DefiLlama reports as gospel. Nuance source is informational only — never added in.",
  },
  {
    entity: "hyperliquid",
    metricName: "ltm_protocol_revenue",
    description:
      "Hyperliquid protocol revenue (post-HLP-vault payouts) over the trailing 365 days. DefiLlama is the foundational source — it covers all fee streams including HIP-3.",
    requiredSources: [
      {
        source_label_pattern: "defillama_fees_revenue:hyperliquid",
        role: "foundational_source",
        required: true,
        notes:
          "Use revenue.totalDataChart (post-HLP), sum_trailing_days(365). DefiLlama's revenue line already nets out HLP vault payouts and includes HIP-3 protocol share.",
      },
    ],
    aggregationMethod: "single_source",
    notes: "Foundational-source pattern: one source, no composition.",
  },
];

async function main() {
  console.log(`[SeedCanonical] Upserting ${SEED_RULES.length} rule(s)...`);
  for (const r of SEED_RULES) {
    await db.execute(sql`
      INSERT INTO canonical_aggregations
        (entity, metric_name, description, required_sources, aggregation_method, notes, source, confidence)
      VALUES (
        ${r.entity},
        ${r.metricName},
        ${r.description},
        ${JSON.stringify(r.requiredSources)}::jsonb,
        ${r.aggregationMethod},
        ${r.notes},
        'seed',
        90
      )
      ON CONFLICT (entity, metric_name) DO UPDATE SET
        description = EXCLUDED.description,
        required_sources = EXCLUDED.required_sources,
        aggregation_method = EXCLUDED.aggregation_method,
        notes = EXCLUDED.notes,
        updated_at = now()
    `);
    console.log(`  ✓ ${r.entity} / ${r.metricName} (${r.requiredSources.length} required sources)`);
  }
  console.log("[SeedCanonical] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[SeedCanonical] Failed:", err);
  process.exit(1);
});
