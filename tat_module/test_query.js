const { Client } = require('pg');

async function testQuery() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        console.log("🔍 Fetching TAT trips for Tracker 3394064...");
        const res = await client.query(`
            SELECT loading_entry, loading_terminal, dest_name, loading_start
            FROM tat_trips_data 
            WHERE tracker_id = 3394064 AND loading_entry >= '2026-03-01'
            ORDER BY loading_entry ASC
        `);

        console.table(res.rows);

    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}
testQuery();
