import { callAnthropicServer } from "../mpp-client";
import { MODELS } from "../constants";
import { consult, observe } from "./db";
import { db } from "../db";
import { dataSourceFacts } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type BaseIntent =
  | "daily_fees"
  | "daily_revenue"
  | "daily_tvl"
  | "daily_dex_volume"
  | "daily_derivatives_volume"
  | "price_history";

export const BASE_INTENTS: BaseIntent[] = [
  "daily_fees",
  "daily_revenue",
  "daily_tvl",
  "daily_dex_volume",
  "daily_derivatives_volume",
  "price_history",
];

export interface DerivationComponent {
  name: string;
  intent: BaseIntent;
  protocol?: string;
}

export interface Derivation {
  phrase: string;
  formula: string;
  components: DerivationComponent[];
  displayLabel: string;
  format: "ratio" | "currency" | "percent" | "number";
  reasoning: string;
  confidence: "verified_doc" | "llm_proposed" | "verified_runtime";
  source: "brain_cache" | "llm";
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORMULA_RE = /^[A-Za-z0-9_+\-*/().\s]+$/;

function normalizePhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

function scopeRefFor(protocol: string, phrase: string): string {
  return `derivation:${normalizePhrase(protocol)}:${normalizePhrase(phrase)}`;
}

type AstNode =
  | { type: "num"; value: number }
  | { type: "id"; name: string }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: AstNode; right: AstNode }
  | { type: "neg"; arg: AstNode };

function parseFormula(formula: string): AstNode {
  if (!FORMULA_RE.test(formula)) {
    throw new Error(`formula contains disallowed characters: ${formula}`);
  }
  // Tokenize without the sticky `/y` flag (which requires es2018+ libs).
  // We walk the string, skipping whitespace and matching tokens at each
  // cursor position; any unmatched character is a parse error.
  const tokens: string[] = [];
  const tokenRe = /^(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|[+\-*/()])/;
  let i = 0;
  while (i < formula.length) {
    if (/\s/.test(formula[i])) { i++; continue; }
    const m = tokenRe.exec(formula.slice(i));
    if (!m) {
      throw new Error(`unparseable token in formula at offset ${i}: ${formula}`);
    }
    tokens.push(m[1]);
    i += m[1].length;
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t: string) => {
    if (tokens[pos] !== t) throw new Error(`expected '${t}', got '${tokens[pos] ?? "EOF"}'`);
    pos++;
  };
  function parseExpr(): AstNode {
    let left = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[pos++] as "+" | "-";
      const right = parseTerm();
      left = { type: "bin", op, left, right };
    }
    return left;
  }
  function parseTerm(): AstNode {
    let left = parseUnary();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[pos++] as "*" | "/";
      const right = parseUnary();
      left = { type: "bin", op, left, right };
    }
    return left;
  }
  function parseUnary(): AstNode {
    if (peek() === "-") {
      pos++;
      return { type: "neg", arg: parseUnary() };
    }
    if (peek() === "+") { pos++; return parseUnary(); }
    return parseAtom();
  }
  function parseAtom(): AstNode {
    const t = peek();
    if (t === "(") {
      eat("(");
      const inner = parseExpr();
      eat(")");
      return inner;
    }
    if (t === undefined) throw new Error("unexpected end of formula");
    if (/^\d/.test(t)) { pos++; return { type: "num", value: parseFloat(t) }; }
    if (NAME_RE.test(t)) { pos++; return { type: "id", name: t }; }
    throw new Error(`unexpected token '${t}' in formula`);
  }
  const ast = parseExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens after parse: ${tokens.slice(pos).join(" ")}`);
  return ast;
}

export function evalFormula(ast: AstNode, env: Record<string, number>): number {
  switch (ast.type) {
    case "num": return ast.value;
    case "id": {
      const v = env[ast.name];
      if (v === undefined) throw new Error(`unbound identifier '${ast.name}'`);
      return v;
    }
    case "neg": return -evalFormula(ast.arg, env);
    case "bin": {
      const l = evalFormula(ast.left, env);
      const r = evalFormula(ast.right, env);
      switch (ast.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? NaN : l / r;
      }
    }
  }
}

export function compileFormula(formula: string): (env: Record<string, number>) => number {
  const ast = parseFormula(formula);
  return (env) => evalFormula(ast, env);
}

function validateDerivation(parsed: any, phrase: string): Derivation | null {
  if (!parsed || typeof parsed !== "object") return null;
  const formula = parsed.formula;
  const components = parsed.components;
  const displayLabel = parsed.displayLabel ?? parsed.display_label;
  const format = parsed.format;
  const reasoning = parsed.reasoning ?? "";
  if (typeof formula !== "string" || !formula.trim()) return null;
  if (!Array.isArray(components) || components.length === 0 || components.length > 6) return null;
  if (typeof displayLabel !== "string" || !displayLabel.trim()) return null;
  if (!["ratio", "currency", "percent", "number"].includes(format)) return null;

  const seen = new Set<string>();
  const cleanComponents: DerivationComponent[] = [];
  for (const c of components) {
    if (!c || typeof c !== "object") return null;
    const name = c.name;
    const intent = c.intent;
    const protocol = c.protocol;
    if (typeof name !== "string" || !NAME_RE.test(name)) return null;
    if (seen.has(name)) return null;
    seen.add(name);
    if (!BASE_INTENTS.includes(intent)) return null;
    if (protocol !== undefined && (typeof protocol !== "string" || !protocol.trim())) return null;
    cleanComponents.push({ name, intent, protocol: protocol?.trim() });
  }

  let compiled: (env: Record<string, number>) => number;
  try {
    compiled = compileFormula(formula);
  } catch {
    return null;
  }
  // Probe: ensure formula references only declared component names.
  try {
    const env: Record<string, number> = {};
    for (const c of cleanComponents) env[c.name] = 1;
    const probe = compiled(env);
    if (!Number.isFinite(probe) && probe !== 0 && !Number.isNaN(probe)) return null;
  } catch {
    return null;
  }

  return {
    phrase,
    formula,
    components: cleanComponents,
    displayLabel,
    format,
    reasoning,
    confidence: "llm_proposed",
    source: "llm",
  };
}

const SYSTEM_PROMPT = `You translate a free-form crypto research metric into a formula over a small set of base time-series intents available in the data brain.

