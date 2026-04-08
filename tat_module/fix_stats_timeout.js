const fs = require('fs');
let sql = fs.readFileSync('supabase/migrations/tat_optimization.sql', 'utf8');

const regex1 = /WITH loading_visits AS \(\s*SELECT tracker_id, in_time_dt, out_time_dt,\s*CASE WHEN LAG\(out_time_dt\) OVER \(PARTITION BY tracker_id ORDER BY in_time_dt\)\s*>= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session\s*FROM geofence_visits\s*WHERE geofence_name IN \([\s\S]*?'Tanga GF', 'Mtwara GF', 'Beira', 'KURASINI ALL TOGETHER'\s*\)\s*AND in_time_dt >= p_start_date - INTERVAL '21 days' AND in_time_dt <= p_end_date \+ INTERVAL '15 days'/g;

const replacement = `WITH target_trackers AS (
        SELECT DISTINCT tracker_id
        FROM geofence_visits
        WHERE in_time_dt >= p_start_date - INTERVAL '3 days'
          AND in_time_dt <= p_end_date + INTERVAL '3 days'
          AND geofence_name IN (
            'TIPER DEPOT', 'Puma Depo Kurasini',
            'Oryx Loading Depo (Kigamboni)', 'Oryx Dar Depo', 'Oilcom Dar Depo',
            'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT',
            'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT',
            'WORLD OIL DEPOT', 'Tanga GF', 'Mtwara GF', 'Beira', 'KURASINI ALL TOGETHER'
          )
    ),
    loading_visits AS (
        SELECT tracker_id, in_time_dt, out_time_dt,
            CASE WHEN LAG(out_time_dt) OVER (PARTITION BY tracker_id ORDER BY in_time_dt)
                 >= in_time_dt - INTERVAL '24 hours' THEN 0 ELSE 1 END as is_new_session
        FROM geofence_visits
        WHERE tracker_id IN (SELECT tracker_id FROM target_trackers)
          AND geofence_name IN (
            'TIPER DEPOT', 'Puma Depo Kurasini',
            'Oryx Loading Depo (Kigamboni)', 'Oryx Dar Depo', 'Oilcom Dar Depo',
            'OILCOM LIMITED TERMINAL DEPOT', 'MERU TERMINAL DEPOT',
            'MOGAS OIL DEPOT', 'SUPERSTAR FUEL DEPOT', 'GBP DRS DEPOT', 'ORYX FUEL DEPOT',
            'WORLD OIL DEPOT', 'Tanga GF', 'Mtwara GF', 'Beira', 'KURASINI ALL TOGETHER'
          )
          AND in_time_dt >= p_start_date - INTERVAL '21 days' AND in_time_dt <= p_end_date + INTERVAL '15 days'`;

sql = sql.replace(regex1, replacement);

fs.writeFileSync('supabase/migrations/tat_optimization.sql', sql);
