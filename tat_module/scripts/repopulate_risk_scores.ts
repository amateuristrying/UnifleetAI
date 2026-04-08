import { createClient } from '@supabase/supabase-js';
import { latLngToCell } from 'h3-js';
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

async function repopulateRiskScores() {
    console.log('Connecting to Supabase for Re-population (Res 9)...');

    try {
        console.log('=============================================');
        console.log('RE-POPULATING stop_risk_scores (Res 9)');
        console.log('=============================================');

        // Fetch data in batches
        let count = 0;
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data: rows, error } = await supabase
                .from('stop_risk_scores')
                .select('id, stop_lat, stop_lng')
                .not('stop_lat', 'is', null)
                .not('stop_lng', 'is', null)
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (!rows || rows.length === 0) {
                hasMore = false;
                break;
            }

            console.log(`Processing batch ${page + 1} (${rows.length} rows)...`);

            // Process batch
            const updates = rows.map(async (row) => {
                const h3 = latLngToCell(row.stop_lat, row.stop_lng, 9);

                const { error: updateError } = await supabase
                    .from('stop_risk_scores')
                    .update({ h3_index: h3 })
                    .eq('id', row.id);

                if (updateError) console.error(`Failed to update ${row.id}:`, updateError.message);
            });

            await Promise.all(updates);

            count += rows.length;
            page++;
        }
        console.log(`stop_risk_scores re-populated: ${count} rows.`);


        console.log('=============================================');
        console.log('RE-POPULATING vehicle_stop_sessions (Res 9)');
        console.log('=============================================');

        count = 0;
        page = 0;
        hasMore = true;

        while (hasMore) {
            const { data: rows, error } = await supabase
                .from('vehicle_stop_sessions')
                .select('session_id, cluster_lat, cluster_lng')
                .not('cluster_lat', 'is', null)
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (!rows || rows.length === 0) {
                hasMore = false;
                break;
            }

            console.log(`Processing batch ${page + 1} (${rows.length} rows)...`);

            const updates = rows.map(async (row) => {
                const h3 = latLngToCell(row.cluster_lat, row.cluster_lng, 9);

                const { error: updateError } = await supabase
                    .from('vehicle_stop_sessions')
                    .update({ h3_index: h3 })
                    .eq('session_id', row.session_id);

                if (updateError) console.error(`Failed to update session ${row.session_id}:`, updateError.message);
            });

            await Promise.all(updates);

            count += rows.length;
            page++;
        }
        console.log(`vehicle_stop_sessions re-populated: ${count} rows.`);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

repopulateRiskScores();
