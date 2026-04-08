import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function testPerformance() {
    const days = [1, 3, 7, 30];

    for (const d of days) {
        console.log(`\nTesting ${d} day(s) range...`);
        const start = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
        const end = new Date().toISOString();

        const startTime = Date.now();
        const { data, error } = await supabase.rpc('get_tat_trip_details', {
            p_start_date: start,
            p_end_date: end
        });
        const duration = Date.now() - startTime;

        if (error) {
            console.error(`Error after ${duration}ms:`, error.message);
        } else {
            console.log(`Success! Duration: ${duration}ms`);
            console.log(`Total Completed (Global): ${data.total_completed}`);
            console.log(`Total Unfinished (Global): ${data.total_unfinished}`);
            console.log(`Page Data Count: ${data.data?.length || 0}`);
            if (data.data?.length > 0) {
                console.log('First trip status:', data.data[0].trip_status);
            }
        }
    }
}

testPerformance();
