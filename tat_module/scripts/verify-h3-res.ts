import { createClient } from '@supabase/supabase-js';
import { getResolution } from 'h3-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
const envPath = path.resolve(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function verifyResolution() {
    console.log('Verifying H3 Resolution...');

    try {
        // Check stop_risk_scores
        const { data: srs, error: srsError } = await supabase
            .from('stop_risk_scores')
            .select('h3_index')
            .not('h3_index', 'is', null)
            .limit(10);

        if (srsError) throw srsError;

        if (srs && srs.length > 0) {
            console.log('\n--- stop_risk_scores sample ---');
            srs.forEach((row, i) => {
                if (row.h3_index) {
                    const res = getResolution(row.h3_index);
                    console.log(`Row ${i}: ${row.h3_index} (Res ${res})`);
                }
            });
        } else {
            console.log('No data found in stop_risk_scores');
        }

        // Check vehicle_stop_sessions
        const { data: vss, error: vssError } = await supabase
            .from('vehicle_stop_sessions')
            .select('h3_index')
            .not('h3_index', 'is', null)
            .limit(10);

        if (vssError) throw vssError;

        if (vss && vss.length > 0) {
            console.log('\n--- vehicle_stop_sessions sample ---');
            vss.forEach((row, i) => {
                if (row.h3_index) {
                    const res = getResolution(row.h3_index);
                    console.log(`Row ${i}: ${row.h3_index} (Res ${res})`);
                }
            });
        } else {
            console.log('No data found in vehicle_stop_sessions');
        }

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verifyResolution();
