const { Client } = require('pg');
const fs = require('fs');

async function applySql() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
        statement_timeout: 0,
        query_timeout: 0
    });

    try {
        await client.connect();
        console.log("✅ Connected securely to Supabase Pooler.");

        console.log("📜 Applying deduplication and schema migration...");
        const sql = fs.readFileSync('./cleanup_and_migrate_key.sql', 'utf8');
        await client.query(sql);
        console.log("✅ Deduplication and Schema Migration Applied successfully.");

    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}
applySql();
