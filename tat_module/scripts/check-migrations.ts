import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function checkMigrations() {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // Check if table exists
        const res = await client.query(`SELECT to_regclass('supabase_migrations.schema_migrations');`);
        if (res.rows[0].to_regclass) {
            const migrations = await client.query('SELECT * FROM supabase_migrations.schema_migrations ORDER BY version');
            console.log('Applied Migrations:', migrations.rows);
        } else {
            console.log('supabase_migrations.schema_migrations table does not exist.');
        }

        // Check if public schema exists
        const schemaRes = await client.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'public';");
        console.log('Public schema exists:', schemaRes.rows.length > 0);

    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await client.end();
    }
}

checkMigrations();
