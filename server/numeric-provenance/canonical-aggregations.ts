/**
 * Canonical aggregation rules: explicit "for entity X, metric Y
 * requires combining sources A+B+C" knowledge.
 *
 * Example: "Hyperliquid LTM Gross Fees" requires DefiLlama (perp +
 * spot DEX fees) PLUS StonksOnChain (HIP-3 external market fees).
 * DefiLlama alone undercounts because it doesn't capture HIP-3
 * deployer-routed fees. Without this rule, the agent fetches one
 * source, gets a "complete-looking" series, and computes a
 * confidently wrong LTM total.
 *
 * Surfaced in three places:
 *   1. System prompt at preflight — agent picks the right sources
 *      from the start.
 *   2. Tool-result hint when the agent calls a partial source for a
 *      canonical-rule metric — caught at fetch moment.
 *   3. Strict-pass validator: when a compute() result name matches a
 *      rule, all required source patterns must appear in the
 *      provenance trail.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export interface RequiredSource {
  source_label_pattern: string; // matched against compute()'s source_label (substring or regex)
  role: string;                 // human label, e.g. "perp_and_spot_dex_fees"
  required: boolean;
  notes?: string;
}

export interface CanonicalRule {
  id: string;
  entity: string;               // 'hyperliquid', 'maple', '*'
  metricName: string;           // 'ltm_gross_fees', etc.
  description: string;
  requiredSources: RequiredSource[];
  aggregationMethod: "sum" | "sum_with_dedup" | "weighted_avg" | "latest_of_max" | string;
  notes?: string;
  source: string;
  confidence: number;
}

/** Pull all active canonical rules. v1 set is small (1-3 rules); we
 *  keep this in-memory after first read for the lifetime of the request. */
async function loadAllActive(): Promise<CanonicalRule[]> {
  try {
    const rows = await db.execute(sql`
      SELECT id, entity, metric_name, description, required_sources,
             aggregation_method, notes, source, confidence
      FROM canonical_aggregations
      WHERE is_active = true
      ORDER BY entity, metric_name
    `);
    const raw: any[] = (rows as any).rows ?? rows;
    return raw.map((r) => ({
      id: r.id,
      entity: String(r.entity),
      metricName: String(r.metric_name),
      description: String(r.description),
      requiredSources: Array.isArray(r.required_sources) ? r.required_sources : [],
      aggregationMethod: String(r.aggregation_method || "sum"),
      notes: r.notes || undefined,
      source: String(r.source || "seed"),
      confidence: Number(r.confidence || 80),
    }));
  } catch (err: any) {
    console.warn(`[CanonicalAggregations] load failed: ${err.message}`);
    return [];
  }
}

let _cachedRules: { at: number; rules: CanonicalRule[] } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getRules(): Promise<CanonicalRule[]> {
  const now = Date.now();
  if (_cachedRules && now - _cachedRules.at < CACHE_TTL_MS) return _cachedRules.rules;
  const rules = await loadAllActive();
  _cachedRules = { at: now, rules };
  return rules;
}

/** Filter rules relevant to the user's question. */
export function pickRelevantRules(
  all: CanonicalRule[],
  userMessage: string,
  resolvedEntities: string[],
): CanonicalRule[] {
  const msg = userMessage.toLowerCase();
  const ents = new Set(resolvedEntities.map((e) => e.toLowerCase()));
  return all.filter((r) => {
    if (r.entity === "*") return true;
    if (ents.has(r.entity.toLowerCase())) return true;
    if (msg.includes(r.entity.toLowerCase())) return true;
    return false;
  });
}

/** Build a system-prompt section listing canonical aggregation rules
 *  for the entities in scope. Empty when nothing matches. */
