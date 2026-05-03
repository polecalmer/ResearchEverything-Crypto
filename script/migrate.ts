// Applies any pending migrations from ./migrations to the database
// pointed at by DATABASE_URL. Idempotent — drizzle-orm skips migrations
// already recorded in drizzle.__drizzle_migrations.
//
// Usage:  npm run db:migrate
//
// In CI/CD, run this once per deploy *before* booting the app.
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  // Use a single dedicated client (not a pool) — migrations need a stable
  // session and many statements can't run inside a transaction-pooled
  // connection (Supabase's 6543 pgbouncer in transaction mode).
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const db = drizzle(client);
    console.log("[migrate] applying any pending migrations from ./migrations …");
    await migrate(db, { migrationsFolder: "./migrations" });
    console.log("[migrate] done");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
