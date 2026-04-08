const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('geofence_visits').select('in_time_dt').order('in_time_dt', { ascending: false }).limit(1);
  console.log("Last imported geofence visit:", data);
}
run();
