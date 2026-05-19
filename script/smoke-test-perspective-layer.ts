/**
 * Smoke test for the analyst perspective layer (migration 0003 +
 * ingestion + extraction). Fires a query through retrieveRelevantContext
 * and prints the formatted brain-context block — what the agent's
 * system prompt would carry.
 *
 * Usage:
 *   npx tsx script/smoke-test-perspective-layer.ts
 *   npx tsx script/smoke-test-perspective-layer.ts "custom query here"
 */
import "dotenv/config";
import { retrieveRelevantContext, formatRetrievedContext } from "../server/brain-retrieval";
import { pool } from "../server/db";

async function main() {
  const query = process.argv[2] || "How does Hyperliquid's HIP-3 affect TradFi market access and weekend price discovery?";
  console.log(`\n=== QUERY ===\n${query}\n`);

  const ctx = await retrieveRelevantContext(query, null, "default");
  console.log(`=== RETRIEVAL SUMMARY ===\n${ctx.retrievalSummary}\n`);
  console.log(`analyst perspectives surfaced:`);
  console.log(`  questions: ${ctx.analystPerspectives.questions.length}`);
  console.log(`  frameworks: ${ctx.analystPerspectives.frameworks.length}`);
  console.log(`  signals: ${ctx.analystPerspectives.signals.length}`);

  const formatted = formatRetrievedContext(ctx);
  console.log(`\n=== FORMATTED BRAIN CONTEXT BLOCK ===\n${formatted}`);

  await pool.end();
}

main().catch((err) => { console.error(err); pool.end().finally(() => process.exit(1)); });
