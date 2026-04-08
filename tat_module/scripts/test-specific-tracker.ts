import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data, error } = await supabase.rpc('get_tat_trip_details', {
        p_start_date: '2026-01-01T00:00:00Z',
        p_end_date: new Date().toISOString(),
        p_limit: 5000,
        p_offset: 0
    });
    
    if (error) {
        console.error("Error:", error);
    } else {
        const trips = data?.data || [];
        console.log("Total trips fetched:", trips.length);
        // We find a specific tracker id from their logs, e.g., for the image. 
        // We'll just group by tracker_id to see the top ones.
        const counts: Record<string, number> = {};
        for (const t of trips) counts[t.tracker_name] = (counts[t.tracker_name] || 0) + 1;
        const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
        console.log("Top trackers by trip count:", sorted.slice(0, 5));
        
        // Let's print trips for the top tracker
        if (sorted.length > 0) {
            const topTracker = sorted[0][0];
            const tTrips = trips.filter((t: any) => t.tracker_name === topTracker);
            console.log(`\nTrips for ${topTracker}:`);
            for (const t of tTrips) {
               console.log(`- Departure: ${t.departure_time}, Loading: ${t.loading_terminal}, Dest: ${t.dest_name} (Entry: ${t.dest_entry})`);
            }
        }
    }
}
main();
