const { Client } = require('pg');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

async function applyFix() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('✅ Connected.');
        const sql = fs.readFileSync('get_tat_trip_details_final.sql', 'utf8');
        await client.query(sql);
        console.log('✅ RPC Restored.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await client.end();
    }
}

applyFix();
