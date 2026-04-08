import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data, error } = await supabase.rpc('get_fleet_scatter_data', { 
      start_date_input: null, 
      end_date_input: null, 
      brand_filter: null, 
      vehicle_filter: null 
  });
  console.log("Empty args:", error ? error.message : "Success");
  
  const { data: d2, error: e2 } = await supabase.rpc('get_fleet_scatter_data', {});
  console.log("Missing args:", e2 ? e2.message : "Success");
}
main();
