import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Token-level diagnostic from the transactions ledger.
    const res = await client.query(`
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*) AS n_research_turns,
        ROUND(AVG(input_tokens))::int AS avg_in,
        ROUND(AVG(output_tokens))::int AS avg_out,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY output_tokens))::int AS p50_out,
        ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY output_tokens))::int AS p90_out
      FROM transactions
      WHERE type IN ('session_research', 'research', 'chart')
        AND output_tokens IS NOT NULL
        AND output_tokens > 0
        AND created_at > now() - interval '21 days'
      GROUP BY 1
      ORDER BY 1;
    `);
    console.table(res.rows);
  } finally {
    await client.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
