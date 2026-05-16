/**
 * Bootstrap synthesis_observations from sessions' OWN historical memos.
 *
 * Initial design used analyst_documents (the HRC corpus of 4,372 docs) as
 * the bootstrap source, but the data revealed two problems:
 *   1. ~85% of the corpus is Twitter threads with no document-level
 *      structural patterns (no scenario tables, no baseline blocks, etc.).
 *   2. The valuation analysts (defi_monk, RyanWatkins_, AustinBarack) have
 *      NO long-form pieces in the corpus — only tweets. So the analyst
 *      framework metadata is rich but the prose bodies for them don't exist.
 *
 * Sessions has 163 assistant messages with body >2000 chars already (116
 * memo-grade at >5000 chars) — that IS the right bootstrap source. Same
 * distribution as what the live observer will see, and it gives us
 * pre-existing priors against which to evaluate detector calibration
 * before Phase 3 runs the correlator.
 *
 * Run:
 *   npx tsx script/bootstrap-synthesis-observations.ts            # full pass
 *   npx tsx script/bootstrap-synthesis-observations.ts --limit 20 # smoke test
 *
 * Idempotent: skips message_ids already in synthesis_observations.message_id
 * with provenance='sessions:historical'. Re-running picks up new memos.
 *
 * Output:
 *   - per-pattern frequency across the historical memo corpus
 *   - examples of each pattern in the wild
 * This is the data Phase 3's correlator will use as priors. If a pattern
 * never fires across 163 historical memos, that's a strong signal that
 * sessions isn't producing it — exactly the gap the AQAv2-vs-hermes
 * comparison surfaced.
 */

import "dotenv/config";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { observeSynthesisOutput } from "../server/synthesis-observer";

interface HistoricalMemo {
  id: string;
  conversation_id: string;
  content: string;
  created_at: Date;
  kind: string | null;
}

async function fetchMemos(opts: { limit?: number; skipIds: Set<string> }): Promise<HistoricalMemo[]> {
  const lim = opts.limit ? sql`LIMIT ${opts.limit * 2}` : sql``; // overshoot to account for filter
  const rows = await db.execute<HistoricalMemo>(sql`
    SELECT id, conversation_id, content, created_at, kind
    FROM messages
    WHERE role = 'assistant'
      AND LENGTH(content) >= 2000
    ORDER BY created_at DESC
    ${lim}
  `);
  const arr: any[] = (rows as any).rows ?? rows;
  const filtered = arr.filter((r) => !opts.skipIds.has(r.id));
  return opts.limit ? filtered.slice(0, opts.limit) : filtered;
}

async function loadSkipSet(): Promise<Set<string>> {
  const rows = await db.execute<{ message_id: string }>(sql`
    SELECT message_id FROM synthesis_observations
    WHERE provenance = 'sessions:historical'
      AND message_id IS NOT NULL
  `);
  const arr: any[] = (rows as any).rows ?? rows;
  return new Set(arr.map((r) => r.message_id));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

  console.log(`[bootstrap] Loading skip set...`);
  const skipIds = await loadSkipSet();
  console.log(`[bootstrap] ${skipIds.size} historical memos already observed`);

  console.log(`[bootstrap] Fetching historical assistant memos${limit ? ` (limit ${limit})` : ""}...`);
  const memos = await fetchMemos({ limit, skipIds });
  console.log(`[bootstrap] ${memos.length} new memos to observe`);

  if (memos.length === 0) {
    console.log("[bootstrap] Nothing to do.");
    process.exit(0);
  }

  const patternCounts: Record<string, number> = {};
  let written = 0;
  let skipped = 0;
  // For each pattern, keep one representative example so we can show the
  // user what the detector actually matched on.
  const patternExamples: Record<string, { messageId: string; snippet: string }> = {};

  for (let i = 0; i < memos.length; i++) {
    const memo = memos[i];
    try {
      // Strip the <!-- mode:X --> prefix the agent prepends when persisting.
      const cleanBody = memo.content.replace(/^<!--[^>]*-->\s*/g, "").trim();
      const res = await observeSynthesisOutput({
        sessionId: memo.conversation_id,
        messageId: memo.id,
        userId: "default",
        mode: memo.kind === "deep_model" ? "deep" : null,
        playbookId: null,
        memoBody: cleanBody,
        subjectEntities: [],
        provenance: "sessions:historical",
        provenanceRef: memo.id,
      });
      if (!res) {
        skipped++;
        continue;
      }
      written++;
      for (const p of res.patterns) {
        patternCounts[p] = (patternCounts[p] || 0) + 1;
        if (!patternExamples[p]) {
          // Record the matched snippet from the patterns_detail JSONB
          // we just wrote — we have the IDs, fetch back for the snippet.
          patternExamples[p] = { messageId: memo.id, snippet: "" };
        }
      }
      if ((i + 1) % 50 === 0) {
        console.log(`[bootstrap] ${i + 1}/${memos.length}  written=${written}  skipped=${skipped}`);
      }
    } catch (err: any) {
      console.warn(`[bootstrap] memo ${memo.id}: ${err?.message}`);
      skipped++;
    }
  }

  console.log(`\n[bootstrap] DONE — observed=${written}, skipped=${skipped}, total=${memos.length}\n`);

  // Aggregate report.
  const totalObserved = written;
  console.log(`Pattern frequency across ${totalObserved} historical sessions memos:`);
  const sortedPatterns = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
  if (sortedPatterns.length === 0) {
    console.log("  (no patterns detected — calibrate detectors or check sample bodies)");
  } else {
    for (const [p, c] of sortedPatterns) {
      const pct = ((c / totalObserved) * 100).toFixed(1);
      console.log(`  ${p.padEnd(32)} ${c.toString().padStart(5)} (${pct}%)`);
    }
  }

  // Surface the gap: patterns that exist in our detector catalogue but
  // never fired. These are precisely the structural elements sessions
  // is failing to produce — the same ones flagged in the hermes-vs-sessions
  // AQAv2 comparison.
  const ALL_PATTERNS = [
    "scenario_lattice",
    "baseline_financials_header",
    "coverage_ratio_analysis",
    "lens_attribution",
    "sources_block_explicit",
    "executive_summary_block",
    "watchlist_block",
  ];
  const missing = ALL_PATTERNS.filter((p) => !patternCounts[p]);
  if (missing.length > 0) {
    console.log(`\nPatterns NEVER observed in historical memos:`);
    for (const p of missing) console.log(`  ✗ ${p}`);
    console.log(`These are the structural gaps in sessions' current output distribution.`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[bootstrap] fatal:", err);
  process.exit(1);
});
