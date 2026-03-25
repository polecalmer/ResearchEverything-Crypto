/**
 * Autonomous Benchmark Runner
 * 
 * The autoresearch loop for the data agent. Runs benchmark cases through
 * the agent, scores results against reference data, analyzes failures,
 * proposes improvements, and merges what works.
 * 
 * Run: npx tsx server/benchmark/runner.ts [--subset N] [--analyze-only]
 */

import { storage } from "../storage";
import { callAnthropicServer, callAnthropicServerHeavy } from "../mpp-client";
import { executeDuneSQL, isDuneConfigured } from "../dune-client";
import * as defillama from "../defillama-client";
import { fetchReferenceTimeSeries } from "./cross-validate";
import { scoreResult, normalizeAgentData, type ScoreResult, type EvalCaseResult } from "./eval";
import type { BenchmarkCase, SystemLearning, BenchmarkRun } from "@shared/schema";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface RunOptions {
  subset?: number;          // run only N random cases
  difficulty?: string;      // filter by difficulty
  analyzeOnly?: boolean;    // only analyze previous run, don't execute
  dryRun?: boolean;         // generate improvements but don't apply
  verbose?: boolean;
}

interface FailureAnalysis {
  byProtocol: { protocol: string; failRate: number; count: number }[];
  byMetric: { metricType: string; failRate: number; count: number }[];
  byErrorType: { errorType: string; count: number; examples: string[] }[];
  commonPatterns: string[];
}

interface CandidateImprovement {
  type: "add_rule" | "modify_routing" | "deactivate_rule";
  rule?: { scope: string; scopeKey: string; ruleType: string; ruleText: string };
  ruleIdToDeactivate?: string;
  targetedCases: string[];    // case IDs this should fix
  confidence: number;
  reasoning: string;
}

// ═══════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION — distinguish agent errors from infra
// ═══════════════════════════════════════════════════════════════

const INFRA_ERROR_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /timeout/i,
  /timed out/i,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /ENOTFOUND/,
  /socket hang up/i,
  /network/i,
  /502|503|504/,
  /insufficient.?funds/i,
  /payment/i,
  /channel.*error/i,
  /MPP.*fail/i,
  /wallet/i,
  /deposit/i,
];

function classifyError(errorMessage: string | null): "agent" | "infrastructure" {
  if (!errorMessage) return "agent";
  for (const pattern of INFRA_ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) return "infrastructure";
  }
  return "agent";
}

/**
 * Retry a single case with exponential backoff.
 * Only retries infrastructure errors, not agent errors.
 */
