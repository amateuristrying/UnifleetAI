const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('tat_trips_data')
    .select('tracker_name, loading_terminal, dest_name, dest_entry, next_dar_entry, has_corridor_event')
    .or('dest_name.eq.Kampala GF,dest_name.eq.Jinja GF')
    .limit(10);
  console.log("Completed / With Dest Name:");
  console.dir(data, {depth: null});

  const { data: raw, error: err2 } = await supabase.from('geofence_visits')
    .select('tracker_name, geofence_name, in_time_dt, out_time_dt')
    .or('geofence_name.eq.Kampala GF,geofence_name.eq.Jinja GF')
    .order('in_time_dt', { ascending: false })
    .limit(5);
  console.log("\nRaw Visits to Uganda:");
  console.dir(raw, {depth: null});
}
run();
