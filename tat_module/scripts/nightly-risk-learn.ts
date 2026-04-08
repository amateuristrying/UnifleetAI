import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(__dirname, '..', '.env.local');
console.log('Loading env from:', envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.warn('Dotenv error:', result.error);
}

console.log('SUPABASE_URL present:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('SERVICE_KEY present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

import { RouteLearningService } from '@/services/route-learning';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const NAVIXY_BASE = 'https://api.navixy.com/v2';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function formatNavixyDate(date: Date): string {
    return date.toISOString().replace('T', ' ').split('.')[0];
}

async function fetchTrack(trackerId: number, from: string, to: string, sessionKey: string): Promise<any[]> {
    const fromStr = encodeURIComponent(formatNavixyDate(new Date(from)));
    const toStr = encodeURIComponent(formatNavixyDate(new Date(to)));
    const url = `${NAVIXY_BASE}/track/read?tracker_id=${trackerId}&from=${fromStr}&to=${toStr}&hash=${sessionKey}`;

    try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return data?.success ? data.list : [];
    } catch (err) {
        console.warn(`Navixy fetch failed for ${trackerId}:`, err);
        return [];
    }
}

async function main() {
    const args = process.argv.slice(2);
    const isAll = args[0] === 'ALL';
    const lookbackDays = !isAll && args[0] ? parseInt(args[0], 10) : 1;

    console.log(`[Nightly Risk Learner] Starting... (Mode: ${isAll ? 'ALL HISTORY' : `Lookback ${lookbackDays} days`})`);

    // 1. Fetch recent trips
    const supabase = getSupabaseAdmin();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    if (!isAll) {
        console.log(`Fetching trips since: ${startDate.toISOString()}`);
    } else {
        console.log('Fetching ALL trips from history...');
    }

    // 0. Count Total First (for UX)
    let countQuery = supabase
        .from('v_ai_trip_logs')
        .select('*', { count: 'exact', head: true });

    if (!isAll) {
        countQuery = countQuery.gte('end_time', startDate.toISOString());
    }

    const { count } = await countQuery;

    console.log(`\n>>> Found ${count} total trips to process. Starting fetch...\n`);

    let allTrips: any[] = [];
    let page = 0;
    const pageSize = 1000;

    while (true) {
        let query = supabase
            .from('v_ai_trip_logs')
            .select('*');

        if (!isAll) {
            query = query.gte('end_time', startDate.toISOString());
        }

        const { data: batch, error } = await query.range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error('Error fetching trips:', error);
            break;
        }

        if (!batch || batch.length === 0) break;

        allTrips = allTrips.concat(batch);
        console.log(`Fetched batch ${page + 1} (${batch.length} trips)... Total: ${allTrips.length}`);

        if (batch.length < pageSize) break; // Reached end
        page++;
    }

    if (allTrips.length === 0) {
        console.log('No trips found for this period.');
        return;
    }

    console.log(`Processing ${allTrips.length} total trips...`);
    let learnedCount = 0;
    let skippedCount = 0;

    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
    if (!sessionKey) throw new Error('Missing Session Key');

    for (const trip of allTrips) {
        try {
            if (!trip.start_time || !trip.end_time || !trip.trip_id) continue;

            // P2.7: Idempotency — skip trips that have already been learned
            const { data: alreadyLearned } = await supabase
                .from('corridor_learned_trips')
                .select('trip_id')
                .eq('trip_id', trip.trip_id)
                .maybeSingle();

            if (alreadyLearned) {
                skippedCount++;
                continue;
            }

            // Fetch track points from Navixy
            const track = await fetchTrack(
                trip.tracker_id,
                trip.start_time,
                trip.end_time,
                sessionKey
            );

            // Rate limit Navixy API calls
            await delay(200);

            if (track && track.length > 2) {
                const simpleTrack = track.map((p: any) => ({
                    lat: p.lat,
                    lng: p.lng,
                    time: p.get_time ? (new Date(p.get_time).getTime() / 1000) : p.time,
                    speed: p.speed // Navixy speed in km/h
                }));

                // P2.5: Pass tracker_id for per-vehicle corridor scoping
                const h3Count = await RouteLearningService.learnCorridorsFromTrack(
                    simpleTrack,
                    trip.tracker_id
                );

                // P2.7: Record that this trip has been learned
                await supabase.from('corridor_learned_trips').insert({
                    trip_id: trip.trip_id,
                    tracker_id: trip.tracker_id,
                    h3_count: h3Count,
                });

                learnedCount++;
            }
        } catch (e) {
            console.error(`Failed to learn trip ${trip.trip_id}`, e);
        }

        if ((learnedCount + skippedCount) % 10 === 0) {
            console.log(`Progress: ${learnedCount} learned, ${skippedCount} skipped (idempotent)...`);
        }
    }

    console.log(`[Nightly Risk Learner] Completed. Learned: ${learnedCount}, Skipped (already learned): ${skippedCount}.`);
}

main().catch(console.error);
