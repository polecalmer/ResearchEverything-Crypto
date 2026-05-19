import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // For each day in the last 21 days, count how many assistant messages
    // contain ANY artifact code-fence vs how many contain a chart fence
    // specifically. Chart-emission frequency is the smoking gun: if it
    // dropped, the regression is in the agent, not the memo PDF path.
    const res = await client.query(`
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*) AS n_assistant,
        COUNT(*) FILTER (WHERE content ~ '\`\`\`artifact:') AS n_with_any_artifact,
        COUNT(*) FILTER (WHERE content ~ '\`\`\`artifact:chart') AS n_with_chart,
        COUNT(*) FILTER (WHERE content ~ '\`\`\`artifact:table') AS n_with_table,
        COUNT(*) FILTER (WHERE content ~ '\`\`\`artifact:metric_cards') AS n_with_metrics
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
