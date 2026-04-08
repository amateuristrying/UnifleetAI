require('dotenv').config({ path: '.env.local' });
console.log("DB Keys found:", Object.keys(process.env).filter(k => k.toLowerCase().includes('database') || k.toLowerCase().includes('postgres') || k.toLowerCase().includes('supabase')));
