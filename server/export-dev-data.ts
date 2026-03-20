import pg from "pg";
import fs from "fs";

const DEV_USER_ID = "1e9bf641-c93c-4629-906a-f50db9050164";

async function exportData() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const { rows: companies } = await pool.query(
    `SELECT id, name, one_liner, description, sector, sub_sector, business_model, stage,
            funding_history, competitive_landscape, source_url, website_url, github_url,
            twitter_url, linkedin_url, pipeline_stage, tags, image_url, excitement_score,
            excitement_reason, deleted_report_count, created_at
     FROM companies WHERE user_id = $1`, [DEV_USER_ID]
  );

  const companyIds = companies.map(c => c.id);

  const { rows: founders } = await pool.query(
    `SELECT id, company_id, name, role, bio, linkedin_url, twitter_url, github_url, personal_url, prior_companies
     FROM founders WHERE company_id = ANY($1)`, [companyIds]
  );

  const { rows: notes } = await pool.query(
    `SELECT id, company_id, content, created_at FROM notes WHERE company_id = ANY($1)`, [companyIds]
  );

  const { rows: reports } = await pool.query(
    `SELECT id, company_id, content, status, created_at FROM reports WHERE company_id = ANY($1)`, [companyIds]
  );

  const { rows: transactions } = await pool.query(
    `SELECT id, type, description, amount, api_cost, company_name, input_tokens, output_tokens, created_at
     FROM transactions WHERE user_id = $1`, [DEV_USER_ID]
  );

  const data = { companies, founders, notes, reports, transactions };
  fs.writeFileSync("/tmp/dev_seed_data.json", JSON.stringify(data));
  console.log(`Exported: ${companies.length} companies, ${founders.length} founders, ${notes.length} notes, ${reports.length} reports, ${transactions.length} transactions`);

  await pool.end();
}

exportData().catch(err => { console.error(err); process.exit(1); });
