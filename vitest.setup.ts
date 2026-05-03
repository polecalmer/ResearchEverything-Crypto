// Loaded by vitest before any test file imports anything.
// Many server modules transitively pull in ./db, which throws at module
// load if DATABASE_URL isn't set. Real tests don't actually hit the DB
// (pg.Pool is lazy — no connection until pool.query is called) but the
// env var has to exist for the import chain to complete.
import "dotenv/config";

if (!process.env.DATABASE_URL) {
  // Fallback so CI / fresh checkouts without a .env can still load
  // server modules. Connection is never established because lazy pool.
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
}
