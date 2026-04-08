import { Client } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
        console.error('No connection string found');
        return;
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();

        console.log('--- Table Check ---');
        const tableCheck = await client.query(`
            SELECT table_type 
            FROM information_schema.tables 
            WHERE table_name = 'trips';
        `);
        console.log('Type:', tableCheck.rows[0]?.table_type || 'NOT FOUND');

        if (tableCheck.rows[0]?.table_type === 'VIEW') {
            console.log('\n--- View Definition ---');
            const viewDef = await client.query(`
                SELECT view_definition 
                FROM information_schema.views 
                WHERE table_name = 'trips';
            `);
            console.log(viewDef.rows[0]?.view_definition);
        }

        console.log('\n--- Index Check ---');
        const indexCheck = await client.query(`
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = 'trips';
        `);
        console.table(indexCheck.rows);

        console.log('\n--- Row Count ---');
        const countCheck = await client.query('SELECT count(*) FROM trips;');
        console.log('Total Rows:', countCheck.rows[0].count);

        console.log('\n--- Query Explain ---');
        const explain = await client.query(`
            EXPLAIN ANALYZE
            SELECT * FROM trips 
            WHERE start_time >= (NOW() - INTERVAL '30 days')
            ORDER BY start_time DESC
            LIMIT 50;
        `);
        console.log(explain.rows.map(r => r['QUERY PLAN']).join('\n'));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

main();
