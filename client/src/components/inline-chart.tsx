import type { DashboardChart } from "@shared/schema";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { format } from "date-fns";

const CHART_COLORS = [
  "#3b6fd4", "#94a3b8", "#5a8de6", "#8b5cf6",
  "#2d5fc0", "#a78bfa", "#4b7ad8", "#7c8db5",
];

function smartFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function axisFormat(value: number, fmt?: string): string {
  if (fmt === "currency") {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  }
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    return `${pct.toFixed(0)}%`;
  }
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

function smartTooltip(value: number, fmt?: string): string {
  if (fmt === "currency") return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (fmt === "percent") {
    const pct = Math.abs(value) < 1 ? value * 100 : value;
    return `${pct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function toUnixSec(val: unknown): number | null {
  if (typeof val === "number") {
    if (val > 1e12) return val / 1000;
    if (val > 1e8) return val;
    return null;
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return d.getTime() / 1000;
  }
  return null;
}

function isDateColumn(col: string, rows: Record<string, unknown>[]): boolean {
  if (!/date|time|day|week|month|block_time|period/i.test(col)) return false;
  const sample = rows[0]?.[col];
  if (typeof sample === "string" && /\d{4}/.test(sample)) return true;
  if (typeof sample === "number" && sample > 1e8) return true;
  return false;
}

function guessFormat(col: string): string {
  if (/usd|price|fee|revenue|volume|amount|cost|tvl|value|earnings|profit|market_cap|fdv/i.test(col)) return "currency";
  if (/pct|percent|ratio|apy|apr|growth|change|rate/i.test(col)) return "percent";
  return "number";
}

function autoCorrectChartConfig(config: Record<string, unknown>, data: Record<string, unknown>[]): Record<string, unknown> {
  if (!config || !data || data.length === 0) return config;
  const xAxis = config.xAxis as Record<string, unknown> | undefined;
  const yAxes = config.yAxes as Record<string, unknown>[] | undefined;
  if (!xAxis || !yAxes) return config;

  const sampleRow = data[0];
  const allCols = Object.keys(sampleRow);
  const xKeyExists = allCols.includes(xAxis.dataKey as string);

  let xNeedsCorrection = !xKeyExists;
  if (xKeyExists && data.length > 1) {
    const xVals = data.map(d => d[xAxis.dataKey as string]);
    const uniqueVals = new Set(xVals.map(v => String(v)));
    if (uniqueVals.size <= 1) xNeedsCorrection = true;
  }

  const yKeysExist = yAxes.every(y => allCols.includes(y.dataKey as string));
  if (!xNeedsCorrection && xKeyExists && yKeysExist) return config;

  const dateCols = allCols.filter(c => isDateColumn(c, data));
  const numericCols = allCols.filter(c => {
    if (dateCols.includes(c)) return false;
    const sample = data.find(d => d[c] != null)?.[c];
    return typeof sample === "number";
  });
  const stringCols = allCols.filter(c => !dateCols.includes(c) && !numericCols.includes(c));

  const corrected = JSON.parse(JSON.stringify(config));

  if (xNeedsCorrection) {
    if (dateCols.length > 0) {
      corrected.xAxis.dataKey = dateCols[0];
      corrected.xAxis.type = "date";
    } else if (stringCols.length > 0) {
      corrected.xAxis.dataKey = stringCols[0];
    } else if (numericCols.length > 0) {
      corrected.xAxis.dataKey = numericCols[0];
    }
  }

  const usedCols = new Set([corrected.xAxis.dataKey]);
  const availableNumeric = numericCols.filter(c => !usedCols.has(c));

  for (let i = 0; i < corrected.yAxes.length; i++) {
    const y = corrected.yAxes[i];
    if (!allCols.includes(y.dataKey)) {
      if (availableNumeric.length > 0) {
        const col = availableNumeric.shift()!;
        corrected.yAxes[i].dataKey = col;
        corrected.yAxes[i].format = guessFormat(col);
        usedCols.add(col);
      }
    } else {
      usedCols.add(y.dataKey);
    }
  }

  return corrected;
}

function buildDateFormatter(data: Record<string, unknown>[], xKey: string) {
  let minYear = Infinity, maxYear = -Infinity;
  for (const d of data) {
    const ts = d[xKey];
    if (typeof ts !== "number") continue;
    try {
      const yr = new Date(ts * 1000).getFullYear();
      if (yr < minYear) minYear = yr;
      if (yr > maxYear) maxYear = yr;
    } catch { /* skip */ }
  }
  const spansYears = maxYear > minYear && minYear > 1970;
  return {
    tickFormatter: (ts: number) => {
      try {
        const d = new Date(ts * 1000);
        if (d.getFullYear() < 1971) return "";
        return spansYears ? format(d, "MMM ''yy") : format(d, "MMM d");
      } catch { return String(ts); }
    },
    tooltipFormatter: (ts: unknown) => {
      if (typeof ts !== "number") return String(ts);
      try {
        const d = new Date(ts * 1000);
        return d.getFullYear() < 1971 ? String(ts) : format(d, "MMM d, yyyy");
      } catch { return String(ts); }
    },
  };
}

export function InlineChartRenderer({ chart }: { chart: DashboardChart }) {
  if ((chart.status !== "complete" && chart.status !== "completed") || !chart.data) {
    return <p className="text-xs text-muted-foreground italic">Chart data not available (status: {chart.status})</p>;
  }

  let chartData: Record<string, unknown>[] = [];
  let chartConfig: Record<string, unknown> = {};
  try {
    chartData = chart.data ? JSON.parse(chart.data) : [];
    chartConfig = chart.chartConfig ? JSON.parse(chart.chartConfig) : {};
  } catch {
    return <p className="text-xs text-muted-foreground italic">Failed to parse chart data</p>;
  }

  if (chartData.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No data</p>;
  }

  const hasChartConfig = chartConfig.xAxis && chartConfig.yAxes && (chartConfig.yAxes as unknown[]).length > 0;
  const isTable = chart.chartType === "table" || !hasChartConfig;

  if (isTable) {
    const columns = (chartConfig.columns as string[]) || (chartData[0] ? Object.keys(chartData[0]) : []);
    return (
      <div className="overflow-x-auto max-h-[300px]">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-background z-10">
            <tr>
              {columns.map((col: string) => (
                <th key={col} className="text-left px-3 py-2 text-[9px] font-medium text-muted-foreground/50 uppercase tracking-wider border-b border-border/40 whitespace-nowrap">
                  {col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartData.slice(0, 50).map((row, i) => (
              <tr key={i} className="border-b border-border/20 hover:bg-muted/20">
                {columns.map((col: string) => {
                  const val = row[col];
                  let display: string;
                  if (val == null) display = "—";
                  else if (typeof val === "number") display = smartFormat(val, guessFormat(col));
                  else display = String(val);
                  return (
                    <td key={col} className="px-3 py-1.5 text-foreground/50 whitespace-nowrap font-mono text-[10px]">
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const correctedConfig = autoCorrectChartConfig(chartConfig, chartData);
  const xAxis = correctedConfig.xAxis as Record<string, unknown>;
  const yAxes = correctedConfig.yAxes as Record<string, unknown>[];
  const isDate = xAxis.type === "date";
  const primaryFmt = (yAxes[0]?.format as string) || "number";
  const cType = chart.chartType || "line";

  const processedData = chartData.map(d => {
    const processed = { ...d };
    if (isDate && processed[xAxis.dataKey as string] != null) {
      const converted = toUnixSec(processed[xAxis.dataKey as string]);
      if (converted !== null) (processed as Record<string, unknown>)[xAxis.dataKey as string] = converted;
    }
    return processed;
  }).sort((a, b) => {
    const aV = a[xAxis.dataKey as string], bV = b[xAxis.dataKey as string];
    return typeof aV === "number" && typeof bV === "number" ? aV - bV : 0;
  });

  const numPoints = processedData.length;
  const dateFmt = isDate ? buildDateFormatter(processedData, xAxis.dataKey as string) : null;
  const hasDualAxis = yAxes.some(y => y.yAxisId === "right");
  const hasMixedTypes = yAxes.some(y => y.chartType && y.chartType !== cType);
  const useComposed = hasDualAxis || hasMixedTypes;
  const maxTicks = 6;
  const tickInterval = numPoints <= maxTicks ? 0 : Math.floor(numPoints / maxTicks);

  const xAxisEl = (
    <XAxis
      dataKey={xAxis.dataKey as string}
      tickFormatter={isDate ? dateFmt!.tickFormatter : undefined}
      tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
      axisLine={{ stroke: "var(--color-chart-line)" }}
      tickLine={false}
      interval={tickInterval}
      height={22}
    />
  );
  const singleYAxisEl = (
    <YAxis
      domain={[0, "auto"]}
      tickFormatter={(v: number) => axisFormat(v, primaryFmt)}
      tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }}
      axisLine={false}
      tickLine={false}
      width={44}
      tickCount={5}
    />
  );
  const yAxisLeftEl = <YAxis yAxisId="left" domain={[0, "auto"]} tickFormatter={(v: number) => axisFormat(v, primaryFmt)} tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }} axisLine={false} tickLine={false} width={44} tickCount={5} />;
  const yAxisRightEl = hasDualAxis ? <YAxis yAxisId="right" orientation="right" domain={[0, "auto"]} tickFormatter={(v: number) => axisFormat(v, (yAxes.find(y => y.yAxisId === "right") as Record<string, string>)?.format || primaryFmt)} tick={{ fontSize: 9, fill: "var(--color-chart-tick)" }} axisLine={false} tickLine={false} width={40} tickCount={5} /> : null;
  const gridEl = <CartesianGrid strokeDasharray="2 6" stroke="var(--color-chart-grid)" vertical={false} />;
  const tooltipEl = (
    <Tooltip
      contentStyle={{ backgroundColor: "var(--color-tooltip-bg)", border: "1px solid var(--color-tooltip-border)", borderRadius: "8px", fontSize: "12px", padding: "8px 12px", color: "var(--color-tooltip-text)" }}
      labelFormatter={isDate ? dateFmt!.tooltipFormatter : (l: unknown) => String(l)}
      formatter={(value: unknown, name: string) => {
        const ax = yAxes.find(y => y.dataKey === name);
        return [smartTooltip(value as number, (ax?.format as string) || primaryFmt), (ax?.label as string) || name.replace(/_/g, " ")];
      }}
    />
  );
  const legendEl = yAxes.length > 1 ? (
    <Legend verticalAlign="top" align="left" height={22} iconType="plainline" iconSize={10}
      wrapperStyle={{ fontSize: "9px", color: "var(--color-tooltip-text)", paddingBottom: "2px" }}
      formatter={(v: string) => { const ax = yAxes.find(y => y.dataKey === v); return (ax?.label as string) || v.replace(/_/g, " "); }}
    />
  ) : null;

  const chartEl = (() => {
    if (useComposed) {
      return (
        <ComposedChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {gridEl}{xAxisEl}{yAxisLeftEl}{yAxisRightEl}{tooltipEl}{legendEl}
          {yAxes.map((y, i) => {
            const axisId = y.yAxisId as string || "left";
            const color = CHART_COLORS[i % CHART_COLORS.length];
            const seriesType = (y.chartType as string) || cType;
            if (seriesType === "bar") return <Bar key={y.dataKey as string} dataKey={y.dataKey as string} yAxisId={axisId} fill={color} radius={[1, 1, 0, 0]} maxBarSize={32} opacity={0.85} />;
            if (seriesType === "area") return <Area key={y.dataKey as string} type="monotone" dataKey={y.dataKey as string} yAxisId={axisId} stroke={color} strokeWidth={1.2} fill={color} fillOpacity={0.08} dot={false} />;
            return <Line key={y.dataKey as string} type="monotone" dataKey={y.dataKey as string} yAxisId={axisId} stroke={color} strokeWidth={1.2} dot={false} />;
          })}
        </ComposedChart>
      );
    }
    if (cType === "bar") {
      return (
        <BarChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
          {yAxes.map((y, i) => <Bar key={y.dataKey as string} dataKey={y.dataKey as string} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={numPoints <= 12 ? 48 : 20} opacity={0.85} />)}
        </BarChart>
      );
    }
    if (cType === "area") {
      return (
        <AreaChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
          {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
          {yAxes.map((y, i) => <Area key={y.dataKey as string} type="monotone" dataKey={y.dataKey as string} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.08} dot={false} />)}
        </AreaChart>
      );
    }
    return (
      <LineChart data={processedData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
        {gridEl}{xAxisEl}{singleYAxisEl}{tooltipEl}{legendEl}
        {yAxes.map((y, i) => <Line key={y.dataKey as string} type="monotone" dataKey={y.dataKey as string} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.2} dot={false} />)}
      </LineChart>
    );
  })();

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        {chartEl}
      </ResponsiveContainer>
    </div>
  );
}
