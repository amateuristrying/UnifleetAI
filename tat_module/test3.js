const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
async function run() {
  const { data, error } = await supabase.from('tat_trips_data')
    .select('tracker_name, loading_entry, loading_exit, next_loading_entry, dest_entry, next_dar_entry, dest_exit, dar_arrival, dar_exit, loading_terminal')
    .ilike('tracker_name', 'T 915 DRH%')
    .order('loading_entry', { ascending: false });
  console.dir(data, {depth: null});
}
run();
