import { useState, useRef, useEffect, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ReferenceDot, Label as RcLabel,
} from "recharts";
import { format } from "date-fns";
import {
  Loader2, CheckCircle2, ChevronDown, Brain, Search, BarChart3,
  Share2, Link2, Check, X, Lightbulb, AlertTriangle, Zap, Eye,
  Quote as QuoteIcon, ArrowDown, ArrowUp, RefreshCw,
  Bookmark, Microscope, Table2, FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/error-boundary";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { ArtifactActions } from "@/components/artifact-actions";
import {
  type Artifact, type SessionMessage, type Session,
  type ResearchMode, type ThinkingStep,
  CHART_COLORS, inferFormat, formatValue, formatAxisTick,
  extractMode, parseContentAndArtifacts,
  parseMarkdownTableCells, isTableSeparator, isTableRow,
} from "@/lib/research-utils";

type ChartViewMode = "line" | "bar" | "area" | "cumulative" | "pie" | "stacked";

/* ─── CSV download utility ─────────────────────────────────────────
 * Converts a chart/table data array into RFC 4180 CSV and triggers
 * a browser download. Column order is taken from the explicit
 * `columns` arg when provided (tables) or from Object.keys of the
 * first row (charts). Values containing commas, quotes, or newlines
 * are quoted; embedded quotes are doubled. Filename derives from
 * the artifact title with non-filename chars stripped. */
function escapeCsvCell(value: any): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows: any[], explicitColumns?: string[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const cols = explicitColumns && explicitColumns.length > 0
    ? explicitColumns
    : Array.from(
        rows.reduce<Set<string>>((acc, r) => {
          if (r && typeof r === "object") for (const k of Object.keys(r)) acc.add(k);
          return acc;
        }, new Set<string>()),
      );
  const header = cols.map(escapeCsvCell).join(",");
  const body = rows
    .map((r) => cols.map((c) => escapeCsvCell(r?.[c])).join(","))
    .join("\r\n");
  return `${header}\r\n${body}`;
}

function downloadCsv(filenameBase: string, csv: string): void {
  if (typeof window === "undefined") return;
  const safeName = (filenameBase || "data")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "data";
  // Add a UTF-8 BOM so Excel opens non-ASCII (em dashes, currency
  // symbols) correctly without prompting for encoding.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function InlineChart({ artifact, hideSave, compact }: { artifact: Artifact; hideSave?: boolean; compact?: boolean }) {
  const { chartConfig, data, title, subtitle, source, refreshRecipe } = artifact;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedChartId, setSavedChartId] = useState<string | null>(null);

  const safeData = data ?? [];
  const { chartType: defaultChartType, yAxes, annotations: rawAnnotations, smoothing: smoothingMode, axisLayout: shaperAxisLayout } = (chartConfig ?? {}) as any;
  const safeYAxes: any[] = yAxes ?? [];
  // Brain-shaped annotations: validated server-side against real data points,
  // so we just need to bucket them by series for the renderer to know which
  // yAxisId to anchor to in dual-axis charts.
  const annotationsByKey: Record<string, Array<{ date: any; value: number; label: string }>> = useMemo(() => {
    const out: Record<string, Array<{ date: any; value: number; label: string }>> = {};
    if (!Array.isArray(rawAnnotations)) return out;
    for (const a of rawAnnotations as any[]) {
      if (!a || typeof a.series !== "string") continue;
      (out[a.series] = out[a.series] || []).push({ date: a.date, value: Number(a.value), label: String(a.label || "") });
    }
    return out;
  }, [rawAnnotations]);
  const smoothingSuffix =
    smoothingMode === "7dma" ? " (7-Day MA)" :
    smoothingMode === "30dma" ? " (30-Day MA)" : "";

  // Tolerate older / partial chart payloads that didn't include an explicit xAxis
  // by inferring the first non-yAxis key from the data row.
  let xAxis = (chartConfig as any)?.xAxis;
  if (!xAxis?.dataKey && safeData[0]) {
    const yKeys = new Set(safeYAxes.map((y: any) => y?.dataKey).filter(Boolean));
    const inferredKey = Object.keys(safeData[0]).find((k) => !yKeys.has(k));
    if (inferredKey) {
      const sample = String(safeData[0][inferredKey] ?? "");
      xAxis = { dataKey: inferredKey, format: /^\d{4}-\d{2}/.test(sample) ? "date" : undefined };
    }
  }

  // The chart shaper picks the best chart type per recipe; we honor that as
  // the default and only let the user toggle the cumulative view (which
  // runs a running-sum transform and renders as area). Per-user line/bar/
  // area/pie overrides were noisy and rarely useful.
  // Honor the artifact's chartType when shaper picked pie or stacked. Older
  // artifacts that say "composed" still flow through the composed branch via
  // isComposedOrDualAxis; line/bar/area route directly.
  const baseChartType = (["line", "bar", "area", "pie", "stacked"].includes(defaultChartType) ? defaultChartType : "line") as ChartViewMode;
  const [cumulative, setCumulative] = useState(false);
  const viewMode: ChartViewMode = cumulative ? "cumulative" : baseChartType;

  const cumulativeData = useMemo(() => {
    if (viewMode !== "cumulative") return safeData;
    const result = safeData.map((row: any) => ({ ...row }));
    for (const y of safeYAxes) {
      let running = 0;
      for (const row of result) {
        const val = Number(row[y.dataKey]);
        if (!isNaN(val)) running += val;
        row[y.dataKey] = running;
      }
    }
    return result;
  }, [safeData, safeYAxes, viewMode]);

  const pieData = useMemo(() => {
    if (viewMode !== "pie" || !safeData.length) return [];
    const primaryKey = safeYAxes[0]?.dataKey;
    if (!primaryKey) return [];
    if (safeYAxes.length > 1) {
      const lastRow = safeData[safeData.length - 1];
      return safeYAxes.map((y, i) => ({
        name: y.label || y.dataKey.replace(/_/g, " "),
        value: Math.abs(Number(lastRow?.[y.dataKey]) || 0),
        color: CHART_COLORS[i % CHART_COLORS.length],
      })).filter(d => d.value > 0);
    }
    const recentSlice = safeData.slice(-Math.min(10, safeData.length));
    return recentSlice.map((row: any, i: number) => ({
      name: String(row[xAxis?.dataKey] || `Item ${i}`),
      value: Math.abs(Number(row[primaryKey]) || 0),
      color: CHART_COLORS[i % CHART_COLORS.length],
    })).filter(d => d.value > 0);
  }, [safeData, safeYAxes, xAxis, viewMode]);

  if (!chartConfig || !data?.length) return null;
  if (!xAxis?.dataKey || !safeYAxes.length) return null;
  const hasExplicitDualAxis = safeYAxes.length > 1 && safeYAxes.some((y: any) => y?.yAxisId === "right" || y?.orientation === "right");
  // The brain's shaper can override the dual-axis decision: if it picked
  // "single", honor that even when there are two series with different
  // formats (e.g. plotting share-of-volume against share-of-fees as a
  // single percent axis). If it picked "dual", force composed when there's
  // more than one series. Falls back to format-mismatch heuristic when the
  // shaper didn't provide a layout (older artifacts / fallback path).
  const shaperForcesSingle = shaperAxisLayout === "single";
  const shaperForcesDual = shaperAxisLayout === "dual" && safeYAxes.length > 1;
  const isComposedOrDualAxis = !shaperForcesSingle && (
    shaperForcesDual ||
    defaultChartType === "composed" ||
    hasExplicitDualAxis ||
    (safeYAxes.length > 1 && inferFormat(safeYAxes[0]?.dataKey, safeYAxes[0]?.label, safeYAxes[0]?.format) !== inferFormat(safeYAxes[1]?.dataKey, safeYAxes[1]?.label, safeYAxes[1]?.format))
  );

  const rawAllFormats = safeYAxes.map(y => inferFormat(y.dataKey, y.label, y.format));

  // Magnitude detection: even when two yAxes share a format (e.g. both
  // currency), if one is in the tens (HYPE price ~$41) and another is in
  // the billions (HYPE 30D MA ARR ~$716M), they can't share a y-axis —
  // the smaller series compresses to ~zero against the larger scale.
  // Compute a robust "typical value" per series (median absolute) and
  // route to right axis when its magnitude differs from the first
  // series by >100×.
  const seriesTypicalAbs = safeYAxes.map(y => {
    const vals: number[] = [];
    for (const r of safeData) {
      const v = Number(r?.[y.dataKey]);
      if (Number.isFinite(v) && v !== 0) vals.push(Math.abs(v));
    }
    if (vals.length === 0) return 0;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)]; // median
  });

  // Format-vs-magnitude sanity. Agents sometimes label a USD-billions
  // series as "percent" (the cascading-mislabel class — "Staked USDe"
  // is a supply, but the agent tagged it format=percent and the
  // renderer dutifully rendered ticks like "8000000000%"). Detect and
  // override per-series:
  //   - format=percent OR ratio with median > 10000  → override
  //     (legit percents/ratios essentially never exceed 10,000)
  //   - format=currency with median < 5             → likely a ratio
  //     mistakenly labeled currency (P/E, multiples)
  // Override target uses label hints to pick the right replacement.
  const allFormats = rawAllFormats.map((f, i) => {
    const mag = seriesTypicalAbs[i];
    const y = safeYAxes[i];
    const labelHint = `${y?.dataKey || ""} ${y?.label || ""}`.toLowerCase();
    const looksMoney = /\$|\busd\b|dollars|supply|amount|tvl|mcap|fees|revenue|volume|paid|staked|locked|deposit|notional/.test(labelHint);
    if ((f === "percent" || f === "ratio") && mag > 10_000) {
      return looksMoney ? "currency" : "number";
    }
    if (f === "currency" && mag > 0 && mag < 5) {
      return "ratio";
    }
    return f;
  });
  const hasRateOrPercent = allFormats.some(f => f === "percent" || f === "ratio");

  const leftMagnitude = seriesTypicalAbs[0] || 0;

  // Assign each yAxis to "left" or "right". Two split criteria — either
  // triggers right-axis routing:
  //   1. Format differs from the first series (currency vs percent, etc.)
  //   2. Same format BUT typical magnitude is >100× off from the first
  //      (price-vs-revenue case, price-vs-MCAP, etc.)
  // Three+ series with multiple distinct format/magnitude classes co-
  // locate to whichever axis is closer to their magnitude.
  const leftFormat = allFormats[0];
  const isMagnitudeMismatch = (mag: number): boolean => {
    if (leftMagnitude === 0 || mag === 0) return false;
    const ratio = Math.max(mag, leftMagnitude) / Math.min(mag, leftMagnitude);
    return ratio > 100;
  };
  // Three-pass axis assignment so we honor both explicit yAxisIds AND
  // implicit format/magnitude routing. The format/magnitude pass fills
  // gaps where the agent didn't explicitly declare a side.
  const axisIds: Array<"left" | "right"> = safeYAxes.map((y, i) => {
    // Highest priority: agent-declared yAxisId/orientation. The agent
    // sometimes explicitly says "this series goes on the right" — honor
    // that even when format and magnitude would otherwise group it left.
    if (y?.yAxisId === "right" || y?.orientation === "right") return "right";
    if (y?.yAxisId === "left" || y?.orientation === "left") return "left";
    // Fallback: format match + magnitude bucket.
    const f = allFormats[i];
    const sameFormat = f === leftFormat;
    const sameMagnitudeBucket = !isMagnitudeMismatch(seriesTypicalAbs[i]);
    return sameFormat && sameMagnitudeBucket ? "left" : "right";
  });
  // rightFormat is the format of the FIRST series routed to the right
  // axis. Used for the right Y-axis tick formatter. Falls back to
  // leftFormat if (somehow) no series routes right but hasRightAxis is
  // true — defensive only.
  const firstRightIdx = axisIds.findIndex((a) => a === "right");
  const rightFormat: string | null = firstRightIdx >= 0 ? allFormats[firstRightIdx] : null;
  const hasRightAxis = firstRightIdx >= 0;

  // Cumulating point-in-time metrics (ARR, TVL, market cap, price, supply,
  // moving averages) produces meaningless growing totals — e.g. a chart that
  // cumulates 30D MA ARR shows "$2B" when the actual ARR is $700M. Block the
  // toggle for any series whose name implies it's already a snapshot/aggregate.
  const POINT_IN_TIME_RE = /\b(arr|run[- ]?rate|annualized|tvl|aum|mcap|market[- ]?cap|fdv|supply|circulating|price|multiple|ratio|moving[- ]?avg|\d+d\s*ma|ma\s*\d+d|ema|sma)\b/i;
  const hasPointInTimeMetric = safeYAxes.some(y =>
    POINT_IN_TIME_RE.test(`${y.dataKey || ""} ${y.label || ""}`),
  );

  const activeData = viewMode === "cumulative" ? cumulativeData : data;

  // Detect a date axis from one of three signals:
  //  1. explicit xAxis.format === "date"
  //  2. ISO string (e.g. "2025-04-23")
  //  3. numeric unix timestamp in seconds (~1e9..1e10) or milliseconds
  //     (~1e12..1e13). Older saved charts stored `date` as a unix int and,
  //     without this branch, the renderer formatted them as currency
  //     ("$1.78B") on the x-axis.
  const xSample = xAxis?.dataKey ? data[0]?.[xAxis.dataKey] : undefined;
  const isUnixSeconds = typeof xSample === "number" && xSample > 1e9 && xSample < 1e10;
  const isUnixMillis = typeof xSample === "number" && xSample > 1e12 && xSample < 1e14;
  const xKeyLooksLikeDate = typeof xAxis?.dataKey === "string" && /(^|_)(date|time|timestamp|day)(_|$)/i.test(xAxis.dataKey);
  const isDate = xAxis?.format === "date"
    || (xSample != null && /^\d{4}-\d{2}/.test(String(xSample)))
    || ((isUnixSeconds || isUnixMillis) && xKeyLooksLikeDate);

  // Categorical X-axis detection. The agent often emits xAxis.format="number"
  // even for waterfall/category bar charts whose xAxis values are strings
  // ("Gross Fees", "Net Revenue", etc.). Without this guard, the numeric
  // formatter is applied to non-numeric labels and Recharts can fail to
  // position bars correctly. When all sampled X-values are non-numeric
  // and non-date strings, treat as categorical: skip xAxis.format entirely
  // and let Recharts use category scale + raw labels.
  const xSamples = data.slice(0, 5).map(r => r?.[xAxis?.dataKey ?? ""]);
  const isCategoricalX = !isDate && xSamples.length > 0 && xSamples.every(v =>
    typeof v === "string" && !/^\d/.test(v) && !/^[+-]?\d/.test(v.trim())
  );

  const lastRow = activeData[activeData.length - 1];
  const primaryKey = yAxes[0]?.dataKey;
  const latestRaw = primaryKey ? lastRow?.[primaryKey] : undefined;
  const latestFmt = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
  const latestValue = latestRaw != null ? formatValue(latestRaw, viewMode === "cumulative" ? "number" : latestFmt) : null;

  // Coerce a date-like value (ISO string, JS Date, unix seconds, unix ms) into
  // a JS Date. Older saved charts persist `date` as unix seconds, which the
  // Date constructor would otherwise parse as 1970-01-21 (~1.78B ms).
  const toDate = (val: any): Date => {
    if (typeof val === "number") {
      return new Date(isUnixSeconds ? val * 1000 : val);
    }
    return new Date(val);
  };

  // Choose x-axis tick density AND format based on the span of the data.
  //   <= 60 days  → show 5-7 evenly-spaced daily ticks,  format "MMM d"
  //   <= 2 years  → one tick per month,                  format "MMM ''yy"
  //   >  2 years  → let recharts auto-thin on its own,   format "MMM ''yy"
  // This fixes the "30 days of daily data collapses to just 2 month labels"
  // bug that made short-range charts look wrong in memos.
  const { dateTicks, dateFormat } = useMemo(() => {
    if (!isDate || !activeData?.length || !xAxis?.dataKey) {
      return { dateTicks: undefined as (string | number)[] | undefined, dateFormat: "MMM ''yy" };
    }
    const rowValues: Array<string | number> = [];
    const dates: Date[] = [];
    for (const row of activeData) {
      const v = row[xAxis.dataKey];
      if (v == null) continue;
      const d = toDate(v);
      if (isNaN(d.getTime())) continue;
      rowValues.push(v);
      dates.push(d);
    }
    if (dates.length < 2) return { dateTicks: undefined, dateFormat: "MMM ''yy" };
    const spanDays = (dates[dates.length - 1].getTime() - dates[0].getTime()) / 86400000;

    // Target ~5 axis labels regardless of range. Recharts ignores minTickGap
    // when explicit `ticks` are passed, so density is fully on us; 5 leaves
    // breathing room for "MMM 'yy" (~50px) at the narrowest chart widths
    // (memo cards, side-by-side library tiles ~360-400px).
    const TARGET_TICKS = 5;

    if (spanDays <= 60) {
      // Daily range: evenly-spaced, include first + last, but never let the
      // last tick render less than half-step away from the previous (prevents
      // "Apr 22 | Apr 23" collisions at the right edge).
      const n = rowValues.length;
      const step = Math.max(1, Math.floor((n - 1) / (TARGET_TICKS - 1)));
      const chosenIdx: number[] = [];
      for (let i = 0; i < n; i += step) chosenIdx.push(i);
      const lastIdx = n - 1;
      const prev = chosenIdx[chosenIdx.length - 1];
      if (prev !== lastIdx) {
        if (lastIdx - prev < Math.ceil(step / 2)) {
          chosenIdx[chosenIdx.length - 1] = lastIdx; // swap instead of append
        } else {
          chosenIdx.push(lastIdx);
        }
      }
      return { dateTicks: chosenIdx.map(i => rowValues[i]), dateFormat: "MMM d" };
    }

    // Longer range: collect calendar-month ticks, then downsample so we
    // never render more than ~7 labels (prevents the "Apr'25/May'25" collision
    // that happens when all 12-13 months of a yearly chart try to fit).
    const seen = new Set<string>();
    const monthly: (string | number)[] = [];
    for (let i = 0; i < rowValues.length; i++) {
      const d = dates[i];
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      monthly.push(rowValues[i]);
    }
    if (monthly.length < 2) return { dateTicks: undefined, dateFormat: "MMM ''yy" };

    const step = Math.max(1, Math.ceil(monthly.length / TARGET_TICKS));
    const sampledIdx: number[] = [];
    for (let i = 0; i < monthly.length; i += step) sampledIdx.push(i);
    const lastMonthIdx = monthly.length - 1;
    const prevMonthIdx = sampledIdx[sampledIdx.length - 1];
    if (prevMonthIdx !== lastMonthIdx) {
      if (lastMonthIdx - prevMonthIdx < Math.ceil(step / 2)) {
        sampledIdx[sampledIdx.length - 1] = lastMonthIdx;
      } else {
        sampledIdx.push(lastMonthIdx);
      }
    }
    return { dateTicks: sampledIdx.map(i => monthly[i]), dateFormat: "MMM ''yy" };
  }, [activeData, isDate, xAxis?.dataKey]);

  const xTickFormatter = (val: any) => {
    if (isDate) {
      try { return format(toDate(val), dateFormat); } catch { return val; }
    }
    // Categorical X: pass labels through unchanged. Applying numeric
    // formatValue to non-numeric strings produces "NaN" or worse.
    if (isCategoricalX) return String(val ?? "");
    return formatValue(val, xAxis.format);
  };

  const tooltipLabelFormatter = (val: any) => {
    if (isDate) {
      try { return format(toDate(val), "MMM d, yyyy"); } catch { return val; }
    }
    return String(val);
  };

  const tooltipFormatter = (value: any, name: string) => {
    const ax = yAxes.find(y => y.dataKey === name);
    const fmt = inferFormat(ax?.dataKey, ax?.label, ax?.format);
    return [formatValue(value, fmt), ax?.label || name.replace(/_/g, " ")];
  };

  const fmt0 = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
  const fmt1 = yAxes.length > 1 ? inferFormat(yAxes[1]?.dataKey, yAxes[1]?.label, yAxes[1]?.format) : fmt0;
  const needsDualAxis = yAxes.length > 1 && fmt0 !== fmt1;

  const renderChart = () => {
    if (viewMode === "pie") {
      if (pieData.length === 0) {
        return (
          <BarChart data={[]} margin={{ top: 12, right: 20, left: 4, bottom: 8 }}>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="var(--color-chart-placeholder)" fontSize={13}>
              No breakdown available for this data
            </text>
          </BarChart>
        );
      }
      const pieFmt = inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format);
      return (
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={110}
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
            label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(1)}%`}
            labelLine={{ stroke: "var(--color-chart-pie-line)", strokeWidth: 1 }}
          >
            {pieData.map((entry: any, i: number) => (
              <Cell key={i} fill={entry.color} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-tooltip-bg)",
              border: "1px solid var(--color-tooltip-border)",
              borderRadius: "10px", fontSize: "13px", padding: "10px 14px",
              color: "var(--color-tooltip-text)",
              backdropFilter: "blur(16px)",
            }}
            formatter={(value: any) => [formatValue(value, pieFmt), ""]}
          />
          {pieData.length > 1 && (
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ fontSize: "9.5px", color: "var(--color-chart-legend)", lineHeight: "12px" }}
            />
          )}
        </PieChart>
      );
    }

    const effectiveChartType = viewMode === "cumulative" ? "area" : viewMode;
    const commonProps = { data: activeData, margin: { top: 12, right: needsDualAxis ? 56 : 20, left: 4, bottom: 8 } };
    const grid = <CartesianGrid strokeDasharray="3 6" stroke="var(--color-chart-grid)" vertical={false} />;
    const xAx = (
      <XAxis
        dataKey={xAxis.dataKey}
        type="category"
        tickFormatter={xTickFormatter}
        tick={{ fontSize: 11, fill: "var(--color-chart-tick)" }}
        // Visible baseline — the X-axis line should always read as a
        // concrete bottom edge for the plot, not an empty void below
        // the data. Subtle but present.
        axisLine={{ stroke: "var(--color-chart-axis-line)", strokeWidth: 1 }}
        tickLine={false}
        tickMargin={8}
        // Categorical bar charts need EVERY tick visible (waterfalls,
        // valuation comparisons). Dated charts subsample via dateTicks.
        ticks={dateTicks}
        interval={isCategoricalX ? 0 : (dateTicks ? 0 : "preserveStartEnd")}
        // Padding must be 0 for categorical charts so bars sit inside
        // the visible plot area; otherwise the first/last bars get
        // pushed off the chart edge with a small N (the waterfall bug).
        padding={isCategoricalX ? { left: 0, right: 0 } : { left: 18, right: 8 }}
        minTickGap={isCategoricalX ? 0 : 32}
      />
    );
    const tip = (
      <Tooltip
        allowEscapeViewBox={{ x: false, y: true }}
        offset={16}
        contentStyle={{
          backgroundColor: "var(--color-tooltip-bg)",
          border: "1px solid var(--color-tooltip-border)",
          borderRadius: "10px", fontSize: "13px", padding: "10px 14px",
          color: "var(--color-tooltip-text)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.15), 0 2px 8px rgba(0,0,0,0.1)",
          pointerEvents: "none",
          lineHeight: "1.5",
        }}
        wrapperStyle={{ pointerEvents: "none", zIndex: 50 }}
        labelFormatter={tooltipLabelFormatter}
        formatter={tooltipFormatter}
        cursor={{ fill: "var(--color-chart-cursor)" }}
      />
    );
    const leg = yAxes.length > 1 ? (
      <Legend verticalAlign="bottom" align="center" height={20} iconType="plainline" iconSize={9}
        wrapperStyle={{ fontSize: "9.5px", color: "var(--color-chart-legend)", paddingTop: "6px", lineHeight: "12px" }}
        formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return ax?.label || v.replace(/_/g, " "); }}
      />
    ) : null;

    // Render brain-shaped annotations as ReferenceDots with inline labels.
    // `withYAxisId` is true only inside the ComposedChart branch (where we
    // declare left/right axes); single-axis charts (Line/Bar/Area) reject
    // the `yAxisId` prop on ReferenceDot, so we omit it there.
    const renderAnnotations = (withYAxisId: boolean) => {
      const out: JSX.Element[] = [];
      for (let i = 0; i < yAxes.length; i++) {
        const y = yAxes[i];
        const list = annotationsByKey[y.dataKey] || [];
        if (list.length === 0) continue;
        const color = CHART_COLORS[i % CHART_COLORS.length];
        const axisId = axisIds[i];
        for (let j = 0; j < list.length; j++) {
          const a = list[j];
          const dotProps: any = {
            x: a.date,
            y: a.value,
            r: 4,
            fill: color,
            stroke: "var(--color-chart-dot-stroke)",
            strokeWidth: 1.5,
            ifOverflow: "extendDomain",
          };
          if (withYAxisId) dotProps.yAxisId = axisId;
          out.push(
            <ReferenceDot key={`anno-${y.dataKey}-${j}`} {...dotProps}>
              <RcLabel
                value={a.label}
                position="top"
                offset={8}
                style={{
                  fill: "var(--color-chart-annotation)",
                  fontSize: 10.5,
                  fontWeight: 500,
                  pointerEvents: "none",
                  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                }}
              />
            </ReferenceDot>
          );
        }
      }
      return out;
    };

    if (isComposedOrDualAxis) {
      return (
        <ComposedChart {...commonProps}>
          {grid}{xAx}
          <YAxis
            yAxisId="left"
            tickFormatter={(v: number) => formatAxisTick(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
            tick={{ fontSize: 11, fill: "var(--color-chart-tick)" }}
            axisLine={false}
            tickLine={false}
            width={72}
            tickMargin={4}
            tickCount={5}
            interval="preserveStartEnd"
            minTickGap={20}
            allowDecimals={false}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tickFormatter={(v: number) => formatAxisTick(v, rightFormat!)}
              tick={{ fontSize: 11, fill: "var(--color-chart-tick-soft)" }}
              axisLine={false}
              tickLine={false}
              width={72}
              tickMargin={4}
              tickCount={5}
              interval="preserveStartEnd"
              minTickGap={20}
              allowDecimals={false}
            />
          )}
          {tip}{leg}
          {yAxes.map((y, i) => {
            const axisId = axisIds[i];
            const yChartType = y.chartType || (i === 0 ? "bar" : "line");
            if (yChartType === "bar") {
              return <Bar key={y.dataKey} yAxisId={axisId} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[0, 0, 0, 0]} maxBarSize={48} />;
            }
            if (yChartType === "area") {
              return <Area key={y.dataKey} yAxisId={axisId} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.03} dot={false} />;
            }
            return <Line key={y.dataKey} yAxisId={axisId} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} dot={false} activeDot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "var(--color-chart-dot-stroke)", strokeWidth: 1 }} />;
          })}
          {renderAnnotations(true)}
        </ComposedChart>
      );
    }

    const yAx = (
      <YAxis
        tickFormatter={(v: number) => formatAxisTick(v, inferFormat(yAxes[0]?.dataKey, yAxes[0]?.label, yAxes[0]?.format))}
        tick={{ fontSize: 11, fill: "var(--color-chart-tick)" }}
        axisLine={false}
        tickLine={false}
        width={72}
        tickMargin={4}
        tickCount={5}
        interval="preserveStartEnd"
        minTickGap={20}
        allowDecimals={false}
      />
    );

    if (effectiveChartType === "bar") {
      return (
        <BarChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Bar key={y.dataKey} dataKey={y.dataKey} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[0, 0, 0, 0]} maxBarSize={48} />
          ))}
          {renderAnnotations(false)}
        </BarChart>
      );
    }
    if (effectiveChartType === "stacked") {
      // Stacked bar: composition over time. Every Bar shares the same stackId
      // so they stack instead of grouping side by side. Top series gets a
      // rounded top corner; intermediate series stay square.
      return (
        <BarChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => {
            const isTop = i === yAxes.length - 1;
            return (
              <Bar
                key={y.dataKey}
                dataKey={y.dataKey}
                stackId="composition"
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                radius={isTop ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={48}
              />
            );
          })}
          {renderAnnotations(false)}
        </BarChart>
      );
    }
    if (effectiveChartType === "area") {
      return (
        <AreaChart {...commonProps}>
          {grid}{xAx}{yAx}{tip}{leg}
          {yAxes.map((y, i) => (
            <Area key={y.dataKey} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={viewMode === "cumulative" ? 0.15 : 0.04} dot={false} />
          ))}
          {renderAnnotations(false)}
        </AreaChart>
      );
    }
    return (
      <LineChart {...commonProps}>
        {grid}{xAx}{yAx}{tip}{leg}
        {yAxes.map((y, i) => (
          <Line key={y.dataKey} type="linear" dataKey={y.dataKey} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1} dot={false} activeDot={{ r: 3, fill: CHART_COLORS[i % CHART_COLORS.length], stroke: "var(--color-chart-dot-stroke)", strokeWidth: 1 }} />
        ))}
        {renderAnnotations(false)}
      </LineChart>
    );
  };

  const isDisabled = (mode: ChartViewMode): { disabled: boolean; reason?: string } => {
    if (mode === "cumulative" && hasRateOrPercent) {
      return { disabled: true, reason: "Cumulative doesn't apply to rates/percentages" };
    }
    if (mode === "cumulative" && hasPointInTimeMetric) {
      return { disabled: true, reason: "Cumulative doesn't apply to point-in-time metrics (ARR, TVL, price, market cap, etc.)" };
    }
    if (isComposedOrDualAxis && !["cumulative", "pie"].includes(mode) && mode !== (["line", "bar", "area"].includes(defaultChartType) ? defaultChartType : "line")) {
      return { disabled: true, reason: "Not available for multi-axis charts" };
    }
    return { disabled: false };
  };

  const handleSaveChart = async () => {
    setSaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/research/charts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          title: title || "Untitled Chart",
          chartType: defaultChartType,
          chartConfig,
          data,
          description: subtitle || source || "",
          ...(refreshRecipe ? { refreshRecipe } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to save");
      const result = await res.json().catch(() => ({}));
      if (result?.id) setSavedChartId(String(result.id));
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      toast({ title: "Saved to Library", description: `"${title}" — now refreshable as live data.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`rounded-lg border border-border/30 bg-card/40 shadow-sm ${compact ? "my-0 p-2" : "my-5 p-5"}`} style={{ overflow: "visible" }}>
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          {title && (
            <h4 className={`font-semibold text-foreground/90 tracking-tight ${compact ? "text-xs" : "text-sm"}`} data-testid="text-chart-title">
              {title}
              {smoothingSuffix && (
                <span className="ml-1.5 text-muted-foreground font-normal" data-testid="text-chart-smoothing-badge">
                  {smoothingSuffix}
                </span>
              )}
            </h4>
          )}
          {subtitle && <p className={`font-medium text-emerald-400 uppercase tracking-wider mt-1 leading-snug ${compact ? "text-[9px] line-clamp-1" : "text-[11px]"}`}>{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {latestValue && (
            <div className="text-right">
              <p className={`font-bold font-mono tabular-nums tracking-tight leading-none ${compact ? "text-base" : "text-xl"}`} style={{ color: CHART_COLORS[0] }}>{latestValue}</p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Latest</p>
            </div>
          )}
          {/* CSV download — scoped to library context (`hideSave` is true
              when InlineChart is rendered inside the library / data-station
              embed; session memos pass hideSave={false} to keep prose
              clean). */}
          {hideSave && (
            <button
              onClick={() => downloadCsv(title || "chart", rowsToCsv(data || []))}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 border-border/30"
              data-testid="button-download-chart-csv"
              title="Download chart data as CSV"
              disabled={!data || data.length === 0}
            >
              <FileDown className="h-3 w-3" />
              CSV
            </button>
          )}
          {!hideSave && !savedChartId && (
            <button
              onClick={handleSaveChart}
              disabled={saving || saved}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                saved
                  ? "bg-amber-500/10 text-amber-500/90 border-amber-500/30"
                  : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 border-border/30"
              }`}
              data-testid="button-save-chart"
              title="Save to library"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
              {saved ? "Saved" : "Save"}
            </button>
          )}
          {!hideSave && savedChartId && (
            <ArtifactActions chartId={savedChartId} chartTitle={title} size="xs" />
          )}
        </div>
      </div>
      {!compact && !isDisabled("cumulative").disabled && (
        <div className="flex items-center gap-1 mt-2 mb-3" data-testid="chart-type-toggle">
          <button
            onClick={() => setCumulative((c) => !c)}
            title="Toggle cumulative (running sum)"
            data-testid="chart-toggle-cumulative"
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all ${
              cumulative
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-muted/30 border border-transparent"
            }`}
          >
            <ArrowUp size={12} strokeWidth={cumulative ? 2.2 : 1.5} />
            Cumulative
          </button>
        </div>
      )}
      <div style={{ overflow: "visible" }} className={compact ? "mt-1" : "mt-2"}>
        <ResponsiveContainer width="100%" height={compact ? 280 : 300} style={{ overflow: "visible" }}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
      {source && !compact && (
        <div className="border-t border-border/20 flex items-center justify-between mt-2 pt-2">
          <p className="text-[11px] text-emerald-400/70 italic">Source: {source}</p>
          <p className="text-[10px] text-muted-foreground/50">{new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
        </div>
      )}
    </div>
  );
}

