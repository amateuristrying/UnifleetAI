
import * as dotenv from 'dotenv';
import * as path from 'path';
import fs from 'fs';
import pg from 'pg';

// Load env
const envPath = path.resolve(process.cwd(), '.env.local');
dotenv.config({ path: envPath });

const { Client } = pg;

async function main() {
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('Missing POSTGRES_URL or DATABASE_URL');
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Supabase requires SSL, usually
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        const sqlPath = path.resolve(process.cwd(), 'scripts/migration_stop_patterns.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Executing SQL from:', sqlPath);
        await client.query(sql);
        console.log('Migration successful!');

    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main().catch(console.error);
