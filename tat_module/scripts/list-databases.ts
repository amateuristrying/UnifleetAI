import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function listDatabases() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
        console.log('Databases:', res.rows.map(r => r.datname));
    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await client.end();
    }
}

listDatabases();
