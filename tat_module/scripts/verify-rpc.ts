import { createClient } from '@supabase/supabase-js';
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

async function verifyRPC() {
    console.log('Verifying get_hex_details RPC...');

    try {
        // 1. Get a valid Res 9 index from DB
        const { data: vss, error: vssError } = await supabase
            .from('vehicle_stop_sessions')
            .select('h3_index')
            .not('h3_index', 'is', null)
            .limit(1)
            .single();

        if (vssError) throw vssError;
        if (!vss) {
            console.log('No data in vehicle_stop_sessions');
            return;
        }

        const testH3 = vss.h3_index;
        console.log(`Testing with H3 Index (Res 9): ${testH3}`);

        // 2. Call RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc('get_hex_details', {
            p_h3_index: testH3,
            min_date: '2020-01-01', // Wide range
            max_date: new Date().toISOString(),
            p_limit: 10
        });

        if (rpcError) {
            console.error('RPC Error:', rpcError.message);
        } else {
            console.log(`RPC Result Count: ${rpcData ? rpcData.length : 0}`);
            if (rpcData && rpcData.length === 0) {
                console.log('FAILURE: RPC returned 0 rows. Likely due to Res 9 vs Res 7 mismatch in OLD RPC logic.');
            } else {
                console.log('SUCCESS: RPC returned data.');
            }
        }

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verifyRPC();
