import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function listTablesSupabase() {
    const connectionString = 'postgresql://postgres:postgres@127.0.0.1:54322/_supabase';
    const client = new Client({ connectionString });

    try {
        await client.connect();
        const res = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name;
    `);
        console.log('Tables in _supabase:', res.rows);
    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await client.end();
    }
}

listTablesSupabase();