Available intents (ONLY these — anything else is invalid):
- daily_fees: gross daily fees paid by users (USD)
- daily_revenue: portion of fees retained by the protocol (USD)
- daily_tvl: total value locked in the protocol (USD)
- daily_dex_volume: spot DEX volume (USD)
- daily_derivatives_volume: perp/derivatives notional volume (USD)
- price_history: token spot price (USD)

Output STRICT JSON, no prose, no markdown, this exact shape:
{
  "formula": "<arithmetic over component names, ops: + - * / and parens only>",
  "components": [{"name": "<identifier>", "intent": "<one of the intents>", "protocol": "<optional override slug>"}],
  "displayLabel": "<short human label, may include the formula in plain words>",
  "format": "ratio" | "currency" | "percent" | "number",
  "reasoning": "<one sentence justifying the decomposition for this protocol>"
}

Rules:
- Component names must be valid identifiers (letters, digits, underscore; no leading digit) and unique.
- The formula must reference ONLY those component names plus numeric constants.
- If the metric is genuinely impossible to express over these intents, output the literal string: NO_DERIVATION
- Pick the closest reasonable proxy; explain the proxy in reasoning. Examples:
  * "NIM (net interest margin) for a lending protocol" ≈ daily_fees / daily_tvl × 365 → format "percent"
  * "PE ratio" ≈ market_cap / (daily_revenue × 365) — but market_cap isn't a base intent here; use price × supply only if the user separately provides supply. Otherwise output NO_DERIVATION.
  * "Take rate" ≈ daily_revenue / daily_fees → format "ratio"
  * "Capital efficiency" ≈ daily_dex_volume / daily_tvl → format "ratio"
  * "Annualized fee yield" ≈ daily_fees × 365 / daily_tvl → format "percent"
