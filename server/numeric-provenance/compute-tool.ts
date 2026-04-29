/**
 * The compute() tool. The agent uses this for ALL derived numbers:
 * LTM totals, quarterly aggregates, ARRs, ratios, multiples, growth
 * rates, sums over windows. The tool runs the formula deterministically,
 * tags the output with provenance, caches it for the validator, and
 * returns a value the agent can drop into prose.
 *
 * When NUMERIC_PROVENANCE_ENABLED=0 the tool still works (returns the
 * number) but the validator doesn't enforce — used during ramp-up so
 * existing turns don't break if the agent doesn't know about compute()
 * yet.
 */

import crypto from "node:crypto";
import {
  FORMULAS,
  formatValueStr,
  FormulaError,
  type FormulaName,
} from "./formulas";
import { recordCompute } from "./turn-cache";

export const COMPUTE_TOOL_NAME = "compute";

export interface ComputeContext {
  turnId: string;
}

export const COMPUTE_TOOL_DEF = {
  name: COMPUTE_TOOL_NAME,
  description: [
    "Compute a derived metric from a data array. **Use this for ALL derived numbers in your synthesis** — LTM totals, quarterly aggregates, ARRs, ratios, multiples, growth rates, sums over windows.",
    "",
    "Never do arithmetic on long data lists yourself. Pass the raw data fetched from a prior tool, pick a formula, get back a value with provenance. The validator REJECTS prose numbers that didn't come from compute() or directly from a tool result.",
    "",
    "WORKED EXAMPLES (showing the FULL input shape — copy these structures):",
    "",
    "1. LTM sum from a daily series (most common):",
    '   { "name": "LTM Gross Fees", "formula": "sum_trailing_days", "data": [{"date":"2025-04-26","value":1234567},...365_more_rows], "field": "value", "format": "currency", "source_label": "defillama_fees_revenue:hyperliquid", "params": { "days": 365 } }',
    "",
    "2. Quarter-bin sum:",
    '   { "name": "Q3 2025 Fees", "formula": "sum_in_quarter", "data": [{"date":"...","value":...},...], "field": "value", "format": "currency", "source_label": "defillama_fees_revenue:hyperliquid", "params": { "year": 2025, "quarter": 3 } }',
    "",
    "3. Ratio between TWO PRE-COMPUTED VALUES (must be numeric literals, NOT field names or strings):",
    '   { "name": "Take Rate", "formula": "ratio", "data": [], "field": "value", "format": "ratio", "source_label": "derived:hyperliquid", "params": { "numerator": 941336305, "denominator": 1048337420 } }',
    '   // numerator and denominator are NUMBERS. Get them by calling compute() FIRST for each side, then pass the resulting `value` field.',
    "",
    "4. Annualize a 30d window:",
    '   { "name": "30d ARR", "formula": "annualize", "data": [], "field": "value", "format": "currency", "source_label": "derived:defillama_fees_revenue:hyperliquid", "params": { "value": 58800000, "multiplier": 12.17 } }',
    '   // multiplier = 365/30 = 12.17 to convert 30d to annual.',
    "",
    "5. Growth pct over a lookback window:",
    '   { "name": "TVL 30d Growth", "formula": "growth_pct", "data": [{"date":"...","value":...},...], "field": "value", "format": "percent", "source_label": "defillama_tvl:hyperliquid", "params": { "lookback_days": 30 } }',
    "",
    "6. Latest value from a series:",
    '   { "name": "Latest TVL", "formula": "latest", "data": [{"date":"...","value":...},...], "field": "value", "format": "currency", "source_label": "defillama_tvl:hyperliquid", "params": {} }',
    "",
    "COMMON ERRORS TO AVOID:",
    "  • Passing a STRING field name as numerator/denominator (e.g. \"revenue\") instead of a NUMBER. ratio/annualize need literal numeric values.",
    "  • Forgetting `params` object — every formula except `sum`/`mean`/`latest`/`count` needs params.",
    "  • Sub-sampling or pre-aggregating the data array before passing in. Pass the FULL raw array; let the formula handle the windowing.",
    "  • Setting `format` to something the formula doesn't return (e.g. format=\"currency\" with formula=\"ratio\" — ratio returns a unitless number).",
    "",
    "Returns: { value, value_str, provenance }. Use value_str verbatim in prose so the validator can match it.",
  ].join("\n"),
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string" as const,
        description: "Human label for this metric, e.g. 'LTM Gross Fees' or 'Q3 2025 Protocol Revenue'.",
      },
      formula: {
        type: "string" as const,
        enum: Object.keys(FORMULAS),
        description: "Which formula to apply. See examples in tool description.",
      },
      data: {
        type: "array" as const,
        description: "The data array to operate on. Pass the raw array from a prior tool result (e.g. defillama fees series). For ratio/annualize formulas where no array is needed, pass [].",
        items: { type: "object" as const },
      },
      field: {
        type: "string" as const,
        description: "Which numeric field in each data row to operate on. Defaults to 'value'. Common: 'fees', 'revenue', 'tvl', 'volume'.",
      },
      format: {
        type: "string" as const,
        enum: ["currency", "percent", "ratio", "number", "tokens"],
        description: "Output format. Affects value_str and validator matching.",
      },
      source_label: {
        type: "string" as const,
        description: "Where the data came from, e.g. 'defillama_fees_revenue:hyperliquid'. Used for provenance — be specific.",
      },
      params: {
        type: "object" as const,
        description: "Formula-specific parameters. days for sum_trailing_days; year+quarter for sum_in_quarter; start_date+end_date for sum_in_window; numerator+denominator for ratio; lookback_days for growth_pct; value+multiplier for annualize.",
      },
    },
    required: ["name", "formula", "data", "format", "source_label"],
  },
};

