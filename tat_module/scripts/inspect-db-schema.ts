
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Load env
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function main() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
        console.error('No DATABASE_URL or POSTGRES_URL found in .env.local');
        process.exit(1);
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to DB.');

        const res = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `);

        console.log('Tables in public schema:');
        res.rows.forEach(row => {
            console.log(`- ${row.table_name}`);
        });

        // Check for columns in potential tables
        const potentialTables = ['trips', 'geofence_visits', 'tracker_visits', 'navixy_tracker_visits', 'v_ai_trip_logs'];
        for (const table of potentialTables) {
             const checkTable = res.rows.find(r => r.table_name === table);
             if (checkTable) {
                 console.log(`\nColumns in ${table}:`);
                 const cols = await client.query(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = '${table}'
                    ORDER BY ordinal_position;
                 `);
                 cols.rows.forEach(col => {
                     console.log(`  - ${col.column_name} (${col.data_type})`);
                 });
             }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

main();
