import { supabase } from '@/lib/supabase';

export interface NightEventsSummary {
    total_trips: number;
    active_vehicles: number;
    off_fence_stops: number;
    total_distance_km: number;
}

export interface OvernightRestLocation {
    tracker_name: string;
    last_active_time: string;
    night_duration_minutes: number;
    is_moving: boolean;
    in_geofence: boolean;
    last_location: string;
    end_lat: number | null;
    end_lng: number | null;
}

export interface NightDrivingLogEvent {
    trip_id: string;
    tracker_name: string;
    start_time: string;
    end_time: string;
    distance_km: number;
    duration_minutes: number;
    status: string;
}

export const fetchNightEventsSummary = async (startDate: string, endDate: string): Promise<NightEventsSummary> => {
    const { data, error } = await supabase.rpc('get_night_events_summary', {
        p_start_date: startDate,
        p_end_date: endDate
    });

    if (error) {
        console.error("Error fetching night events summary:", error);
        throw error;
    }

    if (!data || data.length === 0) {
        return {
            total_trips: 0,
            active_vehicles: 0,
            off_fence_stops: 0,
            total_distance_km: 0
        };
    }

    return data[0];
};

export const fetchOvernightRestLocations = async (startDate: string, endDate: string, limit: number | null = 20, offset: number = 0): Promise<OvernightRestLocation[]> => {
    // Note: Passing undefined instead of null ensures Supabase omits the key if it's null,
    // which prevents strict type missing function 404s.
    const params: any = {
        p_start_date: startDate,
        p_end_date: endDate,
        p_limit: limit !== null ? limit : undefined,
        p_offset: offset !== null ? offset : undefined
    };

    const { data, error } = await supabase.rpc('get_overnight_rest_locations', params);

    if (error) {
        console.error("Error fetching overnight rest locations:", error);
        throw error;
    }

    return data || [];
};

export const fetchNightDrivingLog = async (startDate: string, endDate: string, limit: number | null = 20, offset: number = 0): Promise<NightDrivingLogEvent[]> => {
    const params: any = {
        p_start_date: startDate,
        p_end_date: endDate,
        p_limit: limit !== null ? limit : undefined,
        p_offset: offset !== null ? offset : undefined
    };

    const { data, error } = await supabase.rpc('get_night_driving_log', params);

    if (error) {
        console.error("Error fetching night driving log:", error);
        throw error;
    }

    return data || [];
};
