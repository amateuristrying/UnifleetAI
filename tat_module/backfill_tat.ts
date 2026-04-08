import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function backfill() {
    const startYear = 2023;
    const startMonth = 1;
    const endDate = new Date('2026-04-01');

    let current = new Date(startYear, startMonth - 1, 1); // month is 0-indexed

    while (current < endDate) {
        const chunkStart = current.toISOString().slice(0, 10);
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        const chunkEnd = next.toISOString().slice(0, 10);

        console.log(`Processing chunk: ${chunkStart} → ${chunkEnd} ...`);
        const start = Date.now();

        const { error } = await supabase.rpc('process_tat_chunk', {
            p_start: chunkStart,
            p_end: chunkEnd,
        });

        if (error) {
            console.error(`  ❌ Error on ${chunkStart}:`, error.message);
        } else {
            console.log(`  ✅ Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
        }

        current = next;
    }

    // Verify
    const { data } = await supabase.from('tat_trips_data').select('tracker_id', { count: 'exact', head: true });
    console.log(`\n🎉 Backfill complete! Total trips in tat_trips_data: check Supabase dashboard.`);
}

backfill();
