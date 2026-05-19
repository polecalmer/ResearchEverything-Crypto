// Coverage for the Dune SQL validator. The validator runs before any
// raw agent-authored SQL is forwarded to Dune execution. It defends
// against schema enumeration, write/DDL ops, statement stacking,
// identity disclosure, and resource abuse. If these tests regress, a
// prompt-injected agent could exfiltrate schema info or attempt to
// stress Dune with sleep/large-series queries.
import { describe, it, expect } from "vitest";

import { validateDuneSql, DuneSqlValidationError } from "./dune-mcp-client";

function expectReject(sql: string, matcher: RegExp): void {
  expect(() => validateDuneSql(sql)).toThrow(DuneSqlValidationError);
  expect(() => validateDuneSql(sql)).toThrow(matcher);
}

function expectPass(sql: string): void {
  expect(() => validateDuneSql(sql)).not.toThrow();
}

describe("validateDuneSql — schema enumeration blocks", () => {
  it("blocks SELECT * FROM information_schema.tables", () => {
    expectReject(
      "SELECT * FROM information_schema.tables",
      /information_schema/,
    );
  });

  it("blocks information_schema.columns", () => {
    expectReject(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users'",
      /information_schema/,
    );
  });

  it("blocks pg_catalog access", () => {
    expectReject("SELECT * FROM pg_catalog.pg_tables", /pg_catalog/);
  });

  it("blocks pg_tables / pg_namespace probes", () => {
    expectReject("SELECT tablename FROM pg_tables", /pg_/);
    expectReject("SELECT nspname FROM pg_namespace", /pg_/);
  });

  it("blocks sys.tables (MSSQL/Trino)", () => {
    expectReject("SELECT name FROM sys.tables", /sys\./);
  });

  it("blocks mysql.user", () => {
    expectReject("SELECT user, host FROM mysql.user", /mysql\./);
  });
});

describe("validateDuneSql — write/DDL blocks", () => {
  it("blocks CREATE TABLE", () => {
    expectReject("CREATE TABLE evil (id int)", /write.*DDL/);
  });

  it("blocks DROP TABLE", () => {
    expectReject("DROP TABLE dex.trades", /write.*DDL/);
  });

  it("blocks ALTER TABLE", () => {
    expectReject("ALTER TABLE x ADD COLUMN evil int", /write.*DDL/);
  });

  it("blocks INSERT", () => {
    expectReject("INSERT INTO logs VALUES (1)", /write.*DDL/);
  });

  it("blocks UPDATE", () => {
    expectReject("UPDATE users SET admin = true", /write.*DDL/);
  });

  it("blocks DELETE", () => {
    expectReject("DELETE FROM users WHERE 1=1", /write.*DDL/);
  });

  it("blocks TRUNCATE", () => {
    expectReject("TRUNCATE TABLE foo", /write.*DDL/);
  });

  it("blocks GRANT", () => {
    expectReject("GRANT ALL ON x TO public", /write.*DDL/);
  });

  it("blocks MERGE", () => {
    expectReject("MERGE INTO target USING source ON x = y", /write.*DDL/);
  });
});

describe("validateDuneSql — statement stacking", () => {
  it("blocks SELECT followed by DROP", () => {
    expectReject(
      "SELECT * FROM dex.trades; DROP TABLE users;",
      /stacking|DDL/,
    );
  });

  it("blocks two SELECTs separated by ;", () => {
    expectReject(
      "SELECT 1; SELECT 2;",
      /stacking/,
    );
  });

  it("allows a single trailing semicolon", () => {
    expectPass("SELECT block_time FROM dex.trades LIMIT 10;");
  });

  it("allows no trailing semicolon", () => {
    expectPass("SELECT block_time FROM dex.trades LIMIT 10");
  });
});

describe("validateDuneSql — identity / version disclosure", () => {
  it("blocks current_user", () => {
    expectReject("SELECT current_user", /current_user/);
  });

  it("blocks current_user()", () => {
    expectReject("SELECT current_user()", /current_user/);
  });

  it("blocks session_user", () => {
    expectReject("SELECT session_user", /session_user/);
  });

  it("blocks version()", () => {
    expectReject("SELECT version()", /version/);
  });

  it("blocks current_database()", () => {
    expectReject("SELECT current_database()", /current_database/);
  });
});

