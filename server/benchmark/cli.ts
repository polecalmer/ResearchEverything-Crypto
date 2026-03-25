#!/usr/bin/env npx tsx
/**
 * Benchmark CLI — Standalone entry point
 * 
 * Use this from a dedicated Repl, local machine, or any environment
 * with DATABASE_URL + API keys set.
 * 
 * Usage:
 *   npx tsx server/benchmark/cli.ts seed [--dry-run] [--limit N]
 *   npx tsx server/benchmark/cli.ts run [--subset N] [--difficulty easy|standard|hard] [--dry-run] [--verbose]
 *   npx tsx server/benchmark/cli.ts status
 *   npx tsx server/benchmark/cli.ts failures <runId>
 *   npx tsx server/benchmark/cli.ts observability [--days N]
 *   npx tsx server/benchmark/cli.ts full-cycle [--subset N]
 */

// Load .env for local runs (no-op if dotenv not installed or no .env file)
// @ts-ignore — dotenv is optional, only needed for local development
import("dotenv/config").catch(() => {});

import { storage } from "../storage";
import { seedBenchmark } from "./seed";
import { runBenchmark } from "./runner";

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function getFlagValue(name: string, defaultVal?: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

async function main() {
  if (!command) {
    console.log(`
Benchmark CLI — Autoresearch Eval System

Commands:
  seed          Generate benchmark cases from DeFiLlama
  run           Execute benchmark and apply improvements
  status        Show latest run results and history
  failures      Show failure details for a specific run
  observability Show production query attempt patterns
  full-cycle    Seed (if needed) + full run + report

Flags:
  --subset N       Only run N random cases
  --difficulty X   Filter by easy/standard/hard
  --dry-run        Don't apply improvements
  --verbose        Print every case result
  --limit N        Protocol limit for seeding (default 100)
  --days N         Lookback period for observability (default 30)
`);
    process.exit(0);
  }

  switch (command) {
    case "seed": {
      const dryRun = getFlag("dry-run");
      const limit = parseInt(getFlagValue("limit", "100")!);
      console.log(`\nSeeding benchmark (${limit} protocols, ${dryRun ? "DRY RUN" : "LIVE"})...\n`);
      const result = await seedBenchmark({ protocolLimit: limit, dryRun });
      console.log(`\nSeed complete:`, JSON.stringify(result, null, 2));
      break;
    }

    case "run": {
      const subset = getFlagValue("subset") ? parseInt(getFlagValue("subset")!) : undefined;
      const difficulty = getFlagValue("difficulty");
      const dryRun = getFlag("dry-run");
      const verbose = getFlag("verbose");

      console.log(`\nRunning benchmark (${subset ? `subset=${subset}` : "all cases"}, ${dryRun ? "DRY RUN" : "LIVE"})...\n`);

      const { run, analysis, improvements } = await runBenchmark({
        subset, difficulty, dryRun, verbose,
      });

      // Print summary report
      console.log(`\n${"═".repeat(60)}`);
      console.log(`  FINAL REPORT — Run ${run.id}`);
      console.log(`${"═".repeat(60)}`);
      console.log(`  Config version: ${run.configVersion}`);
      console.log(`  Accuracy: ${(run.overallAccuracy * 100).toFixed(1)}%`);
      console.log(`  Passed: ${run.passedCases} / ${run.totalCases}`);
      console.log(`  Failed: ${run.failedCases}`);
      if (improvements.length > 0) {
        console.log(`\n  Improvements ${dryRun ? "proposed" : "applied"}: ${improvements.length}`);
        for (const imp of improvements) {
          console.log(`    • [${imp.type}] ${imp.rule?.ruleText || "deactivate rule"}`);
        }
      }
      console.log(`${"═".repeat(60)}\n`);
      break;
    }

    case "status": {
      const latest = await storage.getLatestBenchmarkRun();
      const history = await storage.getBenchmarkRunHistory(10);
      const caseCount = await storage.getBenchmarkCaseCount();
      const learnings = await storage.getAllActiveLearnings();

      console.log(`\n${"═".repeat(60)}`);
      console.log(`  SYSTEM STATUS`);
      console.log(`${"═".repeat(60)}`);
      console.log(`  Benchmark cases: ${caseCount}`);
      console.log(`  Active rules: ${learnings.length}`);

      if (latest) {
        console.log(`\n  Latest run (v${latest.configVersion}):`);
        console.log(`    Accuracy: ${(latest.overallAccuracy * 100).toFixed(1)}%`);
        console.log(`    Passed: ${latest.passedCases}/${latest.totalCases}`);
        console.log(`    Date: ${latest.createdAt}`);
      } else {
        console.log(`\n  No completed runs yet.`);
      }

      if (history.length > 1) {
        console.log(`\n  Run history:`);
        for (const run of history) {
          const status = run.status === "completed" ? "✓" : run.status === "running" ? "⟳" : "✗";
          console.log(`    ${status} v${run.configVersion}: ${(run.overallAccuracy * 100).toFixed(1)}% (${run.totalCases} cases) — ${run.createdAt}`);
        }
      }

      if (learnings.length > 0) {
        console.log(`\n  Top rules by confidence:`);
        for (const l of learnings.slice(0, 10)) {
          console.log(`    [${l.confidence}] [${l.scope}/${l.scopeKey}] ${l.ruleText}`);
        }
      }
      console.log(`${"═".repeat(60)}\n`);
      break;
    }

    case "failures": {
      const runId = args[1];
      if (!runId) {
        // Use latest run
        const latest = await storage.getLatestBenchmarkRun();
        if (!latest) { console.log("No completed runs."); break; }
        args[1] = latest.id;
      }
      const failures = await storage.getFailedCaseResultsByRun(args[1]);
      console.log(`\n${failures.length} failures in run ${args[1]}:\n`);
      for (const f of failures) {
        console.log(`  ${f.benchmarkCase?.protocol || "?"} / ${f.benchmarkCase?.metricType || "?"}`);
        console.log(`    Query: "${f.benchmarkCase?.naturalLanguageQuery}"`);
        console.log(`    Score: ${f.score.toFixed(2)} | Source: ${f.dataSource} | Ratio: ${f.magnitudeRatio?.toFixed(3) || "N/A"}`);
        if (f.errorMessage) console.log(`    Error: ${f.errorMessage.substring(0, 120)}`);
        if (f.sqlUsed) console.log(`    SQL: ${f.sqlUsed.substring(0, 120)}...`);
        console.log();
      }
      break;
    }

    case "observability": {
      const days = parseInt(getFlagValue("days", "30")!);
      const [patterns, diffs] = await Promise.all([
        storage.getFailurePatterns(days),
        storage.getRetryDiffs(days),
      ]);

      console.log(`\n${"═".repeat(60)}`);
      console.log(`  OBSERVABILITY — Last ${days} days`);
      console.log(`${"═".repeat(60)}`);

      if (patterns.length > 0) {
        console.log(`\n  Failure patterns (protocol / metric / error → count):`);
        for (const p of patterns.slice(0, 15)) {
          console.log(`    ${p.protocol} / ${p.metricType} / ${p.errorType}: ${p.count}x`);
        }
      }

      if (diffs.length > 0) {
        console.log(`\n  Retry diffs (failed → fixed SQL):`);
        for (const d of diffs.slice(0, 5)) {
          console.log(`    ${d.failed.protocol} / ${d.failed.metricType}:`);
          console.log(`      Failed: ${d.failed.sqlQuery?.substring(0, 100)}...`);
          console.log(`      Fixed:  ${d.fixed.sqlQuery?.substring(0, 100)}...`);
          console.log(`      Error:  ${d.failed.errorMessage?.substring(0, 100)}`);
          console.log();
        }
      }
      console.log(`${"═".repeat(60)}\n`);
      break;
    }

    case "full-cycle": {
      const subset = getFlagValue("subset") ? parseInt(getFlagValue("subset")!) : undefined;

      // 1. Check if seeded
      const caseCount = await storage.getBenchmarkCaseCount();
      if (caseCount < 10) {
        console.log(`\nOnly ${caseCount} benchmark cases found. Seeding first...\n`);
        await seedBenchmark({ protocolLimit: 100 });
      }

      // 2. Run benchmark
      console.log(`\nRunning full benchmark cycle...\n`);
      const { run, analysis, improvements } = await runBenchmark({
        subset, verbose: true,
      });

      // 3. Print full report
      console.log(`\n${"═".repeat(60)}`);
      console.log(`  FULL CYCLE REPORT`);
      console.log(`${"═".repeat(60)}`);
      console.log(`  Accuracy: ${(run.overallAccuracy * 100).toFixed(1)}%`);
      console.log(`  Passed: ${run.passedCases}/${run.totalCases}`);

      if (analysis.byProtocol.length > 0) {
        console.log(`\n  Worst protocols:`);
        for (const p of analysis.byProtocol.slice(0, 5)) {
          console.log(`    ${p.protocol}: ${(p.failRate * 100).toFixed(0)}% failure (${p.count} cases)`);
        }
      }

      if (analysis.byErrorType.length > 0) {
        console.log(`\n  Top error types:`);
        for (const e of analysis.byErrorType.slice(0, 5)) {
          console.log(`    ${e.errorType}: ${e.count}x`);
        }
      }

      if (improvements.length > 0) {
        console.log(`\n  Rules applied: ${improvements.length}`);
        for (const imp of improvements) {
          console.log(`    • [${imp.type}] ${imp.rule?.ruleText || "deactivate"} (confidence: ${imp.confidence.toFixed(2)})`);
        }
      }

      // 4. Compare with history
      const history = await storage.getBenchmarkRunHistory(5);
      if (history.length > 1) {
        console.log(`\n  Trend:`);
        for (const h of history) {
          console.log(`    v${h.configVersion}: ${(h.overallAccuracy * 100).toFixed(1)}% (${h.createdAt})`);
        }
      }

      console.log(`${"═".repeat(60)}\n`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
