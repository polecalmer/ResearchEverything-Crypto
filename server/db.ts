import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 10000,       // Release idle clients quickly so stale connections don't linger
  connectionTimeoutMillis: 15000,  // Wait up to 15s to connect
  max: 5,                          // Fewer connections = fewer stale sockets
  allowExitOnIdle: true,           // Let the pool drain on exit
});

// Prevent unhandled pool errors from crashing the process.
// pg.Pool emits 'error' on idle clients when the server closes the connection
// (e.g., Supabase pooler timeout). Without this handler, Node crashes.
pool.on("error", (err: Error) => {
  console.error("[DB Pool] Idle client error (will reconnect on next query):", err.message);
  // No action needed — the pool automatically removes the dead client
  // and creates a new one on the next query.
});

export const db = drizzle(pool, { schema });
