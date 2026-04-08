
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) { console.error('Missing credentials'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Testing RPC signatures...');

    // Try 7 Params (Expected) with High Limit
    console.log('Testing with limit=50000...');
    const start = Date.now();
    const { data: d7, error: e7 } = await supabase.rpc('get_fleet_corridors', {
        p_min_visits: 1, p_limit: 50000, p_decay_lambda: 0.01,
        p_maturity_threshold: 1, p_tracker_id: null,
        p_day_of_week: null, p_hour_bucket: null
    });
    const duration = Date.now() - start;

    if (!e7) {
        console.log('✅ 7-Param call SUCCESS. Database has correct version.');
        console.log('Sample keys:', Object.keys(d7[0]));
    } else {
        console.log('❌ 7-Param call FAILED:', e7.message);

        // Try 5 Params (Old Version)
        const { data: d5, error: e5 } = await supabase.rpc('get_fleet_corridors', {
            p_min_visits: 1, p_limit: 10, p_decay_lambda: 0.01,
            p_maturity_threshold: 1, p_tracker_id: null
        });

        if (!e5) {
            console.log('⚠️  5-Param call SUCCESS. Database has OLD version (missing p_day_of_week/p_hour_bucket).');
        } else {
            console.log('❌ 5-Param call FAILED:', e5.message);
        }
    }
}
main();
