/**
 * Seed Query Templates
 *
 * Inserts reference SQL templates for compound financial queries.
 * These are the "gold standard" implementations the benchmark scores against.
 */

import { storage } from "../storage";

const ETHENA_INCOME_STATEMENT_SQL = `
-- Ethena Monthly Income Statement with P/E
WITH price AS (
  SELECT
    date_trunc('month', minute) AS month,
    AVG(price) AS avg_price
  FROM prices.usd
  WHERE symbol = 'ENA'
    AND blockchain = 'ethereum'
    AND minute >= now() - interval '365' day
  GROUP BY 1
),

-- USDe supply from token transfers (net mints)
usde_supply AS (
  SELECT
    date_trunc('month', block_time) AS month,
    SUM(CASE
      WHEN "from" = 0x0000000000000000000000000000000000000000 THEN CAST(amount AS double)
      WHEN "to" = 0x0000000000000000000000000000000000000000 THEN -CAST(amount AS double)
      ELSE 0
    END) AS net_minted
  FROM tokens.transfers
  WHERE token_address = 0x4c9EDD5852cd905f086C759E8383e09bff1E68B3  -- USDe
    AND blockchain = 'ethereum'
    AND block_time >= now() - interval '365' day
    AND ("from" = 0x0000000000000000000000000000000000000000
         OR "to" = 0x0000000000000000000000000000000000000000)
  GROUP BY 1
),

usde_cumulative AS (
  SELECT
    month,
    SUM(net_minted) OVER (ORDER BY month) AS total_supply
  FROM usde_supply
),

-- Ethena protocol fees from DeFiLlama-equivalent Dune data
-- Using staking rewards as proxy for protocol fees
fees_data AS (
  SELECT
    date_trunc('month', block_time) AS month,
    SUM(amount_usd) AS total_fees
  FROM tokens.transfers
  WHERE "from" = 0x9D39A5DE30e57443BfF2A8307A4256c8797A3497  -- Ethena staking contract
    AND blockchain = 'ethereum'
    AND block_time >= now() - interval '365' day
    AND amount_usd > 0
    AND amount_usd < 1e12
  GROUP BY 1
),

combined AS (
  SELECT
    p.month,
    p.avg_price,
    COALESCE(u.total_supply, 0) AS usde_supply,
    COALESCE(f.total_fees, 0) AS total_fees,
    COALESCE(f.total_fees, 0) * 0.5 AS protocol_revenue,  -- ~50% of fees go to protocol
    COALESCE(f.total_fees, 0) * 12 AS annualized_fees,
    p.avg_price * 15e9 AS approx_mcap  -- ~15B total supply
  FROM price p
  LEFT JOIN usde_cumulative u ON p.month = u.month
  LEFT JOIN fees_data f ON p.month = f.month
)

SELECT
  month AS date,
  avg_price AS price,
  approx_mcap AS mcap,
  usde_supply,
  total_fees AS fees,
  protocol_revenue AS revenue,
  annualized_fees AS arr,
  CASE
    WHEN protocol_revenue > 0 THEN approx_mcap / (protocol_revenue * 12)
    ELSE NULL
  END AS pe_ratio
FROM combined
WHERE month < date_trunc('month', now())  -- exclude partial current month
ORDER BY month
`;

export async function seedTemplates(dryRun = false) {
  const templates = [
    {
      name: "income_statement",
      businessModel: "stablecoin_yield",
      description: "Monthly income statement with price, supply, fees, revenue, ARR, and P/E ratio for stablecoin yield protocols like Ethena",
      sqlTemplate: ETHENA_INCOME_STATEMENT_SQL,
      requiredParams: ["token_address", "token_symbol", "staking_contract"],
      outputMetrics: ["price", "mcap", "usde_supply", "fees", "revenue", "arr", "pe_ratio"],
      exampleProtocol: "ethena",
      savedQueryDependencies: [5732961, 5737311, 5737510],
      isActive: true,
    },
  ];

  if (dryRun) {
    console.log(`[seed-templates] DRY RUN — would insert ${templates.length} templates:`);
    for (const t of templates) {
      console.log(`  • ${t.name} (${t.businessModel}) — ${t.outputMetrics.length} output metrics`);
    }
    return { inserted: 0 };
  }

  let inserted = 0;
  for (const template of templates) {
    // Check for existing
    const existing = await storage.getQueryTemplateByName(template.name, template.businessModel);
    if (existing) {
      console.log(`[seed-templates] Skipping ${template.name}/${template.businessModel} — already exists`);
      continue;
    }
    await storage.insertQueryTemplate(template as any);
    inserted++;
    console.log(`[seed-templates] Inserted: ${template.name} (${template.businessModel})`);
  }

  console.log(`[seed-templates] Done. Inserted ${inserted} templates.`);
  return { inserted };
}

// CLI entry point
if (process.argv[1]?.includes("seed-templates")) {
  import("dotenv/config").catch(() => {});
  const dryRun = process.argv.includes("--dry-run");
  seedTemplates(dryRun)
    .then(() => process.exit(0))
    .catch(err => { console.error("Fatal:", err); process.exit(1); });
}
