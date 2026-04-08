require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkCounts() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { count: mapped } = await supabase
        .from('trip_geofence_events_normalized')
        .select('*', { count: 'exact', head: true })
        .neq('normalization_rule', 'unmapped');

    const { count: unmapped } = await supabase
        .from('trip_geofence_events_normalized')
        .select('*', { count: 'exact', head: true })
        .eq('normalization_rule', 'unmapped');

    console.log(`Mapped: ${mapped}, Unmapped: ${unmapped}`);
}

checkCounts().catch(console.error);
