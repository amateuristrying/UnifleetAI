const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Extract project ref from URL (e.g., https://motfpmjtunyelvwsmyyp.supabase.co -> motfpmjtunyelvwsmyyp)
  const projectRef = supabaseUrl.split('//')[1].split('.')[0];
  const dbPassword = process.env.DB_PASSWORD || process.env.SUPABASE_DB_PASSWORD; // Often stored separately or can be prompted
  
  console.log("Found project ref:", projectRef);
  if (!dbPassword) {
      console.log("No explicit DB_PASSWORD found in .env.local, checking if SUPABASE_DB_URL exists...");
      console.log("SUPABASE_DB_URL exists:", !!process.env.SUPABASE_DB_URL);
  } else {
      console.log("DB_PASSWORD exists.");
  }
}
run();