export async function buildCanonicalContext(
  userMessage: string,
  resolvedEntities: string[],
): Promise<string> {
  const all = await getRules();
  const relevant = pickRelevantRules(all, userMessage, resolvedEntities);
  if (relevant.length === 0) return "";

  const lines: string[] = [];
  lines.push("CANONICAL METRIC SOURCES (must follow):");
  lines.push("");
  lines.push("For each metric below, use the FOUNDATIONAL SOURCE as the single source of truth for the headline number. Optional NUANCE sources are advisory only — never sum or combine them into the headline. Multi-source composition causes double-counting; one foundational source is the safer pattern.");
  lines.push("");
  for (const r of relevant) {
    lines.push(`• ${r.entity} / ${r.metricName} — ${r.description}`);
    const foundational = r.requiredSources.filter((s) => s.required);
    const nuance = r.requiredSources.filter((s) => !s.required);
    if (foundational.length > 0) {
      lines.push(`    FOUNDATIONAL SOURCE${foundational.length > 1 ? "S" : ""} (use for the headline number):`);
      for (const s of foundational) {
        const noteStr = s.notes ? ` — ${s.notes}` : "";
        lines.push(`      → ${s.source_label_pattern}  (role: ${s.role})${noteStr}`);
      }
    }
    if (nuance.length > 0) {
      lines.push(`    OPTIONAL NUANCE source${nuance.length > 1 ? "s" : ""} (advisory only, do NOT add to headline):`);
      for (const s of nuance) {
        const noteStr = s.notes ? ` — ${s.notes}` : "";
        lines.push(`      ◦ ${s.source_label_pattern}  (role: ${s.role})${noteStr}`);
      }
    }
    if (r.notes) lines.push(`    notes: ${r.notes}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** When the agent calls a tool whose source matches a canonical rule's
 *  REQUIRED list, return a hint listing the OTHER required sources for
 *  the same metric. Surfaced inline with the tool result so the agent
 *  sees it at the fetch moment, not just in the system prompt.
 *
 *  The hint says: "you're fetching one of the required sources for
 *  metric X. The other required sources are: ...". */
export async function buildFetchHintForTool(
  toolName: string,
  toolInput: any,
  resolvedEntities: string[],
): Promise<string> {
  const all = await getRules();
  if (all.length === 0) return "";

  // Heuristic match: derive a coarse source-label from the tool name
  // and see if any rule's required_sources includes a pattern that
  // matches it.
  const sourceLabel = `${toolName}:${stringifyInputArgs(toolInput)}`.toLowerCase();
  const ents = new Set(resolvedEntities.map((e) => e.toLowerCase()));

  const hints: string[] = [];
  for (const r of all) {
    if (r.entity !== "*" && !ents.has(r.entity.toLowerCase())) {
      // Also try matching entity to tool input value
      const inputStr = JSON.stringify(toolInput).toLowerCase();
      if (!inputStr.includes(r.entity.toLowerCase())) continue;
    }
    const matched = r.requiredSources.find((s) =>
      sourceLabel.includes(s.source_label_pattern.toLowerCase()) ||
      s.source_label_pattern.toLowerCase().includes(toolName.toLowerCase()),
    );
    if (!matched) continue;
    // Only hint about additional REQUIRED sources. Optional nuance
    // sources are advisory only — surfacing them as "you also need"
    // would push the agent toward double-counting (the exact failure
    // mode the foundational-source pattern exists to prevent).
    const additionalRequired = r.requiredSources.filter((s) => s !== matched && s.required);
    if (matched.required && additionalRequired.length === 0) {
      // This tool IS the foundational source AND there's nothing else
      // required. Confirm to the agent: use this one source. Don't go
      // hunting for "extra" sources to combine.
      hints.push(
        `For ${r.entity}/${r.metricName}, this tool IS the foundational source. Use it as the single source of truth — do NOT fetch additional sources to "complete" the picture; that would double-count.`,
      );
      continue;
    }
    if (additionalRequired.length > 0) {
      const otherList = additionalRequired
        .map((o) => `${o.source_label_pattern} (${o.role}${o.notes ? `: ${o.notes}` : ""})`)
        .join("; ");
      hints.push(
        `For ${r.entity}/${r.metricName}, this tool covers ${matched.role}. You ALSO need: ${otherList}. Combine via ${r.aggregationMethod} before computing.`,
      );
    }
  }
  return hints.join("\n");
}

function stringifyInputArgs(input: any): string {
  if (!input || typeof input !== "object") return "";
  try {
    return Object.values(input).filter((v) => typeof v === "string").join(" ").toLowerCase();
  } catch {
    return "";
  }
}

/** Coverage check for the strict-pass validator: walks compute() records
 *  in the turn cache, finds any whose name matches a canonical rule's
 *  metric, and verifies all required source patterns appear in the
 *  union of source_labels across compute() calls. Returns missing
 *  sources per offending compute() result. */
export interface CoverageIssue {
  computeName: string;
  ruleEntity: string;
  ruleMetric: string;
  missingSources: RequiredSource[];
  observedSources: string[];
}

export async function checkCoverage(
  turnId: string,
): Promise<{ checks: number; issues: CoverageIssue[] }> {
  const { getTurn } = await import("./turn-cache");
  const turn = getTurn(turnId);
  if (!turn) return { checks: 0, issues: [] };
  const all = await getRules();
  if (all.length === 0) return { checks: 0, issues: [] };

  const observedSourceLabels = new Set<string>(
    turn.computes.map((c) => c.sourceLabel.toLowerCase()),
  );
  // Also count tool-result tool names as "observed" — sometimes the
  // agent fetches a source and then forgets to compute() on it; we want
  // coverage to credit the fetch.
  for (const t of turn.toolResults) {
    observedSourceLabels.add(t.toolName.toLowerCase());
  }

  const issues: CoverageIssue[] = [];
  let checks = 0;
  for (const c of turn.computes) {
    for (const r of all) {
      if (!matchesRuleMetric(c.name, r)) continue;
      checks++;
      const missing: RequiredSource[] = [];
      for (const req of r.requiredSources) {
        if (!req.required) continue;
        const pat = req.source_label_pattern.toLowerCase();
        const hit = Array.from(observedSourceLabels).some((s) => s.includes(pat) || pat.includes(s));
        if (!hit) missing.push(req);
      }
      if (missing.length > 0) {
        issues.push({
          computeName: c.name,
          ruleEntity: r.entity,
          ruleMetric: r.metricName,
          missingSources: missing,
          observedSources: Array.from(observedSourceLabels),
        });
      }
    }
  }
  return { checks, issues };
}

function matchesRuleMetric(computeName: string, rule: CanonicalRule): boolean {
  const cn = computeName.toLowerCase();
  const rn = rule.metricName.toLowerCase().replace(/_/g, " ");
  // Match either the underscore form or the spaced form.
  return cn.includes(rn) || cn.includes(rule.metricName.toLowerCase());
}

export function summarizeCoverageReport(report: { issues: CoverageIssue[] }): string {
  if (report.issues.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `${report.issues.length} compute() result${report.issues.length === 1 ? "" : "s"} matched a canonical aggregation rule but missing required sources:`,
  );
  for (const i of report.issues) {
    lines.push(`  • "${i.computeName}" (rule: ${i.ruleEntity}/${i.ruleMetric})`);
    for (const m of i.missingSources) {
      lines.push(`      missing: ${m.source_label_pattern} (${m.role}${m.notes ? ` — ${m.notes}` : ""})`);
    }
  }
  return lines.join("\n");
}
