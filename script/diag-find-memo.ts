import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT m.id AS msg_id, m.conversation_id AS session_id, c.title,
             LENGTH(m.content) AS chars,
             (SELECT COUNT(*) FROM regexp_matches(m.content, '\`\`\`artifact:chart', 'g')) AS n_charts,
             m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant'
        AND m.content ~ '\`\`\`artifact:chart'
        AND m.created_at > now() - interval '7 days'
      ORDER BY m.created_at DESC
      LIMIT 5;
    `);
    console.table(res.rows);
  } finally {
    await client.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
