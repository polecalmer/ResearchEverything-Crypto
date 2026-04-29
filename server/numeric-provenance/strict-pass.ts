/**
 * Strict-mode provenance enforcement: reject + retry + redact.
 *
 * Soft warning is a bandaid. The agent will skip compute() when given
 * the chance. The structural fix is:
 *
 *   1. Validate. Any unprovenanced number → fail.
 *   2. Reject + retry once. The retry call gets a system addendum
 *      listing the offending numbers and their context, plus the
 *      agent's prior response. Tools (including compute()) remain
 *      available so the agent can fix by computing.
 *   3. Re-validate the retry. If clean → ship.
 *   4. If STILL unmatched → REDACT each offending number in prose
 *      with [unverified] markers. The user literally cannot read
 *      the wrong number. Plus prepend a hard error callout.
 *
 * This mirrors chart-validator's three-step contract. The agent has
 * one bounded chance to fix; failures are made visibly broken in
 * output rather than silently shipped with a warning.
 */

import { callAnthropicRaw } from "../mpp-client";
import {
  checkProvenance,
  extractProseNumbers,
  type ProvenanceReport,
  type ProseNumber,
} from "./provenance-validator";
import {
  checkCrossSource,
  type CrossSourceReport,
} from "./cross-source";
import {
  checkCoverage,
  summarizeCoverageReport,
  type CoverageIssue,
} from "./canonical-aggregations";

export interface StrictPassResult {
  finalText: string;
  retried: boolean;
  redacted: boolean;
  retryCost: number;
  retryInputTokens: number;
  retryOutputTokens: number;
  initialReport: ProvenanceReport;
  finalReport: ProvenanceReport;
  crossSourceReport: CrossSourceReport;
  coverageIssues: CoverageIssue[];
  errorInjected: boolean;
  // Error callout to prepend to BOTH content AND artifacts array
  // (caller handles the splice). Keeps the parser's positional
  // artifact-to-content mapping intact. null when no error.
  errorCalloutArtifact: { type: "callout"; variant: string; title: string; text: string } | null;
}

export interface StrictPassInput {
  finalText: string;
  turnId: string;
  // Conversation context to use in retry. Identical to what the agent had.
  systemPrompt: string;
  messages: Array<{ role: string; content: any }>;
  anthropicTools: any[];
  model: string;
  maxTokens: number;
}

const STRICT_FAIL_RATIO_FATAL = 0.30; // >30% unmatched on second pass = "do not use" warning

