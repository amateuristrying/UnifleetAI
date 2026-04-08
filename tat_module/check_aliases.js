require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkAliases() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('--- Aliases Check ---');
    const { data, error } = await supabase
        .from('geofence_aliases')
        .select('alias_name, normalized_name')
        .ilike('alias_name', '%LAKE OIL%');

    if (error) {
        console.error(error);
    } else {
        console.log('Aliases for LAKE OIL:', JSON.stringify(data, null, 2));
    }

    // Check one exact match with the function result
    const { data: normTest, error: normErr } = await supabase
        .rpc('normalize_geofence_name', { p_name: 'LAKE OIL' });
    console.log('Normalized result of "LAKE OIL":', normTest);
}

checkAliases().catch(console.error);
