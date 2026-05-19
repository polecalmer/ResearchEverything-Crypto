import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Distinct query: actual assistant *text length* (not tokens, not
    // tool calls, just the rendered prose) over the last 21 days.
    const res = await client.query(`
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*) AS n_assistant_msgs,
        ROUND(AVG(LENGTH(content)))::int AS avg_chars,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY LENGTH(content))::int AS p50_chars,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY LENGTH(content))::int AS p90_chars,
        MAX(LENGTH(content)) AS max_chars
      FROM messages
      WHERE role = 'assistant'
        AND created_at > now() - interval '21 days'
      GROUP BY 1
      ORDER BY 1;
    `);
    console.table(res.rows);
  } finally {
    await client.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
