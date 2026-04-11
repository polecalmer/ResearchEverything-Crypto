#!/usr/bin/env npx tsx
/**
 * Autoresearch Training Loop
 *
 * Runs continuous benchmark cycles to improve the data agent:
 *   1-5: 50-case standard benchmark (apply improvements) × 5
 *   6:   Re-seed benchmark cases from DeFiLlama
 *   7:   10-case compound benchmark (P/E + financial statements)
 *   8:   Print full report
 *   9:   Repeat
 *
 * Stops on:
 *   - Budget cap: cumulative cost exceeds $100
 *   - Convergence: accuracy delta < 1% for 3 consecutive runs
 *   - Manual Ctrl+C
 */

import("dotenv/config").catch(() => {});

import { runBenchmark } from "./runner";
import { seedBenchmark } from "./seed";
import { storage } from "../storage";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const BUDGET_CAP_USD = 100;
const CONVERGENCE_THRESHOLD = 0.01; // 1%
const CONVERGENCE_WINDOW = 3;       // 3 consecutive runs within threshold
const STANDARD_SUBSET = 50;
const COMPOUND_SUBSET = 10;
const STANDARD_CYCLES_PER_EPOCH = 5;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

interface RunLog {
  epoch: number;
  step: string;           // "standard-1" .. "standard-5", "reseed", "compound"
  accuracy: number;
  passed: number;
  total: number;
  costUsd: number;
  latencyMs: number;
  rulesAdded: number;
  rulesRemoved: number;
  timestamp: string;
}

const runHistory: RunLog[] = [];
let cumulativeCost = 0;
let epochCount = 0;

// ═══════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════