async function runSingleCaseWithRetry(
  testCase: BenchmarkCase,
  activeLearnings: SystemLearning[],
  maxRetries: number = 2,
): Promise<EvalCaseResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await runSingleCase(testCase, activeLearnings);

    // Classify the error
    result.errorCategory = result.errorMessage ? classifyError(result.errorMessage) : null;

    // If success or agent error, return immediately — no point retrying
    if (!result.errorMessage || result.errorCategory === "agent") {
      return result;
    }

    // Infrastructure error — retry with backoff
    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt + 1) * 5000; // 10s, 20s
      console.warn(`  ⚠ Infrastructure error: ${result.errorMessage.substring(0, 80)}. Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // All retries exhausted — return the last result
  const finalResult = await runSingleCase(testCase, activeLearnings);
  finalResult.errorCategory = finalResult.errorMessage ? classifyError(finalResult.errorMessage) : null;
  return finalResult;
}

// ═══════════════════════════════════════════════════════════════
// CORE: RUN A SINGLE BENCHMARK CASE
// ═══════════════════════════════════════════════════════════════

/**
 * Execute a single benchmark case through the agent pipeline.
 * This is a lightweight version of runDataAgent — it generates a plan,
 * fetches data, but does NOT save to proven_queries or dashboard_charts.
 */
async function runSingleCase(
  testCase: BenchmarkCase,
  activeLearnings: SystemLearning[],
): Promise<EvalCaseResult> {
  const startTime = Date.now();
  let llmCalls = 0;

  try {
    // 1. Build context (mimics runDataAgent context building)
    const slug = testCase.protocolSlug || await defillama.resolveSlug(testCase.protocol).catch(() => testCase.protocol.toLowerCase());

    const contextParts = [
      `Company: ${testCase.protocol}`,
      `DeFiLlama slug for ${testCase.protocol}: "${slug}"`,
      `Dune Analytics: ${isDuneConfigured() ? "AVAILABLE" : "NOT CONFIGURED"}`,
      `DeFiLlama: AVAILABLE`,
      `CoinGecko: AVAILABLE`,
    ];

    // Inject few-shot examples
    const fewShots = await storage.getFewShotExamples(testCase.protocol, testCase.metricType, 3);
    if (fewShots.length > 0) {
      contextParts.push(`\nWorking query examples for similar requests (adapt these — they are proven to work):`);
      for (let i = 0; i < fewShots.length; i++) {
        const fs = fewShots[i];
        contextParts.push(`  Example ${i + 1}: ${fs.protocol} ${fs.metricType} (${fs.successCount} successes, source: ${fs.dataSource})`);
        if (fs.sqlQuery) contextParts.push(`    SQL: ${fs.sqlQuery}`);
      }
    }

    // Inject learned rules
    const relevantRules = activeLearnings.filter(l =>
      l.scopeKey === testCase.protocol.toLowerCase() || l.scope === "global"
    );
    let rulesSection = "";
    if (relevantRules.length > 0) {
      rulesSection = `\n═══════════════════════════════════════════════════════════════
LEARNED RULES (auto-generated from past failures — follow these)
═══════════════════════════════════════════════════════════════
${relevantRules.map(l => `- [${l.ruleType}] ${l.ruleText}`).join("\n")}`;
    }

    // 2. Import the system prompt base from data-agent (we use a minimal version for eval)
    const systemPrompt = buildEvalSystemPrompt() + rulesSection;

    // 3. Call LLM to generate plan
    const response = await callAnthropicServer({
      model: "claude-opus-4-6", // Match production model for accurate eval
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Data context:\n${contextParts.join("\n")}\n\nUser request: "${testCase.naturalLanguageQuery}"`,
      }],
    });
    llmCalls++;

    const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let plans: any[];
    try {
      plans = JSON.parse(cleaned);
      if (!Array.isArray(plans)) plans = [plans];
    } catch {
      return {
        caseId: testCase.id,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: "LLM returned invalid JSON" },
        executionSuccess: false,
        sanityPassed: false,
        dataSource: null,
        sqlUsed: null,
        errorMessage: "LLM returned invalid JSON",
        latencyMs: Date.now() - startTime,
        llmCalls, errorCategory: null,
      };
    }

    if (plans.length === 0) {
      return {
        caseId: testCase.id,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: "LLM returned empty plan" },
        executionSuccess: false,
        sanityPassed: false,
        dataSource: null,
        sqlUsed: null,
        errorMessage: "Empty plan",
        latencyMs: Date.now() - startTime,
        llmCalls, errorCategory: null,
      };
    }

    const plan = plans[0];

    // 4. Execute the plan
    let data: any[] | null = null;
    let sqlUsed: string | null = null;

    try {
      if (plan.dataSource === "dune-sql") {
        const sql = plan.dataSourceConfig?.sql;
        if (!sql) throw new Error("No SQL in plan");
        sqlUsed = sql;
        const result = await executeDuneSQL(sql, `benchmark_${testCase.id}_${Date.now()}`);
        data = result.rows;
      } else if (plan.dataSource === "defillama") {
        data = await fetchDefiLlamaForPlan(plan, slug);
      } else if (plan.dataSource === "coingecko") {
        const coinId = plan.dataSourceConfig?.coinId || slug;
        const priceData = await defillama.getCoinPriceHistory(coinId, plan.dataSourceConfig?.daysBack || 90);
        data = priceData.prices.map(p => ({ date: p.date, price: p.price }));
      } else {
        return {
          caseId: testCase.id,
          score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: `Unsupported data source: ${plan.dataSource}` },
          executionSuccess: false,
          sanityPassed: false,
          dataSource: plan.dataSource,
          sqlUsed,
          errorMessage: `Unsupported source: ${plan.dataSource}`,
          latencyMs: Date.now() - startTime,
          llmCalls, errorCategory: null,
        };
      }
    } catch (execErr: any) {
      return {
        caseId: testCase.id,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: `Execution error: ${execErr.message}` },
        executionSuccess: false,
        sanityPassed: false,
        dataSource: plan.dataSource,
        sqlUsed,
        errorMessage: execErr.message,
        latencyMs: Date.now() - startTime,
        llmCalls, errorCategory: null,
      };
    }

    if (!data || data.length === 0) {
      return {
        caseId: testCase.id,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: "No data returned" },
        executionSuccess: true,
        sanityPassed: false,
        dataSource: plan.dataSource,
        sqlUsed,
        errorMessage: "Empty result set",
        latencyMs: Date.now() - startTime,
        llmCalls, errorCategory: null,
      };
    }

    // 5. Normalize agent data and score against reference
    const agentData = normalizeAgentData(data, plan.chartConfig);
    const referenceData = await fetchReferenceTimeSeries(
      testCase.protocol,
      testCase.metricType,
      testCase.protocolSlug || undefined,
    );

    if (!referenceData || referenceData.length === 0) {
      return {
        caseId: testCase.id,
        score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: "No reference data available" },
        executionSuccess: true,
        sanityPassed: true,
        dataSource: plan.dataSource,
        sqlUsed,
        errorMessage: "Reference data unavailable",
        latencyMs: Date.now() - startTime,
        llmCalls, errorCategory: null,
      };
    }

    const score = scoreResult(agentData, referenceData, testCase.tolerance);

    return {
      caseId: testCase.id,
      score,
      executionSuccess: true,
      sanityPassed: agentData.length > 0,
      dataSource: plan.dataSource,
      sqlUsed,
      errorMessage: null,
      latencyMs: Date.now() - startTime,
      llmCalls, errorCategory: null,
    };

  } catch (err: any) {
    return {
      caseId: testCase.id,
      score: { total: 0, magnitudeScore: 0, magnitudeRatio: null, trendScore: 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: null, reason: `Unexpected error: ${err.message}` },
      executionSuccess: false,
      sanityPassed: false,
      dataSource: null,
      sqlUsed: null,
      errorMessage: err.message,
      latencyMs: Date.now() - startTime,
      llmCalls, errorCategory: null,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ANALYSIS: identify patterns in failures
// ═══════════════════════════════════════════════════════════════

function analyzeFailures(
  results: EvalCaseResult[],
  cases: Map<string, BenchmarkCase>,
): FailureAnalysis {
  const failures = results.filter(r => r.score.total < 0.5);
  const all = results;

  // By protocol
  const protocolCounts = new Map<string, { total: number; failed: number }>();
  for (const r of all) {
    const c = cases.get(r.caseId);
    if (!c) continue;
    const p = protocolCounts.get(c.protocol) || { total: 0, failed: 0 };
    p.total++;
    if (r.score.total < 0.5) p.failed++;
    protocolCounts.set(c.protocol, p);
  }
  const byProtocol = Array.from(protocolCounts.entries())
    .map(([protocol, { total, failed }]) => ({ protocol, failRate: failed / total, count: total }))
    .filter(p => p.failRate > 0.3 && p.count >= 2)
    .sort((a, b) => b.failRate - a.failRate);

  // By metric
  const metricCounts = new Map<string, { total: number; failed: number }>();
  for (const r of all) {
    const c = cases.get(r.caseId);
    if (!c) continue;
    const m = metricCounts.get(c.metricType) || { total: 0, failed: 0 };
    m.total++;
    if (r.score.total < 0.5) m.failed++;
    metricCounts.set(c.metricType, m);
  }
  const byMetric = Array.from(metricCounts.entries())
    .map(([metricType, { total, failed }]) => ({ metricType, failRate: failed / total, count: total }))
    .filter(m => m.failRate > 0.2)
    .sort((a, b) => b.failRate - a.failRate);

  // By error type
  const errorTypes = new Map<string, { count: number; examples: string[] }>();
  for (const r of failures) {
    const errType = r.errorMessage?.split(":")[0]?.trim() || r.score.reason.split("|")[0]?.trim() || "unknown";
    const e = errorTypes.get(errType) || { count: 0, examples: [] };
    e.count++;
    const c = cases.get(r.caseId);
    if (c && e.examples.length < 3) e.examples.push(`${c.protocol}/${c.metricType}: ${r.errorMessage || r.score.reason}`);
    errorTypes.set(errType, e);
  }
  const byErrorType = Array.from(errorTypes.entries())
    .map(([errorType, { count, examples }]) => ({ errorType, count, examples }))
    .sort((a, b) => b.count - a.count);

  // Common patterns (simple heuristic extraction)
  const commonPatterns: string[] = [];
  const executionFailures = failures.filter(r => !r.executionSuccess);
  if (executionFailures.length > failures.length * 0.3) {
    commonPatterns.push(`${executionFailures.length}/${failures.length} failures are execution errors (SQL didn't run)`);
  }
  const magnitudeFailures = failures.filter(r => r.executionSuccess && r.score.magnitudeScore === 0);
  if (magnitudeFailures.length > 3) {
    commonPatterns.push(`${magnitudeFailures.length} cases had wrong magnitude (data returned but values off by >tolerance)`);
  }

  return { byProtocol, byMetric, byErrorType, commonPatterns };
}

// ═══════════════════════════════════════════════════════════════
// IMPROVEMENT GENERATION
// ═══════════════════════════════════════════════════════════════

async function generateImprovements(
  analysis: FailureAnalysis,
  failedResults: EvalCaseResult[],
  cases: Map<string, BenchmarkCase>,
  currentRules: SystemLearning[],
): Promise<CandidateImprovement[]> {
  // Build a detailed failure report for the LLM
  const failureDetails = failedResults.slice(0, 20).map(r => {
    const c = cases.get(r.caseId);
    return {
      protocol: c?.protocol || "unknown",
      metricType: c?.metricType || "unknown",
      query: c?.naturalLanguageQuery || "",
      dataSource: r.dataSource,
      sql: r.sqlUsed?.substring(0, 200),
      error: r.errorMessage,
      scoreBreakdown: r.score.reason,
    };
  });

  const currentRulesText = currentRules.map(r => `[${r.scope}/${r.scopeKey}] [${r.ruleType}] ${r.ruleText}`).join("\n");

  const response = await callAnthropicServerHeavy({
    model: "claude-opus-4-6",
    max_tokens: 2000,
    system: `You are improving a DeFi data agent that writes SQL queries and fetches chart data. Analyze the failure patterns and propose specific, discrete improvements.

Each improvement must be one of:
- add_rule: A new rule to inject into the agent's system prompt
- modify_routing: Change which data source to prefer for a metric/protocol combination
- deactivate_rule: Remove an existing rule that may be causing problems

Return a JSON array of improvements. Each improvement:
{
  "type": "add_rule" | "modify_routing" | "deactivate_rule",
  "rule": { "scope": "protocol" | "global", "scopeKey": "protocol_name or global", "ruleType": "slug_hint" | "table_warning" | "routing_override" | "sql_pattern" | "data_caveat", "ruleText": "concise instruction max 200 chars" },
  "targetedProtocols": ["protocol names this should fix"],
  "targetedMetrics": ["metric types this should fix"],
  "confidence": 0.0-1.0,
  "reasoning": "why this helps"
}

Rules:
- Only propose improvements with 2+ supporting failure examples
- Don't contradict existing rules unless you're replacing them
- Be specific: "Use 'morpho-blue' not 'morpho' as DeFiLlama slug" > "Fix protocol names"
- Max 5 improvements per analysis
- JSON only, no markdown`,
    messages: [{
      role: "user",
      content: `## Failure Analysis Summary
${JSON.stringify(analysis, null, 2)}

## Detailed Failures (first 20)
${JSON.stringify(failureDetails, null, 2)}

## Current Active Rules
${currentRulesText || "(none)"}

Propose up to 5 improvements.`,
    }],
  });

  try {
    const cleaned = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const improvements: any[] = JSON.parse(cleaned);
    return improvements
      .filter(i => i.type && i.confidence > 0.3)
      .map(i => ({
        type: i.type,
        rule: i.rule,
        ruleIdToDeactivate: i.ruleIdToDeactivate,
        targetedCases: [], // Will be populated during testing
        confidence: i.confidence,
        reasoning: i.reasoning,
      }));
  } catch (err: any) {
    console.warn(`[Runner] Failed to parse improvements: ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runBenchmark(options: RunOptions = {}): Promise<{
  run: BenchmarkRun;
  analysis: FailureAnalysis;
  improvements: CandidateImprovement[];
}> {
  const { subset, difficulty, analyzeOnly = false, dryRun = false, verbose = false } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  BENCHMARK RUN — ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);

  // 1. Load benchmark cases
  let cases = await storage.getActiveBenchmarkCases(difficulty);
  if (subset && subset < cases.length) {
    // Random sample
    const shuffled = [...cases].sort(() => Math.random() - 0.5);
    cases = shuffled.slice(0, subset);
  }

  console.log(`[Runner] Loaded ${cases.length} benchmark cases`);
  const caseMap = new Map(cases.map(c => [c.id, c]));

  // 2. Load current config
  const activeLearnings = await storage.getAllActiveLearnings();
  console.log(`[Runner] Active rules: ${activeLearnings.length}`);

  // Get config version (incremented from last run)
  const lastRun = await storage.getLatestBenchmarkRun();
  const configVersion = (lastRun?.configVersion || 0) + 1;

  // 3. Create run record
  const run = await storage.createBenchmarkRun({
    configVersion,
    totalCases: cases.length,
    passedCases: 0,
    failedCases: 0,
    overallAccuracy: 0,
    configSnapshot: { rulesCount: activeLearnings.length, rules: activeLearnings.map(l => l.ruleText) },
    status: "running",
  });

  console.log(`[Runner] Created run ${run.id} (config v${configVersion})`);

  if (analyzeOnly && lastRun) {
    // Just re-analyze the previous run
    const prevResults = await storage.getBenchmarkCaseResultsByRun(lastRun.id);
    const evalResults: EvalCaseResult[] = prevResults.map(r => ({
      caseId: r.caseId,
      score: { total: r.score, magnitudeScore: 0, magnitudeRatio: r.magnitudeRatio, trendScore: r.trendMatch ? 1 : 0, agentTrend: null, referenceTrend: null, shapeScore: 0, mape: r.mape, reason: "" },
      executionSuccess: r.executionSuccess,
      sanityPassed: r.sanityPassed || false,
      dataSource: r.dataSource,
      sqlUsed: r.sqlUsed,
      errorMessage: r.errorMessage,
      errorCategory: r.errorMessage ? classifyError(r.errorMessage) : null,
      latencyMs: r.latencyMs || 0,
      llmCalls: r.llmCalls || 0,
    }));

    const analysis = analyzeFailures(evalResults, caseMap);
    const failedResults = evalResults.filter(r => r.score.total < 0.5);
    const improvements = await generateImprovements(analysis, failedResults, caseMap, activeLearnings);

    return { run, analysis, improvements };
  }

  // 4. Execute cases
  const results: EvalCaseResult[] = [];
  let passCount = 0;
  let failCount = 0;
  let infraErrorCount = 0;
  let totalLatency = 0;
  let totalLlmCalls = 0;
  let consecutiveInfraErrors = 0;
  const CIRCUIT_BREAKER_THRESHOLD = 5; // abort after 5 consecutive infra errors

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];
    if (verbose || i % 10 === 0) {
      console.log(`[Runner] Case ${i + 1}/${cases.length}: ${testCase.protocol} / ${testCase.metricType}`);
    }

    const result = await runSingleCaseWithRetry(testCase, activeLearnings);
    results.push(result);

    // Save case result
    await storage.insertBenchmarkCaseResult({
      runId: run.id,
      caseId: testCase.id,
      score: result.score.total,
      magnitudeRatio: result.score.magnitudeRatio,
      trendMatch: result.score.trendScore === 1,
      mape: result.score.mape,
      executionSuccess: result.executionSuccess,
      sanityPassed: result.sanityPassed,
      dataSource: result.dataSource,
      sqlUsed: result.sqlUsed,
      errorMessage: result.errorMessage,
      latencyMs: result.latencyMs,
      llmCalls: result.llmCalls,
    });

    // Track results — separate infra errors from real failures
    if (result.errorCategory === "infrastructure") {
      infraErrorCount++;
      consecutiveInfraErrors++;
      if (verbose) {
        console.log(`  ⚠ INFRA ERROR (excluded from accuracy): ${result.errorMessage?.substring(0, 80)}`);
      }

      // Circuit breaker — if APIs are down, stop wasting money
      if (consecutiveInfraErrors >= CIRCUIT_BREAKER_THRESHOLD) {
        console.error(`\n[Runner] CIRCUIT BREAKER: ${CIRCUIT_BREAKER_THRESHOLD} consecutive infrastructure errors. Aborting run.`);
        console.error(`  Last error: ${result.errorMessage}`);
        console.error(`  Completed ${i + 1}/${cases.length} cases before abort.\n`);
        break;
      }
    } else {
      consecutiveInfraErrors = 0; // reset on any non-infra result
      if (result.score.total >= 0.5) {
        passCount++;
      } else {
        failCount++;
        if (verbose) {
          console.log(`  ✗ Score: ${result.score.total.toFixed(2)} | ${result.score.reason}`);
        }
      }
    }

    totalLatency += result.latencyMs;
    totalLlmCalls += result.llmCalls;

    // Rate limiting — don't hammer APIs
    // Back off more aggressively if we've seen infra errors recently
    const delay = consecutiveInfraErrors > 0 ? 5000 : 1000;
    if (i % 5 === 4) await new Promise(r => setTimeout(r, delay));
  }

  // Accuracy excludes infrastructure errors — only measures agent quality
  const scoredResults = results.filter(r => r.errorCategory !== "infrastructure");
  const accuracy = scoredResults.length > 0 ? passCount / scoredResults.length : 0;

  // Update run record
  const wasAborted = consecutiveInfraErrors >= CIRCUIT_BREAKER_THRESHOLD;
  await storage.updateBenchmarkRun(run.id, {
    passedCases: passCount,
    failedCases: failCount,
    overallAccuracy: accuracy,
    totalLatencyMs: totalLatency,
    status: wasAborted ? "failed" : "completed",
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  RESULTS: ${passCount}/${scoredResults.length} passed (${(accuracy * 100).toFixed(1)}%)`);
  if (infraErrorCount > 0) {
    console.log(`  Infrastructure errors (excluded): ${infraErrorCount}`);
  }
  if (wasAborted) {
    console.log(`  ⚠ RUN ABORTED — circuit breaker triggered`);
  }
  console.log(`  Total latency: ${(totalLatency / 1000).toFixed(1)}s | LLM calls: ${totalLlmCalls}`);
  console.log(`${"─".repeat(60)}\n`);

  // 5. Analyze failures — ONLY agent errors, not infrastructure
  const agentResults = results.filter(r => r.errorCategory !== "infrastructure");
  const analysis = analyzeFailures(agentResults, caseMap);

  if (analysis.byProtocol.length > 0) {
    console.log(`\nHigh-failure protocols:`);
    for (const p of analysis.byProtocol.slice(0, 10)) {
      console.log(`  ${p.protocol}: ${(p.failRate * 100).toFixed(0)}% fail rate (${p.count} cases)`);
    }
  }

  if (analysis.byErrorType.length > 0) {
    console.log(`\nError types:`);
    for (const e of analysis.byErrorType.slice(0, 5)) {
      console.log(`  ${e.errorType}: ${e.count} occurrences`);
    }
  }

  // 6. Generate candidate improvements — only from agent failures
  const failedResults = agentResults.filter(r => r.score.total < 0.5);
  let improvements: CandidateImprovement[] = [];

  if (failedResults.length > 0) {
    console.log(`\n[Runner] Generating improvement candidates from ${failedResults.length} failures...`);
    improvements = await generateImprovements(analysis, failedResults, caseMap, activeLearnings);

    for (const imp of improvements) {
      console.log(`  → [${imp.type}] ${imp.rule?.ruleText || imp.ruleIdToDeactivate} (confidence: ${imp.confidence.toFixed(2)})`);
      console.log(`    Reasoning: ${imp.reasoning}`);
    }

    // 7. Apply improvements (if not dry run)
    if (!dryRun && improvements.length > 0) {
      console.log(`\n[Runner] Applying ${improvements.length} improvements...`);
      for (const imp of improvements) {
        if (imp.type === "add_rule" && imp.rule) {
          await storage.saveLearning({
            scope: imp.rule.scope,
            scopeKey: imp.rule.scopeKey,
            ruleType: imp.rule.ruleType,
            ruleText: imp.rule.ruleText,
            source: `benchmark_v${configVersion}`,
            triggeredBy: `Benchmark run ${run.id}: ${imp.reasoning.substring(0, 100)}`,
          });
          console.log(`  ✓ Added rule: ${imp.rule.ruleText}`);
        } else if (imp.type === "deactivate_rule" && imp.ruleIdToDeactivate) {
          await storage.deactivateLearning(imp.ruleIdToDeactivate);
          console.log(`  ✓ Deactivated rule: ${imp.ruleIdToDeactivate}`);
        }
      }

      // Update run record with applied improvements
      await storage.updateBenchmarkRun(run.id, {
        improvementsApplied: improvements.map(i => ({
          type: i.type,
          rule: i.rule?.ruleText,
          confidence: i.confidence,
        })),
      });
    }
  }

  // 8. Compare with previous run
  if (lastRun) {
    const delta = accuracy - (lastRun.overallAccuracy || 0);
    const arrow = delta > 0 ? "↑" : delta < 0 ? "↓" : "→";
    console.log(`\n[Runner] vs. previous run (v${lastRun.configVersion}): ${(lastRun.overallAccuracy! * 100).toFixed(1)}% → ${(accuracy * 100).toFixed(1)}% (${arrow}${Math.abs(delta * 100).toFixed(1)}%)`);
  }

  return { run, analysis, improvements };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function fetchDefiLlamaForPlan(plan: any, slug: string): Promise<any[]> {
  const endpoint = plan.dataSourceConfig?.endpoint;
  const planSlug = plan.dataSourceConfig?.slug || slug;

  switch (endpoint) {
    case "tvl":
      return (await defillama.getProtocolTvl(planSlug)).map(d => ({ date: d.date, totalLiquidityUSD: d.totalLiquidityUSD }));
    case "revenue":
      return (await defillama.getProtocolRevenue(planSlug)).dailyRevenue.map(d => ({ date: d.date, revenue: d.revenue }));
    case "fees":
      return (await defillama.getProtocolFees(planSlug)).dailyFees.map(d => ({ date: d.date, fees: d.fees }));
    case "dexVolume":
      return (await defillama.getProtocolDexVolume(planSlug)).dailyVolume.map(d => ({ date: d.date, volume: d.volume }));
    case "derivatives":
      return (await defillama.getProtocolDerivativesVolume(planSlug)).dailyVolume.map(d => ({ date: d.date, volume: d.volume }));
    default:
      // Try TVL as default
      return (await defillama.getProtocolTvl(planSlug)).map(d => ({ date: d.date, totalLiquidityUSD: d.totalLiquidityUSD }));
  }
}

/**
 * Minimal system prompt for eval — same structure as DATA_AGENT_SYSTEM
 * but stripped down to avoid the full 2000-line import.
 */
function buildEvalSystemPrompt(): string {
  return `You are a Data Analyst Agent. Given a user's request and data context, produce a JSON plan for the chart requested.

RESPOND WITH JSON ONLY — an array of chart definitions:
[{
  "title": "Title",
  "description": "One sentence",
  "chartType": "line" | "bar" | "area",
  "dataSource": "dune-sql" | "defillama" | "coingecko",
  "dataSourceConfig": {
    // dune-sql: { "sql": "SELECT ..." }
    // defillama: { "endpoint": "tvl" | "fees" | "revenue" | "dexVolume" | "derivatives", "slug": "protocol-slug" }
    // coingecko: { "coinId": "token-id", "daysBack": 90 }
  },
  "chartConfig": {
    "xAxis": { "dataKey": "date", "label": "Date", "type": "date" },
    "yAxes": [{ "dataKey": "column_name", "label": "Label", "color": "#38bdf8", "format": "currency", "yAxisId": "left" }]
  }
}]

DATA SOURCE ROUTING:
- Revenue, fees, TVL, DEX volume → prefer "defillama" (reliable, pre-aggregated)
- Lending metrics (borrows, supply, liquidations) → use "dune-sql"
- Token price → use "coingecko"
- Custom analytics, user counts → use "dune-sql"

DUNE SQL RULES:
- Use Spellbook tables: dex.trades, lending.borrow, lending.supply, tokens.transfers, prices.usd
- ALWAYS use amount_usd columns, NEVER raw amount
- There is NO lending.repay table
- GROUP BY date_trunc('week', block_time) for time series
- Filter by project name in lowercase

JSON only, no markdown.`;
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (process.argv[1]?.includes("runner")) {
  const args = process.argv.slice(2);
  const subset = args.includes("--subset") ? parseInt(args[args.indexOf("--subset") + 1]) : undefined;
  const analyzeOnly = args.includes("--analyze-only");
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");
  const difficulty = args.includes("--difficulty") ? args[args.indexOf("--difficulty") + 1] : undefined;

  runBenchmark({ subset, difficulty, analyzeOnly, dryRun, verbose })
    .then(({ run, analysis, improvements }) => {
      console.log(`\nRun ${run.id} complete. Accuracy: ${(run.overallAccuracy * 100).toFixed(1)}%`);
      console.log(`Improvements proposed: ${improvements.length}`);
      process.exit(0);
    })
    .catch(err => {
      console.error("Benchmark run failed:", err);
      process.exit(1);
    });
}
