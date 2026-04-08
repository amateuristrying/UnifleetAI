const { Client } = require('pg');
const fs = require('fs');

async function test() {
  const connectionString = "postgresql://postgres.motfpmjtunyelvwsmyyp:Pkc%4009091995@aws-1-ap-south-1.pooler.supabase.com:6543/postgres";
  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
    query_timeout: 0
  });

  try {
    await client.connect();
    
    // Check if there's a geofences table
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE '%geofence%';
    `);
    console.log("Tables:", tables.rows.map(r => r.table_name));

  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await client.end();
  }
}
test();
