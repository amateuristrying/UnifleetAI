import { Client } from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function runMigration() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

    console.log(`Connecting to database...`);

    const client = new Client({
        connectionString: connectionString,
    });

    try {
        await client.connect();

        const migrationPath = path.join(process.cwd(), 'supabase/migrations/remigrate_h3_res9.sql');
        console.log(`Reading migration file: ${migrationPath}`);

        if (!fs.existsSync(migrationPath)) {
            throw new Error(`Migration file not found at ${migrationPath}`);
        }

        const migrationSql = fs.readFileSync(migrationPath, 'utf8');

        console.log('Running migration...');
        // Split by statement if needed, but pg usually handles script execution if syntax is right.
        // However, some valid psql commands like \set won't work.
        // The migration file only contains standard SQL, so it should be fine.

        await client.query(migrationSql);
        console.log('Migration successful!');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

runMigration();
