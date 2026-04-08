import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    const chunks = [
        ['2025-11-01', '2025-11-15'], ['2025-11-15', '2025-12-01'],
        ['2025-12-01', '2025-12-15'], ['2025-12-15', '2026-01-01'],
        ['2026-01-01', '2026-01-15'], ['2026-01-15', '2026-02-01'],
        ['2026-02-01', '2026-02-15'], ['2026-02-15', '2026-03-05'],
    ];

    for (const [s, e] of chunks) {
        console.log(`Processing ${s} → ${e} ...`);
        const t = Date.now();
        const { error } = await supabase.rpc('process_tat_chunk', { p_start: s, p_end: e });
        if (error) console.error(`  ❌ ${error.message}`);
        else console.log(`  ✅ Done in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
    console.log('Done!');
}
run();
