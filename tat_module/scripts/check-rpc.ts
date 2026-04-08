import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function checkFunctions() {
    console.log('Database URL exists:', !!process.env.DATABASE_URL);

    const client = new Client({
        connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('Connecting to database...');
        await client.connect();
        console.log('Connected.');

        console.log('--- Checking Functions existence ---');
        const res = await client.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name IN ('get_tat_fleet_stats', 'get_tat_summary_by_destination')
        `);
        console.log('Functions found:', res.rows.map(r => r.routine_name));

        console.log('\n--- Testing get_tat_fleet_stats ---');
        try {
            const stats = await client.query(`
                SELECT public.get_tat_fleet_stats(
                    (NOW() - INTERVAL '7 days')::timestamptz, 
                    NOW()::timestamptz
                ) as result;
            `);
            console.log('Stats Success:', stats.rows[0].result);
        } catch (e: any) {
            console.error('Stats RPC FAILED');
            console.error('Message:', e.message);
            console.error('Detail:', e.detail);
            console.error('Where:', e.where);
        }

        console.log('\n--- Testing get_tat_summary_by_destination ---');
        try {
            const summary = await client.query(`
                SELECT public.get_tat_summary_by_destination(
                    (NOW() - INTERVAL '7 days')::timestamptz, 
                    NOW()::timestamptz
                ) as result;
            `);
            console.log('Summary Success:', summary.rows[0].result);
        } catch (e: any) {
            console.error('Summary RPC FAILED');
            console.error('Message:', e.message);
            console.error('Detail:', e.detail);
            console.error('Where:', e.where);
        }

    } catch (err: any) {
        console.error('CRITICAL CONNECTION ERROR:', err.message);
        if (err.stack) console.error(err.stack);
    } finally {
        await client.end();
    }
}

checkFunctions();
