/**
 * One-off backfill: re-parse historical assistant messages with the
 * updated `parseArtifacts` (which now recognises `file_download` blocks)
 * and APPEND any newly-parsed file_download entries onto msg.artifacts.
 *
 * Why: messages 559/561 were written before the parser fix landed, so
 * the `artifact:file_download` blocks in their content text never made
 * it into the persisted artifacts JSON. The Excel files are on disk and
 * downloadable, but the side panel's DownloadsPanel doesn't see them.
 *
 * Safe to re-run: idempotent — checks for existing file_download artifact
 * with matching URL before appending.
 *
 * Usage:
 *   npx tsx script/backfill-file-downloads.ts             # backfill all
 *   npx tsx script/backfill-file-downloads.ts --msg 559   # one message
 *   npx tsx script/backfill-file-downloads.ts --dry-run   # report only
 */

import "dotenv/config";
import { pool } from "../server/db";
import { parseArtifacts } from "../server/session-research-agent";

interface Row {
  id: number;
  conversation_id: number;
  content: string;
  artifacts: any;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyMsgIdx = args.indexOf("--msg");
  const onlyMsgId = onlyMsgIdx >= 0 ? Number(args[onlyMsgIdx + 1]) : null;

  const client = await pool.connect();
  try {
    // Find candidate messages: assistant, content contains an
    // artifact:file_download block, optionally restricted to one id.
    let rows: Row[];
    if (onlyMsgId) {
      const r = await client.query(
        `SELECT id, conversation_id, content, COALESCE(artifacts, '[]'::jsonb) AS artifacts
           FROM messages WHERE id = $1`,
        [onlyMsgId],
      );
      rows = r.rows;
    } else {
      const r = await client.query(
        `SELECT id, conversation_id, content, COALESCE(artifacts, '[]'::jsonb) AS artifacts
           FROM messages
          WHERE role = 'assistant'
            AND content LIKE '%artifact:file_download%'
          ORDER BY id ASC`,
      );
      rows = r.rows;
    }

    console.log(`[backfill] ${rows.length} message(s) contain artifact:file_download blocks`);

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const parsed = parseArtifacts(row.content);
      const fileDownloads = parsed.filter((a: any) => a?.type === "file_download");
      if (fileDownloads.length === 0) {
        console.log(`  msg ${row.id}: 0 file_downloads parsed — skip`);
        skipped++;
        continue;
      }

      const existing = Array.isArray(row.artifacts) ? row.artifacts : [];
      const existingUrls = new Set(
        existing
          .filter((a: any) => a?.type === "file_download")
          .map((a: any) => a.url)
          .filter(Boolean),
      );

      // Only append ones we don't already have.
      const toAppend = fileDownloads.filter((a: any) => !existingUrls.has(a.url));
      if (toAppend.length === 0) {
        console.log(`  msg ${row.id}: ${fileDownloads.length} file_downloads parsed, all already present — skip`);
        skipped++;
        continue;
      }

      const merged = [...existing, ...toAppend];
      console.log(`  msg ${row.id}: appending ${toAppend.length} file_download(s):`);
      for (const f of toAppend as any[]) {
        console.log(`    [${f.subtype || "?"}] ${f.filename} (${f.sizeBytes ?? "?"} bytes) → ${f.url}`);
      }

      if (!dryRun) {
        await client.query(
          `UPDATE messages SET artifacts = $1::jsonb WHERE id = $2`,
          [JSON.stringify(merged), row.id],
        );
      }
      updated++;
    }

    console.log(`\n[backfill] ${dryRun ? "would update" : "updated"} ${updated} message(s), skipped ${skipped}`);
  } finally {
    client.release();
  }
  await pool.end();
}

main().catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
