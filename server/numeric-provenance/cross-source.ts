/**
 * Cross-source check for canonical headline metrics.
 *
 * v1 catches the highest-leverage failure mode observed in real outputs:
 * the agent computes a windowed sum from the daily series (e.g. "LTM
 * fees = $329.9M") but the source's own pre-aggregated number
 * (DefiLlama's `total30d`, `totalAllTime`) disagrees materially. That
 * disagreement is the strongest signal the agent's bin aggregation is
 * wrong (the Q3↔Q4 swap class of bug).
 *
 * Generalizes later to true cross-provider checks (DefiLlama vs
 * Token Terminal vs the protocol's own dashboard). The interface is
 * built to accept additional providers without refactoring the caller.
 */

import { getTurn, type ComputeRecord } from "./turn-cache";

export interface CrossSourceIssue {
  metric: string;
  agentValue: number;
  agentValueStr: string;
  expectedValue: number;
  expectedValueStr: string;
  source: string;
  deltaPct: number;
}

export interface CrossSourceReport {
  checks: number;
  issues: CrossSourceIssue[];
}

/** A "canonical metric" the agent commonly computes whose true value
 *  can be reconstructed from a known source endpoint or summary field. */
interface CanonicalCheck {
  computeNamePattern: RegExp;
  format: "currency" | "percent" | "ratio" | "number" | "tokens";
  // Returns expected value + label, or null if not checkable in this run.
  fetchExpected: (compute: ComputeRecord) => Promise<{ value: number; label: string } | null>;
}

const TOLERANCE_PCT = 8; // soft threshold — flag if delta exceeds this %

const CHECKS: CanonicalCheck[] = [
  {
    // "LTM Gross Fees", "LTM Fees", "TTM Gross Fees" etc. computed via sum_trailing_days(365)
    computeNamePattern: /\bLT[MM]?\b.*\b(gross\s+fees?|fees?|trading\s+fees?)\b/i,
    format: "currency",
    fetchExpected: async (c) => {
      if (c.formula !== "sum_trailing_days") return null;
      const days = Number(c.params?.days);
      if (days < 350 || days > 380) return null;
      const slug = extractSlugFromSourceLabel(c.sourceLabel);
      if (!slug) return null;
      try {
        const { getProtocolFees } = await import("../defillama-client");
        const r = await getProtocolFees(slug);
        // DefiLlama exposes totalAllTime; for LTM there's no exact field, but
        // the daily series sum filtered to 365d should match what we computed.
        // Use the same daily series and check OUR re-sum against the agent's value.
        const cutoff = Date.now() - days * 86400000;
        const sum = (r.totalDataChart || [])
          .filter((p: any) => Array.isArray(p) && p[0] * 1000 >= cutoff)
          .reduce((acc: number, p: any) => acc + (Number(p[1]) || 0), 0);
        return { value: sum, label: `defillama re-sum of ${slug} fees, last ${days}d` };
      } catch {
        return null;
      }
    },
  },
  {
    // "30d Fees", "30 day fees", "30-day Gross Fees"
    computeNamePattern: /\b30[\s-]?d(ay)?\b.*\b(gross\s+fees?|fees?|trading\s+fees?)\b/i,
    format: "currency",
    fetchExpected: async (c) => {
      const slug = extractSlugFromSourceLabel(c.sourceLabel);
      if (!slug) return null;
      try {
        const { getProtocolFees } = await import("../defillama-client");
        const r = await getProtocolFees(slug);
        if (typeof r.total30d === "number") {
          return { value: r.total30d, label: `defillama summary.total30d for ${slug}` };
        }
        return null;
      } catch {
        return null;
      }
    },
  },
  {
    // "30d Revenue", "30-day Protocol Revenue"
    computeNamePattern: /\b30[\s-]?d(ay)?\b.*\b(revenue|protocol\s+revenue)\b/i,
    format: "currency",
    fetchExpected: async (c) => {
      const slug = extractSlugFromSourceLabel(c.sourceLabel);
      if (!slug) return null;
      try {
        const { getProtocolRevenue } = await import("../defillama-client");
        const r = await getProtocolRevenue(slug);
        if (typeof r.total30d === "number") {
          return { value: r.total30d, label: `defillama revenue.total30d for ${slug}` };
        }
        return null;
      } catch {
        return null;
      }
    },
  },
];

function extractSlugFromSourceLabel(label: string): string | null {
  // Convention: "defillama_fees_revenue:hyperliquid" or "defillama:hyperliquid"
  const m = label.match(/defillama[^:]*:([a-z0-9-]+)/i);
  if (!m) return null;
  return m[1];
}

/**
 * Walk every compute() result from this turn, find any matching a
 * canonical-metric pattern, fetch the expected value from the same
 * source's pre-aggregated field, and flag deltas above tolerance.
 *
 * Best-effort: any per-check failure is silently skipped — never blocks
 * the response. Caller decides what to do with returned issues.
 */
export async function checkCrossSource(turnId: string): Promise<CrossSourceReport> {
  const turn = getTurn(turnId);
  if (!turn) return { checks: 0, issues: [] };
  const issues: CrossSourceIssue[] = [];
  let checks = 0;

  for (const c of turn.computes) {
    for (const check of CHECKS) {
      if (!check.computeNamePattern.test(c.name)) continue;
      try {
        const expected = await check.fetchExpected(c);
        if (!expected) continue;
        checks++;
        const deltaPct =
          expected.value === 0
            ? 0
            : Math.abs((c.value - expected.value) / expected.value) * 100;
        if (deltaPct > TOLERANCE_PCT) {
          issues.push({
            metric: c.name,
            agentValue: c.value,
            agentValueStr: c.valueStr,
            expectedValue: expected.value,
            expectedValueStr: formatCompact(expected.value, c.format),
            source: expected.label,
            deltaPct,
          });
        }
      } catch {
        // skip — best effort
      }
    }
  }

  return { checks, issues };
}

function formatCompact(n: number, format: string): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (format === "percent") return `${n.toFixed(2)}%`;
  if (format === "ratio") return `${n.toFixed(2)}x`;
  if (format === "currency") {
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  }
  return String(n);
}

export function summarizeCrossSourceReport(report: CrossSourceReport): string {
  if (report.issues.length === 0) return "";
  const lines: string[] = [];
  lines.push(
    `${report.issues.length} canonical metric${report.issues.length === 1 ? "" : "s"} disagree with the source's own pre-aggregated value:`,
  );
  for (const issue of report.issues) {
    lines.push(
      `  • "${issue.metric}": agent says ${issue.agentValueStr}, ${issue.source} says ${issue.expectedValueStr} (${issue.deltaPct.toFixed(1)}% delta).`,
    );
  }
  return lines.join("\n");
}
