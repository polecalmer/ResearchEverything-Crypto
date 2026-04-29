// One-shot: insert the STRC compound case without touching the other 34.
// Avoids the wholesale delete+reinsert that the standard seed-quality runs.
import "dotenv/config";
import { db } from "../server/db";
import { benchmarkQualityCases } from "@shared/schema";
import { eq } from "drizzle-orm";

const STRC_PROMPT =
  "Can you explain the STRC instrument by Microstrategy, what it means for BTC bid pressure, how reflexive is it, can you show me how Saylor's top 10 Biggest BTC buys overlayed on the daily BTC price chart?";

const ROW = {
  dimension: "compound" as const,
  prompt: STRC_PROMPT,
  rubric: `Score on compound-reasoning quality — this is a 4-part question and ALL parts must be addressed:
- Identifies STRC correctly as one of MicroStrategy's "Strategy" preferred-stock issuances used to fund BTC purchases — distinct from STRK / STRF / STRD or MSTR common — and names at least one defining term (perpetual, cumulative dividend, variable rate, or call provisions)? (1 pt)
- Connects STRC issuance to BTC bid pressure mechanically: proceeds → spot BTC purchases → mark-to-market on MSTR NAV. Quantifies at least one link (recent issuance size, BTC bought, or $/BTC of recent purchases)? (1 pt)
- Addresses reflexivity explicitly as a TWO-WAY loop: BTC ↑ → MSTR NAV premium ↑ → cheaper preferred/equity issuance → more BTC bought → BTC ↑. AND names a breaker (NAV premium compression, dividend coverage stress, or BTC drawdown forcing margin/redemption pressure)? (1 pt)
- Produces a SINGLE chart: daily BTC price (line, $ axis) with the top 10 MSTR BTC purchases overlaid as markers/annotations on the dates of those buys, sized or labeled by BTC quantity or $ amount. NOT a bare table; NOT 10 separate charts; NOT BTC price without the overlay? (2 pts)
Negative markers:
- Confuses STRC with STRK, STRF, STRD, MSTR common stock, or generic "convertible notes"
- Treats reflexivity as a one-way amplifier without naming the breaker
- Returns the top-10 buys as a table with no chart, OR a BTC chart with no buy overlay
- Hand-waves the dividend/coupon mechanics without specifics
Return JSON: score (0-5), verdict, critique. Note: max possible is 5.`,
  expectedBehavior:
    "Correctly identifies STRC as an MSTR preferred (distinct from STRK/STRF/STRD), traces the issuance→spot-BTC-buy→NAV-premium loop with at least one quantified link, addresses reflexive feedback AND its breaker, and produces a single daily BTC price chart with the top-10 Saylor purchases overlaid as annotations.",
  tags: ["mstr", "strc", "btc", "reflexivity", "saylor", "chart_overlay"],
  priorTurns: null,
  isActive: true,
};

async function main() {
  const existing = await db
    .select({ id: benchmarkQualityCases.id })
    .from(benchmarkQualityCases)
    .where(eq(benchmarkQualityCases.prompt, STRC_PROMPT));

  if (existing.length > 0) {
    console.log(`STRC case already present (id=${existing[0].id}). No-op.`);
    return;
  }

  const [inserted] = await db.insert(benchmarkQualityCases).values(ROW).returning();
  console.log(`Inserted STRC case: id=${inserted.id} dimension=${inserted.dimension}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
