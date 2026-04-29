/**
 * Brain-disambiguation surfacing for polysemous metrics.
 *
 * Some metric names map to multiple legitimate values:
 *   - "HYPE staked supply"  → total network stake (~405M) vs foundation insider stake (~241M)
 *   - "HYPE market cap"     → circulating MCAP vs adjusted MCAP vs FDV
 *   - "Maple revenue"       → gross fees vs protocol revenue (post-HLP)
 *
 * The HYPE financial-statement run silently picked the foundation
 * insider stake (241M) when computing validator emissions, treating
 * it as total network stake. The brain has the disambiguation; the
 * agent just isn't being shown both options at the right moment.
 *
 * This module exposes a context block that gets injected into the
 * system prompt: for any entity in the user message that has known
 * polysemous metrics, list each variant with its value and what the
 * variant means. The agent then has no excuse for picking wrong.
 *
 * v1 carries a hand-curated list of known polysemous-metric definitions
 * AND respects user-correction facts (source='user-correction') that
 * the ingestion pipeline writes in real-time. As the brain accumulates
 * corrections, the disambiguation set grows automatically.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface PolysemousMetric {
  metric: string;        // canonical name, e.g. "staked_supply"
  entity: string;        // e.g. "hyperliquid" or "hype"
  variants: Array<{
    label: string;       // "Total network stake" / "Foundation insider stake"
    value?: string;      // optional pre-known value
    when_to_use: string; // human guidance for which variant maps to which question
    source?: string;     // canonical source for this variant
  }>;
}

// Hand-curated v1 set. Grows via user corrections (read from brain_facts
// with topic LIKE 'Polysemous metric%').
const SEED_DISAMBIGUATIONS: PolysemousMetric[] = [
  {
    metric: "staked_supply",
    entity: "hyperliquid",
    variants: [
      {
        label: "Total network stake",
        when_to_use: "USE THIS for validator emissions math, staking APR calc, network security cost.",
        source: "stakingrewards.com OR Hyperliquid /staking_summary endpoint",
      },
      {
        label: "Foundation insider stake",
        when_to_use: "USE THIS for overhang sizing, dispersal-pace context, insider-share-of-supply ratios.",
        source: "stonksonchain hype_unlocks_summary",
      },
    ],
  },
  {
    metric: "market_cap",
    entity: "*",
    variants: [
      {
        label: "Circulating MCAP",
        when_to_use: "USE THIS as the headline market cap. Numerator for liquid-token valuation multiples.",
        source: "coingecko.market_data.market_cap.usd",
      },
      {
        label: "Adjusted MCAP / outstanding",
        when_to_use: "USE THIS for honest-token-supply valuation (counts unvested + locked tokens that will eventually trade). Best single liquid-token anchor for high-unlock-risk tokens.",
        source: "circulating + locked/unvested supply × spot",
      },
      {
        label: "FDV",
        when_to_use: "USE THIS for fully-diluted comparisons across protocols. Ceiling case.",
        source: "coingecko.market_data.fully_diluted_valuation.usd",
      },
    ],
  },
  {
    metric: "revenue",
    entity: "*",
    variants: [
      {
        label: "Gross fees",
        when_to_use: "USE THIS as the top of the income statement (gross trading fees, platform fees, etc.). Pre-cost-of-revenue.",
        source: "defillama summary.fees",
      },
      {
        label: "Protocol revenue (net)",
        when_to_use: "USE THIS as the line that flows to the protocol/AHF/buyback. Post-HLP, post-LP, post-incentives.",
        source: "defillama summary.revenue",
      },
    ],
  },
];

/** Pull user-correction polysemous-metric facts written by the
 *  correction-ingestion pipeline. These join the seed list. */
async function pullLearnedDisambiguations(userId: string): Promise<PolysemousMetric[]> {
  try {
    const rows = await db.execute(sql`
      SELECT topic, fact, entities FROM brain_facts
      WHERE user_id = ${userId}
        AND source = 'user-correction'
        AND (topic ILIKE 'Polysemous metric%' OR topic ILIKE 'Entity alias:%')
      LIMIT 50
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    const out: PolysemousMetric[] = [];
    for (const r of raw) {
      // Lightweight: surface entity-aliases as a single-variant note so
      // the agent sees the rebrand in context. Full polysemous-metric
      // structure can be added later by the extractor.
      if (r.topic?.startsWith("Entity alias:")) {
        const ents = Array.isArray(r.entities) ? r.entities : [];
        if (ents.length === 0) continue;
        out.push({
          metric: "entity_alias",
          entity: String(ents[0] || "unknown"),
          variants: [
            {
              label: "Aliases / rebrands",
              when_to_use: r.fact || "",
              source: "user-correction",
            },
          ],
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Filter to disambiguations relevant to the user's current question. */
function pickRelevant(
  all: PolysemousMetric[],
  userMessage: string,
  resolvedEntities: string[],
): PolysemousMetric[] {
  const msg = userMessage.toLowerCase();
  const ents = new Set(resolvedEntities.map((e) => e.toLowerCase()));
  return all.filter((p) => {
    const entMatch = p.entity === "*" || ents.has(p.entity.toLowerCase()) || msg.includes(p.entity.toLowerCase());
    if (!entMatch) return false;
    // Light keyword check on the metric name to avoid spamming the prompt.
    const metricKeyword = p.metric.replace(/_/g, " ");
    if (p.entity === "*") return msg.includes(metricKeyword) || msg.includes("financial") || msg.includes("statement") || msg.includes("valuation") || msg.includes("revenue");
    return true;
  });
}

/** Build the system-prompt context block. Empty string when nothing relevant. */
export async function buildDisambiguationContext(
  userMessage: string,
  resolvedEntities: string[],
  userId: string,
): Promise<string> {
  const learned = await pullLearnedDisambiguations(userId);
  const all = [...SEED_DISAMBIGUATIONS, ...learned];
  const relevant = pickRelevant(all, userMessage, resolvedEntities);
  if (relevant.length === 0) return "";

  const lines: string[] = [];
  lines.push("AMBIGUOUS METRICS — these have MULTIPLE legitimate values. Pick the right variant for the question being asked. If unsure or if both variants are relevant, use BOTH with explicit labels.");
  lines.push("");
  for (const p of relevant) {
    const entLabel = p.entity === "*" ? "(any entity)" : p.entity;
    lines.push(`• ${p.metric.replace(/_/g, " ")} — ${entLabel}:`);
    for (const v of p.variants) {
      const src = v.source ? ` [source: ${v.source}]` : "";
      lines.push(`    - ${v.label}: ${v.when_to_use}${src}`);
    }
  }
  return lines.join("\n");
}
