/**
 * SAP Route Master Seed Script
 *
 * Seeds all 127 SAP route code entries into the sap_route_master table.
 * Deduplicates by canonical origin-destination pair (keeping the first SAP code).
 * Uses pre-computed geocode coordinates for all locations.
 *
 * Usage: npx tsx scripts/seed_route_master.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local (Next.js convention) before anything else
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing environment variables. Ensure .env.local has NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Pre-computed Location Coordinates ────────────────────────────
// Coordinates sourced from known city/site locations in East/Southern Africa
const LOCATIONS: Record<string, { lat: number; lng: number; country: string }> = {
    'Dar Es Salaam': { lat: -6.7924, lng: 39.2083, country: 'Tanzania' },
    'Beira': { lat: -19.8436, lng: 34.8389, country: 'Mozambique' },
    'Tanga': { lat: -5.0689, lng: 39.0989, country: 'Tanzania' },
    'Mombasa': { lat: -4.0435, lng: 39.6682, country: 'Kenya' },
    'Nairobi': { lat: -1.2921, lng: 36.8219, country: 'Kenya' },
    'Arusha': { lat: -3.3869, lng: 36.6830, country: 'Tanzania' },
    'Moshi': { lat: -3.3350, lng: 37.3404, country: 'Tanzania' },
    'Dodoma': { lat: -6.1630, lng: 35.7516, country: 'Tanzania' },
    'Morogoro': { lat: -6.8210, lng: 37.6593, country: 'Tanzania' },
    'Iringa': { lat: -7.7700, lng: 35.6910, country: 'Tanzania' },
    'Mbeya': { lat: -8.9000, lng: 33.4500, country: 'Tanzania' },
    'Songea': { lat: -10.6830, lng: 35.6500, country: 'Tanzania' },
    'Mtwara': { lat: -10.2744, lng: 40.1885, country: 'Tanzania' },
    'Lindi': { lat: -10.0000, lng: 39.7167, country: 'Tanzania' },
    'Tabora': { lat: -5.0167, lng: 32.8000, country: 'Tanzania' },
    'Kigoma': { lat: -4.8833, lng: 29.6333, country: 'Tanzania' },
    'Mwanza': { lat: -2.5167, lng: 32.9000, country: 'Tanzania' },
    'Shinyanga': { lat: -3.6667, lng: 33.4167, country: 'Tanzania' },
    'Singida': { lat: -4.8167, lng: 34.7500, country: 'Tanzania' },
    'Zanzibar': { lat: -6.1622, lng: 39.1921, country: 'Tanzania' },
    'Kibaha': { lat: -6.7667, lng: 38.9167, country: 'Tanzania' },
    'Mkuranga': { lat: -7.1167, lng: 39.1833, country: 'Tanzania' },
    'Kisarawe': { lat: -7.0667, lng: 39.0500, country: 'Tanzania' },
    'Lugoba': { lat: -6.5000, lng: 38.5000, country: 'Tanzania' },
    'Masasi': { lat: -10.7167, lng: 38.8000, country: 'Tanzania' },
    'Ruangwa': { lat: -10.0667, lng: 38.8667, country: 'Tanzania' },
    'Njombe': { lat: -9.3333, lng: 34.7667, country: 'Tanzania' },
    'Mafinga': { lat: -8.3500, lng: 35.0500, country: 'Tanzania' },
    'Makambako': { lat: -8.8333, lng: 34.8500, country: 'Tanzania' },
    'Ifakara': { lat: -8.1333, lng: 36.6833, country: 'Tanzania' },
    'Ludewa': { lat: -9.4333, lng: 34.5333, country: 'Tanzania' },
    'Chunya': { lat: -8.5333, lng: 33.4333, country: 'Tanzania' },
    'Songwe': { lat: -9.3167, lng: 33.0667, country: 'Tanzania' },
    'Tunduma': { lat: -9.3115, lng: 32.7680, country: 'Tanzania' },
    'Nakonde': { lat: -9.3242, lng: 32.7608, country: 'Tanzania' },
    'Isaka': { lat: -3.7833, lng: 33.1667, country: 'Tanzania' },
    'Geita': { lat: -2.8667, lng: 32.2333, country: 'Tanzania' },
    'Northmara': { lat: -1.5000, lng: 34.1667, country: 'Tanzania' },
    'Bulyanhulu': { lat: -3.2333, lng: 32.3333, country: 'Tanzania' },
    'Buzwagi': { lat: -3.5500, lng: 32.3167, country: 'Tanzania' },
    'Ngorongoro': { lat: -3.2310, lng: 35.4910, country: 'Tanzania' },
    'Saadani': { lat: -6.0333, lng: 38.7667, country: 'Tanzania' },
    'Jongomeri': { lat: -8.0000, lng: 34.5000, country: 'Tanzania' },
    'Katavi': { lat: -6.8333, lng: 31.0000, country: 'Tanzania' },
    'Rukwa': { lat: -8.0000, lng: 32.0000, country: 'Tanzania' },
    'Mpanda': { lat: -6.3500, lng: 31.0667, country: 'Tanzania' },
    'Kagera': { lat: -1.5000, lng: 31.0000, country: 'Tanzania' },
    'Manyara': { lat: -3.6833, lng: 35.8167, country: 'Tanzania' },
    'Mara': { lat: -1.7500, lng: 34.0000, country: 'Tanzania' },
    'Simyu': { lat: -3.0000, lng: 34.0000, country: 'Tanzania' },
    'Ruvuma': { lat: -10.6833, lng: 35.6500, country: 'Tanzania' },
    'Kwamkwaja': { lat: -5.3333, lng: 38.6500, country: 'Tanzania' },
    'Kwamsisi': { lat: -5.7500, lng: 38.3833, country: 'Tanzania' },
    'Kisemvule': { lat: -9.5000, lng: 33.0000, country: 'Tanzania' },
    'Chico': { lat: -6.8000, lng: 39.0000, country: 'Tanzania' },
    'Mpika': { lat: -11.8333, lng: 31.4500, country: 'Zambia' },
    // Zambia
    'Lusaka': { lat: -15.3875, lng: 28.3228, country: 'Zambia' },
    'Ndola': { lat: -12.9587, lng: 28.6366, country: 'Zambia' },
    'Kitwe': { lat: -12.8025, lng: 28.2133, country: 'Zambia' },
    'Solwezi': { lat: -12.1700, lng: 25.8600, country: 'Zambia' },
    'Kansanshi': { lat: -12.1000, lng: 26.4167, country: 'Zambia' },
    'Lumwana': { lat: -12.2833, lng: 25.8500, country: 'Zambia' },
    'Kalumbila': { lat: -12.3500, lng: 25.5000, country: 'Zambia' },
    'Kasumbalesa': { lat: -12.2570, lng: 27.7940, country: 'Zambia' },
    // DRC
    'Sakania': { lat: -12.7500, lng: 28.5667, country: 'DRC' },
    'Lubumbashi': { lat: -11.6647, lng: 27.4794, country: 'DRC' },
    'Kolwezi': { lat: -10.7167, lng: 25.4667, country: 'DRC' },
    'Frontier Mines': { lat: -10.4667, lng: 25.3000, country: 'DRC' },
    // Malawi
    'Lilongwe': { lat: -13.9626, lng: 33.7741, country: 'Malawi' },
    'Blantrye': { lat: -15.7861, lng: 35.0058, country: 'Malawi' },
    'Mzuzu': { lat: -11.4618, lng: 34.0200, country: 'Malawi' },
    'Karonga': { lat: -9.9333, lng: 33.9400, country: 'Malawi' },
    // Uganda
    'Kampala': { lat: 0.3476, lng: 32.5825, country: 'Uganda' },
    'Jinja': { lat: 0.4244, lng: 33.2041, country: 'Uganda' },
    // Rwanda
    'Kigali': { lat: -1.9403, lng: 29.8739, country: 'Rwanda' },
    // Burundi
    'Bujumbara': { lat: -3.3614, lng: 29.3599, country: 'Burundi' },
    'Burundi': { lat: -3.3614, lng: 29.3599, country: 'Burundi' },
    // Kenya (already Mombasa/Nairobi above)
    // Mozambique
    'Msasa': { lat: -19.8000, lng: 34.8500, country: 'Mozambique' },
};

// ─── Raw SAP Route Data (all 127 entries) ─────────────────────────
interface RawRoute {
    sap_code: string;
    point_a: string;
    point_b: string;
    point_c?: string;
}

const RAW_ROUTES: RawRoute[] = [
    // Beira routes
    { sap_code: 'Beira - Frontier', point_a: 'Beira', point_b: 'Frontier Mines' },
    { sap_code: 'Beira - Kolwezi', point_a: 'Beira', point_b: 'Kolwezi' },
    { sap_code: 'Beira - Lubumbashi', point_a: 'Beira', point_b: 'Lubumbashi' },
    { sap_code: 'Beira - Lumwana', point_a: 'Beira', point_b: 'Lumwana' },
    { sap_code: 'Beira - Lusaka', point_a: 'Beira', point_b: 'Lusaka' },
    { sap_code: 'Beira - Ndola', point_a: 'Beira', point_b: 'Ndola' },
    // DSM routes
    { sap_code: 'DAR ES SALAAM - ARUSHA', point_a: 'Dar Es Salaam', point_b: 'Arusha' },
    { sap_code: 'DAR ES SALAAM - BLANTYRE', point_a: 'Dar Es Salaam', point_b: 'Blantrye' },
    { sap_code: 'DSM-MTWARA-BLANTYRE', point_a: 'Dar Es Salaam', point_b: 'Blantrye' },
    { sap_code: 'DAR ES SALAAM - BURUNDI', point_a: 'Dar Es Salaam', point_b: 'Bujumbara' },
    { sap_code: 'DAR ES SALAAM - BULYANHULU', point_a: 'Dar Es Salaam', point_b: 'Bulyanhulu' },
    { sap_code: 'DAR ES SALAAM - BUZWAGI', point_a: 'Dar Es Salaam', point_b: 'Buzwagi' },
    { sap_code: 'DSM - CHICO', point_a: 'Dar Es Salaam', point_b: 'Chico' },
    { sap_code: 'DAR ES SALAAM - CHUNYA', point_a: 'Dar Es Salaam', point_b: 'Chunya' },
    { sap_code: 'DAR ES SALAAM - DODOMA', point_a: 'Dar Es Salaam', point_b: 'Dodoma' },
    { sap_code: 'DAR ES SALAAM - FRONTIER', point_a: 'Dar Es Salaam', point_b: 'Frontier Mines' },
    { sap_code: 'Dar-Es-Salam - Frontier', point_a: 'Dar Es Salaam', point_b: 'Frontier Mines' },
    { sap_code: 'DAR ES SALAAM - GEITA', point_a: 'Dar Es Salaam', point_b: 'Geita' },
    { sap_code: 'DAR ES SALAAM - IFAKARA', point_a: 'Dar Es Salaam', point_b: 'Ifakara' },
    { sap_code: 'DAR ES SALAAM - IRINGA', point_a: 'Dar Es Salaam', point_b: 'Iringa' },
    { sap_code: 'DAR ES SALAAM - ISAKA', point_a: 'Dar Es Salaam', point_b: 'Isaka' },
    { sap_code: 'DAR ES SALAAM - JINJA', point_a: 'Dar Es Salaam', point_b: 'Jinja' },
    { sap_code: 'DAR ES SALAAM - JONGOMERO', point_a: 'Dar Es Salaam', point_b: 'Jongomeri' },
    { sap_code: 'DAR ES SALAAM - KAGERA', point_a: 'Dar Es Salaam', point_b: 'Kagera' },
    { sap_code: 'DAR ES SALAAM - KALUMBILA', point_a: 'Dar Es Salaam', point_b: 'Kalumbila' },
    { sap_code: 'DAR ES SALAAM - KAMPALA', point_a: 'Dar Es Salaam', point_b: 'Kampala' },
    { sap_code: 'DAR ES SALAAM - KANSANSHI', point_a: 'Dar Es Salaam', point_b: 'Kansanshi' },
    { sap_code: 'DSM - KASUMBALESA', point_a: 'Dar Es Salaam', point_b: 'Kasumbalesa' },
    { sap_code: 'DAR ES SALAAM - KATAVI', point_a: 'Dar Es Salaam', point_b: 'Katavi' },
    { sap_code: 'DAR ES SALAAM - KIBAHA', point_a: 'Dar Es Salaam', point_b: 'Kibaha' },
    { sap_code: 'DAR ES SALAAM - RWANDA', point_a: 'Dar Es Salaam', point_b: 'Kigali' },
    { sap_code: 'DAR ES SALAAM - KIGOMA', point_a: 'Dar Es Salaam', point_b: 'Kigoma' },
    { sap_code: 'DAR ES SALAAM - KISARAWE', point_a: 'Dar Es Salaam', point_b: 'Kisarawe' },
    { sap_code: 'DAR ES SALAAM - KISEMVULE', point_a: 'Dar Es Salaam', point_b: 'Kisemvule' },
    { sap_code: 'DAR ES SALAAM - KITWE', point_a: 'Dar Es Salaam', point_b: 'Kitwe' },
    { sap_code: 'DAR ES SALAAM - KOLWEZI', point_a: 'Dar Es Salaam', point_b: 'Kolwezi' },
    { sap_code: 'Dar-Es-Salam - Kolwezi', point_a: 'Dar Es Salaam', point_b: 'Kolwezi' },
    { sap_code: 'DAR ES SALAAM - KWAMKWAJA', point_a: 'Dar Es Salaam', point_b: 'Kwamkwaja' },
    { sap_code: 'DAR ES SALAAM - KWAMSISI', point_a: 'Dar Es Salaam', point_b: 'Kwamsisi' },
    { sap_code: 'DAR ES SALAAM - LILONGWE', point_a: 'Dar Es Salaam', point_b: 'Lilongwe' },
    { sap_code: 'DAR ES SALAAM - LINDI', point_a: 'Dar Es Salaam', point_b: 'Lindi' },
    { sap_code: 'DAR ES SALAAM - LUBUMBASHI', point_a: 'Dar Es Salaam', point_b: 'Lubumbashi' },
    { sap_code: 'Dar-Es-Salam - Lubumbashi', point_a: 'Dar Es Salaam', point_b: 'Lubumbashi' },
    { sap_code: 'DAR ES SALAAM - LUDEWA', point_a: 'Dar Es Salaam', point_b: 'Ludewa' },
    { sap_code: 'DAR ES SALAAM - LUGOBA', point_a: 'Dar Es Salaam', point_b: 'Lugoba' },
    { sap_code: 'DAR ES SALAAM - LUMWANA', point_a: 'Dar Es Salaam', point_b: 'Lumwana' },
    { sap_code: 'Dar-Es-Salam - Lumwana', point_a: 'Dar Es Salaam', point_b: 'Lumwana' },
    { sap_code: 'DAR ES SALAAM - LUSAKA', point_a: 'Dar Es Salaam', point_b: 'Lusaka' },
    { sap_code: 'Dar-Es-Salam - Lusaka', point_a: 'Dar Es Salaam', point_b: 'Lusaka' },
    { sap_code: 'DAR ES SALAAM - MAFINGA', point_a: 'Dar Es Salaam', point_b: 'Mafinga' },
    { sap_code: 'DAR ES SALAAM - MANYARA', point_a: 'Dar Es Salaam', point_b: 'Manyara' },
    { sap_code: 'DAR ES SALAAM - MARA', point_a: 'Dar Es Salaam', point_b: 'Mara' },
    { sap_code: 'DAR ES SALAAM - MASASI', point_a: 'Dar Es Salaam', point_b: 'Masasi' },
    { sap_code: 'DAR ES SALAAM - MBEYA', point_a: 'Dar Es Salaam', point_b: 'Mbeya' },
    { sap_code: 'DAR ES SALAAM - MKURANGA', point_a: 'Dar Es Salaam', point_b: 'Mkuranga' },
    { sap_code: 'DAR ES SALAAM - MOMBASA', point_a: 'Dar Es Salaam', point_b: 'Mombasa' },
    { sap_code: 'DAR ES SALAAM - MOROGORO', point_a: 'Dar Es Salaam', point_b: 'Morogoro' },
    { sap_code: 'DAR ES SALAAM - MOSHI', point_a: 'Dar Es Salaam', point_b: 'Moshi' },
    { sap_code: 'DAR ES SALAAM - MPIKA', point_a: 'Dar Es Salaam', point_b: 'Mpika' },
    { sap_code: 'DAR ES SALAAM - MTWARA - LILONGWE', point_a: 'Dar Es Salaam', point_b: 'Mtwara', point_c: 'Lilongwe' },
    { sap_code: 'DAR ES SALAAM - MTWARA - MZUZU', point_a: 'Dar Es Salaam', point_b: 'Mtwara', point_c: 'Mzuzu' },
    { sap_code: 'DSM - MTWARA - MZUZU', point_a: 'Dar Es Salaam', point_b: 'Mtwara', point_c: 'Mzuzu' },
    { sap_code: 'DAR ES SALAAM - MTWARA', point_a: 'Dar Es Salaam', point_b: 'Mtwara' },
    { sap_code: 'DAR ES SALAAM - MWANZA', point_a: 'Dar Es Salaam', point_b: 'Mwanza' },
    { sap_code: 'DAR ES SALAAM - MZUZU', point_a: 'Dar Es Salaam', point_b: 'Mzuzu' },
    { sap_code: 'DAR ES SALAAM - NAIROBI', point_a: 'Dar Es Salaam', point_b: 'Nairobi' },
    { sap_code: 'DAR ES SALAAM - NAKONDE', point_a: 'Dar Es Salaam', point_b: 'Nakonde' },
    { sap_code: 'DAR ES SALAAM - NDOLA', point_a: 'Dar Es Salaam', point_b: 'Ndola' },
    { sap_code: 'Dar-Es-Salam - Ndola', point_a: 'Dar Es Salaam', point_b: 'Ndola' },
    { sap_code: 'DAR ES SALAAM - NGORONGORO', point_a: 'Dar Es Salaam', point_b: 'Ngorongoro' },
    { sap_code: 'DAR ES SALAAM - NJOMBE', point_a: 'Dar Es Salaam', point_b: 'Njombe' },
    { sap_code: 'DAR ES SALAAM - NORTHMARA', point_a: 'Dar Es Salaam', point_b: 'Northmara' },
    { sap_code: 'DAR ES SALAAM - RUANGWA', point_a: 'Dar Es Salaam', point_b: 'Ruangwa' },
    { sap_code: 'DAR ES SALAAM - RUKWA', point_a: 'Dar Es Salaam', point_b: 'Rukwa' },
    { sap_code: 'DAR ES SALAAM - RUVUMA', point_a: 'Dar Es Salaam', point_b: 'Ruvuma' },
    { sap_code: 'DAR ES SALAAM - SAADANI', point_a: 'Dar Es Salaam', point_b: 'Saadani' },
    { sap_code: 'DAR ES SALAAM - SHINYANGA', point_a: 'Dar Es Salaam', point_b: 'Shinyanga' },
    { sap_code: 'DAR ES SALAAM - SIMIYU', point_a: 'Dar Es Salaam', point_b: 'Simyu' },
    { sap_code: 'DAR ES SALAAM - SINGIDA', point_a: 'Dar Es Salaam', point_b: 'Singida' },
    { sap_code: 'DAR ES SALAAM - SOLWEZI', point_a: 'Dar Es Salaam', point_b: 'Solwezi' },
    { sap_code: 'DAR ES SALAAM - SONGEA', point_a: 'Dar Es Salaam', point_b: 'Songea' },
    { sap_code: 'DAR ES SALAAM - SONGWE', point_a: 'Dar Es Salaam', point_b: 'Songwe' },
    { sap_code: 'DAR ES SALAAM - TABORA', point_a: 'Dar Es Salaam', point_b: 'Tabora' },
    { sap_code: 'DAR ES SALAAM - TANGA', point_a: 'Dar Es Salaam', point_b: 'Tanga' },
    { sap_code: 'DAR ES SALAAM - TUNDUMA', point_a: 'Dar Es Salaam', point_b: 'Tunduma' },
    { sap_code: 'DAR ES SALAAM - ZANZIBAR', point_a: 'Dar Es Salaam', point_b: 'Zanzibar' },
    { sap_code: 'Dar es salaam', point_a: 'Dar Es Salaam', point_b: 'Dar Es Salaam' },
    // Dodoma/Iringa
    { sap_code: 'DODOMA - IRINGA', point_a: 'Dodoma', point_b: 'Iringa' },
    { sap_code: 'IRINGA - DAR ES SALAAM', point_a: 'Iringa', point_b: 'Dar Es Salaam' },
    { sap_code: 'IRINGA - DODOMA', point_a: 'Iringa', point_b: 'Dodoma' },
    { sap_code: 'IRINGA - IRINGA', point_a: 'Iringa', point_b: 'Iringa' },
    { sap_code: 'IRINGA - MAKAMBAKO', point_a: 'Iringa', point_b: 'Makambako' },
    { sap_code: 'IRINGA - MANYARA', point_a: 'Iringa', point_b: 'Manyara' },
    { sap_code: 'IRINGA - NJOMBE', point_a: 'Iringa', point_b: 'Njombe' },
    { sap_code: 'IRINGA - SONGEA', point_a: 'Iringa', point_b: 'Songea' },
    // Isaka
    { sap_code: 'ISAKA - KIGOMA', point_a: 'Isaka', point_b: 'Kigoma' },
    // Karonga
    { sap_code: 'Dar Es Salaam - Karonga', point_a: 'Karonga', point_b: 'Karonga' },
    // Mbeya
    { sap_code: 'MBEYA - KATAVI', point_a: 'Mbeya', point_b: 'Katavi' },
    { sap_code: 'MBEYA - MPANDA', point_a: 'Mbeya', point_b: 'Mpanda' },
    // Mombasa
    { sap_code: 'MOMBASA - LUBUMBASHI', point_a: 'Mombasa', point_b: 'Lubumbashi' },
    // Msasa
    { sap_code: 'Masasa -Frontier', point_a: 'Msasa', point_b: 'Frontier Mines' },
    { sap_code: 'Masasa - Kolwezi', point_a: 'Msasa', point_b: 'Kolwezi' },
    { sap_code: 'Masasa - Lubumbashi', point_a: 'Msasa', point_b: 'Lubumbashi' },
    { sap_code: 'Masasa - Lumwana', point_a: 'Msasa', point_b: 'Lumwana' },
    { sap_code: 'Masasa - Lusaka', point_a: 'Msasa', point_b: 'Lusaka' },
    { sap_code: 'Masasa -Ndola', point_a: 'Msasa', point_b: 'Ndola' },
    // Mtwara
    { sap_code: 'MTWARA - LUSAKA', point_a: 'Mtwara', point_b: 'Lusaka' },
    { sap_code: 'MTWARA - LILONGWE', point_a: 'Mtwara', point_b: 'Lilongwe' },
    { sap_code: 'MTWARA - BLANTYRE', point_a: 'Mtwara', point_b: 'Blantrye' },
    { sap_code: 'MTWARA - MZUZU', point_a: 'Mtwara', point_b: 'Mzuzu' },
    // Ndola
    { sap_code: 'Ndola - Frontier', point_a: 'Ndola', point_b: 'Frontier Mines' },
    { sap_code: 'Ndola - Kolwezi', point_a: 'Ndola', point_b: 'Kolwezi' },
    { sap_code: 'Ndola - Lubumbashi', point_a: 'Ndola', point_b: 'Lubumbashi' },
    { sap_code: 'Ndola - Sakania - Lubumbashi', point_a: 'Ndola', point_b: 'Sakania', point_c: 'Lubumbashi' },
    { sap_code: 'Ndola - Lumwana', point_a: 'Ndola', point_b: 'Lumwana' },
    { sap_code: 'Ndola - Lusaka', point_a: 'Ndola', point_b: 'Lusaka' },
    // Shinyanga
    { sap_code: 'SHINYANGA - IRINGA', point_a: 'Shinyanga', point_b: 'Iringa' },
    // Tanga
    { sap_code: 'TANGA - BLANTYRE', point_a: 'Tanga', point_b: 'Blantrye' },
    { sap_code: 'TANGA - BURUNDI', point_a: 'Tanga', point_b: 'Burundi' },
    { sap_code: 'TANGA - FRONTIER', point_a: 'Tanga', point_b: 'Frontier Mines' },
    { sap_code: 'TANGA - JINJA', point_a: 'Tanga', point_b: 'Jinja' },
    { sap_code: 'TANGA - KAMPALA', point_a: 'Tanga', point_b: 'Kampala' },
    { sap_code: 'TANGA - KOLWEZI', point_a: 'Tanga', point_b: 'Kolwezi' },
    { sap_code: 'TANGA - LILONGWE', point_a: 'Tanga', point_b: 'Lilongwe' },
    { sap_code: 'TANGA - LUBUMBASHI', point_a: 'Tanga', point_b: 'Lubumbashi' },
    { sap_code: 'Tanga - Lumwana', point_a: 'Tanga', point_b: 'Lumwana' },
    { sap_code: 'TANGA - LUSAKA', point_a: 'Tanga', point_b: 'Lusaka' },
    { sap_code: 'TANGA-MZUZU', point_a: 'Tanga', point_b: 'Mzuzu' },
    { sap_code: 'Tanga - Ndola', point_a: 'Tanga', point_b: 'Ndola' },
];

// ─── Route Type Classification ────────────────────────────────────
function classifyRoute(a: string, b: string, c?: string): string {
    const crossBorder = LOCATIONS[a]?.country !== LOCATIONS[b]?.country;
    if (c) return 'multi_leg';
    if (crossBorder) return 'long_haul';
    // Same country, check distance
    const locA = LOCATIONS[a];
    const locB = LOCATIONS[b];
    if (locA && locB) {
        const dist = haversine(locA.lat, locA.lng, locB.lat, locB.lng);
        if (dist < 100) return 'local';
        if (dist < 500) return 'regional';
    }
    return 'long_haul';
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Main Seed Function ───────────────────────────────────────────
async function seed() {
    console.log('🚀 Starting SAP Route Master seed...');
    console.log(`   Total raw entries: ${RAW_ROUTES.length}`);

    // Step 1: Deduplicate by canonical key (pointA|pointB|pointC)
    const seen = new Map<string, RawRoute>();
    const sapCodeMap = new Map<string, string[]>(); // canonical → all sap codes

    for (const route of RAW_ROUTES) {
        const key = `${route.point_a}|${route.point_b}|${route.point_c || ''}`;
        if (!seen.has(key)) {
            seen.set(key, route);
            sapCodeMap.set(key, [route.sap_code]);
        } else {
            sapCodeMap.get(key)!.push(route.sap_code);
        }
    }

    const uniqueRoutes = Array.from(seen.values());
    console.log(`   Unique routes after dedup: ${uniqueRoutes.length}`);

    // Step 2: Filter out self-referencing routes (e.g., "Dar es salaam" → "Dar es salaam")
    const validRoutes = uniqueRoutes.filter(r => r.point_a !== r.point_b);
    console.log(`   Valid routes (non-self-referencing): ${validRoutes.length}`);

    // Step 3: Build insert rows
    const rows = validRoutes.map(route => {
        const locA = LOCATIONS[route.point_a];
        const locB = LOCATIONS[route.point_b];
        const locC = route.point_c ? LOCATIONS[route.point_c] : null;

        if (!locA) console.warn(`   ⚠️  Missing coordinates for: ${route.point_a}`);
        if (!locB) console.warn(`   ⚠️  Missing coordinates for: ${route.point_b}`);
        if (route.point_c && !locC) console.warn(`   ⚠️  Missing coordinates for: ${route.point_c}`);

        const distance = locA && locB ? Math.round(haversine(locA.lat, locA.lng, locB.lat, locB.lng)) : null;
        // Rough estimate: 50km/h average speed for East African corridors
        const durationHrs = distance ? Math.round(distance / 50 * 10) / 10 : null;

        const routeName = route.point_c
            ? `${route.point_a} → ${route.point_b} → ${route.point_c}`
            : `${route.point_a} → ${route.point_b}`;

        return {
            sap_code: route.sap_code,
            route_name: routeName,
            point_a: route.point_a,
            point_b: route.point_b,
            point_c: route.point_c || null,
            point_a_lat: locA?.lat || null,
            point_a_lng: locA?.lng || null,
            point_b_lat: locB?.lat || null,
            point_b_lng: locB?.lng || null,
            point_c_lat: locC?.lat || null,
            point_c_lng: locC?.lng || null,
            country_a: locA?.country || null,
            country_b: locB?.country || null,
            country_c: locC?.country || null,
            estimated_distance_km: distance,
            estimated_duration_hrs: durationHrs,
            is_active: true,
            corridor_type: classifyRoute(route.point_a, route.point_b, route.point_c),
        };
    });

    // Step 4: Clear existing data and insert
    console.log('\n   Clearing existing route master data...');
    await supabase.from('route_benchmarks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('route_waypoints').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('sap_route_master').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log(`   Inserting ${rows.length} routes...`);

    // Insert in batches of 20
    for (let i = 0; i < rows.length; i += 20) {
        const batch = rows.slice(i, i + 20);
        const { error } = await supabase.from('sap_route_master').insert(batch);
        if (error) {
            console.error(`   ❌ Batch ${i / 20 + 1} failed:`, error.message);
        } else {
            console.log(`   ✅ Batch ${i / 20 + 1}: ${batch.length} routes inserted`);
        }
    }

    // Step 5: Create waypoints for multi-leg routes
    console.log('\n   Creating waypoints for multi-leg routes...');
    const { data: insertedRoutes } = await supabase
        .from('sap_route_master')
        .select('id, point_a, point_b, point_c, point_a_lat, point_a_lng, point_b_lat, point_b_lng, point_c_lat, point_c_lng')
        .not('point_c', 'is', null);

    if (insertedRoutes) {
        const waypoints = [];
        for (const r of insertedRoutes) {
            waypoints.push(
                { route_id: r.id, sequence_order: 1, waypoint_name: r.point_a, lat: r.point_a_lat, lng: r.point_a_lng, waypoint_type: 'origin' },
                { route_id: r.id, sequence_order: 2, waypoint_name: r.point_b, lat: r.point_b_lat, lng: r.point_b_lng, waypoint_type: 'transit' },
                { route_id: r.id, sequence_order: 3, waypoint_name: r.point_c, lat: r.point_c_lat, lng: r.point_c_lng, waypoint_type: 'destination' },
            );
        }
        if (waypoints.length > 0) {
            const { error } = await supabase.from('route_waypoints').insert(waypoints);
            if (error) {
                console.error('   ❌ Waypoint insert failed:', error.message);
            } else {
                console.log(`   ✅ ${waypoints.length} waypoints created for ${insertedRoutes.length} multi-leg routes`);
            }
        }
    }

    // Step 6: Summary
    const { count } = await supabase.from('sap_route_master').select('*', { count: 'exact', head: true });
    console.log(`\n🏁 Seed complete! Total routes in database: ${count}`);

    // Stats
    const { data: stats } = await supabase
        .from('sap_route_master')
        .select('corridor_type');
    if (stats) {
        const types: Record<string, number> = {};
        stats.forEach(s => { types[s.corridor_type] = (types[s.corridor_type] || 0) + 1; });
        console.log('   Route types:', types);
    }

    const { data: countries } = await supabase
        .from('sap_route_master')
        .select('country_a, country_b');
    if (countries) {
        const uniqueCountries = new Set<string>();
        countries.forEach(c => {
            if (c.country_a) uniqueCountries.add(c.country_a);
            if (c.country_b) uniqueCountries.add(c.country_b);
        });
        console.log(`   Countries covered: ${Array.from(uniqueCountries).join(', ')}`);
    }
}

seed().catch(err => {
    console.error('Fatal seed error:', err);
    process.exit(1);
});
