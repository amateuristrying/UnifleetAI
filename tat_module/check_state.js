require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkState() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase.rpc('get_state_counts');
    if (error) {
        // If RPC not found, use direct query
        const { data: qData, error: qErr } = await supabase
            .from('trip_state_events')
            .select('event_code, count:event_code.count()')
            .group('event_code');
        console.log('State counts:', qData);
    } else {
        console.log('State counts:', data);
    }
}

checkState().catch(console.error);
