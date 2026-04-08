const { createClient } = require('@supabase/supabase-js');
const { getResolution } = require('h3-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://motfpmjtunyelvwsmyyp.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function verifyStopPatterns() {
    console.log('Verifying get_stop_patterns RPC with new signature...');

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError) console.log('Auth check:', userError.message);

    // Test Params matching frontend
    const params = {
        min_date: '2025-10-01T00:00:00Z',
        max_date: new Date().toISOString(),
        p_limit: 10,
        // New params
        hour_filter: null, // Test null
        p_min_duration: null, // Test null
        p_max_duration: null // Test null
    };

    console.log('Calling RPC with params:', params);

    const { data, error } = await supabase.rpc('get_stop_patterns', params);

    if (error) {
        console.error('RPC Failed:', error);
        console.error('Details:', JSON.stringify(error, null, 2));
    } else {
        console.log('RPC Success!');
        console.log(`Returned ${data?.length || 0} rows`);
        if (data && data.length > 0) {
            console.log('Sample Row:', data[0]);
            // Check for new columns
            if ('morning_visits' in data[0]) console.log('✅ morning_visits column present');
            else console.error('❌ morning_visits column MISSING');

            if ('min_duration_hours' in data[0]) console.log('✅ min_duration_hours column present');
            else console.error('❌ min_duration_hours column MISSING');
        }
    }
}

verifyStopPatterns();
export {};