export async function runStrictProvenancePass(
  input: StrictPassInput,
): Promise<StrictPassResult> {
  const initialReport = checkProvenance(input.finalText, input.turnId);
  const crossSourceReport = await checkCrossSource(input.turnId);
  const coverageReport = await checkCoverage(input.turnId);

  let finalText = input.finalText;
  let retried = false;
  let redacted = false;
  let retryCost = 0;
  let retryInputTokens = 0;
  let retryOutputTokens = 0;
  let errorInjected = false;
  let finalReport = initialReport;
  let finalCoverage = coverageReport.issues;

  const needsRetry =
    initialReport.unmatched.length > 0 ||
    crossSourceReport.issues.length > 0 ||
    coverageReport.issues.length > 0;

  if (needsRetry) {
    retried = true;
    const addendum = buildRetryAddendum(initialReport, crossSourceReport, coverageReport.issues);
    try {
      // Retry is single-shot (no tool loop). We deliberately omit tools
      // to force the agent to fix by either removing offending numbers
      // or citing values already present in the conversation context
      // (compute() results, tool readouts). If we passed tools the agent
      // could issue tool_use blocks that would have no continuation,
      // producing the "I need to fetch..." collapse we observed.
      const retryResp = await callAnthropicRaw({
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.systemPrompt + "\n\n" + addendum,
        messages: [
          ...input.messages,
          {
            role: "assistant",
            content: [{ type: "text", text: input.finalText }],
          },
          {
            role: "user",
            content: buildRetryUserMessage(initialReport, crossSourceReport, coverageReport.issues),
          },
        ],
      });
      retryCost = retryResp.mppCost || 0;
      retryInputTokens = retryResp.usage?.input_tokens || 0;
      retryOutputTokens = retryResp.usage?.output_tokens || 0;
      const retryText = (retryResp.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      // Retry guards. Three failure modes the retry can introduce that
      // are worse than the original:
      //   (1) Collapse — agent responds with a meta-statement instead of
      //       a full re-emission ("I need to fetch the missing sources").
      //   (2) Quality regression — retry rephrases prose and ends up
      //       with MORE unmatched numbers than the original (rephrasing
      //       creates new numbers without compute() backing).
      //   (3) Empty / near-empty.
      // In all three cases roll back to original + redact.
      const origLen = input.finalText.trim().length;
      const retryLen = retryText.trim().length;
      const retryReport = checkProvenance(retryText, input.turnId);
      const isCollapse =
        retryLen < Math.max(500, origLen * 0.5) ||
        retryReport.totalNumbers < initialReport.matched / 2;
      const isRegression = retryReport.unmatched.length > initialReport.unmatched.length;
      if (isCollapse) {
        console.warn(
          `[NumericProvenance] retry collapse detected (retryLen=${retryLen}, origLen=${origLen}, retryNumbers=${retryReport.totalNumbers}, origMatched=${initialReport.matched}) — rolling back to original + applying redaction`,
        );
      } else if (isRegression) {
        console.warn(
          `[NumericProvenance] retry regressed (retry unmatched=${retryReport.unmatched.length} > initial unmatched=${initialReport.unmatched.length}) — rolling back to original + applying redaction`,
        );
      } else if (retryLen > 100 && !isCollapse && !isRegression) {
        finalText = retryText;
        // Re-check on the new text. The retry can call compute() so the
        // turn cache may have grown; checkProvenance + checkCoverage
        // re-read it fresh.
        finalReport = retryReport;
        const coverageRetry = await checkCoverage(input.turnId);
        finalCoverage = coverageRetry.issues;
        console.log(
          `[NumericProvenance] retry accepted (unmatched ${initialReport.unmatched.length} → ${retryReport.unmatched.length})`,
        );
      } else {
        console.warn(
          `[NumericProvenance] retry returned empty text — keeping original + redaction`,
        );
      }
    } catch (err: any) {
      console.warn(
        `[NumericProvenance] retry threw: ${err.message} — keeping original + redaction`,
      );
    }
  }

  // After retry, if there are STILL unmatched numbers, redact them.
  // The user sees [unverified] in place of the bad number. Strong
  // visible signal that enforcement fired and the agent failed it.
  let errorCalloutArtifact: StrictPassResult["errorCalloutArtifact"] = null;
  if (finalReport.unmatched.length > 0) {
    redacted = true;
    finalText = redactUnmatchedNumbers(finalText, finalReport.unmatched.map((u) => u.number));
    const ratio = finalReport.totalNumbers > 0
      ? finalReport.unmatched.length / finalReport.totalNumbers
      : 0;
    const fatal = ratio >= STRICT_FAIL_RATIO_FATAL;
    const built = buildErrorCalloutObject(finalReport, crossSourceReport, finalCoverage, fatal);
    finalText = renderCalloutCodeBlock(built) + "\n\n" + finalText;
    errorCalloutArtifact = built;
    errorInjected = true;
  } else if (crossSourceReport.issues.length > 0 || finalCoverage.length > 0) {
    // Cross-source delta or coverage gap after retry — surface as hard
    // callout but no redaction (we don't know which prose mention is
    // "the" wrong one when the delta is the issue).
    const built = buildErrorCalloutObject(finalReport, crossSourceReport, finalCoverage, false);
    finalText = renderCalloutCodeBlock(built) + "\n\n" + finalText;
    errorCalloutArtifact = built;
    errorInjected = true;
  }

  return {
    finalText,
    retried,
    redacted,
    retryCost,
    retryInputTokens,
    retryOutputTokens,
    initialReport,
    finalReport,
    crossSourceReport,
    coverageIssues: finalCoverage,
    errorInjected,
    errorCalloutArtifact,
  };
}

/* ───────────────────── helpers ───────────────────── */

function buildRetryAddendum(
  prov: ProvenanceReport,
  xs: CrossSourceReport,
  coverage: CoverageIssue[],
): string {
  const lines: string[] = [];
  lines.push("PROVENANCE FAILURE — YOUR PRIOR RESPONSE WAS REJECTED.");
  lines.push("");
  if (prov.unmatched.length > 0) {
    lines.push(
      `${prov.unmatched.length} number${prov.unmatched.length === 1 ? "" : "s"} in your response could not be traced to either a compute() call or a tool result. These are exactly the kind of hallucinations that have ruined past memos.`,
    );
    lines.push("");
    lines.push("OFFENDING NUMBERS:");
    for (const issue of prov.unmatched.slice(0, 12)) {
      const closest = issue.candidates[0];
      const closestStr = closest
        ? `  (closest available value: ${closest.value} from ${closest.from})`
        : "";
      lines.push(`  • "${issue.number.raw}" in: …${issue.number.context}…${closestStr}`);
    }
    if (prov.unmatched.length > 12) lines.push(`  • …and ${prov.unmatched.length - 12} more.`);
    lines.push("");
  }
  if (xs.issues.length > 0) {
    lines.push(`${xs.issues.length} canonical metric${xs.issues.length === 1 ? "" : "s"} disagree with the source's own pre-aggregated value:`);
    for (const i of xs.issues) {
      lines.push(`  • "${i.metric}": you said ${i.agentValueStr}, ${i.source} says ${i.expectedValueStr} (${i.deltaPct.toFixed(1)}% delta).`);
    }
    lines.push("");
  }
  if (coverage.length > 0) {
    lines.push("COVERAGE GAPS — these compute() calls used incomplete sources:");
    for (const i of coverage) {
      lines.push(`  • "${i.computeName}" (canonical rule: ${i.ruleEntity}/${i.ruleMetric}) is missing required sources:`);
      for (const m of i.missingSources) {
        lines.push(`      - ${m.source_label_pattern} (${m.role}${m.notes ? ` — ${m.notes}` : ""})`);
      }
    }
    lines.push("");
    lines.push("To fix coverage gaps: fetch the missing source(s), compute() each, sum/combine per the canonical rule's aggregation method, and use the combined result.");
    lines.push("");
  }
  lines.push("REQUIRED ACTION:");
  lines.push("Re-emit the FULL response. For each offending number, either:");
  lines.push("  (a) Call compute() to derive the value with proper formula + source data, then use the returned value_str verbatim, OR");
  lines.push("  (b) Cite a labeled summary field directly from a tool (e.g. defillama summary.total30d), OR");
  lines.push("  (c) Remove the number from your response entirely.");
  lines.push("For coverage gaps, fetch the missing sources first, then re-compute.");
  lines.push("");
  lines.push("Do NOT estimate, guess, or do mental arithmetic on long data lists. The validator will run again on your re-emission and any remaining unprovenanced numbers will be REDACTED from the user-visible output.");
  return lines.join("\n");
}

function buildRetryUserMessage(
  prov: ProvenanceReport,
  xs: CrossSourceReport,
  coverage: CoverageIssue[],
): string {
  const counts: string[] = [];
  if (prov.unmatched.length > 0) counts.push(`${prov.unmatched.length} unprovenanced number${prov.unmatched.length === 1 ? "" : "s"}`);
  if (xs.issues.length > 0) counts.push(`${xs.issues.length} cross-source mismatch${xs.issues.length === 1 ? "" : "es"}`);
  if (coverage.length > 0) counts.push(`${coverage.length} canonical-coverage gap${coverage.length === 1 ? "" : "s"}`);
  return [
    `Your previous response was rejected by the numeric-provenance validator (${counts.join(" + ")}). See system addendum for the specific issues.`,
    "",
    "CRITICAL INSTRUCTIONS for this retry:",
    "  • You have NO tools available in this turn. Fix the offending numbers by either:",
    "    (a) Replacing them with values that ARE present in your prior compute() results or tool readouts (visible in the conversation above), OR",
    "    (b) Removing them from prose entirely (don't replace with a guess), OR",
    "    (c) Replacing them with a labeled summary-field value you already cited (e.g. 'fees30d $X.XM' → use that as the basis for ARR).",
    "  • Re-emit the COMPLETE response. Reproduce ALL artifact:* code blocks verbatim from your prior response. Reproduce ALL prose sections.",
    "  • Do NOT respond with a meta-statement like 'I need to fetch X' or 'Let me re-compute Y'. A short response will be REJECTED and your original (with redactions) will ship instead. The retry must be a full memo.",
    "  • Length: your re-emission must be at least as long as your original response. Anything substantially shorter triggers automatic rollback.",
  ].join("\n");
}

function buildErrorCalloutObject(
  prov: ProvenanceReport,
  xs: CrossSourceReport,
  coverage: CoverageIssue[],
  fatal: boolean,
): { type: "callout"; variant: string; title: string; text: string } {
  const block = buildErrorCalloutInner(prov, xs, coverage, fatal);
  return {
    type: "callout",
    variant: "catch",
    title: fatal ? "DO NOT USE — DATA INTEGRITY FAILURE" : "DATA INTEGRITY ERROR — numbers redacted",
    text: block,
  };
}

function renderCalloutCodeBlock(c: { variant: string; title: string; text: string }): string {
  return [
    "```artifact:callout",
    JSON.stringify({ variant: c.variant, title: c.title, text: c.text }, null, 2),
    "```",
  ].join("\n");
}

function buildErrorCalloutInner(
  prov: ProvenanceReport,
  xs: CrossSourceReport,
  coverage: CoverageIssue[],
  fatal: boolean,
): string {
  const blocks: string[] = [];
  if (prov.unmatched.length > 0) {
    blocks.push(
      `${prov.unmatched.length} prose number${prov.unmatched.length === 1 ? " has" : "s have"} been REDACTED below ([unverified]) because they could not be traced to a compute() call or a tool result, even after one retry. The agent failed to ground these numbers in any data source. Treat the rest of the response with caution; this is the same hallucination class that has produced wrong financial statements before.`,
    );
  }
  if (xs.issues.length > 0) {
    const lines: string[] = [`${xs.issues.length} canonical metric${xs.issues.length === 1 ? "" : "s"} disagree with the source's own pre-aggregated value:`];
    for (const i of xs.issues) {
      lines.push(`  • "${i.metric}": agent said ${i.agentValueStr}, ${i.source} says ${i.expectedValueStr} (${i.deltaPct.toFixed(1)}% delta).`);
    }
    blocks.push(lines.join("\n"));
  }
  if (coverage.length > 0) {
    const cov = summarizeCoverageReport({ issues: coverage });
    if (cov) blocks.push(cov + "\n\nThese results were computed from incomplete source data. The numbers may be substantially undercounted (or overcounted) versus reality.");
  }
  if (fatal) {
    blocks.push(
      `More than ${Math.round(STRICT_FAIL_RATIO_FATAL * 100)}% of numbers in this response failed the provenance check. The synthesis is structurally untrustworthy. Re-run the prompt or rephrase before relying on any figure here.`,
    );
  }
  return blocks.join("\n\n");
}

/** Replace each unmatched number's literal token in prose with
 *  "[unverified]". Walks unique ranges in reverse order so indices
 *  stay stable. */
function redactUnmatchedNumbers(text: string, numbers: ProseNumber[]): string {
  // Re-extract from the (possibly retry-modified) text — index in the
  // ProseNumber refers to the ORIGINAL text, which may not match if
  // the retry changed things. Re-find each raw token in the current text.
  let out = text;
  const seen = new Set<string>();
  for (const n of numbers) {
    if (seen.has(n.raw)) continue;
    seen.add(n.raw);
    // Escape regex metachars in the raw token.
    const escaped = n.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "g");
    out = out.replace(re, `[unverified ${n.format}]`);
  }
  return out;
}
