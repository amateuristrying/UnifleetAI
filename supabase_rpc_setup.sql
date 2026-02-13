-- Enable PL/pgSQL
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- 1. get_tat_fleet_stats
-- Fetches aggregate KPI metrics for the selected date range and destination.
CREATE OR REPLACE FUNCTION get_tat_fleet_stats(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
) RETURNS JSON AS $$
BEGIN
    -- REPLACE WITH YOUR ACTUAL QUERY
    -- Example returning mock data matching the signature
    RETURN json_build_object(
        'avg_waiting_hrs', 12.5,
        'avg_loading_hrs', 4.2,
        'avg_border_hrs', 6.8,
        'avg_offloading_hrs', 3.5,
        'trips_departed', 150,
        'trips_completed', 142,
        'trip_completion_rate', 94.6
    );
END;
$$ LANGUAGE plpgsql;

-- 2. get_border_wait_trend
-- Fetches daily average wait times for specific borders to populate charts.
CREATE OR REPLACE FUNCTION get_border_wait_trend(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_border_tz TEXT,
    p_border_foreign TEXT
) RETURNS JSON AS $$
BEGIN
    -- REPLACE WITH YOUR ACTUAL QUERY
    -- Example returning mock data array
    RETURN json_build_array(
        json_build_object('day_date', '2023-10-01', 'avg_wait_hours', 5.5, 'truck_count', 10),
        json_build_object('day_date', '2023-10-02', 'avg_wait_hours', 6.0, 'truck_count', 12),
        json_build_object('day_date', '2023-10-03', 'avg_wait_hours', 4.8, 'truck_count', 9),
        json_build_object('day_date', '2023-10-04', 'avg_wait_hours', 7.2, 'truck_count', 15),
        json_build_object('day_date', '2023-10-05', 'avg_wait_hours', 5.1, 'truck_count', 11)
    );
END;
$$ LANGUAGE plpgsql;

-- 3. get_tat_summary_by_destination
-- Fetches a breakdown of performance metrics by destination.
CREATE OR REPLACE FUNCTION get_tat_summary_by_destination(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_destination TEXT DEFAULT NULL
) RETURNS JSON AS $$
BEGIN
    -- REPLACE WITH YOUR ACTUAL QUERY
    RETURN json_build_array(
        json_build_object(
            'destination', 'Lubumbashi',
            'trip_count', 45,
            'avg_loading_hrs', 4.0,
            'avg_transit_hrs', 72.5,
            'avg_border_hrs', 8.5,
            'avg_offloading_hrs', 3.0,
            'avg_total_tat_days', 5.2
        ),
        json_build_object(
            'destination', 'Lusaka',
            'trip_count', 30,
            'avg_loading_hrs', 3.8,
            'avg_transit_hrs', 48.0,
            'avg_border_hrs', 5.2,
            'avg_offloading_hrs', 2.8,
            'avg_total_tat_days', 3.5
        )
    );
END;
$$ LANGUAGE plpgsql;

-- 4. get_tat_trip_details
-- Used in the drill-down modal to show detailed trip lifecycles.
CREATE OR REPLACE FUNCTION get_tat_trip_details(
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_trip_type TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_destination TEXT DEFAULT NULL
) RETURNS JSON AS $$
BEGIN
    -- REPLACE WITH YOUR ACTUAL QUERY
    RETURN json_build_array(
        json_build_object(
            'trip_id', 'TRIP-001',
            'truck_reg', 'T123 ABC',
            'driver_name', 'John Doe',
            'destination', 'Lubumbashi',
            'status', 'completed',
            'start_time', '2023-10-01T08:00:00Z',
            'end_time', '2023-10-06T14:00:00Z',
            'loading_duration_hrs', 4.5,
            'border_duration_hrs', 6.0,
            'offloading_duration_hrs', 3.0,
            'total_duration_days', 5.25
        ),
        json_build_object(
            'trip_id', 'TRIP-002',
            'truck_reg', 'T456 XYZ',
            'driver_name', 'Jane Smith',
            'destination', 'Lusaka',
            'status', 'in_transit',
            'start_time', '2023-10-02T09:30:00Z',
            'end_time', NULL,
            'loading_duration_hrs', 3.2,
            'border_duration_hrs', NULL,
            'offloading_duration_hrs', NULL,
            'total_duration_days', NULL
        )
    );
END;
$$ LANGUAGE plpgsql;