export interface ComputeResult {
  name: string;
  value: number;
  value_str: string;
  format: string;
  provenance: {
    formula: string;
    params: Record<string, any>;
    source_label: string;
    field: string;
    row_count: number;
    rows_used: number;
    computed_at: string;
    fingerprint: string;
    notes?: string;
  };
}

export interface ComputeError {
  error: string;
  code: string;
}

export function executeCompute(input: any, ctx: ComputeContext): ComputeResult | ComputeError {
  try {
    const name = String(input?.name || "").trim();
    const formulaName = String(input?.formula || "") as FormulaName;
    const data = Array.isArray(input?.data) ? input.data : [];
    const field = String(input?.field || "value");
    const format = String(input?.format || "number");
    const sourceLabel = String(input?.source_label || "unknown");
    const params = (input?.params && typeof input.params === "object") ? input.params : {};

    if (!name) return { error: "name is required", code: "BAD_INPUT" };
    if (!FORMULAS[formulaName]) {
      return {
        error: `unknown formula '${formulaName}'. Supported: ${Object.keys(FORMULAS).join(", ")}`,
        code: "UNKNOWN_FORMULA",
      };
    }

    const result = FORMULAS[formulaName]({ data, field, params });
    if (!Number.isFinite(result.value)) {
      return {
        error: `formula '${formulaName}' produced non-finite result (${result.value})`,
        code: "NON_FINITE",
      };
    }

    const valueStr = formatValueStr(result.value, format);
    const fingerprint = crypto
      .createHash("sha256")
      .update(`${formulaName}|${JSON.stringify(params)}|${sourceLabel}|${field}|${result.value.toFixed(6)}`)
      .digest("hex")
      .slice(0, 12);

    const out: ComputeResult = {
      name,
      value: result.value,
      value_str: valueStr,
      format,
      provenance: {
        formula: formulaName,
        params,
        source_label: sourceLabel,
        field,
        row_count: data.length,
        rows_used: result.rowsUsed,
        computed_at: new Date().toISOString(),
        fingerprint,
        notes: result.notes,
      },
    };

    recordCompute(ctx.turnId, {
      name,
      value: result.value,
      valueStr,
      format,
      formula: formulaName,
      params,
      sourceLabel,
      rowCount: data.length,
      rowsUsed: result.rowsUsed,
      computedAt: out.provenance.computed_at,
      fingerprint,
    });

    return out;
  } catch (err: any) {
    if (err instanceof FormulaError) {
      return { error: err.message, code: err.code };
    }
    return { error: err?.message || String(err), code: "UNEXPECTED" };
  }
}
