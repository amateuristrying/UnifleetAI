const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) process.exit(1);

const supabase = createClient(supabaseUrl, supabaseKey);

async function listAllTables() {
    console.log('Listing ALL public tables/views...');

    // Try to fetch from a known table to see if we can get error hint, 
    // or just try to list everything via RPC if possible, 
    // but standard way is often blocked.

    // Let's try to query a table we KNOW exists to see if we can get a clue.
    // We know 'fleet_inventory' exists but has no ID.
    // Maybe 'trips' or 'telemetry' exists?

    const tablesToCheck = [
        'trip_logs',
        'trips',
        'positions',
        'telemetry',
        'raw_gps',
        'vehicle_status',
        'navixy_trackers',
        'api_cache'
    ];

    for (const table of tablesToCheck) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (!error) {
            console.log(`✅ Table exists: ${table}`);
            if (data && data.length > 0) {
                console.log(`   Keys:`, Object.keys(data[0]).join(', '));
            }
        }
    }
}

listAllTables();
export {};
