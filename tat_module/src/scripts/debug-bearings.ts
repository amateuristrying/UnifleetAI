
import { getSupabaseAdmin } from '../lib/supabase-server';
import { RouteLearningService } from '../services/route-learning';
import { NavixyServerService } from '../services/navixy-server';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// FORCE OVERRIDE
process.env.NEXT_PUBLIC_NAVIXY_API_URL = 'https://api.navixy.com/v2';

async function debug() {
    console.log('🔍 Debugging Bearings...');
    const supabase = getSupabaseAdmin();

    // 1. Get a recent trip
    const { data: trips } = await supabase
        .from('v_ai_trip_logs')
        .select('*')
        .limit(1)
        .order('start_time', { ascending: false });

    if (!trips || trips.length === 0) {
        console.log('No trips found.');
        return;
    }

    const trip = trips[0];
    console.log(`Analyzing Trip ${trip.trip_id} (Tracker ${trip.tracker_id})`);

    // 2. Fetch Track
    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
    if (!sessionKey) throw new Error('No session key');

    const trackPoints = await NavixyServerService.getTrack(
        trip.tracker_id,
        trip.start_time,
        trip.end_time,
        sessionKey
    );

    console.log(`Fetched ${trackPoints.length} points.`);

    // 3. Re-implement logic locally to trace
    let zeroCount = 0;
    let totalSegments = 0;

    for (let i = 0; i < trackPoints.length - 1; i++) {
        const p1 = trackPoints[i];
        const p2 = trackPoints[i + 1];

        // Exact dup check
        if (p1.lat === p2.lat && p1.lng === p2.lng) {
            console.log(`[${i}] EXACT DUPLICATE POINT -> Bearing 0`);
            zeroCount++;
            continue;
        }

        // Calculate bearing
        const b = computeBearing(p1.lat, p1.lng, p2.lat, p2.lng);
        if (b === 0) {
            console.log(`[${i}] Calculated Bearing 0. Dist possibly tiny? P1: ${p1.lat},${p1.lng} P2: ${p2.lat},${p2.lng}`);
            zeroCount++;
        }
    }

    console.log(`\nSummary:`);
    console.log(`Total Segments: ${trackPoints.length - 1}`);
    console.log(`Zero Bearings: ${zeroCount}`);

    // 4. Run the Service
    try {
        const learned = await RouteLearningService.learnCorridorsFromTrack(
            trackPoints.map((p: any) => ({
                lat: p.lat, lng: p.lng, time: p.get_time ? (new Date(p.get_time).getTime() / 1000) : p.time
            })),
            trip.tracker_id
        );
        console.log(`\nService learned count: ${learned}`);
    } catch (e) {
        console.error(e);
    }
}

function computeBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const toRad = Math.PI / 180;
    const dLng = (lng2 - lng1) * toRad;
    const lat1r = lat1 * toRad;
    const lat2r = lat2 * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2r);
    const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

debug();