describe("validateDuneSql — resource abuse", () => {
  it("blocks pg_sleep()", () => {
    // pg_sleep matches the broader pg_* deny pattern first.
    expectReject("SELECT pg_sleep(60)", /pg_/);
  });

  it("blocks benchmark() (MySQL)", () => {
    expectReject("SELECT benchmark(10000000, MD5('x'))", /benchmark/);
  });

  it("blocks generate_series with massive range", () => {
    expectReject("SELECT generate_series(1, 100000000)", /generate_series/);
  });

  it("allows generate_series with reasonable range", () => {
    expectPass("SELECT generate_series(1, 1000) AS n");
  });
});

describe("validateDuneSql — filesystem / shell exec", () => {
  it("blocks xp_cmdshell", () => {
    expectReject("EXEC xp_cmdshell 'whoami'", /xp_cmdshell/);
  });

  it("blocks SELECT ... INTO OUTFILE", () => {
    expectReject(
      "SELECT * FROM users INTO OUTFILE '/tmp/leak.txt'",
      /OUTFILE/,
    );
  });

  it("blocks load_file()", () => {
    expectReject(
      "SELECT load_file('/etc/passwd')",
      /load_file/,
    );
  });
});

describe("validateDuneSql — legitimate analytics queries (no false positives)", () => {
  it("allows simple SELECT against dex.trades", () => {
    expectPass(
      `SELECT block_time, amount_usd
       FROM dex.trades
       WHERE project = 'uniswap'
         AND block_time > now() - interval '7' day
       ORDER BY block_time DESC
       LIMIT 1000`,
    );
  });

  it("allows CTE with UNION ALL", () => {
    expectPass(`
      WITH daily AS (
        SELECT date_trunc('day', block_time) AS d, sum(amount_usd) AS v
        FROM dex.trades WHERE project = 'uniswap'
        GROUP BY 1
      ),
      curve AS (
        SELECT date_trunc('day', block_time) AS d, sum(amount_usd) AS v
        FROM dex.trades WHERE project = 'curve'
        GROUP BY 1
      )
      SELECT d, sum(v) FROM (SELECT * FROM daily UNION ALL SELECT * FROM curve) GROUP BY 1
    `);
  });

  it("allows quoted string containing a deny word (DROP in a token name)", () => {
    // 'Drop Token' appears in a string literal — should NOT trip the
    // DROP keyword block. The validator strips quoted strings before
    // pattern matching.
    expectPass(
      `SELECT block_time FROM dex.trades WHERE token_symbol = 'DROP'`,
    );
  });

  it("allows -- comment containing a deny word", () => {
    expectPass(
      `-- TODO: write a follow-up query about DELETE flow
       SELECT 1`,
    );
  });

  it("allows /* block comment */ containing a deny word", () => {
    expectPass(
      `/* This query used to UPDATE the cache table but now is read-only */
       SELECT block_time FROM dex.trades LIMIT 10`,
    );
  });

  it("allows a column named 'created' (does not trip CREATE)", () => {
    // CREATE deny pattern uses word-boundary + trailing whitespace; "created"
    // as a column name should NOT trip it.
    expectPass(
      `SELECT created, amount_usd FROM dex.trades LIMIT 5`,
    );
  });

  it("allows window functions and aggregates", () => {
    expectPass(`
      SELECT
        block_time,
        amount_usd,
        SUM(amount_usd) OVER (PARTITION BY project ORDER BY block_time) AS cum_vol,
        ROW_NUMBER() OVER (PARTITION BY project ORDER BY block_time DESC) AS rn
      FROM dex.trades
      WHERE block_time > now() - interval '30' day
    `);
  });
});

describe("validateDuneSql — edge cases", () => {
  it("rejects empty SQL", () => {
    expectReject("", /empty/);
    expectReject("   ", /empty/);
  });

  it("rejects extremely long SQL (>50000 chars)", () => {
    const huge = "SELECT 1 -- " + "x".repeat(60_000);
    expectReject(huge, /too long/);
  });

  it("is case-insensitive", () => {
    expectReject("select * from INFORMATION_SCHEMA.tables", /information_schema/i);
    expectReject("Drop Table foo", /write.*DDL/i);
  });
});
