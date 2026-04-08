const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('geofence_visits')
    .select('geofence_name')
    .or('geofence_name.ilike.%Kampala%,geofence_name.ilike.%Jinja%,geofence_name.ilike.%Mombasa%,geofence_name.ilike.%Nairobi%,geofence_name.ilike.%Mutukula%,geofence_name.ilike.%Malaba%')
    .limit(20);
  console.dir([...new Set(data.map(d => d.geofence_name))], {depth: null});
}
run();
