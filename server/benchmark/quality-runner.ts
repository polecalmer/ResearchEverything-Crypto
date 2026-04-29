/**
 * LLM-judged quality benchmark runner.
 *
 * For each active case we:
 *   1. Run the user's prompt through the production research agent
 *      (`runSessionResearchAgent`) so the judgment reflects what a real
 *      user would see — response text, artifacts, chart config, the lot.
 *   2. Ship the response plus the case's rubric to a Claude judge call,
 *      which returns a 0-5 score, a pass/partial/fail verdict, and a
 *      short critique.
 *   3. Persist the per-case result and update a rolling run summary.
 *
 * Deliberately NOT shared with the tolerance runner — it grades different
 * things, stores different fields, and its pass rate is not comparable.
 */
import { db } from "../db";
import {
  benchmarkQualityCases,
  benchmarkQualityRuns,
  benchmarkQualityResults,
  type BenchmarkQualityCase,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { runSessionResearchAgent } from "../session-research-agent";
import { callAnthropicServer } from "../mpp-client";
import { storage } from "../storage";

const JUDGE_MODEL = "claude-opus-4-7";
const FOLLOW_UP_MODEL = "claude-opus-4-7";

// Opus-4.7 generates a single, contextually-aware follow-up question per case
// based on the agent's initial response. The follow-up is then run through the
// agent with full conversation history, exercising 2-turn behavior. We use
// Opus rather than a cheaper model because follow-up quality (intelligence,
// specificity to the response, avoidance of trivially-restated questions) is
// what we're measuring.
async function generateFollowUpPrompt(
  initialPrompt: string,
  initialResponse: string,
  dimension: string,
): Promise<{ followUp: string; cost: number } | null> {
  const truncatedResponse = (initialResponse || "").slice(0, 4000);
  if (!truncatedResponse.trim()) return null;

  const system = `You generate a SINGLE follow-up question that a serious crypto analyst would ask after reading the assistant's initial response.

Your follow-up must:
- Be one specific question, not multi-part
- Probe the most analytically interesting claim, gap, or ambiguity in the response
- Push for depth (a quantification, a falsifier, a comparable, a stress-test) — NOT trivially restate the original question
- Be self-contained enough that the assistant can answer with the prior conversation as context

Avoid:
- Generic "tell me more" questions
- Questions that simply ask for the SAME metric on a different timescale unless that's the most interesting probe
- Questions about topics the response didn't already touch

Return ONLY the question text. No quotes, no preamble, no markdown.`;

  const user = `DIMENSION: ${dimension}

INITIAL USER PROMPT:
${initialPrompt}

ASSISTANT'S INITIAL RESPONSE (first 4k chars):
"""
${truncatedResponse}
"""

Generate ONE follow-up question now.`;

  try {
    const resp = await callAnthropicServer({
      model: FOLLOW_UP_MODEL,
      max_tokens: 200,
      system,
      messages: [{ role: "user", content: user }],
    });
    const followUp = (resp.text || "").trim().replace(/^["']|["']$/g, "");
    if (!followUp || followUp.length < 5) return null;
    return { followUp, cost: resp.mppCost || 0 };
  } catch (err: any) {
    console.warn(`[quality-runner] follow-up generation failed: ${err?.message || err}`);
    return null;
  }
}

// Stable userId so the agent loads system-wide KGs (data brain, analyst
// frameworks) and any brain entries this benchmark identity has accumulated.
// Distinct from production users so benchmark behavior is isolated from
// per-user prefs/history.
const BENCHMARK_USER_ID = process.env.BENCHMARK_USER_ID || "00000000-0000-0000-0000-0000000bench1";

// Truncate an artifact payload before we ship it to the judge so we don't
// blow past token limits with a 10k-row chart dataset. The judge cares
// about shape (chartType, axisLayout, smoothing, format) far more than
// raw data, so we keep config fields verbatim and drop the data array.
function summariseArtifact(a: any): any {
  if (!a || typeof a !== "object") return a;
  const clone: any = { type: a.type, title: a.title, subtitle: a.subtitle };
  if (a.type === "chart") {
    clone.chartConfig = a.chartConfig;
    clone.yAxes = a.chartConfig?.yAxes || a.yAxes;
    clone.smoothing = a.chartConfig?.smoothing || a.smoothing;
    clone.chartType = a.chartConfig?.chartType || a.chartType;
    clone.axisLayout = a.chartConfig?.axisLayout || a.axisLayout;
    clone.rowCount = Array.isArray(a.data) ? a.data.length : null;
    if (Array.isArray(a.data) && a.data.length > 0) {
      clone.firstRow = a.data[0];
      clone.lastRow = a.data[a.data.length - 1];
    }
  } else if (a.type === "table") {
    clone.columns = a.columns;
    clone.rowCount = Array.isArray(a.data) ? a.data.length : null;
    if (Array.isArray(a.data) && a.data.length > 0) {
      clone.firstRows = a.data.slice(0, 3);
    }
  } else {
    // unknown artifact type — keep enough to judge its existence
    clone.keys = Object.keys(a).slice(0, 20);
  }
  return clone;
}

function buildJudgePrompt(
  c: BenchmarkQualityCase,
  response: { content: string; artifacts: any[] },
): string {
  const artifactSummary = (response.artifacts || []).map(summariseArtifact);
  const content = (response.content || "").slice(0, 6000);
  const priorTurns = Array.isArray(c.priorTurns) ? (c.priorTurns as Array<{ role: string; content: string }>) : [];
  const priorTurnsBlock =
    priorTurns.length > 0
      ? `PRIOR CONVERSATION (the test prompt is a follow-up to this):
${priorTurns
  .map(t => `[${t.role.toUpperCase()}]: ${(t.content || "").slice(0, 1500)}`)
  .join("\n\n")}

`
      : "";

  const criteria = Array.isArray((c as any).criteria) ? (c as any).criteria as Array<{ id: string; description: string; points: number }> : null;
  const criteriaBlock = criteria && criteria.length > 0
    ? `

STRUCTURED CRITERIA (score each one 0, 0.5, or 1):
${criteria.map(cr => `  - id: "${cr.id}" — ${cr.description} (${cr.points} pt${cr.points === 1 ? "" : "s"})`).join("\n")}

You MUST return a "criteriaScores" object whose keys are EXACTLY the IDs above and whose values are 0, 0.5, or 1.
Every criterion ID listed above must appear in criteriaScores — no omissions, no extra IDs.`
    : "";

  const schemaBlock = criteria && criteria.length > 0
    ? `Return ONLY valid JSON matching this exact schema (no prose, no code fences):
{
  "score": <number 0-5>,
  "verdict": "pass" | "partial" | "fail",
  "critique": "<2-4 sentences explaining what the response did / missed>",
  "criteriaScores": { ${criteria.map(cr => `"${cr.id}": <0 | 0.5 | 1>`).join(", ")} }
}`
    : `Return ONLY valid JSON matching this exact schema (no prose, no code fences):
{
  "score": <number 0-5>,
  "verdict": "pass" | "partial" | "fail",
  "critique": "<2-4 sentences explaining what the response did / missed>"
}`;

  return `You are grading a crypto research assistant's response against a rubric.

${priorTurnsBlock}USER PROMPT (the turn being graded):
${c.prompt}

EXPECTED BEHAVIOUR (shorthand):
${c.expectedBehavior || "(none)"}

RUBRIC:
${c.rubric}${criteriaBlock}

AGENT RESPONSE (content, first 6k chars):
"""
${content}
"""

AGENT ARTIFACTS (summary — full data dropped, chart config retained):
${JSON.stringify(artifactSummary, null, 2).slice(0, 4000)}

Grade strictly against the rubric. Do not reward content the rubric doesn't ask for.
${schemaBlock}`;
}

interface ParsedJudge {
  score: number;
  verdict: string;
  critique: string;
  criteriaScores: Record<string, number> | null;
}

function parseJudgeJson(raw: string): ParsedJudge | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof obj.score !== "number") return null;
    const score = Math.max(0, Math.min(5, obj.score));
    const verdict =
      typeof obj.verdict === "string" ? obj.verdict.toLowerCase() : score >= 4 ? "pass" : score >= 2 ? "partial" : "fail";
    const critique = typeof obj.critique === "string" ? obj.critique : "";
    let criteriaScores: Record<string, number> | null = null;
    if (obj.criteriaScores && typeof obj.criteriaScores === "object" && !Array.isArray(obj.criteriaScores)) {
      const sanitized: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj.criteriaScores)) {
        const n = typeof v === "number" ? v : Number(v);
        if (!isFinite(n)) continue;
        // Clamp to {0, 0.5, 1} bins.
        sanitized[k] = n >= 0.75 ? 1 : n >= 0.25 ? 0.5 : 0;
      }
      if (Object.keys(sanitized).length > 0) criteriaScores = sanitized;
    }
    return { score, verdict, critique, criteriaScores };
  } catch {
    return null;
  }
}

