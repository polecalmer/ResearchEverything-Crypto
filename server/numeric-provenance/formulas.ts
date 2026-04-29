/**
 * Pure formula implementations for the compute() tool.
 *
 * Every function here is deterministic, side-effect-free, and takes
 * a data array + params. The compute() tool dispatcher routes to
 * one of these and packages the output with provenance.
 *
 * Design rule: no formula here may call another tool, hit the network,
 * or read process state. If a formula needs external context (e.g. a
 * cross-reference to a different metric), it accepts the value as a
 * literal param. This keeps provenance pure: (formula, params, data)
 * → value, fully reproducible.
 */

export type DataRow = Record<string, any>;

export interface FormulaContext {
  data: DataRow[];
  field: string;       // which numeric field to operate on
  params: Record<string, any>;
}

export interface FormulaResult {
  value: number;
  rowsUsed: number;     // after filtering/windowing — diagnostic
  notes?: string;       // any caveats worth surfacing in provenance
}

export class FormulaError extends Error {
  code: string;
  constructor(code: string, msg: string) {
    super(msg);
    this.code = code;
  }
}

/* ---------- helpers ---------- */

function num(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[$,\s]/g, "").replace(/[bB]$/, "e9").replace(/[mM]$/, "e6").replace(/[kK]$/, "e3");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function pickField(row: DataRow, field: string): number {
  return num(row[field]);
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // unix seconds vs millis heuristic
    const ms = v > 1e12 ? v : v * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function dateField(row: DataRow): Date | null {
  return (
    parseDate(row.date) ||
    parseDate(row.timestamp) ||
    parseDate(row.day) ||
    parseDate(row.time) ||
    parseDate(row.month)
  );
}

function quarterRange(year: number, quarter: number): { start: Date; end: Date } {
  if (quarter < 1 || quarter > 4) throw new FormulaError("BAD_PARAMS", `quarter must be 1-4, got ${quarter}`);
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 1));
  return { start, end };
}

/* ---------- formulas ---------- */

/** Sum all rows' `field`. Skips NaN. */
export function sum(ctx: FormulaContext): FormulaResult {
  let total = 0;
  let rowsUsed = 0;
  for (const r of ctx.data) {
    const v = pickField(r, ctx.field);
    if (Number.isFinite(v)) {
      total += v;
      rowsUsed++;
    }
  }
  return { value: total, rowsUsed };
}

/** Sum rows whose date falls within the trailing N days from `params.as_of`
 *  (default: latest date present in data). Requires a parseable date column. */
export function sum_trailing_days(ctx: FormulaContext): FormulaResult {
  const days = Number(ctx.params.days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new FormulaError("BAD_PARAMS", "params.days must be a positive number");
  }
  const dated = ctx.data
    .map((r) => ({ row: r, date: dateField(r) }))
    .filter((x) => x.date != null) as Array<{ row: DataRow; date: Date }>;
  if (dated.length === 0) {
    throw new FormulaError("NO_DATES", "no parseable date column found in data");
  }
  const asOf = ctx.params.as_of
    ? parseDate(ctx.params.as_of) || new Date()
    : dated.reduce((a, b) => (a.date > b.date ? a : b)).date;
  const cutoff = new Date(asOf.getTime() - days * 86400000);
  let total = 0;
  let rowsUsed = 0;
  for (const { row, date } of dated) {
    if (date > cutoff && date <= asOf) {
      const v = pickField(row, ctx.field);
      if (Number.isFinite(v)) {
        total += v;
        rowsUsed++;
      }
    }
  }
  return {
    value: total,
    rowsUsed,
    notes: `window: ${cutoff.toISOString().slice(0, 10)} → ${asOf.toISOString().slice(0, 10)}`,
  };
}