export function InlineTable({ artifact, compact, hideSave }: { artifact: Artifact; compact?: boolean; hideSave?: boolean }) {
  const { data, columns, title, subtitle, source, refreshRecipe } = artifact;
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!data?.length) return null;

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  const resolveCell = (row: any, col: string): any => {
    if (Array.isArray(row)) {
      const idx = (columns || []).indexOf(col);
      return idx >= 0 ? row[idx] : undefined;
    }
    if (row == null || typeof row !== "object") return row;
    if (col in row) return row[col];
    const target = normalize(col);
    for (const k of Object.keys(row)) {
      if (normalize(k) === target) return row[k];
    }
    return undefined;
  };

  const cols = columns || (Array.isArray(data[0]) ? data[0].map((_: any, i: number) => `Col ${i + 1}`) : Object.keys(data[0]));

  // Save to library: reuses /api/research/charts/save with chartType:"table".
  // The dashboard_charts table already supports table-type entries; the
  // library's data-station tab renders chartType === "table" via InlineTable.
  // Only the save action was missing — adding it here makes tables a
  // first-class library citizen alongside charts.
  const handleSaveTable = async () => {
    setSaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch("/api/research/charts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        credentials: "include",
        body: JSON.stringify({
          title: title || "Untitled Table",
          chartType: "table",
          chartConfig: { columns: cols },
          data,
          description: subtitle || source || "",
          // Pass refreshRecipe through so saved tables become refreshable
          // live artifacts in the library — same parity with charts.
          ...(refreshRecipe ? { refreshRecipe } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to save");
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["/api/research/charts/saved"] });
      toast({ title: "Saved to Library", description: `"${title || "Table"}" — find it in the Charts tab.` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Memo-style table aesthetic, dark-theme adapted: top + bottom thick
  // rules, uppercase indigo headers, no card chrome, no zebra, no hover
  // shading, tabular-nums in body cells, first-column emphasis. Strips
  // the rounded-card frame the prior look relied on.
  return (
    <div className={compact ? "my-0" : "my-5"}>
      {(title || !hideSave || hideSave) && (
        <div className="flex items-start justify-between gap-3 mb-1">
          {title && (
            <h4
              className={`font-semibold text-foreground/90 tracking-tight flex-1 min-w-0 ${compact ? "text-xs pb-1" : "text-sm pb-2"}`}
            >
              {title}
            </h4>
          )}
          {/* CSV download — shown in library context (hideSave=true) so
              users can extract the underlying table data. */}
          {hideSave && (
            <button
              onClick={() => downloadCsv(title || "table", rowsToCsv(data || [], cols))}
              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 border-border/30"
              data-testid="button-download-table-csv"
              title="Download table as CSV"
              disabled={!data || data.length === 0}
            >
              <FileDown className="h-3 w-3" />
              CSV
            </button>
          )}
          {!hideSave && (
            <button
              onClick={handleSaveTable}
              disabled={saving || saved}
              className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all border ${
                saved
                  ? "bg-amber-500/10 text-amber-500/90 border-amber-500/30"
                  : "text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/30 border-border/30"
              }`}
              data-testid="button-save-table"
              title="Save table to library"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? <Check className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
              {saved ? "Saved" : "Save"}
            </button>
          )}
        </div>
      )}
      <div className={`overflow-x-auto ${compact ? "max-h-[300px] overflow-y-auto" : ""}`}>
        <table
          className={`w-full ${compact ? "text-[11px]" : "text-[13px]"}`}
          style={{
            borderCollapse: "collapse",
            fontVariantNumeric: "tabular-nums",
            borderTop: "1.5px solid var(--color-block-rule)",
            borderBottom: "1.5px solid var(--color-block-rule)",
          }}
        >
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c}
                  className={`text-left font-bold uppercase tracking-wider ${compact ? "px-2.5 py-1.5 text-[9.5px]" : "px-3 py-2 text-[11px]"}`}
                  style={{
                    color: "#A4B6E8",
                    borderBottom: "1px solid rgba(164,182,232,0.45)",
                    letterSpacing: "0.04em",
                    background: "transparent",
                  }}
                >
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, compact ? 20 : 50).map((row: any, i: number) => (
              <tr key={i}>
                {cols.map((c, ci) => (
                  <td
                    key={c}
                    className={compact ? "px-2.5 py-1.5" : "px-3 py-1.5"}
                    style={{
                      borderBottom:
                        i === Math.min(data.length, compact ? 20 : 50) - 1
                          ? "none"
                          : "1px solid var(--color-block-separator)",
                      color:
                        ci === 0
                          ? "var(--color-block-text-strong)"
                          : "var(--color-block-text)",
                      fontWeight: ci === 0 ? 600 : 400,
                      verticalAlign: "top",
                    }}
                  >
                    {formatValue(resolveCell(row, c))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MetricCards({ artifact }: { artifact: Artifact }) {
  // Memo-style metric snapshot: a 3-column table with uppercase indigo
  // labels, bold values, italic subtitles. Replaces the prior look (a
  // grid of rounded card boxes side-by-side) which read like a SaaS
  // dashboard widget. Same visual language as the new InlineTable —
  // thick top/bottom rules, indigo header underline, no card chrome,
  // no zebra. data-testid retained so the memo's print-CSS overrides
  // continue to apply unchanged.
  const { data, title } = artifact;
  if (!data?.length) return null;

  const ACCENT = "#A4B6E8";
  const RULE = "var(--color-block-rule)";
  const SEP = "var(--color-block-separator)";

  return (
    <div className="my-5" data-testid="metric-cards">
      {title && (
        <h4
          className="text-[11px] font-bold uppercase mb-1.5 m-0"
          style={{
            color: ACCENT,
            letterSpacing: "0.04em",
            paddingBottom: "3px",
            borderBottom: `1px solid ${ACCENT}`,
          }}
        >
          {title}
        </h4>
      )}
      <div
        style={{
          display: "table",
          width: "100%",
          borderCollapse: "collapse",
          borderTop: `1.5px solid ${RULE}`,
          borderBottom: `1.5px solid ${RULE}`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {data.map((card: any, i: number) => {
          const isLast = i === data.length - 1;
          const cellBorder = isLast ? "none" : `1px solid ${SEP}`;
          return (
            <div key={i} style={{ display: "table-row" }}>
              <p
                className="text-[10px] font-bold uppercase m-0"
                style={{
                  display: "table-cell",
                  width: "38%",
                  padding: "6px 10px",
                  verticalAlign: "middle",
                  color: ACCENT,
                  letterSpacing: "0.04em",
                  borderBottom: cellBorder,
                }}
              >
                {card.label}
              </p>
              <p
                className="text-[14px] font-bold m-0"
                style={{
                  display: "table-cell",
                  width: "28%",
                  padding: "6px 10px",
                  verticalAlign: "middle",
                  color: "var(--color-block-text-strong)",
                  borderBottom: cellBorder,
                }}
              >
                {card.value}
              </p>
              <p
                className="text-[12px] italic m-0"
                style={{
                  display: "table-cell",
                  width: "34%",
                  padding: "6px 10px",
                  verticalAlign: "middle",
                  color: "var(--color-block-text-muted)",
                  borderBottom: cellBorder,
                }}
              >
                {card.subtitle || ""}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalloutBlock({ artifact }: { artifact: Artifact }) {
  // Memo-style callout: thin 2px left rule in the variant accent, tiny
  // uppercase kicker label in the same accent, body text in the standard
  // foreground tone. No filled background, no rounded corners, no icon —
  // the prior look (rounded card with neon-tinted fill and a Lightbulb
  // icon) read like a Notion admonition / generic web-app warning. The
  // analyst-memo pattern is restrained: just enough chrome to set it
  // apart from prose, nothing more.
  const variant = artifact.variant || "insight";
  const accent = {
    insight: "#A4B6E8",      // indigo — same family as the table header
    risk: "#E8B86A",         // muted amber
    contrarian: "#C8A2E8",   // muted violet
    catch: "#E8A0A8",        // muted coral
  }[variant];
  const label = {
    insight: "Insight",
    risk: "Risk",
    contrarian: "Contrarian",
    catch: "The Catch",
  }[variant];
  return (
    <div
      className="my-5 pl-4 py-1"
      data-testid={`callout-${variant}`}
      style={{ borderLeft: `2px solid ${accent}` }}
    >
      <div
        className="text-[10px] font-bold uppercase mb-1.5"
        style={{ color: accent, letterSpacing: "0.14em" }}
      >
        {artifact.title || label}
      </div>
      <p className="text-[13px] text-foreground/85 leading-relaxed m-0">
        {artifact.text}
      </p>
    </div>
  );
}

export function ComparisonBlock({ artifact }: { artifact: Artifact }) {
  const { left, right, title } = artifact;
  if (!left || !right) return null;
  return (
    <div className="my-5 rounded-lg border border-border/30 bg-card/40 overflow-hidden shadow-sm" data-testid="comparison-block">
      {title && <div className="text-sm font-semibold text-foreground/90 px-5 pt-4 pb-2 tracking-tight">{title}</div>}
      <div className="grid grid-cols-2 divide-x divide-border/20">
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-3 font-bold">{left.label}</div>
          <ul className="space-y-2">
            {left.items.map((item, i) => (
              <li key={i} className="text-[13px] text-foreground/80 leading-relaxed flex gap-2">
                <span className="text-muted-foreground/50 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground/70 mb-3 font-bold">{right.label}</div>
          <ul className="space-y-2">
            {right.items.map((item, i) => (
              <li key={i} className="text-[13px] text-foreground/80 leading-relaxed flex gap-2">
                <span className="text-muted-foreground/50 shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function QuoteBlock({ artifact }: { artifact: Artifact }) {
  // Memo-style pull-quote: thin 2px left rule, italic body, attribution
  // as discreet small-caps line below. Drops the giant QuoteIcon and the
  // primary-colored border that made the prior treatment feel like a
  // generic web-app callout. Restrained — same pattern the print memo
  // uses, adapted for dark theme.
  return (
    <div
      className="my-5 pl-4 py-1"
      data-testid="quote-block"
      style={{ borderLeft: "2px solid var(--color-block-rule)" }}
    >
      <p className="text-[14px] text-foreground/90 italic leading-relaxed m-0">
        {artifact.text}
      </p>
      {artifact.attribution && (
        <p
          className="text-[10px] mt-2 m-0"
          style={{
            color: "var(--color-block-text-soft)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {artifact.attribution}
        </p>
      )}
    </div>
  );
}

// Canonical display names. Renderer normalizes the agent's slug or
// over-verbose body into this short list so the user sees a clean
// comma-separated provenance list — never endpoint details, query
// IDs, methodology notes, or dates. Audit-trail metadata stays in logs.
const SOURCE_NAME_CANON: Record<string, string> = {
  defillama: "DeFiLlama",
  "defi-llama": "DeFiLlama",
  "defi llama": "DeFiLlama",
  dune: "Dune Analytics",
  "dune analytics": "Dune Analytics",
  "dune sql": "Dune Analytics",
  coingecko: "CoinGecko",
  "coin gecko": "CoinGecko",
  stonksonchain: "StonksOnChain",
  "stonks on chain": "StonksOnChain",
  allium: "Allium",
  web: "Web search",
  "web search": "Web search",
  brain: "Brain",
  "analyst-corpus": "Analyst corpus",
  "analyst corpus": "Analyst corpus",
  execute_code: "Execute code",
};

function canonicalSourceName(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  // Strip everything after the first hyphen / colon / parenthesis / dash
  // — anything past that is endpoint detail / methodology leak.
  const head = trimmed.split(/[-—:(]/)[0].trim();
  const key = head.toLowerCase();
  if (SOURCE_NAME_CANON[key]) return SOURCE_NAME_CANON[key];
  // Fallback: title-case the head.
  return head.charAt(0).toUpperCase() + head.slice(1);
}

function extractSourcesFromBody(body: string): string[] {
  if (!body) return [];
  const out = new Set<string>();
  // Pass 1: bullet headers ("- **dune** - ...").
  const lines = body.split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\s*[-*•]\s*(?:\*\*)?([^*\n—:(\-]+)/);
    if (m) {
      const name = canonicalSourceName(m[1]);
      if (name) out.add(name);
    }
  }
  // Pass 2: scan the FULL body for any known canonical source name —
  // legacy outputs often mention DeFiLlama / CoinGecko inside a verbose
  // detail tail rather than as separate bullets, and the user wants all
  // three to surface.
  const lower = body.toLowerCase();
  for (const slug of Object.keys(SOURCE_NAME_CANON)) {
    if (lower.includes(slug)) out.add(SOURCE_NAME_CANON[slug]);
  }
  return Array.from(out);
}

export function SourcesBlock({ artifact }: { artifact: Artifact }) {
  const structured = artifact.sources ?? [];
  const names: string[] = (() => {
    if (structured.length > 0) {
      const set = new Set<string>();
      for (const s of structured) {
        const n = canonicalSourceName(s.name);
        if (n) set.add(n);
      }
      return Array.from(set);
    }
    if (artifact.body) return extractSourcesFromBody(artifact.body);
    return [];
  })();
  if (names.length === 0) return null;
  return (
    <div className="mt-4 mb-2 pt-3 border-t border-border/30" data-testid="sources-block">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mb-1.5">
        {artifact.title || "Sources"}
      </div>
      <div className="text-[12px] text-muted-foreground/85">
        {names.join(", ")}
      </div>
    </div>
  );
}

function InlineFormatted({ text }: { text: string }) {
  // Strikethrough is used by the numeric-provenance layer to mark prose
  // numbers the validator could not trace. The original value stays
  // visible (so the reader can see what was claimed) but the visual
  // signal makes it clear the value is unverified — the data-integrity
  // callout at the top of the response carries the explanation.
  const parts = text.split(/(\*\*.*?\*\*|`.*?`|~~.+?~~)/g);
  return (
    <>
      {parts.map((part, j) => {
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={j} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={j} className="bg-muted/60 px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        if (part.startsWith("~~") && part.endsWith("~~"))
          return (
            <s
              key={j}
              className="text-muted-foreground/55 decoration-destructive/40 decoration-[1.5px]"
              title="Value flagged by the numeric-provenance validator — see the data-integrity callout for details"
            >
              {part.slice(2, -2)}
            </s>
          );
        return <span key={j}>{part}</span>;
      })}
    </>
  );
}

function MarkdownTable({ rows }: { rows: string[] }) {
  const headerRow = rows[0];
  const dataRows = rows.filter((_, i) => i > 0 && !isTableSeparator(_));
  const headers = parseMarkdownTableCells(headerRow);

  return (
    <div className="my-4 rounded-lg border border-border/30 overflow-hidden" data-testid="markdown-table">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-muted/30 border-b border-border/30">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-4 py-2.5 font-semibold text-foreground/90 whitespace-nowrap">
                <InlineFormatted text={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataRows.map((row, ri) => {
            const cells = parseMarkdownTableCells(row);
            return (
              <tr key={ri} className={`border-b border-border/10 ${ri % 2 === 1 ? "bg-muted/10" : ""} hover:bg-muted/20 transition-colors`}>
                {headers.map((_, ci) => (
                  <td key={ci} className="px-4 py-2.5 text-foreground/80 whitespace-nowrap">
                    <InlineFormatted text={cells[ci] || ""} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");

  const blocks: Array<{ type: "line"; index: number; content: string } | { type: "table"; index: number; rows: string[] }> = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const tableRows: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        tableRows.push(lines[i]);
        i++;
      }
      if (tableRows.length >= 2) {
        blocks.push({ type: "table", index: i, rows: tableRows });
      } else {
        tableRows.forEach((r, ri) => blocks.push({ type: "line", index: i + ri, content: r }));
      }
    } else {
      blocks.push({ type: "line", index: i, content: lines[i] });
      i++;
    }
  }

  return (
    <div className="space-y-1.5">
      {blocks.map((block, bi) => {
        if (block.type === "table") {
          return <MarkdownTable key={`table-${bi}`} rows={block.rows} />;
        }
        const line = block.content;
        if (line.startsWith("### ")) return (
          <h4 key={bi} className="text-[14px] font-semibold text-foreground mt-5 mb-1">
            <InlineFormatted text={line.slice(4)} />
          </h4>
        );
        if (line.startsWith("## ")) return (
          <h3 key={bi} className="text-base font-bold text-foreground mt-6 mb-2 pb-1.5 border-b border-border/20">
            <InlineFormatted text={line.slice(3)} />
          </h3>
        );
        if (line.startsWith("# ")) return (
          <h2 key={bi} className="text-lg font-bold text-foreground mt-6 mb-2 pb-2 border-b border-border/30">
            <InlineFormatted text={line.slice(2)} />
          </h2>
        );
        if (line.startsWith("- ") || line.startsWith("* ")) return (
          <p key={bi} className="text-[13px] text-foreground/80 pl-4 leading-relaxed flex gap-2">
            <span className="text-muted-foreground/50 shrink-0">•</span>
            <span><InlineFormatted text={line.slice(2)} /></span>
          </p>
        );
        if (line.match(/^\d+\.\s/)) return (
          <p key={bi} className="text-[13px] text-foreground/80 pl-4 leading-relaxed">
            <InlineFormatted text={line} />
          </p>
        );
        if (line.startsWith("> ")) return (
          <p key={bi} className="text-[13px] text-foreground/60 italic border-l-2 border-border/40 pl-4 py-0.5 my-1">
            <InlineFormatted text={line.slice(2)} />
          </p>
        );
        if (line.startsWith("---") || line.startsWith("***")) return <hr key={bi} className="border-border/20 my-4" />;
        if (line.startsWith("**") && line.endsWith("**")) return (
          <p key={bi} className="text-[13px] font-semibold text-foreground/90 mt-1">
            {line.slice(2, -2)}
          </p>
        );
        if (!line.trim()) return <div key={bi} className="h-2" />;

        return (
          <p key={bi} className="text-[13px] text-foreground/80 leading-[1.7]">
            <InlineFormatted text={line} />
          </p>
        );
      })}
    </div>
  );
}

export function ModeBadge({ mode }: { mode: ResearchMode }) {
  const configs: Record<string, { label: string; className: string }> = {
    quick: { label: "Quick", className: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30" },
    focused: { label: "Focused", className: "bg-blue-400/10 text-blue-400 border-blue-400/30" },
    deep: { label: "Deep Dive", className: "bg-purple-400/10 text-purple-400 border-purple-400/30" },
    chart: { label: "Chart", className: "bg-cyan-400/10 text-cyan-400 border-cyan-400/30" },
  };
  const config = configs[mode];
  if (!config) return null;
  return (
    <span className={`inline-block px-2.5 py-1 rounded-md border text-[10px] uppercase tracking-wider font-semibold ${config.className}`} data-testid={`mode-badge-${mode}`}>
      {config.label}
    </span>
  );
}

/**
 * Highlight popover. Surfaces over a text selection inside an assistant
 * message and offers two actions:
 *   - Dive Deeper: send a follow-up to the SAME session (existing).
 *   - Build Chart: spawn a NEW chart-mode session in the background.
 *     User keeps reading the source memo; tracker UI shows progress
 *     bottom-right. Optional onBuildChart prop — when omitted (e.g.
 *     reading a saved memo from Library where there's no live session
 *     to dive into), only the Build Chart button appears.
 */
export function DiveDeepButton({
  onDiveDeep,
  onBuildChart,
}: {
  onDiveDeep?: (text: string) => void;
  onBuildChart?: (text: string) => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setPos(null);
        setSelectedText("");
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 10) {
        setPos(null);
        setSelectedText("");
        return;
      }
      const anchorNode = sel.anchorNode;
      if (!anchorNode) { setPos(null); setSelectedText(""); return; }
      const msgEl = (anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode as Element : anchorNode.parentElement)
        ?.closest("[data-testid^='msg-assistant-']");
      if (!msgEl) { setPos(null); setSelectedText(""); return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      setSelectedText(text);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  if (!pos || !selectedText) return null;
  if (!onDiveDeep && !onBuildChart) return null;

  const dismiss = () => {
    window.getSelection()?.removeAllRanges();
    setPos(null);
    setSelectedText("");
  };

  return (
    <div
      className="fixed z-[100] flex items-center gap-1 p-1 rounded-lg bg-popover/95 border border-border/60 backdrop-blur-md shadow-lg animate-in fade-in zoom-in-95 duration-150"
      style={{ left: pos.x, top: pos.y, transform: "translate(-50%, -100%)" }}
      data-testid="highlight-popover"
    >
      {onDiveDeep && (
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-foreground/85 hover:bg-accent transition"
          onMouseDown={(e) => {
            e.preventDefault();
            onDiveDeep(selectedText);
            dismiss();
          }}
          data-testid="button-double-click"
          title="Run focused-mode follow-up on this section"
        >
          <Microscope className="w-3.5 h-3.5" />
          Double Click
        </button>
      )}
      {onBuildChart && (
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-foreground/85 hover:bg-accent transition"
          onMouseDown={(e) => {
            e.preventDefault();
            onBuildChart(selectedText);
            dismiss();
          }}
          data-testid="button-build-chart"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Build Chart
        </button>
      )}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

// ─── Phase-based agent pipeline ─────────────────────────────────────
//
// Replaces the previous verbose step-list which leaked internals (Dune query
// IDs, source-fallback strategy, error messages). The new panel renders 4-5
// abstract phases — Understanding / Planning / Researching / Analyzing /
// Composing — and lights them up as the agent moves through them. No source
// names, no error chatter, no internal tool names.
//
// Visual pattern mirrors AgentCard from the VC pipeline (add-deal.tsx) so it
// feels like the same product family.

type PhaseId = "understanding" | "planning" | "researching" | "analyzing" | "composing";

interface PhaseDef {
  id: PhaseId;
  label: string;
  // The user-visible message shown when this phase is the active one.
  activeMessage: string;
}

const PHASES: PhaseDef[] = [
  { id: "understanding", label: "Understanding",  activeMessage: "Reading your question" },
  { id: "planning",      label: "Planning",       activeMessage: "Choosing what to investigate" },
  { id: "researching",   label: "Researching",    activeMessage: "Gathering data" },
  { id: "analyzing",     label: "Analyzing",      activeMessage: "Synthesizing findings" },
  { id: "composing",     label: "Composing",      activeMessage: "Writing the response" },
];

// Map a single ThinkingStep to one of the abstract phases. Conservative — when
// in doubt, return null and the caller falls back to the previous phase.
function phaseFromStep(step: ThinkingStep): PhaseId | null {
  const label = (step.label || "").toLowerCase();
  // Hard-coded phase signals from the agent.
  if (step.type === "complete") return "composing";
  if (step.type === "synthesis_started") return "analyzing";
  if (step.type === "sub_question_started" || step.type === "sub_question_progress" || step.type === "sub_question_done") return "researching";
  if (step.type === "analyzing") return "analyzing";

  // Keyword sniffing for tool/thinking steps. Prefer the most specific bucket.
  if (/multi-perspective|perspective|synthes(is|izing|ize)|debate|reflection|reflect/.test(label)) return "analyzing";
  if (/execute_code|aggregate|compute|model|deriv(e|ed)|merge/.test(label)) return "analyzing";
  if (/plan|sub-?quest|breakdown|decompose|approach/.test(label)) return "planning";
  if (/fetch|search|query|pull|retriev|get_|tvl|revenue|fees|price|protocol|onchain|on-chain|dune|defillama|coingecko|allium|brain/.test(label)) return "researching";
  if (/render|chart|memo|composing|final|writing|build(ing)?\s+chart/.test(label)) return "composing";
  if (/understand|reading|parsing|intent|classif/.test(label)) return "understanding";

  // Tool_start is almost always research.
  if (step.type === "tool_start" || step.type === "tool_result") return "researching";

  return null;
}

// Reduce all observed steps into a phase state map: which phases have been
// touched + which one is currently active (most recent). We always include
// "Understanding" as touched (it implicitly happens first).
function buildPhaseState(steps: ThinkingStep[], isComplete: boolean): {
  active: PhaseId | null;
  touched: Set<PhaseId>;
  visible: PhaseId[];
} {
  const touched = new Set<PhaseId>(["understanding"]);
  let active: PhaseId | null = "understanding";
  let lastResolved: PhaseId | null = null;

  for (const s of steps) {
    const p = phaseFromStep(s);
    if (p) {
      lastResolved = p;
      touched.add(p);
      // Mark all earlier phases as touched too (you can't reach research without understanding).
      const idx = PHASES.findIndex(ph => ph.id === p);
      for (let i = 0; i < idx; i++) touched.add(PHASES[i].id);
    }
  }

  if (lastResolved) active = lastResolved;
  if (isComplete) active = null;

  // Always show all 5 phases — keeps the layout stable, dims unreached ones.
  const visible: PhaseId[] = PHASES.map(p => p.id);

  return { active, touched, visible };
}

function PhaseCard({ phase, state, isComplete }: { phase: PhaseDef; state: "pending" | "active" | "done"; isComplete: boolean }) {
  return (
    <div
      className={`relative rounded-lg border px-3 py-2.5 transition-all duration-500 ${
        state === "active"
          ? "border-border/30 bg-card/60 shadow-sm"
          : state === "done"
          ? "border-border/10 bg-card/20"
          : "border-border/[0.06] bg-transparent"
      }`}
      data-testid={`phase-${phase.id}`}
      data-state={state}
    >
      {state === "active" && (
        <div className="absolute inset-0 rounded-lg bg-gradient-to-r from-sky-500/[0.06] to-transparent pointer-events-none" />
      )}
      <div className="relative flex items-center gap-2.5">
        <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-300 flex-shrink-0 ${
          state === "active"
            ? "border-sky-400/40 bg-sky-500/10"
            : state === "done"
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-white/[0.06] bg-transparent"
        }`}>
          {state === "active" ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-400/70" />
          ) : state === "done" ? (
            <svg className="w-2.5 h-2.5 text-emerald-500/70" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5L5 9L9.5 3.5" />
            </svg>
          ) : (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-block-separator)" }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[11px] font-medium transition-all duration-300 ${
            state === "active" ? "text-foreground/80" : state === "done" ? "text-foreground/40" : "text-foreground/15"
          }`}>
            {phase.label}
          </span>
          {state === "active" && !isComplete && (
            <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{phase.activeMessage}…</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThinkingPanel({ steps }: { steps: ThinkingStep[] }) {
  const startRef = useRef<number | null>(null);
  const frozenRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  if (steps.length === 0) {
    startRef.current = null;
    frozenRef.current = null;
  } else if (startRef.current === null) {
    startRef.current = Date.now();
  }

  const isComplete = steps[steps.length - 1]?.type === "complete";

  if (isComplete && frozenRef.current === null && startRef.current !== null) {
    frozenRef.current = Math.floor((Date.now() - startRef.current) / 1000);
  }

  useEffect(() => {
    if (isComplete || startRef.current === null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [isComplete]);

  if (steps.length === 0) return null;

  const elapsed =
    frozenRef.current !== null
      ? frozenRef.current
      : startRef.current !== null
        ? Math.floor((Date.now() - startRef.current) / 1000)
        : 0;

  const { active, touched, visible } = buildPhaseState(steps, isComplete);

  const phaseState = (id: PhaseId): "pending" | "active" | "done" => {
    if (active === id) return "active";
    if (touched.has(id)) return "done";
    return "pending";
  };

  return (
    <div
      className="mb-4 rounded-lg border border-border/30 bg-card/10 px-3 py-3"
      data-testid="thinking-panel"
    >
      <div className="flex items-center justify-between mb-2.5 px-1">
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 font-semibold">
          {isComplete ? "Done" : "Working"}
        </span>
        <span
          className="text-[10px] tabular-nums text-muted-foreground/50"
          data-testid="thinking-elapsed"
          title={isComplete ? "Total time" : "Elapsed"}
        >
          {formatElapsed(elapsed)}
        </span>
      </div>
      <div className="grid gap-2">
        {visible.map(id => {
          const phase = PHASES.find(p => p.id === id)!;
          return <PhaseCard key={id} phase={phase} state={phaseState(id)} isComplete={isComplete} />;
        })}
      </div>
    </div>
  );
}

export function ShareBar({ sessionId, session }: { sessionId: number; session?: Session }) {
  const { toast } = useToast();
  const [shareToken, setShareToken] = useState<string | null>(session?.shareToken || null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setShareToken(session?.shareToken || null);
  }, [session?.shareToken, sessionId]);

  const shareUrl = shareToken ? `${window.location.origin}/shared/research/${shareToken}` : null;

  const handleShare = async () => {
    setLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/research/sessions/${sessionId}/share`, {
        method: "POST",
        headers: { ...authHeaders },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setShareToken(data.shareToken);
      const url = `${window.location.origin}/shared/research/${data.shareToken}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Link Copied", description: "Read-only share link copied to clipboard." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUnshare = async () => {
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(`/api/research/sessions/${sessionId}/share`, {
        method: "DELETE",
        headers: { ...authHeaders },
        credentials: "include",
      });
      setShareToken(null);
      toast({ title: "Unshared", description: "Share link has been revoked." });
    } catch {}
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 px-6 py-1.5 border-b border-border/20 bg-card/10">
      {!shareToken ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[9px] gap-1 text-muted-foreground/60 hover:text-foreground/80"
          onClick={handleShare}
          disabled={loading}
          data-testid="button-share-session"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
          Share
        </Button>
      ) : (
        <div className="flex items-center gap-1.5">
          <Link2 className="h-3 w-3 text-emerald-500/60" />
          <span className="text-[9px] text-muted-foreground/50 truncate max-w-[200px]">{shareUrl}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0"
            onClick={handleCopy}
            data-testid="button-copy-share-link"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Link2 className="h-3 w-3 text-muted-foreground/50" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 text-muted-foreground/40 hover:text-destructive"
            onClick={handleUnshare}
            data-testid="button-unshare-session"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  msg,
  onOverride,
  onDiveDeep,
  onAddToReport,
  onSaveAsModel,
  onContinue,
  isLast,
  busy,
  lastUserMessage,
}: {
  msg: SessionMessage;
  onOverride?: (action: { forceMode?: ResearchMode; refreshBrain?: boolean }) => void;
  onDiveDeep?: (text: string) => void;
  onAddToReport?: (msgId: number) => Promise<void>;
  onSaveAsModel?: (msgId: number, artifactIndex?: number) => Promise<void>;
  onContinue?: () => void;
  isLast?: boolean;
  busy?: boolean;
  lastUserMessage?: string;
}) {
  const isUser = msg.role === "user";
  const [reportState, setReportState] = useState<"idle" | "saving" | "saved">("idle");
  const [modelState, setModelState] = useState<"idle" | "saving" | "saved">("idle");

  if (isUser) {
    return (
      <div className="flex justify-end mb-5" data-testid={`msg-user-${msg.id}`}>
        <div className="max-w-[80%] bg-primary/10 rounded-xl px-4 py-3">
          <p className="text-[13px] text-foreground/90">{msg.content}</p>
        </div>
      </div>
    );
  }

  const { mode, cleaned, needsContinuation } = extractMode(msg.content);
  const parts = parseContentAndArtifacts(cleaned, msg.artifacts as Artifact[] | null);

  const artifacts: any[] = Array.isArray(msg.artifacts) ? msg.artifacts : [];
  const hasTableArtifacts = artifacts.some((a: any) => a.type === "table" || a.type === "metric_cards" || a.type === "chart" || a.type === "comparison");

  const showOverrides = isLast && !busy && onOverride && lastUserMessage;
  const canShorter = mode === "deep" || mode === "focused";
  const canDeeper = mode === "quick" || mode === "focused";
  const shorterTo: ResearchMode = mode === "deep" ? "focused" : "quick";
  const deeperTo: ResearchMode = mode === "quick" ? "focused" : "deep";

  return (
    <div className="mb-6 group/msg" data-testid={`msg-assistant-${msg.id}`}>
      <div className="flex items-center gap-2 mb-3">
        {mode && <ModeBadge mode={mode} />}
        <div className="flex-1" />
        {onAddToReport && (
          <button
            disabled={reportState !== "idle"}
            onClick={async () => {
              setReportState("saving");
              try {
                await onAddToReport(msg.id);
                setReportState("saved");
                setTimeout(() => setReportState("idle"), 3000);
              } catch {
                setReportState("idle");
              }
            }}
            className={`text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-colors ${
              reportState === "saved"
                ? "border-emerald-400/40 text-emerald-400 bg-emerald-400/5"
                : reportState === "saving"
                  ? "border-border/40 text-muted-foreground/40 cursor-wait"
                  : "border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/60 hover:bg-muted/20"
            }`}
            data-testid={`button-add-report-${msg.id}`}
          >
            {reportState === "saving" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : reportState === "saved" ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
            {reportState === "saving" ? "Saving..." : reportState === "saved" ? "Saved" : "Save Memo to Library"}
          </button>
        )}
        <a
          href={`/memo/${msg.conversationId}/${msg.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs px-2.5 py-1 rounded-md border flex items-center gap-1.5 transition-colors border-border/40 text-muted-foreground/60 hover:text-foreground hover:border-border/60 hover:bg-muted/20"
          data-testid={`button-download-memo-${msg.id}`}
          title="Open a print-ready memo for this prompt & response"
        >
          <FileDown className="w-3.5 h-3.5" />
          Download Memo
        </a>
      </div>
      <div className="max-w-full">
        {parts.map((part, i) => {
          const isArtifact = part.type === "table" || part.type === "chart" || part.type === "metric_cards" || part.type === "comparison";
          // Wrap each artifact in an ErrorBoundary so one bad chart/table
          // doesn't blank the whole message. Label for better console output.
          const raw = (() => {
            if (part.type === "text" && part.content) return <MarkdownText key={i} text={part.content} />;
            if (part.type === "metric_cards" && part.artifact) return <MetricCards key={i} artifact={part.artifact} />;
            if (part.type === "chart" && part.artifact) return <InlineChart key={i} artifact={part.artifact} />;
            if (part.type === "table" && part.artifact) return <InlineTable key={i} artifact={part.artifact} />;
            if (part.type === "callout" && part.artifact) return <CalloutBlock key={i} artifact={part.artifact} />;
            if (part.type === "comparison" && part.artifact) return <ComparisonBlock key={i} artifact={part.artifact} />;
            if (part.type === "quote" && part.artifact) return <QuoteBlock key={i} artifact={part.artifact} />;
            if (part.type === "sources" && part.artifact) return <SourcesBlock key={i} artifact={part.artifact} />;
            return null;
          })();
          const artifactEl = raw == null
            ? null
            : <ErrorBoundary key={`eb-${i}`} label={part.type}>{raw}</ErrorBoundary>;
          if (isArtifact && onSaveAsModel && part.artifactIdx !== undefined) {
            return (
              <div key={i}>
                {artifactEl}
                <div className="flex items-center gap-2 mt-1.5 mb-3">
                  <button
                    disabled={modelState !== "idle"}
                    onClick={async () => {
                      setModelState("saving");
                      try {
                        await onSaveAsModel(msg.id, part.artifactIdx);
                        setModelState("saved");
                        setTimeout(() => setModelState("idle"), 3000);
                      } catch {
                        setModelState("idle");
                      }
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border flex items-center gap-1 transition-colors ${
                      modelState === "saved"
                        ? "border-green-400/40 text-green-400 bg-green-400/5"
                        : modelState === "saving"
                          ? "border-border/30 text-muted-foreground/40 cursor-wait"
                          : "border-border/30 text-muted-foreground/50 hover:text-foreground hover:border-border/50 hover:bg-muted/20"
                    }`}
                    data-testid={`button-save-model-${msg.id}-${i}`}
                  >
                    {modelState === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : modelState === "saved" ? <Check className="w-3 h-3" /> : <Table2 className="w-3 h-3" />}
                    {modelState === "saving" ? "Saving..." : modelState === "saved" ? "Saved" : "Save as Model"}
                  </button>
                </div>
              </div>
            );
          }
          return artifactEl;
        })}
      </div>
      {needsContinuation && isLast && !busy && onContinue && (
        <div className="mt-5 flex justify-center" data-testid="continue-analysis-section">
          <button
            onClick={onContinue}
            className="group/btn flex items-center gap-3 px-6 py-3 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
            data-testid="button-continue-analysis"
          >
            <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center group-hover/btn:bg-primary/25 transition-colors">
              <RefreshCw className="w-4 h-4 text-primary" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-foreground/90">Continue Analysis</p>
              <p className="text-[11px] text-muted-foreground/60">Pick up where we left off and complete the synthesis</p>
            </div>
          </button>
        </div>
      )}
      {showOverrides && !needsContinuation && (
        <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid="mode-overrides">
          {canShorter && (
            <button
              onClick={() => onOverride!({ forceMode: shorterTo })}
              className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
              data-testid="button-shorter"
            >
              <ArrowUp className="w-3 h-3" /> Shorter
            </button>
          )}
          {canDeeper && (
            <button
              onClick={() => onOverride!({ forceMode: deeperTo })}
              className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
              data-testid="button-deeper"
            >
              <ArrowDown className="w-3 h-3" /> Deeper
            </button>
          )}
          <button
            onClick={() => onOverride!({ refreshBrain: true })}
            className="text-xs px-3 py-1.5 rounded-md border border-border/40 text-muted-foreground/70 hover:text-foreground hover:border-border hover:bg-muted/20 transition-colors flex items-center gap-1.5"
            data-testid="button-refresh-data"
          >
            <RefreshCw className="w-3 h-3" /> Refresh data
          </button>
        </div>
      )}
    </div>
  );
}
