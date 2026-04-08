const { Client } = require('pg');

async function checkPopulation() {
    const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        const res = await client.query(`SELECT COUNT(*) as count FROM tat_trips_data;`);
        console.log(`Current row count in tat_trips_data: ${res.rows[0].count}`);

    } catch (err) {
        console.error("❌ Error:", err.message);
    } finally {
        await client.end();
    }
}
checkPopulation();
