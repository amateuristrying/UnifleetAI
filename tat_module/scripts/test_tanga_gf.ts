import * as dotenv from 'dotenv';
import { Client } from 'pg';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });
const connString = process.env.SUPABASE_DB_URL; 

async function run() {
    const client = new Client({ connectionString: connString });
    await client.connect();
    
    // We run the get_tat_trip_details for this specific truck if we can find its tracker_id. 
    // Or we just get the latest trips to see if the Kurasini one exists
    const res = await client.query(`
        SELECT t.tracker_name, t.loading_start, t.loading_terminal, t.dest_name, t.next_dar_entry, t.dest_exit, t.is_completed, t.trip_status
        FROM get_tat_trip_details('2026-01-01', '2026-03-01', NULL, NULL, NULL) t
        WHERE t.loading_terminal LIKE '%Kurasini%' OR t.loading_terminal LIKE '%Tanga%'
        ORDER BY t.loading_start DESC
        LIMIT 10;
    `);
    
    console.log(res.rows);
    await client.end();
}
run();
