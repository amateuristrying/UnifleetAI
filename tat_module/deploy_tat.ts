import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sql = fs.readFileSync('supabase/migrations/tat_optimization.sql', 'utf8');
  console.log("Deploying SQL, size:", sql.length);
  const { data, error } = await supabase.rpc('exec_sql', { query: sql });
  if (error) {
     console.error("Deploy Error:", error);
  } else {
     console.log("Deploy Success!");
  }
}

run();
