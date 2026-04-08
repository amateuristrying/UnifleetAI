import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
// Load env
const envPath = path.resolve(process.cwd(), '.env.local');
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
            SELECT * FROM get_tat_trip_details(
                (NOW() - INTERVAL '30 days')::timestamp, 
                NOW()::timestamp
            ) LIMIT 1;
        `);

        console.log('RPC Result:');
        const data = res.rows[0].get_tat_trip_details;

        console.log('Result Summary:');
        console.log(`Total Completed: ${data.total_completed}`);
        console.log(`Total Unfinished: ${data.total_unfinished}`);
        console.log(`Limit: ${data.limit}, Offset: ${data.offset}`);
        console.log(`Page Data Size: ${data.data?.length || 0}`);

        if (data.data && data.data.length > 0) {
            console.log('\nFirst trip details:');
            console.log(JSON.stringify(data.data[0], null, 2));

            const firstTrip = data.data[0];
            if (firstTrip.visit_chain) {
                console.log('\nVisit Chain found:', firstTrip.visit_chain.length, 'events');
            } else {
                console.warn('\nWarning: No visit_chain found in trip details');
            }
        } else {
            console.log('No trips found on this page.');
        }

    } catch (err) {
        console.error('Verification failed:', err);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
