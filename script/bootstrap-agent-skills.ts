/**
 * One-shot import of the hermes skill packs into sessions' agent_skills
 * brain table. Skills are procedural docs the agent consults at synthesis
 * time — analyst frameworks for "how to value a protocol", "how to
 * forensically trace tx flows", etc.
 *
 * Run:
 *   npx tsx script/bootstrap-agent-skills.ts             # full ingest
 *   npx tsx script/bootstrap-agent-skills.ts --reembed   # re-embed existing
 *
 * Idempotent: skips slugs already in agent_skills unless --reembed.
 *
 * Source: /Users/sessions/.hermes/skills/{data-science,research}/{slug}/SKILL.md
 * Only crypto-relevant skills are pulled (the rest are hermes-specific
 * machinery — jupyter kernel, polymarket, memory experiments, etc.).
 */

import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { embed } from "../server/data-source-brain/embeddings";

const HERMES_SKILLS_ROOT = "/Users/sessions/.hermes/skills";

// Crypto-relevant skill whitelist. The other hermes skills (jupyter-live-
// kernel, polymarket, memory-architecture-experiments, llm-wiki, etc.)
// are either hermes-specific machinery or out of scope for sessions'
// research surface — we skip them to keep the retrieval pool focused.
const SKILLS_TO_LIFT: Array<{ category: "data-science" | "research"; slug: string }> = [
  { category: "data-science", slug: "crypto-protocol-valuation" },
  { category: "data-science", slug: "onchain-flow-forensics" },
  { category: "data-science", slug: "onchain-forensics" },
  { category: "data-science", slug: "onchain-chart-library" },
  { category: "data-science", slug: "dune-query-builder" },
  { category: "research", slug: "chart-library" },
  { category: "research", slug: "consult-analysts" },
  { category: "research", slug: "research-mode" },
];

interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/** Parse the SKILL.md frontmatter (YAML between leading `---` blocks)
 *  for the name + description. If no frontmatter, fall back to the first
 *  H1 + first paragraph. */
function parseSkillFile(raw: string, fallbackName: string): ParsedSkill {
  let name = fallbackName;
  let description = "";
  let body = raw;

  // Frontmatter: starts with ---\n, ends with \n---\n
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (fmMatch) {
    const yaml = fmMatch[1];
    body = fmMatch[2];
    const nameM = yaml.match(/^name:\s*(.+)$/m);
    if (nameM) name = nameM[1].trim();
    const descM = yaml.match(/^description:\s*\|\s*\n([\s\S]*?)(?=^\w+:|\Z)/m);
    if (descM) {
      description = descM[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 500);
    } else {
      const descSingle = yaml.match(/^description:\s*(.+)$/m);
      if (descSingle) description = descSingle[1].trim().slice(0, 500);
    }
  }

  if (!description) {
    // Fall back: first H1 + first non-heading paragraph from the body
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1 && name === fallbackName) name = h1[1].trim();
    const firstPara = body.split(/\n\n/).find((p) => !p.trim().startsWith("#") && p.trim().length > 0);
    if (firstPara) description = firstPara.trim().slice(0, 500);
  }

  return { name, description, body };
}

async function main() {
  const reembed = process.argv.includes("--reembed");

  console.log(`[skills-bootstrap] Ingesting ${SKILLS_TO_LIFT.length} hermes skills...`);
  if (reembed) console.log("[skills-bootstrap] --reembed: existing rows will be updated");

  // Read existing slugs so we can skip dupes
  const existingRows = await db.execute<{ slug: string }>(
    sql`SELECT slug FROM agent_skills`,
  );
  const existing = new Set(
    ((existingRows as any).rows ?? existingRows).map((r: any) => r.slug),
  );
  console.log(`[skills-bootstrap] ${existing.size} skill(s) already in DB`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (const sk of SKILLS_TO_LIFT) {
    const relPath = `${sk.category}/${sk.slug}/SKILL.md`;
    const absPath = path.join(HERMES_SKILLS_ROOT, relPath);

    if (existing.has(sk.slug) && !reembed) {
      console.log(`  - ${sk.slug.padEnd(32)}  SKIP (already present)`);
      skipped++;
      continue;
    }

    try {
      const raw = await fs.readFile(absPath, "utf-8");
      const parsed = parseSkillFile(raw, sk.slug);

      // Embed over name + description + body (truncated for the embedding
      // model's input limit). Body alone can be 50k+ chars; truncate to
      // first 8k tokens worth (~32k chars) which captures the core procedure.
      const embedInput = `${parsed.name}\n\n${parsed.description}\n\n${parsed.body.slice(0, 32_000)}`;
      const vec = await embed(embedInput, "document");

      const vecStr = `[${vec.join(",")}]`;

      if (existing.has(sk.slug)) {
        await db.execute(sql`
          UPDATE agent_skills
          SET name = ${parsed.name},
              description = ${parsed.description},
              body = ${parsed.body},
              source_path = ${relPath},
              embedding = ${vecStr}::vector,
              updated_at = now()
          WHERE slug = ${sk.slug}
        `);
        console.log(`  ✓ ${sk.slug.padEnd(32)}  UPDATED  (${parsed.body.length.toLocaleString()} chars)`);
        updated++;
      } else {
        await db.execute(sql`
          INSERT INTO agent_skills (slug, name, category, description, body, source_path, embedding)
          VALUES (${sk.slug}, ${parsed.name}, ${sk.category}, ${parsed.description},
                  ${parsed.body}, ${relPath}, ${vecStr}::vector)
        `);
        console.log(`  ✓ ${sk.slug.padEnd(32)}  INSERTED (${parsed.body.length.toLocaleString()} chars)`);
        inserted++;
      }
    } catch (err: any) {
      console.warn(`  ✗ ${sk.slug.padEnd(32)}  FAILED: ${err?.message || String(err)}`);
      errored++;
    }
  }

  console.log(`\n[skills-bootstrap] DONE — inserted=${inserted}, updated=${updated}, skipped=${skipped}, errored=${errored}`);
  process.exit(errored > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[skills-bootstrap] fatal:", err);
  process.exit(1);
});
