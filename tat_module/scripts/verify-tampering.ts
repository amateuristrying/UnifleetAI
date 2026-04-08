const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://motfpmjtunyelvwsmyyp.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // Use Anon Key to simulate frontend

if (!SUPABASE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function verifyTampering() {
    console.log('Verifying get_tampering_events RPC...');

    const params = {
        min_date: '2025-01-01T00:00:00Z',
        max_date: new Date().toISOString(),
        p_limit: 10
    };

    console.log('Calling RPC with params:', params);

    const { data, error } = await supabase.rpc('get_tampering_events', params);

    if (error) {
        console.error('RPC Failed:', error);
        console.error('Details:', JSON.stringify(error, null, 2));
    } else {
        console.log('RPC Success!');
        console.log(`Returned ${data?.length || 0} rows`);
        if (data && data.length > 0) {
            console.log('Sample Row:', data[0]);
        }
    }
}

verifyTampering();
export {};
