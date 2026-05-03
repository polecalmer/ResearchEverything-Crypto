# Database migrations

Schema lives in `shared/schema.ts`. This directory holds the versioned
migrations Drizzle generates from it.

## Day-to-day workflow

1. Edit `shared/schema.ts`.
2. `npm run db:generate` — produces a new `NNNN_<name>.sql` file plus a
   journal entry under `meta/`. Review the SQL.
3. Commit both the SQL and the updated `meta/`.
4. `npm run db:migrate` — applies any pending migrations to whatever
   `DATABASE_URL` points at. Run this in CI/CD before booting the app.

## One-time baseline (existing environments)

The repo's history previously used `drizzle-kit push` (live schema sync,
no migration files). The first migration (`0000_initial_baseline.sql`)
captures the schema as of that switch. Every existing database (dev
Supabase, staging, prod) already has those tables.

To stop `db:migrate` from trying to re-create them, run **once** per
existing environment:

```
DATABASE_URL=<env-url> npm run db:baseline
```

This inserts one row per existing migration into
`drizzle.__drizzle_migrations`, marking them as already applied. Drizzle
gates by `created_at`, so subsequent `db:migrate` runs cleanly skip
the baseline and apply only newer migrations.

A fresh DB (e.g. a brand-new RDS) does **not** need baselining — just
run `db:migrate` against the empty database.

## What about `db:push`?

Kept for fast iteration in personal dev (one-line schema tweaks without
generating a migration). **Never** run it against staging or prod — it
has no rollback story and bypasses the migration journal.

## pgvector

`0000_initial_baseline.sql` starts with `CREATE EXTENSION IF NOT EXISTS
vector;`. Supabase enables this by default; bare Postgres or fresh RDS
needs the extension available (RDS: parameter group, then `CREATE
EXTENSION` runs automatically via the migration).
