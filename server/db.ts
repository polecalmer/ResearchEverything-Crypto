import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./logger";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

// 25 is a comfortable default per task; bump via DB_POOL_MAX in prod if
// concurrent agent runs saturate the pool. Old default of 5 was tight for
// even single-user research sessions (every tool call hits the DB).
const POOL_MAX = Number(process.env.DB_POOL_MAX || "25");

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 10000,       // Release idle clients quickly so stale connections don't linger
  connectionTimeoutMillis: 15000,  // Wait up to 15s to connect
  max: POOL_MAX,
  allowExitOnIdle: true,           // Let the pool drain on exit
});

// Prevent unhandled pool errors from crashing the process.
// pg.Pool emits 'error' on idle clients when the server closes the connection
// (e.g., Supabase pooler timeout). Without this handler, Node crashes.
pool.on("error", (err: Error) => {
  logger.error({ err }, "[db.pool] idle client error (will reconnect on next query)");
  // No action needed — the pool automatically removes the dead client
  // and creates a new one on the next query.
});

// Periodic pool stats so we can see saturation / leaks in CloudWatch.
// waiting > 0 sustained = pool too small; total constantly == max = leak
// or under-sized; idle ~= total = healthy.
const POOL_STATS_INTERVAL_MS = Number(process.env.DB_POOL_STATS_INTERVAL_MS || "30000");
const statsTimer = setInterval(() => {
  logger.info(
    {
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: POOL_MAX,
    },
    "db.pool.stats",
  );
}, POOL_STATS_INTERVAL_MS);
statsTimer.unref();

export const db = drizzle(pool, { schema });
