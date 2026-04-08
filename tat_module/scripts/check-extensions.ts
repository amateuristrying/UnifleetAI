import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function checkExtensions() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query("SELECT * FROM pg_available_extensions WHERE name LIKE '%h3%' OR name LIKE '%postgis%'");
        console.log('Available extensions:', res.rows);
    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await client.end();
    }
}

checkExtensions();
