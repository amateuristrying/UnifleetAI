import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { SecurityAnalysisPayload, SeverityLevel } from '@/types/security';

const VALID_SEVERITIES: SeverityLevel[] = ['CRITICAL', 'WARNING', 'MINOR'];

/**
 * POST /api/security/analysis
 *
 * Receives route deviation analysis results from the client
 * and upserts them into the route_security_events table.
 */
export async function POST(request: NextRequest) {
    try {
        const body: SecurityAnalysisPayload = await request.json();

        if (!body.trip_id || typeof body.trip_id !== 'string') {
            return NextResponse.json(
                { success: false, error: 'Missing or invalid trip_id' },
                { status: 400 }
            );
        }

        if (!body.tracker_id || typeof body.tracker_id !== 'number') {
            return NextResponse.json(
                { success: false, error: 'Missing or invalid tracker_id' },
                { status: 400 }
            );
        }

        if (typeof body.proposed_km !== 'number' || typeof body.actual_km !== 'number') {
            return NextResponse.json(
                { success: false, error: 'Missing distance metrics' },
                { status: 400 }
            );
        }

        if (!VALID_SEVERITIES.includes(body.severity_level)) {
            return NextResponse.json(
                { success: false, error: `Invalid severity_level: ${body.severity_level}` },
                { status: 400 }
            );
        }

        // Check env var before attempting connection
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
            console.error('[SecurityAPI] SUPABASE_SERVICE_ROLE_KEY is not set in .env.local');
            return NextResponse.json(
                { success: false, error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY not set. Add it to .env.local.' },
                { status: 503 }
            );
        }

        const supabaseAdmin = getSupabaseAdmin();

        // Try the RPC function first; fall back to direct upsert if function doesn't exist
        const { data, error } = await supabaseAdmin.rpc('upsert_security_analysis', {
            p_trip_id: body.trip_id,
            p_tracker_id: body.tracker_id,
            p_tracker_name: body.tracker_name || 'Unknown',
            p_proposed_km: body.proposed_km,
            p_actual_km: body.actual_km,
            p_deviation_km: body.deviation_km || 0,
            p_deviation_severity_ratio: body.deviation_severity_ratio || 0,
            p_severity_level: body.severity_level,
            p_route_breaches: body.route_breaches || 0,
            p_unauthorized_stops: body.unauthorized_stops || 0,
            p_deviation_segments: body.deviation_segments || null,
            p_stop_events: body.stop_events?.length > 0 ? body.stop_events : null,
            p_risk_score: body.risk_score ?? 0,
            p_risk_reasons: body.risk_reasons ?? [],
        });

        // If the RPC function doesn't exist, fall back to direct upsert
        if (error && (error.code === 'PGRST202' || error.message?.includes('Could not find'))) {
            console.warn('[SecurityAPI] RPC not found, falling back to direct upsert. Run scripts/migration_route_security.sql in Supabase SQL Editor.');

            const row = {
                trip_id: body.trip_id,
                tracker_id: body.tracker_id,
                tracker_name: body.tracker_name || 'Unknown',
                proposed_km: body.proposed_km,
                actual_km: body.actual_km,
                deviation_km: body.deviation_km || 0,
                deviation_severity_ratio: body.deviation_severity_ratio || 0,
                severity_level: body.severity_level,
                route_breaches: body.route_breaches || 0,
                unauthorized_stops: body.unauthorized_stops || 0,
                deviation_segments: body.deviation_segments || null,
                stop_events: body.stop_events?.length > 0 ? body.stop_events : null,
                risk_score: body.risk_score ?? 0,
                risk_reasons: body.risk_reasons ?? [],
                analyzed_at: new Date().toISOString(),
            };

            const { data: upsertData, error: upsertError } = await supabaseAdmin
                .from('route_security_events')
                .upsert(row, { onConflict: 'trip_id' })
                .select()
                .single();

            if (upsertError) {
                console.error('[SecurityAPI] Direct upsert error:', upsertError);
                return NextResponse.json(
                    {
                        success: false,
                        error: upsertError.message,
                        hint: upsertError.code === '42P01'
                            ? 'Table route_security_events does not exist. Run scripts/migration_route_security.sql in Supabase SQL Editor.'
                            : undefined,
                    },
                    { status: 500 }
                );
            }

            return NextResponse.json({ success: true, data: upsertData });
        }

        if (error) {
            console.error('[SecurityAPI] Supabase RPC Error:', error);
            return NextResponse.json(
                { success: false, error: error.message, code: error.code },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, data });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[SecurityAPI] Unexpected Error:', message);
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}
