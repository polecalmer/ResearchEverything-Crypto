import fs from "fs";
import path from "path";
import { callAnthropicRaw } from "./mpp-client";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuestionTypeDef {
  id: string;
  description: string;
  example_prompts: string[];
  required_tools: string[];
  recommended_tools?: string[];
  banned_tools: string[];
  default_artifact: string;
  typical_sub_shape: string;
  lens_hint?: string;
}

export interface PlaybookNode {
  id: string;
  abstract: string;
  types: string[];
  depends_on?: string[];
}

export interface PlaybookDef {
  id: string;
  name: string;
  description: string;
  trigger_pattern: string;
  source_analyst?: string;
  nodes: PlaybookNode[];
}

export interface ResolvedFramework {
  analyst: string;
  name: string;
  description: string;
  steps: string[];
}

export interface SubQuestion {
  id: string;
  text: string;
  types: string[];
  depends_on: string[];
  suggested_tools: string[];
  artifact_hint: string;
  lens?: string;
  status?: "pending" | "answered" | "needs_revision";
  notes?: string;
  resolvedFramework?: ResolvedFramework;
}

export interface ResearchPlan {
  main_question: string;
  sub_questions: SubQuestion[];
  playbook_used: string | null;
  synthesis_required: boolean;
  confidence: number;
  // Validator output, attached after planning
  warnings?: string[];
  // Versioning for audit trail
  planner_version: string;
  reflection_count: number;
}