- Prefer fewer components. Only add cross-protocol components when the user's phrasing requires it.
- If protocol context implies a default slug (e.g. user said "Maple"), omit the per-component "protocol" field.
- format "percent" means the numeric value is shown as a percentage (multiply by 100 in display); the FORMULA itself returns a decimal (e.g. 0.04 for 4%).`;

export async function decomposeMetric(input: {
  userMessage: string;
  protocol: string;
  ticker?: string;
  denominator?: { protocol: string; metric: "volume" | "fees" | "revenue" };
}): Promise<Derivation | null> {
  const phrase = input.userMessage.trim().slice(0, 500);
  const scopeRef = scopeRefFor(input.protocol, phrase);

  // 1a. Deterministic cache lookup by exact scope_ref. This is the canonical
  // path: we know the key, we want O(1) hit-or-miss, no semantic ranking. The
  // semantic consult below is only a fallback for slight phrase variations
  // (e.g. "Maple NIM" vs "Net interest margin for Maple") that hash to
  // different scope_refs but should reuse the same derivation.
  try {
    const rows = await db
      .select()
      .from(dataSourceFacts)
      .where(and(eq(dataSourceFacts.scopeRef, scopeRef), eq(dataSourceFacts.category, "definition")))
      .limit(1);
    if (rows.length > 0) {
      const f = rows[0];
      const cached = tryParseCachedDerivation(f.content);
      if (cached) {
        return { ...cached, phrase, source: "brain_cache", confidence: (f.confidence === "verified_doc" || f.confidence === "verified_runtime") ? f.confidence : "llm_proposed" };
      }
    }
  } catch (err: any) {
    console.warn(`[MetricDecomposer] direct cache lookup failed: ${err.message}`);
  }

  // 1b. Semantic fallback — handles paraphrases that don't normalize to the
  // same scope_ref. We still verify the returned facts parse to a valid
  // derivation; if not, we fall through to the LLM.
  try {
    const facts = await consult({
      query: `derivation for ${phrase} on ${input.protocol}`,
      category: "definition",
      topK: 5,
    });
    for (const r of facts) {
      const f = r.fact;
      if (!f.scopeRef.startsWith(`derivation:${normalizePhrase(input.protocol)}:`)) continue;
      const cached = tryParseCachedDerivation(f.content);
      if (cached) {
        return { ...cached, phrase, source: "brain_cache", confidence: (f.confidence === "verified_doc" || f.confidence === "verified_runtime") ? f.confidence : "llm_proposed" };
      }
    }
  } catch (err: any) {
    console.warn(`[MetricDecomposer] brain consult failed: ${err.message}`);
  }

  // 2. LLM call.
  const userPayload = {
    user_message: input.userMessage,
    protocol: input.protocol,
    ticker: input.ticker ?? null,
    denominator: input.denominator ?? null,
  };

  let raw = "";
  try {
    const response = await callAnthropicServer({
      model: MODELS.HAIKU,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(userPayload) }],
    });
    raw = (response.text || "").trim();
  } catch (err: any) {
    console.warn(`[MetricDecomposer] LLM call failed: ${err.message}`);
    return null;
  }

  if (raw === "NO_DERIVATION" || /^NO_DERIVATION\b/i.test(raw)) {
    console.log(`[MetricDecomposer] LLM declined to derive "${phrase}" for ${input.protocol}`);
    return null;
  }

  const parsed = tryParseJson(raw);
  if (!parsed) {
    console.warn(`[MetricDecomposer] LLM output was not valid JSON for "${phrase}": ${raw.slice(0, 200)}`);
    return null;
  }
  const derivation = validateDerivation(parsed, phrase);
  if (!derivation) {
    console.warn(`[MetricDecomposer] LLM derivation failed validation for "${phrase}": ${raw.slice(0, 300)}`);
    return null;
  }
  return derivation;
}

export async function cacheDerivation(d: Derivation, protocol: string): Promise<void> {
  try {
    const scopeRef = scopeRefFor(protocol, d.phrase);
    const payload = JSON.stringify({
      formula: d.formula,
      components: d.components,
      displayLabel: d.displayLabel,
      format: d.format,
      reasoning: d.reasoning,
    });
    const content =
      `Derivation for "${d.phrase}" on ${protocol}: ${d.displayLabel}. ` +
      `Formula: ${d.formula}. Reasoning: ${d.reasoning} ` +
      `JSON: ${payload}`;
    // NOTE: cached derivations carry source="defillama" because the base
    // intents they compose primarily resolve to defillama. The actual cache
    // key is scope_ref, not source — the enum just needs to be valid.
    await observe({
      source: "defillama",
      scope_ref: scopeRef,
      category: "definition",
      content,
      confidence: d.confidence === "verified_doc" ? "verified_doc" : "observed_once",
      source_of_fact: "metric-decomposer:llm",
    });
  } catch (err: any) {
    console.warn(`[MetricDecomposer] cacheDerivation failed: ${err.message}`);
  }
}

function tryParseJson(s: string): any {
  // Strip markdown fences if model added them.
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : s;
  try {
    return JSON.parse(body.trim());
  } catch {
    // Try to extract the first {...} block.
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function tryParseCachedDerivation(content: string): Derivation | null {
  const idx = content.indexOf("JSON: ");
  if (idx < 0) return null;
  const tail = content.slice(idx + "JSON: ".length).trim();
  const parsed = tryParseJson(tail);
  if (!parsed) return null;
  return validateDerivation(parsed, "");
}
