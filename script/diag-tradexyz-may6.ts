import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT m.id, m.conversation_id AS session_id, c.title,
             LENGTH(m.content) AS chars,
             m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'assistant'
        AND m.content ~ '\`\`\`artifact:chart'
        AND m.created_at > now() - interval '30 hours'
        AND (LOWER(c.title) LIKE '%tradexyz%' OR LOWER(c.title) LIKE '%trade xyz%' OR LOWER(c.title) LIKE '%trade%xyz%')
      ORDER BY m.created_at DESC
      LIMIT 3;
    `);
    console.table(res.rows);
    if (res.rows.length > 0) {
      const msgId = res.rows[0].id;
      const c = await client.query(`SELECT content FROM messages WHERE id = $1`, [msgId]);
      const content: string = c.rows[0].content;
      console.log("\n=== chart artifact bodies in message", msgId, "===");
      const re = /```artifact:chart\s*\n([\s\S]*?)```/g;
      let m; let i = 0;
      while ((m = re.exec(content)) !== null) {
        const body = m[1].trim();
        try {
          const j = JSON.parse(body);
          console.log(`\n--- chart #${i++} ---`);
          console.log("title:", j.title);
          console.log("subtitle:", j.subtitle);
          console.log("chartType:", j.chartType);
          console.log("data length:", Array.isArray(j.data) ? j.data.length : "(not array)");
          console.log("data[0]:", j.data?.[0]);
          console.log("data[last]:", j.data?.[j.data?.length - 1]);
          console.log("yAxes:", JSON.stringify(j.yAxes));
          console.log("xAxis:", JSON.stringify(j.xAxis));
          console.log("source:", j.source);
        } catch (e: any) {
          console.log(`\n--- chart #${i++} (UNPARSEABLE) ---`);
          console.log("err:", e.message);
          console.log("body[0..200]:", body.slice(0, 200));
        }
      }
    }
  } finally {
    await client.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
