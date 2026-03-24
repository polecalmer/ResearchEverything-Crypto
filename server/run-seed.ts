import { pool } from "./db";
import * as fs from "fs";
import * as path from "path";

const DEV_TO_PROD_EMAIL_MAP: Record<string, string> = {
  "allmysubscriptions10@proton.me": "allmysubscriptions10@proton.me",
};

const DEV_TO_PROD_USERNAME_MAP: Record<string, string> = {
  "polecalmer": "polecalmer",
};

export async function runSeedMigration() {
  try {
    const tables = [
      "dashboard_charts", "dune_queries", "master_dune_queries",
      "token_profiles", "token_analyses", "transactions", "usage_events",
      "users", "companies", "founders", "reports"
    ];

    const emptyCounts: Record<string, number> = {};
    let hasEmpty = false;
    for (const tbl of tables) {
      try {
        const r = await pool.query(`SELECT count(*)::int as c FROM ${tbl}`);
        emptyCounts[tbl] = r.rows[0]?.c || 0;
        if (emptyCounts[tbl] === 0) hasEmpty = true;
      } catch { emptyCounts[tbl] = -1; }
    }

    console.log("[seed] Table counts:", JSON.stringify(emptyCounts));

    if (hasEmpty) {
      console.log("[seed] Some tables are empty, running seed migration...");

      const tryPaths = [
        path.join(__dirname, "..", "server", "seed-data.sql"),
        path.join(__dirname, "seed-data.sql"),
        path.resolve("server/seed-data.sql"),
        path.resolve("seed-data.sql"),
        path.join(process.cwd(), "server/seed-data.sql"),
      ];

      let finalPath: string | null = null;
      for (const p of tryPaths) {
        if (fs.existsSync(p)) {
          finalPath = p;
          break;
        }
      }

      if (finalPath) {
        console.log(`[seed] Using seed file: ${finalPath}`);
        await executeSeedFile(finalPath);
      } else {
        console.log("[seed] No seed-data.sql found at any path, skipping");
      }
    }

    await remapOrphanedRecords();
  } catch (err) {
    console.error("[seed] Migration error:", err);
  }
}

async function remapOrphanedRecords() {
  try {
    const orphanResult = await pool.query(`
      SELECT DISTINCT c.user_id 
      FROM companies c 
      LEFT JOIN users u ON u.id = c.user_id 
      WHERE u.privy_id IS NULL AND u.id IS NOT NULL
    `);

    if (orphanResult.rows.length === 0) {
      console.log("[seed] No orphaned records to remap");
      return;
    }

    console.log(`[seed] Found ${orphanResult.rows.length} orphaned user IDs, attempting remap...`);

    for (const row of orphanResult.rows) {
      const orphanId = row.user_id;
      const orphanUser = await pool.query("SELECT id, username, email FROM users WHERE id = $1", [orphanId]);
      if (orphanUser.rows.length === 0) continue;

      const { username, email } = orphanUser.rows[0];

      let prodUser = null;
      if (email) {
        const r = await pool.query(
          "SELECT id FROM users WHERE email = $1 AND privy_id IS NOT NULL AND id != $2 LIMIT 1",
          [email, orphanId]
        );
        if (r.rows.length > 0) prodUser = r.rows[0].id;
      }

      if (!prodUser && username) {
        const r = await pool.query(
          "SELECT id FROM users WHERE username LIKE $1 AND privy_id IS NOT NULL AND id != $2 LIMIT 1",
          [username + "%", orphanId]
        );
        if (r.rows.length > 0) prodUser = r.rows[0].id;
      }

      if (!prodUser) {
        console.log(`[seed] No production match for orphan user ${username} (${email}), skipping`);
        continue;
      }

      console.log(`[seed] Remapping ${username} (${orphanId}) -> production user (${prodUser})`);

      const tablesToRemap = [
        "companies", "reports", "token_analyses", "dashboard_charts",
        "dune_queries", "transactions", "usage_events", "notes"
      ];

      for (const tbl of tablesToRemap) {
        try {
          const r = await pool.query(
            `UPDATE ${tbl} SET user_id = $1 WHERE user_id = $2`,
            [prodUser, orphanId]
          );
          if (r.rowCount && r.rowCount > 0) {
            console.log(`[seed]   ${tbl}: remapped ${r.rowCount} rows`);
          }
        } catch (e: any) {
          if (e.message?.includes("duplicate key")) {
            console.log(`[seed]   ${tbl}: some duplicates skipped`);
          }
        }
      }
    }

    console.log("[seed] Remap complete");
  } catch (err) {
    console.error("[seed] Remap error:", err);
  }
}

async function executeSeedFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");

  const statements: string[] = [];
  let current = "";
  for (const line of content.split("\n")) {
    const stripped = line.trim();
    if (stripped.startsWith("INSERT INTO")) {
      current = line;
    } else if (current) {
      current += "\n" + line;
    }
    if (current && stripped.endsWith(";")) {
      statements.push(current);
      current = "";
    }
  }

  let success = 0;
  let skipped = 0;
  let errors = 0;

  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      success++;
    } catch (e: any) {
      if (e.message?.includes("duplicate key") || e.message?.includes("already exists")) {
        skipped++;
      } else {
        errors++;
        if (errors <= 10) {
          console.error("[seed] Error:", e.message?.substring(0, 300));
        }
      }
    }
  }

  console.log(`[seed] Complete: ${success} inserted, ${skipped} skipped (duplicates), ${errors} errors`);
}
