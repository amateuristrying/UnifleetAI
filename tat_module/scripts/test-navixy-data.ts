
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const NAVIXY_SESSION_KEY = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY!;
const NAVIXY_BASE = 'https://api.navixy.com/v2';

function formatNavixyDate(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toISOString().replace('T', ' ').split('.')[0];
}

async function fetchTrack(trackerId: number, from: string, to: string) {
    const fromStr = encodeURIComponent(formatNavixyDate(from));
    const toStr = encodeURIComponent(formatNavixyDate(to));
    const url = `${NAVIXY_BASE}/track/read?tracker_id=${trackerId}&from=${fromStr}&to=${toStr}&hash=${NAVIXY_SESSION_KEY}`;

    console.log(`Fetching track from: ${url.replace(NAVIXY_SESSION_KEY, '***')}`);

    const res = await fetch(url);
    if (!res.ok) {
        console.error('Navixy fetch failed:', res.status, res.statusText);
        return [];
    }
    const data = await res.json();
    return data?.success ? data.list : [];
}

async function main() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get a recent trip
    const { data: trips, error } = await supabase
        .from('v_ai_trip_logs')
        .select('trip_id, tracker_id, start_time, end_time')
        .limit(1)
        .order('start_time', { ascending: false });

    if (error || !trips || trips.length === 0) {
        console.error('Failed to get sample trip:', error);
        return;
    }

    const trip = trips[0];
    console.log(`Analyzing trip: ${trip.trip_id} (Tracker: ${trip.tracker_id})`);

    const points = await fetchTrack(trip.tracker_id, trip.start_time, trip.end_time);

    if (points.length === 0) {
        console.log('No points found for this trip.');
        return;
    }

    console.log(`Title: Received ${points.length} points.`);
    console.log('Sample Point Structure:');
    console.log(JSON.stringify(points[0], null, 2));

    // Check for specific fields of interest
    const hasAlt = points.some((p: any) => 'alt' in p || 'altitude' in p);
    const hasSat = points.some((p: any) => 'sat' in p || 'satellites' in p);

    console.log('\nData Availability Check:');
    console.log(`- Altitude: ${hasAlt ? 'YES' : 'NO'}`);
    console.log(`- Satellites: ${hasSat ? 'YES' : 'NO'}`);
}

main();
