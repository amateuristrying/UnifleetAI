require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('geofence_visits').select('geofence_name').ilike('geofence_name', '%Chembe%').limit(5);
  console.log('Results:', data);
}
run();