function failedCriteriaIdsFromScores(scores: Record<string, number> | null): string[] {
  if (!scores) return [];
  return Object.entries(scores).filter(([, v]) => v < 1).map(([k]) => k);
}

export interface QualityRunOptions {
  /** Only score cases matching this dimension (or "all"). */
  dimension?: string;
  /** Limit to first N active cases after filtering. */
  limit?: number;
  /** If true, don't insert results into the DB — dry-run for debugging. */
  dryRun?: boolean;
  /** Free-form note stored on the run row. */
  notes?: string;
  /** Verbose per-case logging. */
  verbose?: boolean;
}

export async function runQualityBenchmark(opts: QualityRunOptions = {}): Promise<{
  runId: string | null;
  totalCases: number;
  scoredCases: number;
  averageScore: number | null;
  perCase: Array<{ caseId: string; score: number; verdict: string; dimension: string }>;
}> {
  const { dimension, limit, dryRun = false, notes, verbose = false } = opts;

  let cases: BenchmarkQualityCase[] = await db
    .select()
    .from(benchmarkQualityCases)
    .where(eq(benchmarkQualityCases.isActive, true));

  if (dimension && dimension !== "all") {
    cases = cases.filter(c => c.dimension === dimension);
  }
  if (limit && limit < cases.length) cases = cases.slice(0, limit);

  if (cases.length === 0) {
    console.log(`[quality-runner] No active cases match filter (dimension=${dimension || "all"}).`);
    return { runId: null, totalCases: 0, scoredCases: 0, averageScore: null, perCase: [] };
  }

  let runId: string | null = null;
  if (!dryRun) {
    const [run] = await db
      .insert(benchmarkQualityRuns)
      .values({
        totalCases: cases.length,
        status: "running",
        judgeModel: JUDGE_MODEL,
        notes: notes || null,
      })
      .returning();
    runId = run.id;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  QUALITY BENCHMARK — ${new Date().toISOString()}`);
  console.log(`  Cases: ${cases.length}   Dimension: ${dimension || "all"}   Dry-run: ${dryRun}`);
  console.log(`${"═".repeat(60)}\n`);

  // Load any accumulated benchmark brain so the agent gets the same KG-informed
  // context production users get (data brain + analyst frameworks load via
  // userId; user research brain loads via the brain object below).
  const brainRecord = await storage.getResearchBrain(BENCHMARK_USER_ID).catch(() => null);
  const benchmarkBrain = brainRecord ? {
    entities: (brainRecord.entities || {}) as Record<string, any>,
    knowledge: (brainRecord.knowledge || []) as any[],
    preferences: (brainRecord.preferences || {}) as Record<string, any>,
    relationships: (brainRecord.relationships || []) as any[],
    contradictions: (brainRecord.contradictions || []) as any[],
    meta: (brainRecord.meta || { totalSessions: 0, lastActive: new Date().toISOString().slice(0, 10), topEntities: [] }) as any,
  } : null;
  console.log(`[quality-runner] benchmark userId=${BENCHMARK_USER_ID} · brain ${benchmarkBrain ? "loaded" : "empty"}`);

  const perCase: Array<{ caseId: string; score: number; verdict: string; dimension: string }> = [];
  let totalCost = 0;
  let totalLatency = 0;
  let scoredCount = 0;
  let sumScore = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const caseStart = Date.now();
    console.log(`[${i + 1}/${cases.length}] [${c.dimension}] ${c.prompt.slice(0, 70)}${c.prompt.length > 70 ? "…" : ""}`);

    let score = 0;
    let verdict = "fail";
    let critique = "";
    let responseText = "";
    let responseArtifacts: any[] = [];
    let judgeRaw: any = null;
    let executionSuccess = false;
    let errorMessage: string | null = null;
    let costUsd = 0;
    let criteriaScores: Record<string, number> | null = null;
    let failedCriteriaIds: string[] = [];
    let followUpPrompt: string | null = null;
    let followUpResponse: string | null = null;
    let followUpCost: number | null = null;
    let followUpLatencyMs: number | null = null;

    try {
      const history = Array.isArray(c.priorTurns)
        ? (c.priorTurns as Array<{ role: string; content: string }>)
        : [];
      const response = await runSessionResearchAgent(
        c.prompt,
        history,
        benchmarkBrain,
        undefined,
        undefined,
        undefined,
        BENCHMARK_USER_ID,
      );
      executionSuccess = true;
      responseText = response.content || "";
      responseArtifacts = response.artifacts || [];
      costUsd += response.mppCost || 0;

      const judgePrompt = buildJudgePrompt(c, response);
      const judgeResp = await callAnthropicServer({
        model: JUDGE_MODEL,
        max_tokens: 600,
        messages: [{ role: "user", content: judgePrompt }],
      });
      costUsd += judgeResp.mppCost || 0;

      const parsed = parseJudgeJson(judgeResp.text);
      if (parsed) {
        score = parsed.score;
        verdict = parsed.verdict;
        critique = parsed.critique;
        criteriaScores = parsed.criteriaScores;
        failedCriteriaIds = failedCriteriaIdsFromScores(criteriaScores);
        judgeRaw = { text: judgeResp.text, ...parsed };
      } else {
        errorMessage = "Judge returned unparseable JSON";
        judgeRaw = { text: judgeResp.text };
      }

      // Follow-up turn: generate a context-aware probe via Opus 4.7, then run
      // it through the agent with the prior turn as conversation history. Cost
      // accumulates into costUsd alongside the initial turn so the run-level
      // total stays correct.
      if (executionSuccess && responseText) {
        const followUp = await generateFollowUpPrompt(c.prompt, responseText, c.dimension);
        if (followUp) {
          costUsd += followUp.cost;
          followUpPrompt = followUp.followUp;
          if (verbose) console.log(`    follow-up: ${followUp.followUp}`);
          const followUpStart = Date.now();
          try {
            const followUpHistory = [
              ...history,
              { role: "user" as const, content: c.prompt },
              { role: "assistant" as const, content: responseText },
            ];
            const followUpResp = await runSessionResearchAgent(
              followUp.followUp,
              followUpHistory,
              benchmarkBrain,
              undefined,
              undefined,
              undefined,
              BENCHMARK_USER_ID,
            );
            followUpResponse = followUpResp.content || "";
            followUpCost = followUpResp.mppCost || 0;
            costUsd += followUpCost;
            followUpLatencyMs = Date.now() - followUpStart;
          } catch (followUpErr: any) {
            console.warn(`    follow-up turn failed: ${followUpErr?.message || followUpErr}`);
            followUpLatencyMs = Date.now() - followUpStart;
          }
        }
      }
    } catch (e: any) {
      executionSuccess = false;
      errorMessage = e?.message || String(e);
      if (verbose) console.error(`  ✗ Error: ${errorMessage}`);
    }

    const latencyMs = Date.now() - caseStart;
    totalLatency += latencyMs;
    totalCost += costUsd;
    if (executionSuccess && errorMessage == null) {
      scoredCount++;
      sumScore += score;
    }
    perCase.push({ caseId: c.id, score, verdict, dimension: c.dimension });

    const verdictIcon = verdict === "pass" ? "✓" : verdict === "partial" ? "~" : "✗";
    console.log(
      `  ${verdictIcon} ${verdict.toUpperCase()}  score=${score.toFixed(1)}/5  ${latencyMs}ms  $${costUsd.toFixed(4)}`,
    );
    if (critique && verbose) console.log(`    ${critique}`);
    if (errorMessage) console.log(`    error: ${errorMessage}`);

    if (!dryRun && runId) {
      await db.insert(benchmarkQualityResults).values({
        runId,
        caseId: c.id,
        dimension: c.dimension,
        score,
        verdict,
        critique,
        responseText,
        responseArtifacts: responseArtifacts.map(summariseArtifact),
        judgeRaw,
        criteriaScores,
        failedCriteriaIds: failedCriteriaIds.length > 0 ? failedCriteriaIds : null,
        followUpPrompt,
        followUpResponse,
        followUpCost,
        followUpLatencyMs,
        costUsd,
        latencyMs,
        executionSuccess,
        errorMessage,
      });
      await db
        .update(benchmarkQualityRuns)
        .set({
          scoredCases: scoredCount,
          averageScore: scoredCount > 0 ? sumScore / scoredCount : null,
          totalCostUsd: totalCost,
          totalLatencyMs: totalLatency,
        })
        .where(eq(benchmarkQualityRuns.id, runId));
    }
  }

  const averageScore = scoredCount > 0 ? sumScore / scoredCount : null;
  if (!dryRun && runId) {
    await db
      .update(benchmarkQualityRuns)
      .set({
        scoredCases: scoredCount,
        averageScore,
        totalCostUsd: totalCost,
        totalLatencyMs: totalLatency,
        status: "completed",
      })
      .where(eq(benchmarkQualityRuns.id, runId));
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  QUALITY RUN COMPLETE`);
  if (averageScore != null) console.log(`  Average score: ${averageScore.toFixed(2)} / 5 (${scoredCount}/${cases.length} scored)`);
  console.log(`  Total cost: $${totalCost.toFixed(2)}   Total time: ${(totalLatency / 1000).toFixed(1)}s`);
  console.log(`${"═".repeat(60)}\n`);

  return { runId, totalCases: cases.length, scoredCases: scoredCount, averageScore, perCase };
}
