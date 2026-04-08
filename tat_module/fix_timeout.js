const fs = require('fs');
let sql = fs.readFileSync('supabase/migrations/tat_optimization.sql', 'utf8');

const targetTrackersSql = `
    CREATE TEMP TABLE tmp_target_trackers ON COMMIT DROP AS
    SELECT DISTINCT tracker_id
    FROM public.geofence_visits
    WHERE in_time_dt >= p_start_date - INTERVAL '3 days' 
      AND in_time_dt <= p_end_date + INTERVAL '3 days'
      AND (p_tracker_id IS NULL OR tracker_id = p_tracker_id)
      AND geofence_name IN (
            'TIPER DEPOT', 'Puma Depo Kurasini',
            'Oryx Loading Depo (Kigamboni)', 'Oryx Dar Depo', 'Oilcom Dar Depo',
            'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT',
            'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT',
            'WORLD OIL DEPOT', 'Tanga GF', 'Mtwara GF', 'Beira',
            'KURASINI ALL TOGETHER', 'Asas Kibaha Dsm -Yard', 'ASAS DSM Office / Dar W/Shop', 'Asas Tabata'
      );
      
    CREATE TEMP TABLE tmp_classified ON COMMIT DROP AS`;

sql = sql.replace(
    'CREATE TEMP TABLE tmp_classified ON COMMIT DROP AS',
    targetTrackersSql
);

sql = sql.replace(
    /FROM public\.geofence_visits\s+WHERE in_time_dt >= p_start_date - INTERVAL '21 days'\s+AND in_time_dt <= p_end_date \+ INTERVAL '15 days'\s+AND \(p_tracker_id IS NULL OR tracker_id = p_tracker_id\);/g,
    `FROM public.geofence_visits
    WHERE tracker_id IN (SELECT tracker_id FROM tmp_target_trackers)
      AND in_time_dt >= p_start_date - INTERVAL '21 days'
      AND in_time_dt <= p_end_date + INTERVAL '15 days';`
);

fs.writeFileSync('supabase/migrations/tat_optimization.sql', sql);