async function train() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          AUTORESEARCH TRAINING LOOP                         ║
║  Budget cap: $${BUDGET_CAP_USD}  |  Convergence: ${(CONVERGENCE_THRESHOLD * 100).toFixed(0)}% over ${CONVERGENCE_WINDOW} runs        ║
║  Standard: ${STANDARD_SUBSET} cases × ${STANDARD_CYCLES_PER_EPOCH} cycles  |  Compound: ${COMPOUND_SUBSET} cases    ║
╚══════════════════════════════════════════════════════════════╝
`);

  while (true) {
    epochCount++;
    console.log(`\n${"█".repeat(60)}`);
    console.log(`  EPOCH ${epochCount}`);
    console.log(`${"█".repeat(60)}`);

    // ─── Steps 1-5: Standard benchmark cycles ───
    for (let cycle = 1; cycle <= STANDARD_CYCLES_PER_EPOCH; cycle++) {
      if (shouldStop()) break;

      console.log(`\n── Epoch ${epochCount}, Standard Cycle ${cycle}/${STANDARD_CYCLES_PER_EPOCH} ──\n`);

      const result = await runBenchmark({
        subset: STANDARD_SUBSET,
        verbose: false,
        dryRun: false,
      });

      const cost = result.run.totalCostUsd || 0;
      cumulativeCost += cost;

      const rulesAdded = result.improvements.filter(i => i.type === "add_rule").length;
      const rulesRemoved = result.improvements.filter(i => i.type === "deactivate_rule").length;

      const log: RunLog = {
        epoch: epochCount,
        step: `standard-${cycle}`,
        accuracy: result.run.overallAccuracy,
        passed: result.run.passedCases,
        total: result.run.totalCases,
        costUsd: cost,
        latencyMs: result.run.totalLatencyMs || 0,
        rulesAdded,
        rulesRemoved,
        timestamp: new Date().toISOString(),
      };
      runHistory.push(log);

      printRunSummary(log);

      if (checkBudget()) return;
      if (checkConvergence()) return;
    }

    if (shouldStop()) break;

    // ─── Step 6: Re-seed ───
    console.log(`\n── Epoch ${epochCount}, Re-seeding ──\n`);
    try {
      const seedResult = await seedBenchmark({ protocolLimit: 100 });
      console.log(`[Reseed] Done: ${JSON.stringify(seedResult)}`);
    } catch (e) {
      console.warn(`[Reseed] Failed: ${(e as Error).message} — continuing with existing cases`);
    }

    if (shouldStop()) break;

    // ─── Step 7: Compound benchmark ───
    console.log(`\n── Epoch ${epochCount}, Compound Benchmark ──\n`);

    const compoundResult = await runBenchmark({
      subset: COMPOUND_SUBSET,
      compoundOnly: true,
      verbose: true,
      dryRun: false,
    });

    const compoundCost = compoundResult.run.totalCostUsd || 0;
    cumulativeCost += compoundCost;

    const compoundLog: RunLog = {
      epoch: epochCount,
      step: "compound",
      accuracy: compoundResult.run.overallAccuracy,
      passed: compoundResult.run.passedCases,
      total: compoundResult.run.totalCases,
      costUsd: compoundCost,
      latencyMs: compoundResult.run.totalLatencyMs || 0,
      rulesAdded: compoundResult.improvements.filter(i => i.type === "add_rule").length,
      rulesRemoved: compoundResult.improvements.filter(i => i.type === "deactivate_rule").length,
      timestamp: new Date().toISOString(),
    };
    runHistory.push(compoundLog);

    printRunSummary(compoundLog);

    if (checkBudget()) return;

    // ─── Step 8: Full epoch report ───
    printEpochReport();
  }

  printFinalReport();
}

// ═══════════════════════════════════════════════════════════════
// STOPPING CONDITIONS
// ═══════════════════════════════════════════════════════════════

function shouldStop(): boolean {
  return cumulativeCost >= BUDGET_CAP_USD;
}

function checkBudget(): boolean {
  if (cumulativeCost >= BUDGET_CAP_USD) {
    console.log(`\n⛔ BUDGET CAP REACHED: $${cumulativeCost.toFixed(2)} >= $${BUDGET_CAP_USD}`);
    printFinalReport();
    return true;
  }
  const remaining = BUDGET_CAP_USD - cumulativeCost;
  if (remaining < 10) {
    console.log(`⚠ Budget warning: $${remaining.toFixed(2)} remaining`);
  }
  return false;
}

function checkConvergence(): boolean {
  const standardRuns = runHistory.filter(r => r.step.startsWith("standard-"));
  if (standardRuns.length < CONVERGENCE_WINDOW + 1) return false;

  const recent = standardRuns.slice(-CONVERGENCE_WINDOW);
  const prev = standardRuns[standardRuns.length - CONVERGENCE_WINDOW - 1];

  const allWithinThreshold = recent.every(r =>
    Math.abs(r.accuracy - prev.accuracy) < CONVERGENCE_THRESHOLD
  );

  if (allWithinThreshold) {
    const avgAccuracy = recent.reduce((s, r) => s + r.accuracy, 0) / recent.length;
    console.log(`\n🎯 CONVERGED: accuracy stable at ${(avgAccuracy * 100).toFixed(1)}% for ${CONVERGENCE_WINDOW} consecutive runs (delta < ${(CONVERGENCE_THRESHOLD * 100).toFixed(0)}%)`);
    printFinalReport();
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// REPORTING
// ═══════════════════════════════════════════════════════════════

function printRunSummary(log: RunLog) {
  const pct = (log.accuracy * 100).toFixed(1);
  const time = (log.latencyMs / 1000).toFixed(0);
  const cost = log.costUsd.toFixed(2);

  const prevStandard = runHistory.filter(r => r.step.startsWith("standard-")).slice(-2);
  let delta = "";
  if (prevStandard.length >= 2) {
    const diff = prevStandard[1].accuracy - prevStandard[0].accuracy;
    delta = diff > 0 ? ` (↑${(diff * 100).toFixed(1)}%)` : diff < 0 ? ` (↓${(Math.abs(diff) * 100).toFixed(1)}%)` : ` (→)`;
  }

  console.log(`  ✦ [${log.step}] ${pct}%${delta} | ${log.passed}/${log.total} passed | $${cost} | ${time}s | +${log.rulesAdded}/-${log.rulesRemoved} rules | cumulative: $${cumulativeCost.toFixed(2)}`);
}

function printEpochReport() {
  const epochRuns = runHistory.filter(r => r.epoch === epochCount);
  const standardRuns = epochRuns.filter(r => r.step.startsWith("standard-"));
  const compoundRun = epochRuns.find(r => r.step === "compound");

  const epochCost = epochRuns.reduce((s, r) => s + r.costUsd, 0);
  const epochTime = epochRuns.reduce((s, r) => s + r.latencyMs, 0);
  const epochRulesAdded = epochRuns.reduce((s, r) => s + r.rulesAdded, 0);
  const epochRulesRemoved = epochRuns.reduce((s, r) => s + r.rulesRemoved, 0);

  const standardAccuracies = standardRuns.map(r => r.accuracy);
  const standardFirst = standardAccuracies[0] || 0;
  const standardLast = standardAccuracies[standardAccuracies.length - 1] || 0;

  console.log(`
