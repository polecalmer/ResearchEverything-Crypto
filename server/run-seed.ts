import { pool } from "./db";
import * as fs from "fs";
import * as path from "path";

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
    
    if (!hasEmpty) {
      console.log("[seed] All tables have data, skipping seed");
      return;
    }

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

    if (!finalPath) {
      console.log("[seed] No seed-data.sql found at any path, skipping");
      console.log("[seed] Tried:", tryPaths.join(", "));
      return;
    }

    console.log(`[seed] Using seed file: ${finalPath}`);
    await executeSeedFile(finalPath);
  } catch (err) {
    console.error("[seed] Migration error:", err);
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
