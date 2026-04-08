require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function checkView() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log('--- View Check ---');
    const { data, error, count } = await supabase
        .from('tat_trips_view_v2')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('View Error:', error.message);
    } else {
        console.log('Trips in tat_trips_view_v2:', count);
    }

    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_tat_trip_details_v2', {
        p_start_date: '2025-10-01T00:00:00Z',
        p_end_date: new Date().toISOString()
    });

    if (rpcErr) {
        console.error('RPC Error:', rpcErr.message);
    } else {
        console.log('RPC result count:', rpcData?.data?.length);
    }
}

checkView().catch(console.error);
