import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!; // use service role or anon key
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const today = new Date();
    const startDate = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = today.toISOString();
    
    console.log("Calling get_tat_trip_details...");
    const { data, error } = await supabase.rpc('get_tat_trip_details', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_limit: 100,
        p_offset: 0
    });
    
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Success! Returned data items:", data?.data?.length);
    }
}
main();
