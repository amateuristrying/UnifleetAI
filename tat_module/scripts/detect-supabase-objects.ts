
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function detectObjects() {
    console.log('--- Detecting Supabase SQL Functions & RPCs ---');

    const query = `
        SELECT 
            p.proname as function_name,
            pg_get_function_arguments(p.oid) as arguments,
            pg_get_function_result(p.oid) as result_type,
            n.nspname as schema_name
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.proname NOT LIKE 'st_%'
        AND p.proname NOT LIKE '_st_%'
        AND p.proname NOT LIKE 'postgis_%'
        AND p.proname NOT LIKE '_postgis_%'
        AND p.proname NOT LIKE 'geometry_%'
        AND p.proname NOT LIKE 'geography_%'
        AND p.proname NOT LIKE 'box2d%'
        AND p.proname NOT LIKE 'box3d%'
        AND p.proname NOT LIKE 'raster_%'
        AND p.proname NOT LIKE 'addgeometry%'
        AND p.proname NOT LIKE 'dropgeometry%'
        ORDER BY p.proname
    `;

    try {
        const { data, error } = await supabase.rpc('exec_sql', { query });

        if (error) {
            console.error('Error calling exec_sql:', error);

            // Fallback: try to list from information_schema if exec_sql is restricted or failing differently
            console.log('Attempting fallback detection via direct RPC list (if possible)...');
            return;
        }

        console.log(`Found ${data.length} functions:\n`);
        console.table(data);

    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

detectObjects();
