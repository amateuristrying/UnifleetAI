import { NextResponse } from 'next/server';
import { NavixyServerService } from '@/services/navixy-server';
import * as turf from '@turf/turf';

export const dynamic = 'force-dynamic'; // Always fetch fresh data

export async function GET() {
    try {
        const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
        if (!sessionKey) {
            return NextResponse.json({ error: 'Missing Navixy session key' }, { status: 500 });
        }

        const zones = await NavixyServerService.listZones(sessionKey);

        // Parallel processing with concurrency limit if needed, 
        // but for <100 zones Promise.all is fine. If >100, might need p-limit.
        // Assuming reasonably low count for now.

        const stats = {
            total: zones.length,
            circle: 0,
            polygon: 0,
            sausage: 0,
            processed: 0,
            failed_points: 0,
            skipped_invalid: 0
        };

        const featurePromises = zones.map(async (z: any) => {
            let geometry: GeoJSON.Polygon | null = null;

            if (z.type === 'circle') stats.circle++;
            else if (z.type === 'polygon') stats.polygon++;
            else if (z.type === 'sausage') stats.sausage++;

            if (z.type === 'circle' && z.center && z.radius) {
                // Approximate circle as polygon
                const circle = turf.circle(
                    [z.center.lng, z.center.lat],
                    z.radius / 1000,
                    { steps: 32, units: 'kilometers' } // ensure unit match
                );
                geometry = circle.geometry as GeoJSON.Polygon;
            } else if (z.type === 'polygon') {
                const points = z.points;

                if (!points || points.length === 0) {
                    // Points should now be present thanks to with_points=true
                    console.warn(`Zone ${z.id} (${z.type}) has no points even with with_points=true`);
                    stats.failed_points++;
                    return null;
                }

                const coords = points.map((p: any) => [p.lng, p.lat]);
                // Ensure ring closure
                if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
                    coords.push(coords[0]);
                }
                geometry = { type: 'Polygon', coordinates: [coords] };
            } else if (z.type === 'sausage') {
                // USER REQ: Road corridors (sausage) should NOT be marked as safe zones.
                stats.sausage++;
                return null;
            }

            if (geometry) {
                stats.processed++;
                return {
                    type: 'Feature',
                    properties: {
                        id: z.id,
                        name: z.label || z.name || `Zone ${z.id}`,
                        color: z.color || '#10b981', // Default green
                        address: z.address
                    },
                    geometry
                } as GeoJSON.Feature;
            }
            return null;
        });

        const results = await Promise.all(featurePromises);
        const features = results.filter((f): f is GeoJSON.Feature => f !== null);

        console.log(`[API] Safe Zones Stats:`, stats);
        console.log(`[API] Returning ${features.length} / ${zones.length} zones.`);

        return NextResponse.json({
            type: 'FeatureCollection',
            features
        });

    } catch (error) {
        console.error('[API] Safe Zones error:', error);
        return NextResponse.json({ error: 'Failed to fetch safe zones' }, { status: 500 });
    }
}
