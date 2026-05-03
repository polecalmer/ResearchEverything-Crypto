// One-time baseline for an existing database that already has the schema
// applied (via the legacy `drizzle-kit push` workflow). Marks every
// migration in ./migrations/meta/_journal.json as already applied so
// `db:migrate` skips them.
//
// Usage:  npm run db:baseline
//
// Safe to re-run — uses INSERT ... WHERE NOT EXISTS on (hash) so each
// migration is recorded exactly once.
//
// Run this *once per existing environment* (dev Supabase, staging, prod)
// after merging the initial migration. New environments don't need it —
// they should run `db:migrate` against an empty DB instead.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const migrationsDir = path.resolve("./migrations");
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No journal at ${journalPath} — run \`npm run db:generate\` first`);
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    let inserted = 0;
    let skipped = 0;
    for (const entry of journal.entries) {
      const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
      const sql = fs.readFileSync(sqlPath, "utf8");
      const hash = crypto.createHash("sha256").update(sql).digest("hex");

      const result = await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
         )`,
        [hash, entry.when],
      );
      if (result.rowCount && result.rowCount > 0) {
        inserted += 1;
        console.log(`[baseline] marked ${entry.tag} as applied (hash ${hash.slice(0, 12)}…)`);
      } else {
        skipped += 1;
        console.log(`[baseline] ${entry.tag} already recorded — skipping`);
      }
    }

    console.log(`[baseline] done — inserted=${inserted} skipped=${skipped}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[baseline] failed:", err);
  process.exit(1);
});
