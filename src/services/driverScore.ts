import { supabase } from '@/lib/supabase';
import type { Trip, Stop, EngineHours, SpeedViolation } from '@/types/driverScore';

// Data availability range
const DATA_START = new Date('2026-01-01');
const DATA_END = new Date('2026-02-09');

function ensureDateRange(start: Date, end: Date): { start: string, end: string } {
    let s = start < DATA_START ? DATA_START : start;
    let e = end > DATA_END ? DATA_END : end;

    if (s > e) s = e; // Safety if start is after max data end

    return {
        start: s.toISOString().split('T')[0],
        end: e.toISOString().split('T')[0]
    };
}

export async function fetchDriverScoreData(startDate: Date, endDate: Date) {
    const { start, end } = ensureDateRange(startDate, endDate);

    console.log(`Fetching driver score data from ${start} to ${end}`);

    try {
        const [tripsRes, stopsRes, engineRes, violationsRes] = await Promise.all([
            supabase
                .from('trips')
                .select('*')
                .gte('trip_date', start)
                .lte('trip_date', end),
            supabase
                .from('stops')
                .select('*')
                .gte('trip_date', start)
                .lte('trip_date', end),
            supabase
                .from('engine_hours_daily_summary')
                .select('*')
                .gte('report_date', start)
                .lte('report_date', end),
            supabase
                .from('speed_violations')
                .select('*')
                .gte('trip_date', start)
                .lte('trip_date', end)
        ]);

        if (tripsRes.error) throw tripsRes.error;
        if (stopsRes.error) throw stopsRes.error;
        if (engineRes.error) throw engineRes.error;
        if (violationsRes.error) throw violationsRes.error;

        return {
            trips: (tripsRes.data || []) as Trip[],
            stops: (stopsRes.data || []) as Stop[],
            engineHours: (engineRes.data || []) as EngineHours[],
            speedViolations: (violationsRes.data || []) as SpeedViolation[]
        };

    } catch (error) {
        console.error('Error fetching driver score data:', error);
        throw error;
    }
}
