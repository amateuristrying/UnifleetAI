import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env.local' });
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

async function fetchRoute(label: string, fromStr: string, toStr: string) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${fromStr};${toStr}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) { console.log(label, "Failed"); return; }
    const data = await res.json();
    const km = Math.round(data.routes[0].distance / 1000);
    console.log(label, km, "km");
}

async function main() {
    // Current Kasumulu
    const kasumulu_bad = "33.7431,-9.5786";
    
    // Stricter highway Kasumulu (Right before the physical border on the T1)
    // Approximate: -9.569424, 33.765664
    const kasumulu_fixed = "33.765664,-9.569424";
    
    const karonga = "33.9400,-9.9333";
    const uyole_fixed = "33.535086,-8.922114";

    await fetchRoute('Fixed Uyole -> Bad Kasumulu', uyole_fixed, kasumulu_bad);
    await fetchRoute('Bad Kasumulu -> Karonga', kasumulu_bad, karonga);
    
    await fetchRoute('Fixed Uyole -> Fixed Kasumulu', uyole_fixed, kasumulu_fixed);
    await fetchRoute('Fixed Kasumulu -> Karonga', kasumulu_fixed, karonga);
}
main();
