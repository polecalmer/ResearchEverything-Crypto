/**
 * Cost report — query the llm_cost_events ledger for spend rollups.
 *
 * Usage:
 *   npx tsx script/cost-report.ts                          # today's spend, all users
 *   npx tsx script/cost-report.ts --user <userId>          # filter by user
 *   npx tsx script/cost-report.ts --conv 205               # one conversation
 *   npx tsx script/cost-report.ts --since "2026-05-17"     # since a date
 *   npx tsx script/cost-report.ts --by-message --conv 205  # per-message breakdown
 *   npx tsx script/cost-report.ts --by-kind                # group by call_kind
 *
 * Outputs both `cost_estimate` (sessions' voucher) and `cost_actual`
 * (reconciled from OR receipts when available). Estimate over-states
 * actual by ~25-40% — relabeled rows show both numbers.
 */

import "dotenv/config";
import { pool } from "../server/db";

interface Args {
  userId?: string;
  conv?: number;
  since?: string;
  byMessage?: boolean;
  byKind?: boolean;
  byConv?: boolean;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  return {
    userId: get("--user"),
    conv: get("--conv") ? Number(get("--conv")) : undefined,
    since: get("--since"),
    byMessage: a.includes("--by-message"),
    byKind: a.includes("--by-kind"),
    byConv: a.includes("--by-conv"),
  };
}

async function main() {
  const args = parseArgs();
  const client = await pool.connect();
  try {
    const where: string[] = [];
    const params: any[] = [];
    if (args.userId) { params.push(args.userId); where.push(`user_id = $${params.length}`); }
    if (args.conv != null) { params.push(args.conv); where.push(`conversation_id = $${params.length}`); }
    const sinceIso = args.since || new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    params.push(sinceIso);
    where.push(`created_at >= $${params.length}`);
    const whereSql = "WHERE " + where.join(" AND ");

    // Top-level summary
    const summary = await client.query(
      `SELECT
         count(*)::int                                    AS calls,
         sum(input_tokens)::bigint                        AS input_tokens,
         sum(output_tokens)::bigint                       AS output_tokens,
         sum(cache_read_tokens)::bigint                   AS cache_read,
         sum(cost_estimate)::numeric(12,4)                AS spend_estimate,
         sum(COALESCE(cost_actual, cost_estimate))::numeric(12,4) AS spend_best,
         min(created_at)                                  AS first_call,
         max(created_at)                                  AS last_call
       FROM llm_cost_events
       ${whereSql}`,
      params,
    );
    const s = summary.rows[0];
    const total_in = Number(s.input_tokens || 0);
    const cache_pct = total_in > 0 ? ((Number(s.cache_read) / total_in) * 100).toFixed(1) : "0.0";

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log(`COST REPORT  ${args.userId ? `user=${args.userId.slice(0,8)}…` : ""}`);
    console.log(`             ${args.conv != null ? `conversation=${args.conv}` : ""}`);
    console.log(`             since=${sinceIso}`);
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`  Calls:           ${s.calls}`);
    console.log(`  Input tokens:    ${total_in.toLocaleString()}`);
    console.log(`  Output tokens:   ${Number(s.output_tokens || 0).toLocaleString()}`);
    console.log(`  Cache hits:      ${Number(s.cache_read || 0).toLocaleString()} (${cache_pct}% of input)`);
    console.log(`  Spend (est):     $${s.spend_estimate}`);
    console.log(`  Spend (best):    $${s.spend_best}  ← uses cost_actual where reconciled`);
    console.log(`  Window:          ${s.first_call ? new Date(s.first_call).toISOString() : "?"} → ${s.last_call ? new Date(s.last_call).toISOString() : "?"}`);

    // Per-message breakdown
    if (args.byMessage && args.conv != null) {
      const r = await client.query(
        `SELECT
           message_id,
           count(*)::int               AS calls,
           sum(input_tokens)::int      AS input_t,
           sum(output_tokens)::int     AS output_t,
           sum(cost_estimate)::numeric(10,4) AS est,
           sum(COALESCE(cost_actual, cost_estimate))::numeric(10,4) AS best
         FROM llm_cost_events
         ${whereSql}
         GROUP BY message_id
         ORDER BY message_id NULLS LAST`,
        params,
      );
      console.log("\n  ── Per-message breakdown ─────────────────────────────");
      console.log("  msg_id  calls  in_tokens  out_tokens  est        actual");
      for (const row of r.rows) {
        const mid = row.message_id ? String(row.message_id).padStart(6) : "  (n/a)";
        const c = String(row.calls).padStart(5);
        const i = String(row.input_t).padStart(10);
        const o = String(row.output_t).padStart(10);
        const e = `$${Number(row.est).toFixed(4)}`.padStart(10);
        const b = `$${Number(row.best).toFixed(4)}`.padStart(10);
        console.log(`  ${mid}  ${c}  ${i}  ${o}  ${e}  ${b}`);
      }
    }

    // Per-call-kind breakdown
    if (args.byKind) {
      const r = await client.query(
        `SELECT
           call_kind,
           count(*)::int               AS calls,
           sum(cost_estimate)::numeric(10,4) AS est,
           sum(COALESCE(cost_actual, cost_estimate))::numeric(10,4) AS best
         FROM llm_cost_events
         ${whereSql}
         GROUP BY call_kind
         ORDER BY sum(cost_estimate) DESC`,
        params,
      );
      console.log("\n  ── By call_kind ───────────────────────────────────────");
      for (const row of r.rows) {
        console.log(`  ${row.call_kind.padEnd(22)}  ${String(row.calls).padStart(4)} calls  est $${row.est}  best $${row.best}`);
      }
    }

    // Per-conversation roll-up
    if (args.byConv) {
      const r = await client.query(
        `SELECT
           conversation_id,
           count(*)::int                 AS calls,
           count(DISTINCT message_id) FILTER (WHERE message_id IS NOT NULL)::int AS msgs,
           sum(cost_estimate)::numeric(10,4) AS est,
           sum(COALESCE(cost_actual, cost_estimate))::numeric(10,4) AS best
         FROM llm_cost_events
         ${whereSql}
         GROUP BY conversation_id
         ORDER BY sum(cost_estimate) DESC
         LIMIT 25`,
        params,
      );
      console.log("\n  ── By conversation ────────────────────────────────────");
      for (const row of r.rows) {
        const conv = row.conversation_id ?? "(none)";
        console.log(`  conv ${String(conv).padStart(5)}  ${String(row.calls).padStart(4)} calls  ${String(row.msgs).padStart(3)} msgs  est $${row.est}  best $${row.best}`);
      }
    }

    console.log("");
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
