import "dotenv/config";
import pg from "pg";

(async () => {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    console.log("=== brain_facts mentioning TradeXYZ or TRADE token disambiguation ===");
    const r1 = await c.query(`
      SELECT id, user_id, topic, LEFT(fact, 200) AS fact_preview, source, confidence, created_at
      FROM brain_facts
      WHERE (
        LOWER(topic) LIKE '%tradexyz%' OR
        LOWER(fact)  LIKE '%tradexyz%' OR
        (LOWER(fact) LIKE '%trade%' AND LOWER(fact) LIKE '%token%' AND
         (LOWER(fact) LIKE '%unrelated%' OR LOWER(fact) LIKE '%no token%' OR LOWER(fact) LIKE '%no public%'))
      )
      ORDER BY created_at DESC
      LIMIT 15;
    `);
    console.table(r1.rows);
    console.log("");
    console.log("=== data_source_facts about TradeXYZ ===");
    const r2 = await c.query(`
      SELECT id, protocol, metric_type, LEFT(content, 200) AS content_preview, observed_count, status, created_at
      FROM data_source_facts
      WHERE LOWER(protocol) LIKE '%tradexyz%' OR LOWER(protocol) LIKE '%xyz%' OR LOWER(content) LIKE '%tradexyz%'
      ORDER BY observed_count DESC
      LIMIT 10;
    `);
    console.table(r2.rows);
    console.log("");
    console.log("=== recent corrections related to TRADE token ===");
    const r3 = await c.query(`
      SELECT id, status, LEFT(turn_message::text, 200) AS preview, created_at
      FROM correction_queue
      WHERE LOWER(turn_message::text) LIKE '%tradexyz%' OR LOWER(turn_message::text) LIKE '%trade token%'
      ORDER BY created_at DESC
      LIMIT 5;
    `);
    console.table(r3.rows);
  } finally { await c.end(); }
})().catch(e => { console.error(e); process.exit(1); });
