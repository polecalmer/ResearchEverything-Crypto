/**
 * File-output artifact tools: write_xlsx, write_csv, save_chart_png.
 *
 * Closes the largest single gap between sessions and hermes — the ability
 * to emit DOWNLOADABLE FILES (Excel workbooks, CSVs, high-res PNGs) as
 * first-class research outputs, not markdown-embedded JSON. Hermes ships
 * `.xlsx` files you can open in Excel and hand to a teammate; sessions
 * previously shipped only markdown memos. This module + the matching
 * /api/research/artifacts/:sessionId/:filename download endpoint closes
 * that gap.
 *
 * Storage (MVP): files written to /tmp/sessions-artifacts/{session_id}/
 * with collision-safe filenames. Lives on the same machine as the
 * server process — ephemeral on restart, single-instance only. Production
 * deploy should swap to Supabase Storage or S3 (the storeFile() helper
 * is the seam — replace its implementation, no other changes needed).
 *
 * Tool flow:
 *   1. Agent calls write_xlsx({ filename, sheets }) or write_csv({...})
 *   2. Tool serialises to disk under the active session's artifact dir
 *   3. Returns an artifact JSON: { type: "file_download", subtype, filename,
 *      url, sizeBytes } — the agent embeds this in its response markdown
 *      as ```artifact:file_download``` so the frontend renders a download
 *      affordance.
 *   4. /api/research/artifacts/:sessionId/:filename serves the bytes back
 *      to the browser with proper content-type + auth.
 *
 * SessionId is read from RequestContext (AsyncLocalStorage) — no need to
 * thread it through the 5500 LOC of agent dispatch. The route handler
 * sets it on entry.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import ExcelJS from "exceljs";
import { stringify as csvStringify } from "csv-stringify/sync";
import { getRequestContext } from "./request-context";
import { logger } from "./logger";
import { getStorageBackend, type ResolvedArtifact } from "./storage-backend";

/* ─────────────────────────── Config ─────────────────────────── */

const ARTIFACTS_ROOT = process.env.ARTIFACTS_ROOT || "/tmp/sessions-artifacts";
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB hard cap per file
const MAX_SHEETS_PER_WORKBOOK = 20;
const MAX_ROWS_PER_SHEET = 100_000;
const MAX_COLS_PER_SHEET = 200;

// Tighten the filename whitelist hard. Anything that's not alphanumeric,
// dash, underscore, or dot becomes underscore. Prevents path traversal
// (../) and OS-illegal characters at the disk-write boundary.
const SAFE_FILENAME_RE = /[^a-zA-Z0-9._-]/g;
function safeFilename(name: string, fallbackExt: string): string {
  if (!name || typeof name !== "string") name = `untitled.${fallbackExt}`;
  let cleaned = name.replace(SAFE_FILENAME_RE, "_").slice(0, 120);
  if (!cleaned.endsWith(`.${fallbackExt}`)) cleaned = `${cleaned}.${fallbackExt}`;
  // Avoid empty stems
  if (cleaned === `.${fallbackExt}`) cleaned = `untitled.${fallbackExt}`;
  return cleaned;
}

/* ──────────────────────── Storage helper ──────────────────────── */

interface StoredFile {
  url: string;
  absolutePath: string;
  sizeBytes: number;
}

/** Write a buffer to the active session's artifact directory under a
 *  collision-safe name. Returns the relative URL the frontend uses to
 *  download.
 *
 *  Dispatches via the active storage backend (local disk in dev,
 *  STORAGE_BACKEND=s3 in prod). The collision-safe suffix is generated
 *  here, before the backend write, so both local and S3 see the final
 *  filename and the bucket layout matches local paths exactly. */
