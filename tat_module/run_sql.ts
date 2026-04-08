import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

// Supabase REST client (uses HTTP, bypassing direct DB port blocks/timeouts on connection)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    console.log("Calling get_tat_trip_details via HTTP...");
    // Test the function with p_tracker_id 1641017
    const { data, error } = await supabase.rpc('get_tat_trip_details', {
        p_start_date: '2026-01-01T00:00:00Z',
        p_end_date: new Date().toISOString(),
        p_limit: 100,
        p_offset: 0,
        p_tracker_id: 1641017
    });
    
    if (error) {
        console.error("RPC Error:", error);
    } else {
        console.log("Fetched Items:", data?.data?.length);
        console.log(JSON.stringify(data?.data?.slice(0, 2), null, 2));
    }
}
run();