${"─".repeat(60)}
  EPOCH ${epochCount} REPORT
${"─".repeat(60)}
  Standard accuracy: ${(standardFirst * 100).toFixed(1)}% → ${(standardLast * 100).toFixed(1)}% (${standardRuns.length} cycles)
  Compound accuracy: ${compoundRun ? (compoundRun.accuracy * 100).toFixed(1) + "%" : "N/A"}
  Epoch cost: $${epochCost.toFixed(2)} | Cumulative: $${cumulativeCost.toFixed(2)} / $${BUDGET_CAP_USD}
  Epoch time: ${(epochTime / 1000 / 60).toFixed(1)} min
  Rules: +${epochRulesAdded} added, -${epochRulesRemoved} removed
  Trend: ${standardAccuracies.map(a => (a * 100).toFixed(0) + "%").join(" → ")}
${"─".repeat(60)}
`);
}

async function printFinalReport() {
  const totalTime = runHistory.reduce((s, r) => s + r.latencyMs, 0);
  const totalRulesAdded = runHistory.reduce((s, r) => s + r.rulesAdded, 0);
  const totalRulesRemoved = runHistory.reduce((s, r) => s + r.rulesRemoved, 0);

  const standardRuns = runHistory.filter(r => r.step.startsWith("standard-"));
  const compoundRuns = runHistory.filter(r => r.step === "compound");

  const activeRules = await storage.getAllActiveLearnings().catch(() => []);

  console.log(`
${"═".repeat(60)}
  FINAL TRAINING REPORT
${"═".repeat(60)}

  Epochs completed: ${epochCount}
  Total runs: ${runHistory.length} (${standardRuns.length} standard + ${compoundRuns.length} compound)
  Total cost: $${cumulativeCost.toFixed(2)} / $${BUDGET_CAP_USD}
  Total time: ${(totalTime / 1000 / 60).toFixed(1)} min
  Rules: +${totalRulesAdded} added, -${totalRulesRemoved} removed, ${activeRules.length} active

  STANDARD ACCURACY TREND:
  ${standardRuns.map((r, i) => `  ${i + 1}. [E${r.epoch}/${r.step}] ${(r.accuracy * 100).toFixed(1)}%`).join("\n")}

  COMPOUND ACCURACY TREND:
  ${compoundRuns.length > 0 ? compoundRuns.map((r, i) => `  ${i + 1}. [E${r.epoch}] ${(r.accuracy * 100).toFixed(1)}%`).join("\n") : "  (none)"}

  FULL RUN LOG:
  ${"Step".padEnd(16)} ${"Accuracy".padEnd(10)} ${"Cost".padEnd(8)} ${"Time".padEnd(8)} Rules
  ${"-".repeat(55)}
${runHistory.map(r =>
    `  ${(r.step).padEnd(16)} ${((r.accuracy * 100).toFixed(1) + "%").padEnd(10)} $${r.costUsd.toFixed(2).padEnd(7)} ${((r.latencyMs / 1000).toFixed(0) + "s").padEnd(8)} +${r.rulesAdded}/-${r.rulesRemoved}`
  ).join("\n")}
${"═".repeat(60)}
`);
}

// ═══════════════════════════════════════════════════════════════
// ENTRY
// ═══════════════════════════════════════════════════════════════

train()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("\n💥 Training loop crashed:", err);
    printFinalReport().then(() => process.exit(1));
  });
