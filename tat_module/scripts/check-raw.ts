import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRawData() {
    const startDate = '2026-01-01T00:00:00Z';
    const endDate = '2026-02-11T23:59:59Z';

    console.log(`Checking raw Kurasini visits from ${startDate} to ${endDate}...\n`);

    try {
        const { count, error } = await supabase
            .from('geofence_visits')
            .select('*', { count: 'exact', head: true })
            .eq('geofence_name', 'KURASINI ALL TOGETHER')
            .gte('in_time_dt', startDate)
            .lte('in_time_dt', endDate);

        if (error) {
            console.error('Query Error:', error);
            return;
        }

        console.log(`Total Kurasini Visits: ${count}`);

        // Get sample
        const { data: sample } = await supabase
            .from('geofence_visits')
            .select('tracker_id, in_time_dt, out_time_dt')
            .eq('geofence_name', 'KURASINI ALL TOGETHER')
            .limit(5);

        console.log('Sample data:', sample);

    } catch (e) {
        console.error('Check failed:', e);
    }
}

checkRawData();
