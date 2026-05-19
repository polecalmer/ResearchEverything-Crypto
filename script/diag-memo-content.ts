import "dotenv/config";
import pg from "pg";

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT content FROM messages WHERE id = $1
    `, [495]);
    if (!res.rows.length) {
      console.log("not found");
      return;
    }
    const content: string = res.rows[0].content;
    console.log("=== content length:", content.length);
    // Find every artifact code-fence and report its position + type + first 80 chars
    const fenceRe = /```artifact:(\w+)/g;
    let m;
    let i = 0;
    while ((m = fenceRe.exec(content)) !== null) {
      console.log(`#${i++}  type=${m[1]}  pos=${m.index}  preview=${content.slice(m.index, m.index + 100).replace(/\n/g, ' ')}`);
    }
    console.log("=== first 500 chars ===");
    console.log(content.slice(0, 500));
  } finally {
    await client.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
