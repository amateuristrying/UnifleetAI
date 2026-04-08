
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { cellToLatLng } from 'h3-js';

// SWITCH TO MAPBOX (Public OSRM is down/refusing connections)
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const USE_MAPBOX = !!MAPBOX_TOKEN;

// Fallback OSRM
const OSRM_API_URL = process.env.OSRM_API_URL || 'https://router.project-osrm.org';

const BATCH_SIZE = 1;
const DELAY_MS = 600; // Mapbox is faster, but let's be safe (approx 100 req/min free tier is 100k/month, plenty)
const MAX_RETRIES = 5;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Robust fetch with exponential backoff
async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<Response> {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);

            if (res.status === 429) {
                const waitTime = (i + 1) * 2000;
                console.warn(`⚠️ 429 Too Many Requests. Waiting ${waitTime}ms...`);
                await sleep(waitTime);
                continue;
            }

            if (res.status >= 500) {
                const waitTime = (i + 1) * 1000;
                console.warn(`⚠️ Server Error ${res.status}. Retrying in ${waitTime}ms...`);
                await sleep(waitTime);
                continue;
            }

            return res;
        } catch (err: any) {
            const isNetworkError = err.cause && (
                err.cause.code === 'ECONNREFUSED' ||
                err.cause.code === 'ETIMEDOUT' ||
                err.cause.code === 'ENOTFOUND'
            );

            if (isNetworkError) {
                const waitTime = (i + 1) * 3000;
                console.warn(`⚠️ Connection Error (${err.cause.code}). Retrying in ${waitTime}ms...`);
                await sleep(waitTime);
            } else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

async function enrichCorridors() {
    console.log('🚀 Starting Corridor Enrichment...');

    if (USE_MAPBOX) {
        console.log('✅ Using MAPBOX API (Reliable)');
    } else {
        console.warn('⚠️ Mapbox Token NOT found. Falling back to OSRM Demo Server (Unreliable)');
    }

    // 1. Fetch corridors without geometry
    const { data: corridors, error } = await supabase
        .from('fleet_corridors')
        .select('h3_index')
        .is('road_geometry', null)
        .limit(1000);

    if (error) {
        console.error('Error fetching corridors:', error);
        return;
    }

    if (!corridors || corridors.length === 0) {
        console.log('✅ No corridors pending enrichment.');
        return;
    }

    // Deduplicate
    const uniqueH3 = [...new Set(corridors.map(c => c.h3_index))];
    console.log(`Processing ${uniqueH3.length} unique H3 indices...`);

    for (let i = 0; i < uniqueH3.length; i++) {
        const h3 = uniqueH3[i];
        const [lat, lng] = cellToLatLng(h3);

        try {
            let url = '';

            if (USE_MAPBOX) {
                // Mapbox Directions: A->B route (offset by ~10m) to get speed limit annotation
                // 0 distance routes cause 422 when requesting annotations
                const destLng = lng + 0.0001;
                url = `https://api.mapbox.com/directions/v5/mapbox/driving/${lng},${lat};${destLng},${lat}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full&annotations=maxspeed`;
            } else {
                // OSRM Nearest
                url = `${OSRM_API_URL}/nearest/v1/driving/${lng},${lat}?number=1`;
            }

            const res = await fetchWithRetry(url);
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`HTTP ${res.status}: ${res.statusText} - ${errText}`);
            }

            const json = await res.json();

            let snappedLng: number | null = null;
            let snappedLat: number | null = null;
            let speedLimit: number | null = null; // New

            if (json.code === 'Ok' && json.waypoints && json.waypoints.length > 0) {
                const wp = json.waypoints[0];
                snappedLng = wp.location[0];
                snappedLat = wp.location[1];

                // Parse Speed Limit from Mapbox Annotation
                // json.routes[0].legs[0].annotation.maxspeed -> array of objects { speed: 50, unit: 'km/h' }
                if (USE_MAPBOX && json.routes && json.routes.length > 0 && json.routes[0].legs && json.routes[0].legs.length > 0) {
                    const leg = json.routes[0].legs[0];
                    if (leg.annotation && leg.annotation.maxspeed && leg.annotation.maxspeed.length > 0) {
                        const speedObj = leg.annotation.maxspeed[0]; // Take first point
                        if (speedObj && typeof speedObj.speed === 'number') {
                            // Convert to km/h if needed (Mapbox usually returns km/h or unknown)
                            // Actually Mapbox returns { speed: 50, unit: 'km/h' } or { speed: 30, unit: 'mph' }
                            if (speedObj.unit === 'mph') {
                                speedLimit = Math.round(speedObj.speed * 1.60934);
                            } else if (speedObj.unit === 'km/h') {
                                speedLimit = Math.round(speedObj.speed);
                            }
                        }
                    }
                }
            }

            if (snappedLng !== null && snappedLat !== null) {
                // Update DB
                const updatePayload: any = {
                    road_geometry: `POINT(${snappedLng} ${snappedLat})`
                };
                if (speedLimit) updatePayload.speed_limit_kmh = speedLimit;

                const { error: updateError } = await supabase
                    .from('fleet_corridors')
                    .update(updatePayload)
                    .eq('h3_index', h3);

                if (updateError) {
                    console.error(`❌ DB Update Failed for ${h3}:`, updateError.message);
                } else {
                    process.stdout.write('.');
                }
            } else {
                console.warn(`⚠️ No road found near ${h3}`);
            }

        } catch (err) {
            console.error(`\n❌ Failed to enrich ${h3}:`, err);
        }

        await sleep(DELAY_MS);
    }

    console.log('\n✅ Enrichment Batch Complete.');
}

enrichCorridors();
