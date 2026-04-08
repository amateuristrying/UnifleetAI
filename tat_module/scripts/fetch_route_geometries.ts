/**
 * Fetch Real Highway Geometries for SAP Route Master
 *
 * Uses Mapbox Directions API to get actual road network geometries
 * for all routes and stores them in the route_geometry column.
 *
 * Usage: npx tsx scripts/fetch_route_geometries.ts
 *
 * API Cost: ~114 requests × free tier = negligible
 * Rate limit: 300 req/min (Mapbox) → built-in throttle at 200ms/req
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase env vars.');
    process.exit(1);
}
if (!MAPBOX_TOKEN) {
    console.error('❌ Missing NEXT_PUBLIC_MAPBOX_TOKEN in .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Mapbox Directions API ───────────────────────────────────────
async function fetchDirectionsGeometry(
    coords: [number, number][], // [lng, lat] pairs
): Promise<{ geometry: GeoJSON.LineString; distance_km: number; duration_hrs: number } | null> {
    // Mapbox Directions: coordinates are lng,lat
    const coordStr = coords.map(c => `${c[0]},${c[1]}`).join(';');
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`   ⚠️  Directions API returned ${res.status}: ${res.statusText}`);
            return null;
        }

        const data = await res.json();

        if (!data.routes || data.routes.length === 0) {
            console.warn('   ⚠️  No routes returned by Directions API');
            return null;
        }

        const route = data.routes[0];
        return {
            geometry: route.geometry as GeoJSON.LineString,
            distance_km: Math.round(route.distance / 1000), // meters → km
            duration_hrs: Math.round((route.duration / 3600) * 10) / 10, // seconds → hours
        };
    } catch (err) {
        console.warn('   ⚠️  Directions API error:', (err as Error).message);
        return null;
    }
}

// ─── Throttle ────────────────────────────────────────────────────
function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ────────────────────────────────────────────────────────
async function main() {
    console.log('🛣️  Fetching real highway geometries for all routes...\n');

    // Get all routes with coordinates
    const { data: routes, error } = await supabase
        .from('sap_route_master')
        .select('id, route_name, sap_code, point_a_lat, point_a_lng, point_b_lat, point_b_lng, point_c_lat, point_c_lng, point_c, route_geometry, estimated_distance_km')
        .eq('is_active', true)
        .not('point_a_lat', 'is', null)
        .not('point_b_lat', 'is', null)
        .order('route_name');

    if (error || !routes) {
        console.error('❌ Failed to fetch routes:', error?.message);
        process.exit(1);
    }

    console.log(`   Found ${routes.length} routes with coordinates.`);

    // Filter to routes without geometry already (skip already-fetched)
    const pending = routes.filter(r => !r.route_geometry);
    console.log(`   ${pending.length} routes need geometry (${routes.length - pending.length} already have it).\n`);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i++) {
        const route = pending[i];
        const idx = `[${i + 1}/${pending.length}]`;

        // Build coordinate waypoints
        const coords: [number, number][] = [
            [route.point_a_lng, route.point_a_lat], // Origin
        ];

        // If multi-leg, add intermediate waypoint
        if (route.point_c && route.point_c_lat && route.point_c_lng) {
            coords.push([route.point_b_lng, route.point_b_lat]); // Via point
            coords.push([route.point_c_lng, route.point_c_lat]); // Final destination
        } else {
            coords.push([route.point_b_lng, route.point_b_lat]); // Destination
        }

        process.stdout.write(`   ${idx} ${route.route_name}...`);

        const result = await fetchDirectionsGeometry(coords);

        if (result) {
            // Update route with geometry and refined distance/duration
            const { error: updateErr } = await supabase
                .from('sap_route_master')
                .update({
                    route_geometry: result.geometry,
                    estimated_distance_km: result.distance_km,
                    estimated_duration_hrs: result.duration_hrs,
                })
                .eq('id', route.id);

            if (updateErr) {
                console.log(` ❌ DB update failed: ${updateErr.message}`);
                failed++;
            } else {
                console.log(` ✅ ${result.distance_km} km, ${result.duration_hrs}h (${result.geometry.coordinates.length} points)`);
                success++;
            }
        } else {
            console.log(' ❌ No route found');
            failed++;
        }

        // Rate limit: 200ms between requests (5 req/sec, well under 300 req/min limit)
        await sleep(200);
    }

    console.log(`\n🏁 Complete! ✅ ${success} succeeded, ❌ ${failed} failed, ⏭️ ${routes.length - pending.length} skipped (already had geometry).`);

    // Summary stats
    const { data: geoRoutes } = await supabase
        .from('sap_route_master')
        .select('estimated_distance_km')
        .not('route_geometry', 'is', null);

    if (geoRoutes) {
        const totalKm = geoRoutes.reduce((s, r) => s + (r.estimated_distance_km || 0), 0);
        console.log(`   📊 Total network: ${geoRoutes.length} routes, ${totalKm.toLocaleString()} km of highway mapped.`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
