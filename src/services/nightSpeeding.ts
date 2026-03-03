import { supabase } from '@/lib/supabase';

// Night hours: 19:00 – 06:59 local (Africa/Dar_es_Salaam)
export const NIGHT_START_HOUR = 19;
export const NIGHT_END_HOUR = 7; // exclusive upper bound (0–6)

export interface NightSpeedingIncident {
    id: string;
    tracker_id: number;
    tracker_name: string;
    start_time: string;
    trip_date: string;
    duration_seconds: number;
    max_speed: number;
    avg_speed: number;
    lat: number | null;
    lng: number | null;
}

export interface NightSpeedingSummary {
    total_incidents: number;
    vehicles_involved: number;
    avg_max_speed: number;
    worst_speed: number;
}

// Only show true speeding incidents — violations at or above this threshold
export const MIN_SPEED_KMH = 80;

// Fetch night speeding incidents from Supabase directly (no RPC needed)
export const fetchNightSpeedingIncidents = async (
    startDate: string,
    endDate: string,
    limit = 100,
    offset = 0
): Promise<NightSpeedingIncident[]> => {
    // Filter: trip_date between startDate and endDate
    // AND (hour >= 19 OR hour <= 6) in UTC+3 equivalent
    // We compare using start_time with AT TIME ZONE 'Africa/Dar_es_Salaam'
    // Supabase doesn't natively support AT TIME ZONE in filters,
    // so we filter by trip_date and then post-filter by hour client-side.
    // A generous time window: 16:00 UTC (= 19:00 EAT) to 04:00 UTC (= 07:00 EAT next day)
    const { data, error } = await supabase
        .from('speed_violations')
        .select('id, tracker_id, tracker_name, start_time, trip_date, duration_seconds, max_speed, avg_speed, lat, lng')
        .gte('trip_date', startDate)
        .lte('trip_date', endDate)
        .gte('max_speed', MIN_SPEED_KMH)   // ← server-side: exclude sub-80 km/h records
        .order('max_speed', { ascending: false }) // highest speed first
        .range(offset, offset + limit - 1);

    if (error) {
        console.error('Error fetching night speeding incidents:', error);
        throw error;
    }

    // Client-side filter: keep only night-hour records (EAT = UTC+3)
    const rows = (data || []).filter(r => {
        if (!r.start_time) return false;
        const d = new Date(r.start_time);
        const eatHour = (d.getUTCHours() + 3) % 24;
        return eatHour >= NIGHT_START_HOUR || eatHour < NIGHT_END_HOUR;
    });

    return rows as NightSpeedingIncident[];
};

export const computeSummary = (incidents: NightSpeedingIncident[]): NightSpeedingSummary => {
    if (incidents.length === 0) {
        return { total_incidents: 0, vehicles_involved: 0, avg_max_speed: 0, worst_speed: 0 };
    }
    const vehicles = new Set(incidents.map(r => r.tracker_id)).size;
    const avgMax = incidents.reduce((s, r) => s + (r.max_speed ?? 0), 0) / incidents.length;
    const worst = Math.max(...incidents.map(r => r.max_speed ?? 0));
    return {
        total_incidents: incidents.length,
        vehicles_involved: vehicles,
        avg_max_speed: Math.round(avgMax),
        worst_speed: Math.round(worst),
    };
};

/** Returns the latest trip_date with max_speed >= MIN_SPEED_KMH, or yesterday as fallback. */
export const fetchLatestSpeedDate = async (): Promise<string> => {
    const { data } = await supabase
        .from('speed_violations')
        .select('trip_date')
        .gte('max_speed', MIN_SPEED_KMH)
        .order('trip_date', { ascending: false })
        .limit(1);
    if (data && data.length > 0 && data[0].trip_date) return data[0].trip_date as string;
    // fallback: yesterday
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
};

