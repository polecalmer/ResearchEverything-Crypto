/**
 * Seed for output_requirements.
 *
 * Each entry is a STRUCTURAL requirement for a specific prompt shape:
 * "for these prompts, the agent must produce these outputs." Domain
 * knowledge that the system can't derive on its own — the exception
 * to the no-manual-seeds rule.
 *
 * Run: `npx tsx server/numeric-provenance/seed-output-requirements.ts`
 *
 * Idempotent via DELETE+INSERT for the seeded scope so edits to a rule
 * propagate cleanly. (Unique constraint would prevent updates if we
 * change wording — easier to wipe the seed scope and re-insert.)
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

interface SeedRow {
  promptShape: string;
  entity: string;
  title: string;
  requirement: string;
  ordering: number;
}

const SEED_ROWS: SeedRow[] = [
  {
    promptShape: "financial_statement",
    entity: "*",
    ordering: 10,
    title: "Daily P/E and P/S charts (Circ MCAP, Adj MCAP, FDV) — trailing 12 months",
    requirement: [
      "Emit TWO chart artifacts back-to-back: a daily P/E time-series and a daily P/S time-series. Each chart has THREE lines (one per MCAP lens: Circulating, Adjusted-outstanding, FDV).",
      "",
      "EFFICIENT WORKFLOW (do NOT call compute() per day — that's 365× too many round trips):",
      "  1. ONE call to query_defillama_fees_revenue to get the daily fees + revenue series (~365 rows trailing 12mo).",
      "  2. ONE call to query_defillama_price_history (or coingecko price series) to get the daily price series in the same window.",
      "  3. ONE call to get_token_snapshot to get current circulating supply, outstanding/adjusted supply, and max supply (FDV basis).",
      "  4. ONE call to execute_code that does ALL the heavy lifting in Python:",
      "       • Build a date-aligned dataframe joining price + fees + revenue per day",
      "       • Compute the trailing-365d rolling sum of fees and revenue (one pandas .rolling call each)",
      "       • For each day t: daily_PE_circ[t] = price[t] × circulating_supply / rolling_LTM_revenue[t]",
      "       • daily_PE_adj[t] = price[t] × adjusted_supply / rolling_LTM_revenue[t]",
      "       • daily_PE_fdv[t] = price[t] × max_supply / rolling_LTM_revenue[t]",
      "       • Same three lines for P/S using rolling_LTM_fees instead",
      "       • Output the resulting two arrays-of-rows (one per chart) as JSON. Each row: { date, pe_circ, pe_adj, pe_fdv } and { date, ps_circ, ps_adj, ps_fdv }",
      "  5. Drop those arrays directly into TWO chart artifacts (one P/E, one P/S). The data array IS the chart's data.",
      "",
      "Chart specs (both charts, same shape):",
      '  - chartType: "line", smoothing: "30dma"',
      '  - xAxis: { "dataKey": "date", "format": "date" }',
      '  - yAxes: 3 series with format: "ratio". For P/E: dataKeys pe_circ/pe_adj/pe_fdv, labels "P/E (Circ)", "P/E (Adj)", "P/E (FDV)". For P/S: dataKeys ps_circ/ps_adj/ps_fdv, labels "P/S (Circ)", "P/S (Adj)", "P/S (FDV)".',
      "  - Titles: \"<Token> Daily P/E — Trailing 12mo Across MCAP Lenses\" and same pattern for P/S.",
      "  - Subtitles: one-line takeaways about current level vs 12mo range and any spread/trend story.",
      "",
      "DO NOT loop compute() 365 times. The agent will run out of rounds. ONE execute_code call covers all the daily math.",
    ].join("\n"),
  },
  {
    promptShape: "financial_statement",
    entity: "*",
    ordering: 30,
    title: "Multiples interpretation note (3-5 sentences)",
    requirement: [
      "After the two charts, write a short prose paragraph reading the multiples. Include:",
      "  - Latest values for P/E (Circ) and P/S (Circ) — read from the LAST row of the chart data arrays.",
      "  - 12-month range (min/max) for P/E (Circ) — pull from the chart data arrays via execute_code if needed; cite via compute() with a 'min'/'max' formula on the field if available, else just cite from the execute_code numeric output.",
      "  - The spread between Circ and Adj/FDV today — what does it imply about unvested-supply pressure?",
      "  - Trend direction: compressing (revenue growing into the multiple) or expanding (price running ahead)?",
    ].join("\n"),
  },
];

async function main() {
  console.log(`[SeedOutputReqs] Wiping prior 'seed' rows for shapes: ${[...new Set(SEED_ROWS.map(r => r.promptShape))].join(", ")}`);
  const shapes = [...new Set(SEED_ROWS.map((r) => r.promptShape))];
  for (const shape of shapes) {
    await db.execute(sql`
      DELETE FROM output_requirements WHERE prompt_shape = ${shape} AND source = 'seed'
    `);
  }
  console.log(`[SeedOutputReqs] Inserting ${SEED_ROWS.length} row(s)...`);
  for (const r of SEED_ROWS) {
    await db.execute(sql`
      INSERT INTO output_requirements
        (prompt_shape, entity, title, requirement, ordering, source)
      VALUES (
        ${r.promptShape}, ${r.entity}, ${r.title}, ${r.requirement}, ${r.ordering}, 'seed'
      )
    `);
    console.log(`  ✓ ${r.promptShape} / ${r.title}`);
  }
  console.log("[SeedOutputReqs] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[SeedOutputReqs] FAIL:", err);
  process.exit(1);
});
