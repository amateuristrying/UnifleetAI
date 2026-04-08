import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.rpc('exec_sql', {
     query: "SELECT pg_get_functiondef('get_tat_trip_details(timestamp with time zone, timestamp with time zone, integer, integer, text, text, text, integer)'::regprocedure)"
  });
  if (error) {
     console.log("Error:", error);
  } else {
     console.log("Live SQL:", JSON.stringify(data, null, 2));
  }
}

run();
