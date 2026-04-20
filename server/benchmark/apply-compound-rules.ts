import "dotenv/config";
import { storage } from "../storage";

async function main() {
  // Deactivate the Dune-based P/E rules that don't work
  const allRules = await storage.getAllActiveLearnings();
  const toDeactivate = allRules.filter(r =>
    (r.scopeKey === "pe_ratio" && r.ruleText.includes("Dune SQL")) ||
    (r.scopeKey === "pe_ratio_timeseries" && r.ruleText.includes("monthly revenue CTE"))
  );
  for (const rule of toDeactivate) {
    await storage.deactivateLearning(rule.id);
    console.log("Deactivated:", rule.ruleType, "/", rule.scopeKey, "—", rule.ruleText.slice(0, 60));
  }

  // Add the DeFiLlama-based P/E rules
  const newRules = [
    { ruleType: "routing_override", scope: "global", scopeKey: "pe_ratio", ruleText: "For P/E ratio: use DeFiLlama for revenue (fees endpoint with dataType=dailyRevenue) and CoinGecko for market cap. Compute P/E = mcap / annualized_revenue. Do NOT use Dune SQL for P/E — Dune has no protocol revenue table.", confidence: 95, source: "benchmark" },
    { ruleType: "sql_pattern", scope: "global", scopeKey: "pe_ratio_multi_source", ruleText: "P/E time series: (1) fetch dailyRevenue from defillama, (2) compute trailing 30d avg × 365 for annualized rev, (3) fetch mcap from coingecko market_chart, (4) P/E = mcap / annualized_rev per period. Return as line chart.", confidence: 88, source: "benchmark" },
    { ruleType: "routing_override", scope: "protocol", scopeKey: "ethena", ruleText: "Ethena financial data: use DeFiLlama slug 'ethena' for fees, revenue, AND TVL. Do NOT write Dune SQL for Ethena revenue — it is not a DEX and has no lending.borrow entries.", confidence: 90, source: "benchmark" },
  ];

  for (const r of newRules) {
    await storage.saveLearning(r as any);
    console.log("Added:", r.ruleType, "/", r.scopeKey);
  }

  console.log(`\nDone. Deactivated ${toDeactivate.length}, added ${newRules.length} rules.`);
  process.exit(0);
}

main();