async function storeFile(
  sessionId: string,
  desiredFilename: string,
  ext: "xlsx" | "csv" | "png",
  buffer: Buffer,
): Promise<StoredFile> {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File too large (${buffer.byteLength} bytes, max ${MAX_FILE_BYTES}).`);
  }

  // Use the desired filename but append a 6-char random suffix to avoid
  // overwrites within a session (the agent may emit multiple files with
  // the same intended name across rounds).
  const baseName = safeFilename(desiredFilename, ext);
  const stem = baseName.slice(0, baseName.length - ext.length - 1);
  const suffix = crypto.randomBytes(3).toString("hex");
  const finalName = `${stem}_${suffix}.${ext}`;

  const backend = getStorageBackend();
  const stored = await backend.putArtifact(String(sessionId), finalName, buffer);

  // Keep `absolutePath` populated for back-compat — for the S3 backend
  // it carries the s3:// URI which is only useful for debug logging.
  return { url: stored.url, absolutePath: stored.ref, sizeBytes: stored.sizeBytes };
}

/* ─────────────────────── Tool definitions ─────────────────────── */

export const WRITE_XLSX_TOOL_DEF = {
  name: "write_xlsx",
  description:
    "Generate an ANALYST-GRADE downloadable Excel workbook (.xlsx). The workbook automatically applies professional formatting (currency $1.2M / percent 12.5% / HYPE-denominated / ratios 1.23x), totals-row bolding, frozen headers, row banding, color-coded negative numbers — so output looks like a sell-side analyst built it, not a CSV dump.\n\n**REQUIRED for financial-model deliverables**: multi-sheet structure with full data (not summary rows only). Standard sheets when shipping a forward-looking model:\n  1. **Summary** — executive KPIs + key takeaways (top of model)\n  2. **Assumptions** — every input parameter with default + sensitivity range (so a reader can fork the model)\n  3. **Income Statement** — quarterly/monthly detail with all line items, not just totals\n  4. **Drivers** — the underlying time series feeding the model (FULL daily/weekly granularity if the user asked for daily — DO NOT downsample)\n  5. **Scenarios** — base/bear/bull side-by-side (one row per line item × 3 cols)\n  6. **Sensitivity** — 2-D grid of an output metric vs 2 key driver inputs\n  7. **Sources** — data source references + methodology notes\n\nFormatting: pass `columnTypes` per-sheet to control number formats. Pass `title` for a large bold title at the top of each sheet. Pass `totalsRows` (0-based row indices) to bold + border totals — or just put 'Total'/'Net'/'Sum' in the first cell and we'll auto-detect.\n\nNumbers should be NATIVE (1234567 not '$1.2M' as a string) — the formatter renders display from numFmt. Returns file URL + size; embed result as `artifact:file_download` in your response. Max 20 sheets, 100k rows/sheet, 200 cols/sheet, 25MB total.",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Filename WITHOUT extension (e.g. 'hype_3yr_forward_model'). System adds .xlsx + collision-safe suffix.",
      },
      sheets: {
        type: "array",
        description: "Sheets to include in the workbook. Order matters — first sheet is the default tab when opened.",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Tab name (max 31 chars per Excel spec). Keep short: 'Summary', 'Income Statement', 'Drivers', etc." },
            title: {
              type: "string",
              description: "Optional large bold title rendered at the top of the sheet (14pt). Use a descriptive analyst-style heading: 'HYPE NTM Income Statement — Base Case (May 2026 → May 2027)'.",
            },
            description: {
              type: "string",
              description: "Optional methodology line below the title (italic, muted, wraps). Use to disclose calculation conventions, data sources, or caveats. Example: 'AF buybacks calibrated from LTM (May 2025–May 2026) live data; forward projection extrapolates revenue × 0.97 / HYPE price.'",
            },
            columns: {
              type: "array",
              description: "Column headers in display order.",
              items: { type: "string" },
            },
            rows: {
              type: "array",
              description: "Data rows. Each row is an object keyed by column header. **Numbers should be NATIVE (1234567 not '$1.2M' string).** The formatter applies per-column numFmt from columnTypes/header inference.",
              items: { type: "object" },
            },
            columnTypes: {
              type: "object",
              description: "Optional per-column type hint. Keys = column header, values one of: 'currency' ($1,234.56 with red parens neg), 'currency_millions' ($1.2M shorthand), 'currency_billions', 'percent' (0.1234 → 12.34%), 'basisPoints', 'number' (decimal), 'integer' (no decimals), 'hype' (1,234 HYPE), 'ratio' (1.23x), 'date' (yyyy-mm-dd), 'text'. Unspecified columns are inferred from header text.",
            },
            totalsRows: {
              type: "array",
              description: "Optional 0-based row indices that should render as totals (bold + top border + soft fill). If omitted, rows whose first column matches /total|subtotal|sum|net|grand/i are auto-detected.",
              items: { type: "number" },
            },
          },
          required: ["name", "columns", "rows"],
        },
      },
    },
    required: ["filename", "sheets"],
  },
} as const;

export const WRITE_CSV_TOOL_DEF = {
  name: "write_csv",
  description:
    "Generate a downloadable CSV file and emit it as a file artifact. Use for tabular data the user wants to take into other tools (Excel, Numbers, Python notebooks, BI tools). One-sheet equivalent of write_xlsx; pick this when you only need data export, write_xlsx when you need multi-sheet structure or formatting. Returns file URL + size; embed as `artifact:file_download` to render the download link.",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Filename WITHOUT extension." },
      columns: {
        type: "array",
        description: "Column headers in order.",
        items: { type: "string" },
      },
      rows: {
        type: "array",
        description: "Data rows as objects keyed by column header.",
        items: { type: "object" },
      },
    },
    required: ["filename", "columns", "rows"],
  },
} as const;

/* ─────────────────────────── Writers ─────────────────────────── */

/** Per-column formatting hint. The agent can pass these to get correct
 *  number formats applied across the column. If omitted, the writer
 *  infers from header text + cell values. */
export type ColumnType =
  | "currency"          // $1,234.56 with red parens on negative
  | "currency_millions" // $1.2M / -$1.2M shorthand
  | "currency_billions" // $1.2B shorthand
  | "percent"           // 12.34%
  | "basisPoints"       // 123 bps
  | "number"            // 1,234.56 (with commas)
  | "integer"           // 1,234 (no decimals)
  | "hype"              // 1,234.56 HYPE
  | "ratio"             // 1.23x
  | "date"              // yyyy-mm-dd
  | "text";

interface XlsxSheetInput {
  name: string;
  columns: string[];
  rows: Array<Record<string, any>>;
  description?: string;
  /** Optional large title above the description; renders bold at 14pt. */
  title?: string;
  /** Optional per-column type hints. Keyed by column header.
   *  Values not in this map fall back to header-text inference. */
  columnTypes?: Record<string, ColumnType>;
  /** Optional list of row indices (0-based, in `rows`) that are TOTALS /
   *  SUBTOTALS — they get bold formatting + a top border. If omitted,
   *  the writer auto-detects rows whose first-column value contains
   *  /total|subtotal|sum|net|grand/i. */
  totalsRows?: number[];
}

interface XlsxInput {
  filename: string;
  sheets: XlsxSheetInput[];
}

interface CsvInput {
  filename: string;
  columns: string[];
  rows: Array<Record<string, any>>;
}

/* ─── Number-format inference ─────────────────────────────────────
 * Heuristic: peek at header text first (explicit signals from the
 * model), fall back to scanning the first 10 cell values. Returns an
 * Excel numFmt string and a `align` direction. Headers that look like
 * money/currency get a [Red] negative format so losses pop visually. */

const FMT: Record<ColumnType, { numFmt: string; align?: "right" | "left" | "center" }> = {
  currency:          { numFmt: '"$"#,##0.00_);[Red]("$"#,##0.00)',     align: "right" },
  currency_millions: { numFmt: '"$"#,##0.0,,"M"_);[Red]("$"#,##0.0,,"M")', align: "right" },
  currency_billions: { numFmt: '"$"#,##0.00,,,"B"_);[Red]("$"#,##0.00,,,"B")', align: "right" },
  percent:           { numFmt: "0.00%;[Red]-0.00%",                     align: "right" },
  basisPoints:       { numFmt: '#,##0" bps";[Red]-#,##0" bps"',         align: "right" },
  number:            { numFmt: "#,##0.00;[Red](#,##0.00)",              align: "right" },
  integer:           { numFmt: "#,##0;[Red](#,##0)",                    align: "right" },
  hype:              { numFmt: '#,##0.00" HYPE";[Red](#,##0.00" HYPE")', align: "right" },
  ratio:             { numFmt: '0.00"x";[Red](0.00"x")',                align: "right" },
  date:              { numFmt: "yyyy-mm-dd",                            align: "center" },
  text:              { numFmt: "@",                                     align: "left" },
};

function inferColumnType(
  headerText: string,
  sampleValues: any[],
  explicit?: ColumnType,
): ColumnType {
  if (explicit) return explicit;
  const h = headerText.toLowerCase();

  // Strong header signals
  if (/(^|\b)date|day|month|year(\b|$)/.test(h) && !/payday|today/.test(h)) return "date";
  if (/%|percent|share|rate|margin|growth|yield|apy|apr|cagr/.test(h)) return "percent";
  if (/\bbps\b|basis/.test(h)) return "basisPoints";
  if (/\bhype\b/.test(h) && !/hype\s*(?:price|usd|mcap)/.test(h)) return "hype";
  if (/\b(ratio|multiple|x[\s)])/.test(h) && !/matrix/.test(h)) return "ratio";
  if (/\$|usd|mcap|fdv|revenue|fees|volume|tvl|price|value|cost|expense|earnings|ebitda|pnl|p&l|notional|cap\b|nav|aum|opex|capex|sbc|buyback|emission/.test(h)) {
    return "currency";
  }

  // Sample-based inference for headers that didn't match
  const nums = sampleValues.filter((v) => typeof v === "number");
  if (nums.length === 0) {
    // All strings — check for date strings
    const dateLike = sampleValues.some((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    return dateLike ? "date" : "text";
  }
  // All integers, no decimals → integer
  const allInt = nums.every((n) => Math.abs(n - Math.trunc(n)) < 1e-9);
  return allInt ? "integer" : "number";
}

/** Detect a totals row by first-column text. */
function isTotalsRowText(v: any): boolean {
  if (typeof v !== "string") return false;
  return /\b(total|subtotal|sum|net|grand[ -]?total|net dilution|net change|total revenue|gross|cumulative)\b/i.test(v);
}

/** Write an Excel workbook from a structured spec. Returns the artifact
 *  JSON (serialised as string) the agent embeds in its response. */
export async function writeXlsx(input: XlsxInput): Promise<string> {
  const ctx = getRequestContext();
  const sessionId = ctx?.sessionId;
  if (!sessionId) {
    return JSON.stringify({
      error: "write_xlsx called outside an active session context. This is a system issue, not a model-side problem — surface to the user that file output is currently unavailable.",
    });
  }
  if (!Array.isArray(input.sheets) || input.sheets.length === 0) {
    return JSON.stringify({ error: "write_xlsx requires at least one sheet." });
  }
  if (input.sheets.length > MAX_SHEETS_PER_WORKBOOK) {
    return JSON.stringify({ error: `Too many sheets (${input.sheets.length}, max ${MAX_SHEETS_PER_WORKBOOK}).` });
  }

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Sessions Research";
    wb.created = new Date();

    for (const sheet of input.sheets) {
      if (!Array.isArray(sheet.columns) || sheet.columns.length === 0) {
        return JSON.stringify({ error: `Sheet "${sheet.name}" has no columns.` });
      }
      if (sheet.columns.length > MAX_COLS_PER_SHEET) {
        return JSON.stringify({ error: `Sheet "${sheet.name}" has too many columns (${sheet.columns.length}, max ${MAX_COLS_PER_SHEET}).` });
      }
      const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
      if (rows.length > MAX_ROWS_PER_SHEET) {
        return JSON.stringify({ error: `Sheet "${sheet.name}" has too many rows (${rows.length}, max ${MAX_ROWS_PER_SHEET}).` });
      }

      // Excel sheet names: max 31 chars, can't contain : / \ ? * [ ]
      const safeName = (sheet.name || "Sheet").replace(/[:/\\?*\[\]]/g, "_").slice(0, 31);
      const ws = wb.addWorksheet(safeName);
      const lastCol = Math.max(1, sheet.columns.length);

      // ── Pre-compute per-column type + numFmt + alignment ────────────
      // Sampled string values used for value-based inference + width
      // estimation.
      const colTypes: ColumnType[] = sheet.columns.map((col) => {
        const samples = rows.slice(0, 20).map((r) => r?.[col]).filter((v) => v != null);
        return inferColumnType(col, samples, sheet.columnTypes?.[col]);
      });

      let nextRow = 1;

      // ── Title row (optional, large bold) ────────────────────────────
      if (sheet.title && sheet.title.trim()) {
        const titleCell = ws.getRow(nextRow).getCell(1);
        titleCell.value = sheet.title.trim();
        titleCell.font = { bold: true, size: 14, color: { argb: "FF111827" } };
        titleCell.alignment = { vertical: "middle" };
        ws.mergeCells(nextRow, 1, nextRow, lastCol);
        ws.getRow(nextRow).height = 22;
        nextRow++;
      }

      // ── Description row (italic muted) ──────────────────────────────
      if (sheet.description && sheet.description.trim()) {
        const descCell = ws.getRow(nextRow).getCell(1);
        descCell.value = sheet.description.trim();
        descCell.font = { italic: true, color: { argb: "FF6B7280" }, size: 10 };
        descCell.alignment = { wrapText: true, vertical: "top" };
        ws.mergeCells(nextRow, 1, nextRow, lastCol);
        ws.getRow(nextRow).height = Math.max(18, Math.min(60, Math.ceil(sheet.description.length / 90) * 14));
        nextRow++;
      }

      // Empty spacer between header block and table
      if (sheet.title || sheet.description) nextRow++;

      // ── Header row (bold, filled, bordered) ─────────────────────────
      const headerRowIdx = nextRow;
      const headerRow = ws.getRow(headerRowIdx);
      sheet.columns.forEach((col, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = col;
        cell.font = { bold: true, color: { argb: "FF111827" }, size: 11 };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE5E7EB" },
        };
        cell.alignment = { vertical: "middle", horizontal: FMT[colTypes[idx]].align || "left" };
        cell.border = {
          top:    { style: "medium", color: { argb: "FF374151" } },
          bottom: { style: "medium", color: { argb: "FF374151" } },
          left:   { style: "thin",   color: { argb: "FFD1D5DB" } },
          right:  { style: "thin",   color: { argb: "FFD1D5DB" } },
        };
      });
      ws.getRow(headerRowIdx).height = 20;
      ws.views = [{ state: "frozen", ySplit: headerRowIdx }];
      nextRow++;

      // ── Detect totals rows (auto + explicit) ────────────────────────
      const explicitTotals = new Set<number>(sheet.totalsRows || []);
      const totalsRowIndices = new Set<number>();
      rows.forEach((r, i) => {
        if (explicitTotals.has(i)) {
          totalsRowIndices.add(i);
          return;
        }
        const firstColVal = sheet.columns[0] ? r?.[sheet.columns[0]] : null;
        if (isTotalsRowText(firstColVal)) totalsRowIndices.add(i);
      });

      // ── Data rows ───────────────────────────────────────────────────
      rows.forEach((r, rowIdx) => {
        const dataRow = ws.getRow(nextRow);
        const isTotals = totalsRowIndices.has(rowIdx);
        const isBanded = !isTotals && rowIdx % 2 === 1;

        sheet.columns.forEach((col, idx) => {
          const v = r?.[col];
          const cell = dataRow.getCell(idx + 1);
          const colType = colTypes[idx];

          if (v == null) {
            cell.value = null;
          } else if (typeof v === "number" || typeof v === "boolean") {
            cell.value = v;
          } else if (typeof v === "string") {
            // Try to parse as number when the column is numeric (the
            // agent often passes "$1.2M" or "12.5%" formatted strings —
            // we want them re-rendered cleanly via numFmt).
            const numericTypes: ColumnType[] = [
              "currency", "currency_millions", "currency_billions",
              "percent", "basisPoints", "number", "integer", "hype", "ratio",
            ];
            if (numericTypes.includes(colType)) {
              const stripped = v
                .replace(/[$,\s]/g, "")
                .replace(/HYPE/i, "")
                .replace(/bps/i, "")
                .replace(/x$/i, "");
              const isPct = /%$/.test(v);
              const isParenNeg = /^\(.+\)$/.test(stripped);
              const cleaned = stripped.replace(/[()%]/g, "");
              const suffixMult = /M$/i.test(cleaned)
                ? 1_000_000
                : /B$/i.test(cleaned)
                  ? 1_000_000_000
                  : /K$/i.test(cleaned)
                    ? 1_000
                    : 1;
              const numStr = cleaned.replace(/[MBK]$/i, "");
              const n = parseFloat(numStr);
              if (!isNaN(n)) {
                let val = n * suffixMult;
                if (isPct) val = val / 100;
                if (isParenNeg) val = -val;
                cell.value = val;
              } else {
                cell.value = v;
              }
            } else if (colType === "date" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
              const d = new Date(v);
              cell.value = isNaN(d.getTime()) ? v : d;
            } else {
              cell.value = v;
            }
          } else {
            cell.value = JSON.stringify(v).slice(0, 32_767);
          }

          // Apply per-column numFmt
          cell.numFmt = FMT[colType].numFmt;
          cell.alignment = { vertical: "middle", horizontal: FMT[colType].align || "left" };

          // Row styling: totals = bold + top border, banded = soft fill
          if (isTotals) {
            cell.font = { bold: true, color: { argb: "FF111827" }, size: 11 };
            cell.border = {
              top:    { style: "medium", color: { argb: "FF374151" } },
              bottom: { style: "thin",   color: { argb: "FFD1D5DB" } },
              left:   { style: "thin",   color: { argb: "FFE5E7EB" } },
              right:  { style: "thin",   color: { argb: "FFE5E7EB" } },
            };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF9FAFB" },
            };
          } else if (isBanded) {
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFFAFBFC" },
            };
          }
        });
        nextRow++;
      });

      // Sheet-wide bottom border at the end of the table (visual close)
      if (rows.length > 0) {
        sheet.columns.forEach((_, idx) => {
          const cell = ws.getRow(nextRow - 1).getCell(idx + 1);
          const prev = cell.border || {};
          cell.border = {
            ...prev,
            bottom: { style: "medium", color: { argb: "FF374151" } },
          };
        });
      }

      // ── Column widths: content-aware sizing ─────────────────────────
      // Sample first 100 cells per column; cap min 10, max 50.
      sheet.columns.forEach((col, idx) => {
        const colType = colTypes[idx];
        const headerLen = col.length;
        const sampleMax = rows.slice(0, 100).reduce((m, r) => {
          const v = r?.[col];
          if (v == null) return m;
          // Estimate display width post-format. Currency/percent add ~3
          // chars for "$"/% + commas. Dates are fixed 10 chars.
          let display: string;
          if (colType === "date") {
            display = "yyyy-mm-dd";
          } else if (typeof v === "number") {
            display = colType === "currency_millions" || colType === "currency_billions"
              ? "$" + (Math.abs(v) / 1e6).toFixed(1) + "M"
              : colType === "currency"
                ? "$" + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                : colType === "percent"
                  ? (v * 100).toFixed(2) + "%"
                  : colType === "ratio"
                    ? v.toFixed(2) + "x"
                    : String(v);
          } else {
            display = String(v);
          }
          return Math.max(m, display.length);
        }, 0);
        const width = Math.min(50, Math.max(10, Math.max(headerLen, sampleMax) + 3));
        ws.getColumn(idx + 1).width = width;
      });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const stored = await storeFile(sessionId, input.filename, "xlsx", buffer);

    logger.info(
      { sessionId, filename: input.filename, sheets: input.sheets.length, sizeBytes: stored.sizeBytes, url: stored.url },
      "write_xlsx ok",
    );

    return JSON.stringify({
      type: "file_download",
      subtype: "xlsx",
      filename: path.basename(stored.absolutePath),
      url: stored.url,
      sizeBytes: stored.sizeBytes,
      sheets: input.sheets.length,
      summary: `Generated ${input.sheets.length}-sheet workbook (${(stored.sizeBytes / 1024).toFixed(1)} KB). Embed as \`\`\`artifact:file_download\`\`\` in your response so the user sees a download link.`,
    });
  } catch (err: any) {
    logger.warn({ err: err?.message, sessionId, filename: input.filename }, "write_xlsx failed");
    return JSON.stringify({ error: `write_xlsx failed: ${err?.message || String(err)}` });
  }
}

