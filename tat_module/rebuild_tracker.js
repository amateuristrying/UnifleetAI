require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function run() {
  console.log('Rebuilding state events...');
  const { error: e1 } = await supabase.rpc('build_trip_state_events_v2', {
    p_start: '2025-10-01T00:00:00Z',
    p_end: '2026-04-05T00:00:00Z',
    p_tracker_id: 3380709
  });
  if (e1) console.error('E1:', e1);

  console.log('Rebuilding trip facts...');
  const { error: e2 } = await supabase.rpc('build_tat_trip_facts_v2', {
    p_start: '2025-10-01T00:00:00Z',
    p_end: '2026-04-05T00:00:00Z',
    p_tracker_id: 3380709
  });
  if (e2) console.error('E2:', e2);

  console.log('Rebuilding border facts...');
  const { error: e3 } = await supabase.rpc('build_tat_border_facts_v2', {
    p_start: '2025-10-01T00:00:00Z',
    p_end: '2026-04-05T00:00:00Z',
    p_tracker_id: 3380709
  });
  if (e3) console.error('E3:', e3);

  console.log('Done rebuilding. Now let\'s check facts!');
}

run();
