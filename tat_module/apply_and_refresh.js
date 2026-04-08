const { Client } = require('pg');
const fs = require('fs');

async function applyAndRefresh() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        statement_timeout: 0,
        query_timeout: 0
    });

    try {
        await client.connect();

        console.log("📜 Reading and applying updated SQL logic...");
        const sql = fs.readFileSync('./supabase/migrations/tat_optimization_incremental.sql', 'utf8');
        await client.query(sql);
        console.log("✅ SQL Deployment verified.");
    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}
applyAndRefresh();
