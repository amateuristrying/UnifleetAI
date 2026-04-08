import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugTrips() {
    const startDate = '2026-01-01T00:00:00Z';
    const endDate = '2026-02-11T23:59:59Z';

    console.log(`Analyzing trips from ${startDate} to ${endDate}...\n`);

    try {
        // Fetch ALL trips in this range bypassing pagination for debug
        const { data, error } = await supabase.rpc('get_tat_trip_details', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_limit: 1000,
            p_offset: 0,
            p_trip_type: null,
            p_status: null,
            p_destination: null
        });

        if (error) {
            console.error('RPC Error:', error);
            return;
        }

        const trips = (data as any).data || [];
        console.log(`Total Trips Found (Sessionized): ${trips.length}\n`);

        const summary: Record<string, number> = {};
        const statusMap: Record<string, number> = {};

        trips.forEach((t: any) => {
            const dest = t.dest_name || 'UNKNOWN';
            summary[dest] = (summary[dest] || 0) + 1;
            statusMap[t.trip_status] = (statusMap[t.trip_status] || 0) + 1;
        });

        console.log('--- Sample Raw Records (First 10) ---');
        trips.slice(0, 10).forEach((t: any) => {
            console.log(`${t.tracker_name.padEnd(25)} | ${t.kurasini_entry.slice(0, 16)} | ${t.trip_status.padEnd(12)} | ${t.dest_name || 'UNKNOWN'}`);
        });
        if (trips.length > 10) console.log('... and more');

        console.log('\n--- Status Breakdown ---');
        console.table(statusMap);

        console.log('\n--- Destination Breakdown ---');
        console.table(summary);

        const fs = await import('fs');
        const exportPath = path.resolve(__dirname, '..', 'trip_debug_export.json');
        fs.writeFileSync(exportPath, JSON.stringify(trips, null, 2));
        console.log(`\nFull export saved to: ${exportPath}`);

    } catch (e) {
        console.error('Debug script failed:', e);
    }
}

debugTrips();