/** Write a CSV from a structured spec. */
export async function writeCsv(input: CsvInput): Promise<string> {
  const ctx = getRequestContext();
  const sessionId = ctx?.sessionId;
  if (!sessionId) {
    return JSON.stringify({
      error: "write_csv called outside an active session context. This is a system issue, not a model-side problem.",
    });
  }
  if (!Array.isArray(input.columns) || input.columns.length === 0) {
    return JSON.stringify({ error: "write_csv requires non-empty `columns` array." });
  }
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length > MAX_ROWS_PER_SHEET) {
    return JSON.stringify({ error: `Too many rows (${rows.length}, max ${MAX_ROWS_PER_SHEET}).` });
  }

  try {
    const csvText = csvStringify(rows, {
      header: true,
      columns: input.columns.map((c) => ({ key: c, header: c })),
      cast: {
        // Render dates as ISO; let csv-stringify handle numbers/strings
        date: (v) => v.toISOString().slice(0, 10),
      },
    });
    const buffer = Buffer.from(csvText, "utf-8");
    const stored = await storeFile(sessionId, input.filename, "csv", buffer);

    logger.info(
      { sessionId, filename: input.filename, rows: rows.length, sizeBytes: stored.sizeBytes, url: stored.url },
      "write_csv ok",
    );

    return JSON.stringify({
      type: "file_download",
      subtype: "csv",
      filename: path.basename(stored.absolutePath),
      url: stored.url,
      sizeBytes: stored.sizeBytes,
      rows: rows.length,
      summary: `Generated ${rows.length}-row CSV (${(stored.sizeBytes / 1024).toFixed(1)} KB). Embed as \`\`\`artifact:file_download\`\`\` in your response.`,
    });
  } catch (err: any) {
    logger.warn({ err: err?.message, sessionId, filename: input.filename }, "write_csv failed");
    return JSON.stringify({ error: `write_csv failed: ${err?.message || String(err)}` });
  }
}

