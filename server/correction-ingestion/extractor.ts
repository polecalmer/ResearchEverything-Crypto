import { callAnthropicRaw } from "../mpp-client";
import type { ExtractedCorrection } from "./store";

const EXTRACTOR_MODEL =
  process.env.CORRECTION_EXTRACTOR_MODEL || "claude-haiku-4-5-20251001";

export interface TurnPair {
  failedAssistantContent: string;
  failedAssistantArtifactsSummary: string;
  userCorrectionContent: string;
  correctedAssistantContent: string;
  correctedAssistantArtifactsSummary: string;
}

/** Run a Haiku extraction over a (failed, correction, corrected) turn-pair.
 *  Returns 0+ structured corrections. Never throws — returns [] on any error. */
export async function extractCorrections(
  pair: TurnPair,
): Promise<{ corrections: ExtractedCorrection[]; costUsd: number }> {
  const prompt = buildPrompt(pair);
  try {
    const resp = await callAnthropicRaw({
      model: EXTRACTOR_MODEL,
      max_tokens: 800,
      system:
        "You extract structured corrections from research-session turn-pairs. Output ONLY a valid JSON array. Never include any other text.",
      messages: [{ role: "user", content: prompt }],
    });
    const costUsd = resp.mppCost || 0;
    const text = (resp.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
    const arr = parseJsonArray(text);
    const filtered = arr.filter(isValidCorrection);
    return { corrections: filtered, costUsd };
  } catch (err: any) {
    console.warn(`[CorrectionExtractor] failed: ${err.message}`);
    return { corrections: [], costUsd: 0 };
  }
}

function buildPrompt(p: TurnPair): string {
  return `Three messages from a research session. Extract structured corrections that, if remembered, would prevent the failed turn from happening again.

═══ FAILED ASSISTANT TURN ═══
${truncate(p.failedAssistantContent, 2500)}

ARTIFACTS:
${truncate(p.failedAssistantArtifactsSummary, 800)}

═══ USER CORRECTION ═══
${truncate(p.userCorrectionContent, 1500)}

═══ CORRECTED ASSISTANT TURN ═══
${truncate(p.correctedAssistantContent, 2500)}

ARTIFACTS:
${truncate(p.correctedAssistantArtifactsSummary, 800)}

═══ TASK ═══
Compare the two assistant turns to identify what specifically changed that fixed the failure. Emit a JSON array of corrections. Each item must be one of these EXACT shapes:

  { "type": "slug_alias", "tool": "<tool_name or *>", "arg": "<arg_name>", "from": "<bad_value>", "to": "<good_value>", "evidence": "<one sentence>", "confidence": 80 }
  { "type": "entity_rebrand", "old_name": "<old>", "new_name": "<new>", "token_symbol": "<SYMBOL or omit>", "evidence": "<one sentence>" }
  { "type": "source_behavior", "source": "<source_name>", "endpoint": "<endpoint or omit>", "rule": "<one-sentence behavior rule>", "evidence": "<one sentence>" }
  { "type": "fact", "entity": "<entity>", "attribute": "<attribute>", "value": "<value>", "evidence": "<one sentence>" }

RULES:
- Only emit a correction you can point to specific evidence for in the text above.
- For slug_alias: tool can be the source name ("defillama", "coingecko", "dune") — this matches every tool from that source. Use exact tool name only if the rename is tool-specific.
- For slug_alias: arg MUST be the literal argument name a tool actually accepts. Use these canonicals (do NOT invent variants):
    defillama tools  → "protocol"        (NOT protocol_slug, NOT slug)
    coingecko tools  → "coin_id"         (NOT id, NOT coin)
    dune tools       → "query_id"        (NOT id, NOT query)
    stonksonchain    → "kind" or "coin"
- For entity_rebrand: include token_symbol only if explicitly mentioned.
- Prefer the highest-leverage correction: if a slug rename caused the fix, that's more important than a downstream fact.
- Multiple corrections OK if the turn-pair shows multiple distinct fixes.
- Return [] if nothing concrete can be extracted.

Output the JSON array now. Nothing else.`;
}

function parseJsonArray(text: string): any[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isValidCorrection(x: any): x is ExtractedCorrection {
  if (!x || typeof x !== "object") return false;
  if (x.type === "slug_alias") {
    return (
      typeof x.tool === "string" &&
      typeof x.arg === "string" &&
      typeof x.from === "string" &&
      typeof x.to === "string" &&
      x.from !== x.to &&
      typeof x.evidence === "string"
    );
  }
  if (x.type === "entity_rebrand") {
    return (
      typeof x.old_name === "string" &&
      typeof x.new_name === "string" &&
      x.old_name !== x.new_name &&
      typeof x.evidence === "string"
    );
  }
  if (x.type === "source_behavior") {
    return (
      typeof x.source === "string" &&
      typeof x.rule === "string" &&
      typeof x.evidence === "string"
    );
  }
  if (x.type === "fact") {
    return (
      typeof x.entity === "string" &&
      typeof x.attribute === "string" &&
      typeof x.value === "string" &&
      typeof x.evidence === "string"
    );
  }
  return false;
}

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "…[truncated]" : s;
}

/** Build a compact text summary of an artifact array suitable for the
 *  extractor prompt — keeps the prompt small while preserving the
 *  fields that distinguish "right chart" from "wrong chart". */
export function summarizeArtifacts(artifacts: any): string {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "(none)";
  const lines: string[] = [];
  for (const a of artifacts) {
    if (!a || typeof a !== "object") continue;
    if (a.type === "chart") {
      const yKeys = (a.chartConfig?.yAxes || [])
        .map((y: any) => y?.dataKey)
        .filter(Boolean)
        .join(", ");
      const recipe = a.refreshRecipe
        ? `${a.refreshRecipe.dataSource}/${a.refreshRecipe.endpoint || a.refreshRecipe.slug || "?"}`
        : "(no recipe)";
      const dataLen = Array.isArray(a.data) ? a.data.length : 0;
      lines.push(
        `chart "${a.title || ""}" (${dataLen} rows, yKeys=[${yKeys}], recipe=${recipe})`,
      );
    } else if (a.type === "metric_cards") {
      const labels = (a.data || [])
        .map((d: any) => `${d.label}=${d.value}`)
        .join(", ");
      lines.push(`metric_cards "${a.title || ""}": ${labels}`);
    } else if (a.type === "callout") {
      lines.push(`callout "${a.title || ""}" — ${truncate(a.text || "", 200)}`);
    } else if (a.type === "table" || a.type === "inline_table") {
      const cols = (a.chartConfig?.columns || a.columns || [])
        .map((c: any) => c?.label || c?.dataKey)
        .filter(Boolean)
        .join(", ");
      lines.push(`table "${a.title || ""}" (cols=[${cols}])`);
    } else if (a.type) {
      lines.push(`${a.type} "${a.title || ""}"`);
    }
  }
  return lines.join("\n") || "(none)";
}
