const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) process.exit(1);

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugCorridors() {
    console.log('--- Debugging Fleet Corridors ---');

    // 1. Total Count
    const { count: total, error: err1 } = await supabase
        .from('fleet_corridors')
        .select('*', { count: 'exact', head: true });

    if (err1) {
        console.error('Error counting corridors:', err1);
        return;
    }
    console.log(`Total Corridors: ${total}`);

    // 2. Global Corridors (tracker_id IS NULL)
    const { count: globalCount, error: err2 } = await supabase
        .from('fleet_corridors')
        .select('*', { count: 'exact', head: true })
        .is('tracker_id', null);

    console.log(`Global Corridors (tracker_id is NULL): ${globalCount}`);

    // 3. Specific Corridors (tracker_id IS NOT NULL)
    const specificCount = (total || 0) - (globalCount || 0);
    console.log(`Specific Corridors (tracker_id set): ${specificCount}`);

    // 4. Sample distinct tracker_ids
    console.log('\nSampling 50 corridors with tracker_id set:');
    const { data: sample, error: err3 } = await supabase
        .from('fleet_corridors')
        .select('tracker_id')
        .not('tracker_id', 'is', null)
        .limit(50);

    if (sample && sample.length > 0) {
        const ids = Array.from(new Set(sample.map((r: any) => r.tracker_id)));
        console.log(`Sample Tracker IDs found in corridors: ${ids.join(', ')}`);
    } else {
        console.log('No specific corridors found in sample.');
    }

    // 5. Compare with Trips
    console.log('\nFetching top 5 trackers from trips...');
    const { data: trips, error: err4 } = await supabase
        .from('trips')
        .select('tracker_id, tracker_name')
        .limit(5);

    if (trips) {
        trips.forEach((t: any) => {
            console.log(`Trip Tracker: ID=${t.tracker_id} Name=${t.tracker_name}`);
        });
    }

    // 6. Test specific fetch
    if (trips && trips.length > 0) {
        const testId = trips[0].tracker_id;
        console.log(`\nTesting fetch for specific ID: ${testId}`);

        const { count: matchCount } = await supabase
            .from('fleet_corridors')
            .select('*', { count: 'exact', head: true })
            .eq('tracker_id', testId);

        console.log(`Rows in fleet_corridors matching ID ${testId}: ${matchCount}`);
    }

    // 7. Find Top Trackers by Corridor Count
    console.log('\nFinding top trackers with most corridors...');

    // Fetch a large chunk to analyze distribution
    const { data: chunk } = await supabase
        .from('fleet_corridors')
        .select('tracker_id')
        .not('tracker_id', 'is', null)
        .limit(50000);

    if (chunk) {
        const counts: Record<number, number> = {};
        chunk.forEach((r: any) => {
            if (r.tracker_id) {
                counts[r.tracker_id] = (counts[r.tracker_id] || 0) + 1;
            }
        });

        const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        console.log('Top Trackers (ID: Count):');
        for (const [tid, count] of sorted) {
            const { data: tData } = await supabase
                .from('trips')
                .select('tracker_name')
                .eq('tracker_id', tid)
                .limit(1);
            const name = tData && tData[0] ? tData[0].tracker_name : 'Unknown';
            console.log(`- ${name} (ID: ${tid}): ${count} corridors`);
        }
    }
}

debugCorridors();
export {};