export interface PlanCallResult {
  plan: ResearchPlan;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

// ─── Catalog loading ─────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data", "research-planner");
let _typesCache: { version: string; types: QuestionTypeDef[] } | null = null;
let _playbooksCache: { version: string; playbooks: PlaybookDef[] } | null = null;

function loadTypes() {
  if (!_typesCache) {
    const raw = fs.readFileSync(path.join(DATA_DIR, "question_types.json"), "utf-8");
    _typesCache = JSON.parse(raw);
  }
  return _typesCache!;
}

function loadPlaybooks() {
  if (!_playbooksCache) {
    const raw = fs.readFileSync(path.join(DATA_DIR, "playbooks.json"), "utf-8");
    _playbooksCache = JSON.parse(raw);
  }
  return _playbooksCache!;
}

export function getKnownTypeIds(): Set<string> {
  return new Set(loadTypes().types.map(t => t.id));
}

export function getKnownPlaybookIds(): Set<string> {
  return new Set(loadPlaybooks().playbooks.map(p => p.id));
}

// ─── Planner prompt ──────────────────────────────────────────────────────────

const PLANNER_VERSION = "planner-v0";
const PLANNER_MODEL = "claude-haiku-4-5";

// Real tool names exposed by the agent. Kept in sync with the TOOLS array in
// session-research-agent.ts. Used both at startup (catalog validation) and at
// plan-validation time (to strip suggested tools that don't exist).
export const KNOWN_AGENT_TOOLS = new Set<string>([
  "query_defillama_tvl",
  "query_defillama_fees_revenue",
  "query_defillama_volume",
  "query_defillama_protocol_summary",
  "query_defillama_price_history",
  "list_defi_protocols",
  "execute_dune_sql",
  "discover_dune_tables",
  "compare_protocols",
  "get_token_snapshot",
  "execute_code",
  "query_yield_pools",
  "query_stablecoins",
  "query_chain_tvl",
  "query_analyst_corpus",
  "query_analyst_frameworks",
  "analyst_perspective",
  "update_research_brain",
  "web_search",
]);

// Catalog self-check: run once on first load, log any drift between the JSON
// taxonomy's required/recommended tool names and the real agent tool registry.
// We log instead of throwing so a bad catalog edit doesn't take the app down,
// but the warning is loud enough that it shows up in startup logs.
let _catalogValidated = false;
function validateCatalogOnce() {
  if (_catalogValidated) return;
  _catalogValidated = true;
  const types = loadTypes().types;
  const drift: string[] = [];
  for (const t of types) {
    for (const tool of [...t.required_tools, ...(t.recommended_tools || []), ...(t.banned_tools || [])]) {
      if (!KNOWN_AGENT_TOOLS.has(tool)) drift.push(`${t.id}: "${tool}"`);
    }
  }
  if (drift.length > 0) {
    console.warn(`[ResearchPlanner] Catalog drift — these tool names in question_types.json do not match any registered agent tool: ${drift.join(", ")}`);
  } else {
    console.log(`[ResearchPlanner] Catalog OK — ${types.length} question types, ${loadPlaybooks().playbooks.length} playbooks loaded.`);
  }
}

function buildPlannerSystemPrompt(): string {
  const types = loadTypes();
  const playbooks = loadPlaybooks();

  return `You are the research planner for a crypto research agent. Your job is to take a user prompt and emit a strict JSON ResearchPlan that the execution agent will follow.

You do NOT answer the user. You ONLY decompose and classify.

# Question type catalog (v${types.version})
${types.types.map(t => `- ${t.id}: ${t.description}\n  required_tools: ${JSON.stringify(t.required_tools)}${t.recommended_tools?.length ? `\n  recommended_tools: ${JSON.stringify(t.recommended_tools)}` : ""}\n  default_artifact: ${t.default_artifact}${t.lens_hint ? `\n  lens_hint: ${t.lens_hint}` : ""}`).join("\n")}

# Playbook catalog (v${playbooks.version})
${playbooks.playbooks.map(p => `- ${p.id} (${p.name}): ${p.description}\n  trigger: ${p.trigger_pattern}\n  nodes: ${p.nodes.map(n => `${n.id}[${n.types.join("+")}]`).join(" → ")}`).join("\n")}

# Rules
1. Decompose the user prompt into 1-7 sub-questions. A simple lookup may have only 1.
2. Classify each sub-question with 1-3 types from the catalog (multi-label is encouraged; e.g. "how does sUSDe yield accrue to holders" = ["flow-analysis","tokenomics-mechanics","valuation-ask"]).
3. If a playbook fits, set playbook_used to its id and instantiate its nodes against the user's specific subject. If no playbook fits, set playbook_used to null and freelance the decomposition.
4. depends_on lists sub-question ids that must be answered first. No cycles. Leaf sub-questions have empty depends_on.
5. suggested_tools should be the union of required_tools and recommended_tools across the assigned types. Add others only when clearly justified. analyst_perspective is particularly powerful for valuation, tokenomics, and narrative questions — suggest it when a sub-question could benefit from an analyst's reasoning perspective.
6. artifact_hint is the single artifact type the execution agent should produce for this sub-question.
7. lens (optional) names an analyst slug ("TopherGMI", "shaundadevens", "thiccyth0t") whose framework should be queried for this sub-question.
8. synthesis_required = true when there are 3+ sub-questions or the prompt asks for a "view"/"thesis"/"recommendation".
9. confidence: 0.0-1.0. Drop below 0.5 if the prompt is ambiguous about subject, scope, or intent.

# Output format (STRICT JSON, no prose, no code fences)
{
  "main_question": "<rephrased user prompt in one sentence>",
  "sub_questions": [
    {
      "id": "q1",
      "text": "<concrete sub-question instantiated against the user's subject>",
      "types": ["<type-id>", ...],
      "depends_on": [],
      "suggested_tools": ["<tool-name>", ...],
      "artifact_hint": "<artifact-type>",
      "lens": "<analyst-slug or null>"
    }
  ],
  "playbook_used": "<playbook-id or null>",
  "synthesis_required": <bool>,
  "confidence": <float>
}`;
}

function buildReflectionSystemPrompt(): string {
  return `You are revising a research plan after partial execution. The execution agent has run some tools and produced partial findings. Your job is to decide whether the original plan is still good, or whether sub-questions need to be added, dropped, or marked needs_revision.

You will receive:
- The original ResearchPlan
- A summary of what tools have been called and what was learned
- The original user prompt

Output STRICT JSON: same ResearchPlan shape as the original, but with an incremented reflection_count, updated sub_questions (add/remove/mark needs_revision), and a short note in any sub-question's "notes" field explaining the revision.

If the plan is still good, return it unchanged with reflection_count incremented. Do not invent new types or playbooks; only use ids from the original catalog.`;
}

// ─── Validator ───────────────────────────────────────────────────────────────

export function validatePlan(plan: ResearchPlan): { valid: boolean; warnings: string[]; fatal: boolean } {
  const warnings: string[] = [];
  let fatal = false;

  if (!plan.sub_questions || plan.sub_questions.length === 0) {
    warnings.push("FATAL: plan has zero sub-questions");
    fatal = true;
    return { valid: false, warnings, fatal };
  }

  const knownTypes = getKnownTypeIds();
  const knownPlaybooks = getKnownPlaybookIds();
  const ids = new Set(plan.sub_questions.map(q => q.id));

  // Unknown playbook
  if (plan.playbook_used && !knownPlaybooks.has(plan.playbook_used)) {
    warnings.push(`unknown playbook "${plan.playbook_used}" — clearing`);
    plan.playbook_used = null;
  }

  for (const q of plan.sub_questions) {
    // Unknown types — drop them, then repair zero-type sub-questions by
    // assigning a safe default ("playbook-synthesis") so routing isn't lost.
    const unknown = q.types.filter(t => !knownTypes.has(t));
    if (unknown.length > 0) {
      warnings.push(`sub-question ${q.id} had unknown types ${JSON.stringify(unknown)} — dropped`);
      q.types = q.types.filter(t => knownTypes.has(t));
    }
    if (q.types.length === 0) {
      warnings.push(`sub-question ${q.id} had zero valid types after dropping — defaulting to playbook-synthesis`);
      q.types = ["playbook-synthesis"];
    }

    // Banned tools — strip them
    const types = loadTypes().types.filter(t => q.types.includes(t.id));
    const bannedSet = new Set(types.flatMap(t => t.banned_tools));
    const bannedHit = q.suggested_tools.filter(t => bannedSet.has(t));
    if (bannedHit.length > 0) {
      warnings.push(`sub-question ${q.id} suggested banned tools ${JSON.stringify(bannedHit)} — stripped`);
      q.suggested_tools = q.suggested_tools.filter(t => !bannedSet.has(t));
    }

    // Strip suggested tools that don't exist in the real agent registry.
    // The planner is on a small model; it sometimes hallucinates plausible-
    // sounding tool names. Better to strip than to confuse the executor.
    const ghostTools = q.suggested_tools.filter(t => !KNOWN_AGENT_TOOLS.has(t));
    if (ghostTools.length > 0) {
      warnings.push(`sub-question ${q.id} suggested unknown tools ${JSON.stringify(ghostTools)} — stripped`);
      q.suggested_tools = q.suggested_tools.filter(t => KNOWN_AGENT_TOOLS.has(t));
    }

    // depends_on referential integrity
    const badDeps = (q.depends_on || []).filter(d => !ids.has(d));
    if (badDeps.length > 0) {
      warnings.push(`sub-question ${q.id} depends on missing ids ${JSON.stringify(badDeps)} — pruned`);
      q.depends_on = q.depends_on.filter(d => ids.has(d));
    }
  }

  // Cycle detection (DFS)
  const graph = new Map(plan.sub_questions.map(q => [q.id, q.depends_on || []]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const ids2 = Array.from(graph.keys());
  for (const id of ids2) color.set(id, WHITE);

  function visit(node: string): boolean {
    color.set(node, GRAY);
    for (const dep of graph.get(node) || []) {
      const c = color.get(dep);
      if (c === GRAY) return true;
      if (c === WHITE && visit(dep)) return true;
    }
    color.set(node, BLACK);
    return false;
  }

  for (const id of ids2) {
    if (color.get(id) === WHITE && visit(id)) {
      warnings.push(`FATAL: cycle detected involving sub-question ${id}`);
      fatal = true;
      break;
    }
  }

  // Confidence floor
  if (plan.confidence < 0.4) {
    warnings.push(`low planner confidence (${plan.confidence.toFixed(2)}) — execution agent should treat plan as a hint, not a contract`);
  }

  plan.warnings = warnings;
  return { valid: !fatal, warnings, fatal };
}

// ─── Framework resolution ────────────────────────────────────────────────────

export async function resolveFrameworkProcedures(plan: ResearchPlan): Promise<{
  plan: ResearchPlan;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const subQsWithLens = plan.sub_questions.filter(q => q.lens);
  if (subQsWithLens.length === 0) return { plan, cost: 0, inputTokens: 0, outputTokens: 0 };

  const { searchAnalystFrameworks } = await import("./analyst-corpus");

  const frameworksBySubQ: Record<string, { analyst: string; name: string; description: string }> = {};
  await Promise.all(subQsWithLens.map(async (q) => {
    try {
      const hits = await searchAnalystFrameworks({
        query: q.text,
        analyst: q.lens,
        limit: 1,
        minSimilarity: 0.25,
      });
      if (hits.length > 0) {
        frameworksBySubQ[q.id] = {
          analyst: hits[0].analyst,
          name: hits[0].name,
          description: hits[0].description,
        };
      }
    } catch (e: any) {
      console.warn(`[ResearchPlanner] Framework resolve failed for ${q.id}:`, e.message);
    }
  }));

  const toResolve = Object.entries(frameworksBySubQ);
  if (toResolve.length === 0) return { plan, cost: 0, inputTokens: 0, outputTokens: 0 };

  const batchPrompt = toResolve.map(([qId, fw]) => {
    const subQ = subQsWithLens.find(q => q.id === qId)!;
    return `SUB_Q "${qId}": "${subQ.text}"
FRAMEWORK: "${fw.name}" by ${fw.analyst}
DESCRIPTION: ${fw.description}`;
  }).join("\n\n");

  const response = await callAnthropicRaw({
    model: PLANNER_MODEL,
    max_tokens: 1500,
    system: `You convert analyst framework descriptions into procedural reasoning steps for a crypto research agent.

For each SUB_Q + FRAMEWORK pair, produce 3-5 numbered steps the agent should follow to reason USING that framework (not just cite it). Steps should be concrete and actionable — tell the agent what to calculate, compare, or evaluate at each step.

Respond with JSON: { "procedures": { "<qId>": ["step 1...", "step 2...", ...], ... } }
Only JSON, no other text.`,
    messages: [{ role: "user", content: batchPrompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const procedures: Record<string, string[]> = parsed.procedures || parsed;

      for (const [qId, steps] of Object.entries(procedures)) {
        if (!Array.isArray(steps) || !frameworksBySubQ[qId]) continue;
        const fw = frameworksBySubQ[qId];
        const sq = plan.sub_questions.find(q => q.id === qId);
        if (sq) {
          sq.resolvedFramework = {
            analyst: fw.analyst,
            name: fw.name,
            description: fw.description,
            steps: steps.map(String).slice(0, 5),
          };
        }
      }
    }
  } catch (e: any) {
    console.warn("[ResearchPlanner] Framework procedure parse failed:", e.message);
  }

  return {
    plan,
    cost: response.mppCost,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

// ─── Plan call ───────────────────────────────────────────────────────────────

export async function planResearch(
  userMessage: string,
  recentHistory: Array<{ role: string; content: string }>,
): Promise<PlanCallResult> {
  validateCatalogOnce();

  const lastAssistant = [...recentHistory].reverse().find(m => m.role === "assistant");
  const contextSnippet = lastAssistant
    ? `\n\nPrevious assistant response (first 600 chars): "${lastAssistant.content.slice(0, 600)}"`
    : "";
  const userMsg = `User prompt: """${userMessage}"""${contextSnippet}\n\nEmit the ResearchPlan JSON now.`;

  const response = await callAnthropicRaw({
    model: PLANNER_MODEL,
    max_tokens: 2000,
    system: buildPlannerSystemPrompt(),
    messages: [{ role: "user", content: userMsg }],
  });

  // Capture cost up-front so it's reported even when JSON parsing fails — the
  // model spend already happened, the caller's budget tracker needs to see it.
  const costMeta = {
    cost: response.mppCost,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    const err: any = new Error(`planner returned no JSON. Raw: ${text.slice(0, 300)}`);
    err.costMeta = costMeta;
    throw err;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    const err: any = new Error(`planner JSON parse failed: ${e.message}. Raw: ${jsonMatch[0].slice(0, 300)}`);
    err.costMeta = costMeta;
    throw err;
  }
  const plan: ResearchPlan = {
    main_question: String(parsed.main_question || userMessage).slice(0, 500),
    sub_questions: Array.isArray(parsed.sub_questions)
      ? parsed.sub_questions.map((q: any, i: number) => ({
          id: String(q.id || `q${i + 1}`),
          text: String(q.text || ""),
          types: Array.isArray(q.types) ? q.types.map(String) : (q.type ? [String(q.type)] : []),
          depends_on: Array.isArray(q.depends_on) ? q.depends_on.map(String) : [],
          suggested_tools: Array.isArray(q.suggested_tools) ? q.suggested_tools.map(String) : [],
          artifact_hint: String(q.artifact_hint || "structured_doc"),
          lens: q.lens && q.lens !== "null" ? String(q.lens) : undefined,
          status: "pending",
        }))
      : [],
    playbook_used: parsed.playbook_used && parsed.playbook_used !== "null" ? String(parsed.playbook_used) : null,
    synthesis_required: Boolean(parsed.synthesis_required),
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    planner_version: PLANNER_VERSION,
    reflection_count: 0,
  };

  // Enforce validator: if validation is fatal (cycle, zero sub-Qs that we
  // couldn't repair), throw with cost metadata so the caller can fall back to
  // unplanned execution rather than inject a broken plan.
  const validation = validatePlan(plan);
  if (validation.fatal) {
    const err: any = new Error(`planner emitted invalid plan: ${validation.warnings.join("; ")}`);
    err.costMeta = costMeta;
    throw err;
  }

  return { plan, ...costMeta };
}

export async function reflectOnPlan(
  originalPlan: ResearchPlan,
  userMessage: string,
  executionSummary: string,
): Promise<PlanCallResult> {
  const userMsg = `# Original prompt
${userMessage}

# Original plan
${JSON.stringify(originalPlan, null, 2)}

# Execution summary so far
${executionSummary}

Decide: is the plan still good? Revise if needed and emit the updated ResearchPlan JSON.`;

  const response = await callAnthropicRaw({
    model: PLANNER_MODEL,
    max_tokens: 2000,
    system: buildReflectionSystemPrompt(),
    messages: [{ role: "user", content: userMsg }],
  });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Reflection failure is non-fatal — return original plan with bumped count
    return {
      plan: { ...originalPlan, reflection_count: originalPlan.reflection_count + 1 },
      cost: response.mppCost,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const revised: ResearchPlan = {
    main_question: String(parsed.main_question || originalPlan.main_question),
    sub_questions: Array.isArray(parsed.sub_questions)
      ? parsed.sub_questions.map((q: any, i: number) => ({
          id: String(q.id || `q${i + 1}`),
          text: String(q.text || ""),
          types: Array.isArray(q.types) ? q.types.map(String) : [],
          depends_on: Array.isArray(q.depends_on) ? q.depends_on.map(String) : [],
          suggested_tools: Array.isArray(q.suggested_tools) ? q.suggested_tools.map(String) : [],
          artifact_hint: String(q.artifact_hint || "structured_doc"),
          lens: q.lens && q.lens !== "null" ? String(q.lens) : undefined,
          status: q.status || "pending",
          notes: q.notes ? String(q.notes) : undefined,
        }))
      : originalPlan.sub_questions,
    playbook_used: parsed.playbook_used && parsed.playbook_used !== "null" ? String(parsed.playbook_used) : originalPlan.playbook_used,
    synthesis_required: Boolean(parsed.synthesis_required ?? originalPlan.synthesis_required),
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : originalPlan.confidence,
    planner_version: PLANNER_VERSION,
    reflection_count: originalPlan.reflection_count + 1,
  };

  validatePlan(revised);

  return {
    plan: revised,
    cost: response.mppCost,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

// ─── Render plan as system-prompt addendum ───────────────────────────────────

export function renderPlanForSystemPrompt(plan: ResearchPlan): string {
  if (!plan.sub_questions.length) return "";

  const lines: string[] = [];
  lines.push("# RESEARCH PLAN (from planner pre-step — follow this structure)");
  lines.push(`Main question: ${plan.main_question}`);
  if (plan.playbook_used) lines.push(`Playbook: ${plan.playbook_used}`);
  lines.push(`Synthesis required: ${plan.synthesis_required ? "YES — produce a final synthesis section after sub-question outputs" : "no"}`);
  lines.push(`Planner confidence: ${plan.confidence.toFixed(2)}${plan.confidence < 0.5 ? " (LOW — treat as hint; deviate if you see a better decomposition)" : ""}`);
  lines.push("");
  lines.push("Sub-questions (answer in dependency order):");
  for (const q of plan.sub_questions) {
    const deps = q.depends_on.length ? ` [after: ${q.depends_on.join(", ")}]` : "";
    const lens = q.lens ? ` [lens: ${q.lens}]` : "";
    lines.push(`  ${q.id}. ${q.text}${deps}${lens}`);
    lines.push(`     types: ${q.types.join(", ") || "(none assigned)"}`);
    lines.push(`     suggested tools: ${q.suggested_tools.join(", ") || "(none)"}`);
    lines.push(`     artifact: ${q.artifact_hint}`);
    if (q.resolvedFramework) {
      const rf = q.resolvedFramework;
      lines.push(`     >>> PROCEDURE — Apply ${rf.analyst}'s "${rf.name}" framework (${rf.description}):`);
      rf.steps.forEach((s, i) => lines.push(`         ${i + 1}. ${s}`));
      lines.push(`     You MUST follow these steps as your reasoning scaffold for this sub-question. Structure your analysis around them — do not merely cite the framework.`);
    }
  }
  if (plan.warnings && plan.warnings.length) {
    lines.push("");
    lines.push(`Plan validator notes: ${plan.warnings.join("; ")}`);
  }
  lines.push("");
  lines.push("You may deviate from this plan if execution reveals it's wrong, but explain why in your final answer.");
  return lines.join("\n");
}