/* ─────────────────── Download endpoint helper ─────────────────── */

/** Resolve a session_id + filename to a streamable artifact. Returns
 *  null if the file doesn't exist, the filename is unsafe, or the path
 *  escapes the session directory (local backend: path-traversal
 *  defence; S3 backend: filename allow-list).
 *
 *  Streams via the active storage backend — local disk OR S3. The
 *  download route pipes the returned stream straight to the HTTP
 *  response. */
export async function resolveArtifact(
  sessionId: string,
  filename: string,
): Promise<ResolvedArtifact | null> {
  const backend = getStorageBackend();
  return await backend.getArtifact(String(sessionId), filename);
}

/** Back-compat shim — older code (and the existing route handler) calls
 *  resolveArtifactPath() and uses node:fs.createReadStream on the
 *  returned absolutePath. New code should call resolveArtifact() and
 *  pipe the returned `stream` directly. This shim continues to work for
 *  the LOCAL backend only; on S3 it returns null (callers must migrate
 *  to resolveArtifact). */
export async function resolveArtifactPath(
  sessionId: string,
  filename: string,
): Promise<{ absolutePath: string; sizeBytes: number; contentType: string } | null> {
  const backend = getStorageBackend();
  if (backend.kind !== "local") {
    // Force callers to use resolveArtifact() under S3 — they need the
    // stream, not a path. Returning null here surfaces the bug loudly
    // at deploy time rather than silently breaking downloads.
    return null;
  }
  const sessionDir = path.join(ARTIFACTS_ROOT, String(sessionId));
  const candidate = path.join(sessionDir, filename);
  const resolvedDir = path.resolve(sessionDir);
  const resolvedFile = path.resolve(candidate);
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) return null;

  try {
    const stat = await fs.stat(resolvedFile);
    if (!stat.isFile()) return null;
    const ext = path.extname(resolvedFile).toLowerCase();
    const contentType =
      ext === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : ext === ".csv"
        ? "text/csv; charset=utf-8"
        : ext === ".png"
        ? "image/png"
        : "application/octet-stream";
    return { absolutePath: resolvedFile, sizeBytes: stat.size, contentType };
  } catch {
    return null;
  }
}
