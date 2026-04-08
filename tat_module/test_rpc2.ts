import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data, error } = await supabase.rpc('get_fleet_scatter_data', { 
      start_date_input: null, 
      end_date_input: null, 
      brand_filter: ['Unknown'], 
      vehicle_filter: null 
  });
  console.log("With array:", error ? error.message : "Success");
}
main();
