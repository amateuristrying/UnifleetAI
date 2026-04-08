require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const BATCH_SIZE = 5000;
const ACTIVE_DELAY_MS = 500;   // Wait when ingesting heavy backlog
const IDLE_DELAY_MS = 5000;    // Wait when caught up to real-time

async function runOrchestrator() {
  console.log('🚀 Starting Autonomous Lambda Orchestrator...');
  
  // Track the timestamp of the last time we searched for UI rebuilds
  let lastRebuildCheck = new Date().toISOString();
  let iterations = 0;

  while (true) {
    iterations++;
    try {
      // 1. Process Raw Telemetry into Live Geofence Stream
      const { data, error } = await supabase.rpc('process_live_telemetry_batch', {
        p_batch_size: BATCH_SIZE
      });

      if (error) {
        console.error(`❌ DB Error on Iteration ${iterations}:`, error);
        await new Promise(res => setTimeout(res, IDLE_DELAY_MS));
        continue;
      }

      let processedRows = 0;
      const match = data ? data.match(/Processed (\d+) rows/) : null;
      if (match) processedRows = parseInt(match[1], 10);
      
      if (processedRows > 0) {
        process.stdout.write(`\r[Iter ${iterations}] ${data}`);
      }

      // 2. Discover precisely who physically changed state in this batch
      const { data: activeTrackers, error: fetchErr } = await supabase
        .from('live_tracker_geofence_state')
        .select('tracker_id, updated_at, current_geofence_name')
        .gt('updated_at', lastRebuildCheck)
        .order('updated_at', { ascending: true });

      if (!fetchErr && activeTrackers && activeTrackers.length > 0) {
        // Optimization: Deduplicate tracker IDs to avoid redundant rebuilds in same batch
        const uniqueTrackers = Array.from(new Set(activeTrackers.map(t => t.tracker_id)));
        
        // Strategy: If we are catching up a heavy backlog (watermark lag > 30 min),
        // we skip the expensive full rebuilds until we are closer to real-time.
        const isBacklog = uniqueTrackers.length > 100;
        
        if (isBacklog) {
          console.log(`\n\n⏩ Backlog Jump: ${uniqueTrackers.length} trackers shifted. Skipping expensive UI sync until caught up...`);
          lastRebuildCheck = activeTrackers[activeTrackers.length - 1].updated_at;
        } else {
          console.log(`\n\n⚡ Boundary detection! ${uniqueTrackers.length} unique tracker(s) fundamentally shifted state.`);
          
          // Use a narrower 3-day window for live updates to keep RPCs fast
          const syncStart = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
          const syncEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

          for (const tid of uniqueTrackers) {
            console.log(`   ➔ Auto-Syncing Dashboard for Tracker ${tid}...`);
            
            // Natively rebuild the State Machine 
            await supabase.rpc('build_trip_state_events_v2', { 
              p_start: syncStart, 
              p_end: syncEnd, 
              p_tracker_id: tid 
            });

            // Roll up to the UI Queue Array
            await supabase.rpc('build_tat_trip_facts_v2', { 
              p_start: syncStart, 
              p_end: syncEnd, 
              p_tracker_id: tid 
            });
          }
          lastRebuildCheck = activeTrackers[activeTrackers.length - 1].updated_at;
          console.log(`✅ UI sync for ${uniqueTrackers.length} trackers resolved.`);
        }
      }

      // 3. Throttle sleep logic
      if (processedRows === 0) {
        // We are completely up to real time, sleep longer
        process.stdout.write(`\r[Iter ${iterations}] 🛡️  Scanning Live Radar...`);
        await new Promise(resolve => setTimeout(resolve, IDLE_DELAY_MS));
      } else {
        // Still chomping through heavy backlog
        await new Promise(resolve => setTimeout(resolve, ACTIVE_DELAY_MS));
      }

    } catch (err) {
      console.error(`\n💥 Fatal execution error in Orchestrator loop:`, err);
      await new Promise(resolve => setTimeout(resolve, IDLE_DELAY_MS));
    }
  }
}

runOrchestrator();
