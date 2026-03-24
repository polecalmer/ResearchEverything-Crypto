import { pool } from "./db";
import * as fs from "fs";
import * as path from "path";

export async function runSeedMigration() {
  try {
    const result = await pool.query("SELECT count(*)::int as c FROM companies");
    const companyCount = result.rows[0]?.c || 0;
    
    if (companyCount > 0) {
      console.log(`[seed] Production DB already has ${companyCount} companies, skipping seed`);
      return;
    }

    console.log("[seed] Production DB is empty, running data seed...");
    
    const sqlPath = path.join(__dirname, "..", "server", "seed-data.sql");
    const altPath = path.join(__dirname, "seed-data.sql");
    const finalPath = fs.existsSync(sqlPath) ? sqlPath : fs.existsSync(altPath) ? altPath : null;
    
    if (!finalPath) {
      const tryPaths = [
        path.resolve("server/seed-data.sql"),
        path.resolve("seed-data.sql"),
        path.join(process.cwd(), "server/seed-data.sql"),
      ];
      for (const p of tryPaths) {
        if (fs.existsSync(p)) {
          console.log(`[seed] Found seed file at: ${p}`);
          await executeSeedFile(p);
          return;
        }
      }
      console.log("[seed] No seed-data.sql found, skipping");
      return;
    }

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
        if (errors <= 5) {
          console.error("[seed] Error:", e.message?.substring(0, 200));
        }
      }
    }
  }

  console.log(`[seed] Complete: ${success} inserted, ${skipped} skipped (duplicates), ${errors} errors`);
}
