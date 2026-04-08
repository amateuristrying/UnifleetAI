const require_esm = (module_name) => require(module_name);
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function debugV2() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('--- V2 Debugger ---');

    // 1. Check Metadata
    const { count: masterCount, error: masterErr } = await supabase
        .from('geofence_master')
        .select('*', { count: 'exact', head: true });

    if (masterErr) {
        console.error('Master Err:', masterErr.message);
    } else {
        console.log(`Geofence Master count: ${masterCount}`);
    }

    const { count: aliasCount } = await supabase
        .from('geofence_aliases')
        .select('*', { count: 'exact', head: true });
    console.log(`Geofence Aliases count: ${aliasCount}`);

    if (masterCount === 0 || aliasCount === 0) {
        console.warn('WARNING: Metadata tables are empty! Rebuilding seed...');
        // Execute seed if empty (this assumes the SQL for seeding is in a file)
        // Since we can't easily run raw SQL from JS client without an exec_sql wrapper,
        // we'll advise the user to run the seed again if empty.
    }

    // 2. Run Rebuild for a small window (7 days)
    const startDate = '2026-03-01';
    const endDate = '2026-03-07';
    console.log(`Running rebuild for ${startDate} to ${endDate}...`);

    const { error: rebuildErr } = await supabase.rpc('rebuild_tat_v2_full', {
        p_start: startDate,
        p_end: endDate
    });

    if (rebuildErr) {
        console.error('Rebuild RPC Err:', rebuildErr.message);
    } else {
        console.log('Rebuild RPC finished.');
    }

    // 3. Inspect Intermediate Tables
    const { data: normData } = await supabase
        .from('trip_geofence_events_normalized')
        .select('raw_geofence_name, canonical_name, role_code, normalization_rule')
        .limit(5);
    console.log('First 5 Normalized Events:', JSON.stringify(normData, null, 2));

    const { data: stateData } = await supabase
        .from('trip_state_events')
        .select('event_code, event_time, trip_key')
        .limit(5);
    console.log('First 5 State Events:', JSON.stringify(stateData, null, 2));

    const { data: factData } = await supabase
        .from('tat_trip_facts_v2')
        .select('trip_key, loading_terminal, status')
        .limit(2);
    console.log('Fact Sample:', JSON.stringify(factData, null, 2));
}

debugV2().catch(console.error);
