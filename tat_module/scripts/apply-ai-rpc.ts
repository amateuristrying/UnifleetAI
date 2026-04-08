
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load env
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function main() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
        console.error('No DATABASE_URL or POSTGRES_URL found in .env.local');
        console.error('Please ensure you have a direct connection string to apply migrations.');
        process.exit(1);
    }

    console.log('Connecting to database...');
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Supabase requires SSL
    });

    try {
        await client.connect();
        console.log('Connected.');

        const sqlPath = path.resolve(__dirname, '..', 'supabase_ai_rpc.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying migration...');
        await client.query(sql);
        console.log('Migration applied successfully!');

    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
