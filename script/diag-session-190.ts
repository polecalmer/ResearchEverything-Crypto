import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const conv = await client.query(
      `SELECT id, title, created_at FROM conversations WHERE id = $1`,
      [190],
    );
    console.log("session 190:", conv.rows[0]);
    console.log("");
    const msgs = await client.query(
      `SELECT id, role, LENGTH(content) AS chars,
              (SELECT COUNT(*) FROM regexp_matches(content, '\`\`\`artifact:', 'g')) AS artifacts,
              created_at
       FROM messages WHERE conversation_id = 190 ORDER BY id`,
    );
    console.table(msgs.rows);
  } finally {
    await client.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