/** Sum rows whose date is in [start_date, end_date) (inclusive start, exclusive end). */
export function sum_in_window(ctx: FormulaContext): FormulaResult {
  const start = parseDate(ctx.params.start_date);
  const end = parseDate(ctx.params.end_date);
  if (!start || !end) {
    throw new FormulaError("BAD_PARAMS", "params.start_date and params.end_date required (ISO format)");
  }
  let total = 0;
  let rowsUsed = 0;
  for (const r of ctx.data) {
    const d = dateField(r);
    if (!d) continue;
    if (d >= start && d < end) {
      const v = pickField(r, ctx.field);
      if (Number.isFinite(v)) {
        total += v;
        rowsUsed++;
      }
    }
  }
  return {
    value: total,
    rowsUsed,
    notes: `window: ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
  };
}

/** Sum rows in calendar quarter Q`params.quarter` of `params.year`. */
export function sum_in_quarter(ctx: FormulaContext): FormulaResult {
  const year = Number(ctx.params.year);
  const quarter = Number(ctx.params.quarter);
  if (!Number.isFinite(year) || !Number.isFinite(quarter)) {
    throw new FormulaError("BAD_PARAMS", "params.year and params.quarter required");
  }
  const { start, end } = quarterRange(year, quarter);
  return sum_in_window({
    ...ctx,
    params: { start_date: start.toISOString(), end_date: end.toISOString() },
  });
}

/** Mean of all rows' `field`. */
export function mean(ctx: FormulaContext): FormulaResult {
  const s = sum(ctx);
  if (s.rowsUsed === 0) return { value: 0, rowsUsed: 0 };
  return { value: s.value / s.rowsUsed, rowsUsed: s.rowsUsed };
}

/** Mean over the trailing N days. */
export function mean_trailing_days(ctx: FormulaContext): FormulaResult {
  const s = sum_trailing_days(ctx);
  if (s.rowsUsed === 0) return { value: 0, rowsUsed: 0 };
  return { value: s.value / s.rowsUsed, rowsUsed: s.rowsUsed, notes: s.notes };
}

/** Latest value: row with max date (if dated) or last array element. */
export function latest(ctx: FormulaContext): FormulaResult {
  if (ctx.data.length === 0) return { value: NaN, rowsUsed: 0 };
  const dated = ctx.data
    .map((r) => ({ row: r, date: dateField(r) }))
    .filter((x) => x.date != null) as Array<{ row: DataRow; date: Date }>;
  let row: DataRow;
  if (dated.length > 0) {
    row = dated.reduce((a, b) => (a.date > b.date ? a : b)).row;
  } else {
    row = ctx.data[ctx.data.length - 1];
  }
  return { value: pickField(row, ctx.field), rowsUsed: 1 };
}

/** Ratio: literal numerator / literal denominator. Both passed as params
 *  (so the agent must compute or look up each side via separate compute() calls).
 *  Provenance for each side lives in those calls. */
export function ratio(ctx: FormulaContext): FormulaResult {
  const n = num(ctx.params.numerator);
  const d = num(ctx.params.denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d)) {
    throw new FormulaError("BAD_PARAMS", "params.numerator and params.denominator required (numbers)");
  }
  if (d === 0) throw new FormulaError("DIV_ZERO", "denominator is zero");
  return { value: n / d, rowsUsed: 0 };
}

/** Growth pct: (latest_value - earliest_in_window) / earliest_in_window * 100 */
export function growth_pct(ctx: FormulaContext): FormulaResult {
  const days = Number(ctx.params.lookback_days);
  if (!Number.isFinite(days) || days <= 0) {
    throw new FormulaError("BAD_PARAMS", "params.lookback_days required (positive number)");
  }
  const dated = ctx.data
    .map((r) => ({ row: r, date: dateField(r) }))
    .filter((x) => x.date != null) as Array<{ row: DataRow; date: Date }>;
  if (dated.length < 2) throw new FormulaError("INSUFFICIENT_DATA", "need ≥2 dated rows");
  const sorted = [...dated].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latestPt = sorted[sorted.length - 1];
  const cutoff = new Date(latestPt.date.getTime() - days * 86400000);
  // earliest row at or after cutoff
  const earliestPt = sorted.find((p) => p.date >= cutoff);
  if (!earliestPt) throw new FormulaError("INSUFFICIENT_DATA", "no rows in lookback window");
  const a = pickField(earliestPt.row, ctx.field);
  const b = pickField(latestPt.row, ctx.field);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) {
    throw new FormulaError("BAD_DATA", "non-finite values or zero base");
  }
  return {
    value: ((b - a) / a) * 100,
    rowsUsed: 2,
    notes: `from ${earliestPt.date.toISOString().slice(0, 10)} (${a}) to ${latestPt.date.toISOString().slice(0, 10)} (${b})`,
  };
}

/** Annualize a windowed value: (value * multiplier). E.g. 30d revenue × 365/30. */
export function annualize(ctx: FormulaContext): FormulaResult {
  const v = num(ctx.params.value);
  const mult = num(ctx.params.multiplier);
  if (!Number.isFinite(v) || !Number.isFinite(mult)) {
    throw new FormulaError("BAD_PARAMS", "params.value and params.multiplier required");
  }
  return { value: v * mult, rowsUsed: 0 };
}

/** Count rows. */
export function count(ctx: FormulaContext): FormulaResult {
  return { value: ctx.data.length, rowsUsed: ctx.data.length };
}

export const FORMULAS: Record<string, (ctx: FormulaContext) => FormulaResult> = {
  sum,
  sum_trailing_days,
  sum_in_window,
  sum_in_quarter,
  mean,
  mean_trailing_days,
  latest,
  ratio,
  growth_pct,
  annualize,
  count,
};

export type FormulaName = keyof typeof FORMULAS;

/** Format a numeric value for prose, matching the rest of the renderer. */
export function formatValueStr(value: number, format: string): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (format === "percent") return `${value.toFixed(2)}%`;
  if (format === "ratio") return `${value.toFixed(2)}x`;
  if (format === "tokens") {
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return value.toFixed(0);
  }
  if (format === "currency" || format === "$") {
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  }
  // "number"
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value * 100) / 100);
}
