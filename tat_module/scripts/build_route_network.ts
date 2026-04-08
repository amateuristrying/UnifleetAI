/**
 * Build Unified Highway Network Graph
 *
 * Instead of 114 individual route geometries, this script:
 * 1. Defines the East/Southern African highway graph (cities as nodes, highways as edges)
 * 2. For each route, finds the path through the graph (BFS)
 * 3. Fetches Mapbox Directions for each UNIQUE edge segment ONCE
 * 4. Maps routes to their sequence of shared edges
 *
 * Result: Routes sharing the same highway segment use IDENTICAL geometry.
 *
 * Usage: npx tsx scripts/build_route_network.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

if (!SUPABASE_URL || !SUPABASE_KEY || !MAPBOX_TOKEN) {
    console.error('❌ Missing env vars. Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_MAPBOX_TOKEN');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── City Coordinates (canonical positions) ──────────────────────
const CITIES: Record<string, { lat: number; lng: number }> = {
    // Tanzania
    'Dar Es Salaam': { lat: -6.7924, lng: 39.2083 },
    'Morogoro': { lat: -6.8210, lng: 37.6593 },
    'Dodoma': { lat: -6.1630, lng: 35.7516 },
    'Iringa': { lat: -7.7700, lng: 35.6910 },
    'Singida': { lat: -4.8167, lng: 34.7500 },
    'Tabora': { lat: -5.0167, lng: 32.8000 },
    'Mbeya': { lat: -8.9000, lng: 33.4500 },
    'Tunduma': { lat: -9.3115, lng: 32.7680 },
    'Songwe': { lat: -9.3167, lng: 33.0667 },
    'Kasumulu': { lat: -9.569424, lng: 33.765664 },
    'Tanga': { lat: -5.0689, lng: 39.0989 },
    'Moshi': { lat: -3.3350, lng: 37.3404 },
    'Arusha': { lat: -3.3869, lng: 36.6830 },
    'Mwanza': { lat: -2.5167, lng: 32.9000 },
    'Shinyanga': { lat: -3.6667, lng: 33.4167 },
    'Kigoma': { lat: -4.8833, lng: 29.6333 },
    'Isaka': { lat: -3.7833, lng: 33.1667 },
    'Mombasa': { lat: -4.0435, lng: 39.6682 },
    'Nairobi': { lat: -1.2921, lng: 36.8219 },
    'Mtwara': { lat: -10.2744, lng: 40.1885 },
    'Lindi': { lat: -10.0000, lng: 39.7167 },
    'Songea': { lat: -10.6830, lng: 35.6500 },
    'Njombe': { lat: -9.3333, lng: 34.7667 },
    'Makambako': { lat: -8.8333, lng: 34.8500 },
    'Mafinga': { lat: -8.3500, lng: 35.0500 },
    'Ifakara': { lat: -8.1333, lng: 36.6833 },
    'Kibaha': { lat: -6.7667, lng: 38.9167 },
    'Masasi': { lat: -10.7167, lng: 38.8000 },
    'Ruangwa': { lat: -10.0667, lng: 38.8667 },
    'Chunya': { lat: -8.5333, lng: 33.4333 },
    'Ludewa': { lat: -9.4333, lng: 34.5333 },
    'Ngorongoro': { lat: -3.2310, lng: 35.4910 },
    'Geita': { lat: -2.8667, lng: 32.2333 },
    'Northmara': { lat: -1.5000, lng: 34.1667 },
    'Bulyanhulu': { lat: -3.2333, lng: 32.3333 },
    'Buzwagi': { lat: -3.5500, lng: 32.3167 },
    'Nakonde': { lat: -9.3242, lng: 32.7608 },
    'Mkuranga': { lat: -7.1167, lng: 39.1833 },
    'Kisarawe': { lat: -7.0667, lng: 39.0500 },
    'Lugoba': { lat: -6.5000, lng: 38.5000 },
    'Kwamkwaja': { lat: -5.3333, lng: 38.6500 },
    'Kwamsisi': { lat: -5.7500, lng: 38.3833 },
    'Saadani': { lat: -6.0333, lng: 38.7667 },
    'Katavi': { lat: -6.8333, lng: 31.0000 },
    'Mpanda': { lat: -6.3500, lng: 31.0667 },
    'Kagera': { lat: -1.5000, lng: 31.0000 },
    'Manyara': { lat: -3.6833, lng: 35.8167 },
    'Mara': { lat: -1.7500, lng: 34.0000 },
    'Simyu': { lat: -3.0000, lng: 34.0000 },
    'Ruvuma': { lat: -10.6833, lng: 35.6500 },
    'Rukwa': { lat: -8.0000, lng: 32.0000 },
    'Jongomeri': { lat: -8.0000, lng: 34.5000 },
    'Kisemvule': { lat: -9.5000, lng: 33.0000 },
    'Chico': { lat: -6.8000, lng: 39.0000 },
    'Zanzibar': { lat: -6.1622, lng: 39.1921 },
    // Zambia
    'Lusaka': { lat: -15.3875, lng: 28.3228 },
    'Ndola': { lat: -12.9587, lng: 28.6366 },
    'Kitwe': { lat: -12.8025, lng: 28.2133 },
    'Chingola': { lat: -12.5180, lng: 27.8650 },
    'Solwezi': { lat: -12.1742, lng: 26.3667 },
    'Kansanshi': { lat: -12.1000, lng: 26.4167 },
    'Lumwana': { lat: -12.2753, lng: 25.1517 },
    'Kalumbila': { lat: -12.3500, lng: 25.5000 },
    'Kasumbalesa': { lat: -12.2570, lng: 27.7940 },
    'Mpika': { lat: -11.8333, lng: 31.4500 },
    'Kasama': { lat: -10.2167, lng: 31.1833 },
    'Kapiri': { lat: -13.9667, lng: 28.6833 },
    'Chembe': { lat: -11.1000, lng: 28.7000 },
    'Mbala Turnoff': { lat: -9.0000, lng: 31.4000 },
    // DRC
    'Sakania': { lat: -12.7500, lng: 28.5667 },
    'Lubumbashi': { lat: -11.6647, lng: 27.4794 },
    'Kolwezi': { lat: -10.7167, lng: 25.4667 },
    'Frontier Mines': { lat: -10.4667, lng: 25.3000 },
    // Malawi
    'Lilongwe': { lat: -13.9626, lng: 33.7741 },
    'Blantrye': { lat: -15.7861, lng: 35.0058 },
    'Mzuzu': { lat: -11.4618, lng: 34.0200 },
    'Karonga': { lat: -9.9333, lng: 33.9400 },
    // Uganda
    'Kampala': { lat: 0.3476, lng: 32.5825 },
    'Jinja': { lat: 0.4244, lng: 33.2041 },
    // Rwanda & Burundi (border crossings)
    'Kigali': { lat: -1.9403, lng: 29.8739 },
    'Rusumo': { lat: -2.3847, lng: 30.7836 },
    'Bujumbara': { lat: -3.3614, lng: 29.3599 },
    'Burundi': { lat: -3.3614, lng: 29.3599 },
    'Kabanga': { lat: -2.9022, lng: 30.4986 },
    // Mozambique
    'Beira': { lat: -19.8436, lng: 34.8389 },
    'Msasa': { lat: -17.8407, lng: 31.1161 },
};

// ─── Highway Graph ───────────────────────────────────────────────
// Each entry = city → list of directly connected cities via highway
// This represents the actual road network of East/Southern Africa
const HIGHWAY_GRAPH: Record<string, string[]> = {
    // ── Tanzania Trunk Roads ──
    'Dar Es Salaam': ['Morogoro', 'Kibaha', 'Tanga', 'Lindi', 'Lugoba', 'Chico', 'Mkuranga', 'Kisarawe', 'Zanzibar'],
    'Kibaha': ['Dar Es Salaam'],
    'Morogoro': ['Dar Es Salaam', 'Dodoma', 'Iringa', 'Ifakara'],
    'Dodoma': ['Morogoro', 'Singida', 'Iringa'],
    'Iringa': ['Morogoro', 'Dodoma', 'Makambako', 'Mafinga'],
    'Makambako': ['Iringa', 'Njombe', 'Mbeya', 'Kasumulu', 'Jongomeri', 'Ludewa'],
    'Kasumulu': ['Makambako', 'Mbeya', 'Karonga'],
    'Mafinga': ['Iringa'],
    'Njombe': ['Makambako', 'Songea', 'Ludewa'],
    'Songea': ['Njombe', 'Ruvuma'],
    'Ruvuma': ['Songea'],
    'Ludewa': ['Makambako', 'Njombe'],
    'Jongomeri': ['Makambako'],
    'Singida': ['Dodoma', 'Shinyanga', 'Tabora', 'Manyara'],
    'Manyara': ['Singida', 'Arusha'],
    'Tabora': ['Singida', 'Kigoma', 'Isaka', 'Shinyanga'],
    'Shinyanga': ['Singida', 'Tabora', 'Mwanza', 'Kahama'],
    'Isaka': ['Tabora', 'Mwanza', 'Geita', 'Bulyanhulu'],
    'Mwanza': ['Shinyanga', 'Isaka', 'Geita', 'Mara', 'Simyu'],
    'Mara': ['Mwanza', 'Northmara'],
    'Simyu': ['Mwanza'],
    'Northmara': ['Mara'],
    'Geita': ['Isaka', 'Mwanza', 'Bulyanhulu'],
    'Bulyanhulu': ['Isaka', 'Geita', 'Buzwagi'],
    'Buzwagi': ['Bulyanhulu', 'Shinyanga'],
    'Kigoma': ['Tabora'],
    'Mbeya': ['Makambako', 'Kasumulu', 'Songwe', 'Tunduma', 'Chunya', 'Mpanda', 'Kisemvule'],
    'Chunya': ['Mbeya'],
    'Songwe': ['Mbeya', 'Tunduma'],
    'Tunduma': ['Mbeya', 'Songwe', 'Nakonde'],
    'Mpanda': ['Mbeya', 'Katavi'],
    'Katavi': ['Mpanda'],
    'Rukwa': ['Mbeya'],
    'Kisemvule': ['Mbeya'],
    'Ifakara': ['Morogoro'],
    // ── Tanzania Coast & Lindi-Mtwara ──
    'Tanga': ['Dar Es Salaam', 'Moshi', 'Mombasa', 'Kwamkwaja', 'Kwamsisi', 'Saadani', 'Lugoba'],
    'Kwamkwaja': ['Tanga'],
    'Kwamsisi': ['Tanga'],
    'Saadani': ['Tanga', 'Lugoba'],
    'Lugoba': ['Dar Es Salaam', 'Tanga', 'Saadani'],
    'Moshi': ['Tanga', 'Arusha'],
    'Arusha': ['Moshi', 'Nairobi', 'Ngorongoro', 'Manyara'],
    'Ngorongoro': ['Arusha'],
    'Lindi': ['Dar Es Salaam', 'Mtwara', 'Ruangwa'],
    'Ruangwa': ['Lindi'],
    'Mtwara': ['Lindi', 'Masasi'],
    'Masasi': ['Mtwara', 'Songea'],
    'Mkuranga': ['Dar Es Salaam'],
    'Kisarawe': ['Dar Es Salaam'],
    'Chico': ['Dar Es Salaam'],
    'Zanzibar': ['Dar Es Salaam'],
    // ── Kenya ──
    'Mombasa': ['Tanga', 'Nairobi'],
    'Nairobi': ['Mombasa', 'Arusha', 'Kampala'],
    // ── Uganda ──
    'Kampala': ['Nairobi', 'Jinja'],
    'Jinja': ['Kampala'],
    // ── Tanzania Western Borders ──
    // Each is a separate branch from Mwanza — NOT connected to each other
    'Kagera': ['Mwanza'],
    // ── Rwanda (via Rusumo Border) ──
    'Rusumo': ['Mwanza', 'Kigali'],
    'Kigali': ['Rusumo'],
    // ── Burundi (via Kabanga Border) ──
    'Kabanga': ['Mwanza', 'Bujumbara', 'Burundi'],
    'Bujumbara': ['Kabanga'],
    'Burundi': ['Kabanga'],
    // ── Zambia ──
    // Main corridor: Tunduma → Nakonde → Mpika → Kapiri → (Ndola or Lusaka)
    // Chembe/Kasama return corridor is handled via ROUTE_PATH_OVERRIDES (not in BFS graph)
    'Nakonde': ['Tunduma', 'Mpika', 'Mbala Turnoff'],
    'Mpika': ['Nakonde', 'Kapiri'],
    'Kapiri': ['Mpika', 'Lusaka', 'Ndola'],
    'Lusaka': ['Kapiri'],
    'Ndola': ['Kapiri', 'Kitwe', 'Solwezi', 'Sakania'],
    'Kitwe': ['Ndola', 'Chingola'],
    'Chingola': ['Kitwe', 'Kasumbalesa'],
    'Kasumbalesa': ['Chingola', 'Lubumbashi'],
    'Solwezi': ['Ndola', 'Lumwana', 'Kansanshi', 'Kalumbila'],
    'Kansanshi': ['Solwezi'],
    'Lumwana': ['Solwezi'],
    'Kalumbila': ['Solwezi'],
    'Mbala Turnoff': ['Nakonde', 'Kasama'],
    // ── DRC ──
    // Chembe border is only used for return routes (handled via ROUTE_PATH_OVERRIDES)
    'Lubumbashi': ['Kasumbalesa', 'Kolwezi', 'Sakania'],
    'Sakania': ['Ndola', 'Lubumbashi'],
    'Kolwezi': ['Lubumbashi', 'Frontier Mines'],
    'Frontier Mines': ['Kolwezi'],
    // ── Malawi ──
    'Lilongwe': ['Blantrye', 'Mzuzu'],
    'Blantrye': ['Lilongwe'],
    'Mzuzu': ['Lilongwe', 'Karonga'],
    'Karonga': ['Mzuzu', 'Kasumulu'],
    // ── Mozambique ──
    'Beira': ['Msasa', 'Lusaka'],
    // ── Zimbabwe ──
    'Msasa': ['Beira', 'Lusaka'],
};

// Ensure graph is bidirectional
for (const [city, neighbors] of Object.entries(HIGHWAY_GRAPH)) {
    for (const n of neighbors) {
        if (!HIGHWAY_GRAPH[n]) HIGHWAY_GRAPH[n] = [];
        if (!HIGHWAY_GRAPH[n].includes(city)) {
            HIGHWAY_GRAPH[n].push(city);
        }
    }
}

// ─── BFS Shortest Path ──────────────────────────────────────────
function findPath(from: string, to: string): string[] | null {
    if (from === to) return [from];
    if (!HIGHWAY_GRAPH[from] || !HIGHWAY_GRAPH[to]) return null;

    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = [from];
    visited.add(from);

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current === to) {
            // Reconstruct path
            const path: string[] = [];
            let node: string | undefined = to;
            while (node) {
                path.unshift(node);
                node = parent.get(node);
            }
            return path;
        }

        for (const neighbor of (HIGHWAY_GRAPH[current] || [])) {
            // Prevent Sakania from acting as a 2-edge shortcut that bypasses the 4-edge Kasumbalesa route
            // unless Sakania is specifically the origin or destination.
            if (neighbor === 'Sakania' && to !== 'Sakania' && from !== 'Sakania') {
                continue;
            }

            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                parent.set(neighbor, current);
                queue.push(neighbor);
            }
        }
    }
    return null; // No path found
}

// ─── Edge Key (Strictly Directional) ──────────────────────────
function edgeKey(a: string, b: string): string {
    return `${a}|${b}`;
}

// ─── Return Corridors ────────────────────────────────────────────
// Some routes use a different return path (e.g. Lubumbashi return
// via Chembe border). These corridors are always built into the network
// and their edges are attached to the matching forward route.
//
// forwardPair: the SAP route's [point_a, point_b] that this return belongs to
// path: the explicit return city path
const RETURN_CORRIDORS: { forwardPair: [string, string]; name: string; path: string[] }[] = [
    {
        forwardPair: ['Dar Es Salaam', 'Lubumbashi'],
        name: 'Lubumbashi Return (via Chembe)',
        path: ['Lubumbashi', 'Chembe', 'Kasama', 'Mbala Turnoff', 'Nakonde', 'Tunduma', 'Mbeya', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    {
        forwardPair: ['Dar Es Salaam', 'Kolwezi'],
        name: 'Kolwezi Return (via Chembe)',
        path: ['Kolwezi', 'Lubumbashi', 'Chembe', 'Kasama', 'Mbala Turnoff', 'Nakonde', 'Tunduma', 'Mbeya', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    {
        forwardPair: ['Dar Es Salaam', 'Frontier Mines'],
        name: 'Frontier Mines Return (via Chembe)',
        path: ['Frontier Mines', 'Kolwezi', 'Lubumbashi', 'Chembe', 'Kasama', 'Mbala Turnoff', 'Nakonde', 'Tunduma', 'Mbeya', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    // Malawi returns to Dar Es Salaam
    {
        forwardPair: ['Dar Es Salaam', 'Lilongwe'],
        name: 'Lilongwe Return (to Dar)',
        path: ['Lilongwe', 'Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    {
        forwardPair: ['Dar Es Salaam', 'Blantrye'],
        name: 'Blantrye Return (to Dar)',
        path: ['Blantrye', 'Lilongwe', 'Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    {
        forwardPair: ['Dar Es Salaam', 'Mzuzu'],
        name: 'Mzuzu Return (to Dar)',
        path: ['Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Iringa', 'Morogoro', 'Dar Es Salaam'],
    },
    // Malawi returns to Mtwara
    {
        forwardPair: ['Mtwara', 'Lilongwe'],
        name: 'Lilongwe Return (to Mtwara)',
        path: ['Lilongwe', 'Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Njombe', 'Songea', 'Masasi', 'Mtwara'],
    },
    {
        forwardPair: ['Mtwara', 'Blantrye'],
        name: 'Blantrye Return (to Mtwara)',
        path: ['Blantrye', 'Lilongwe', 'Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Njombe', 'Songea', 'Masasi', 'Mtwara'],
    },
    {
        forwardPair: ['Mtwara', 'Mzuzu'],
        name: 'Mzuzu Return (to Mtwara)',
        path: ['Mzuzu', 'Karonga', 'Kasumulu', 'Makambako', 'Njombe', 'Songea', 'Masasi', 'Mtwara'],
    },
];

// ─── Mapbox Directions API ──────────────────────────────────────
async function fetchEdgeGeometry(
    fromCity: string, toCity: string
): Promise<{ geometry: any; distance_km: number; duration_hrs: number } | null> {
    const from = CITIES[fromCity];
    const to = CITIES[toCity];
    if (!from || !to) return null;

    const coordStr = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordStr}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;

    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        if (!data.routes?.[0]) return null;
        const route = data.routes[0];
        return {
            geometry: route.geometry,
            distance_km: Math.round(route.distance / 1000),
            duration_hrs: Math.round((route.duration / 3600) * 10) / 10,
        };
    } catch {
        return null;
    }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ────────────────────────────────────────────────────────
async function main() {
    console.log('🛣️  Building unified highway network...\n');

    // Step 1: Get all routes
    const { data: routes, error } = await supabase
        .from('sap_route_master')
        .select('id, route_name, sap_code, point_a, point_b, point_c, point_a_lat, point_a_lng, point_b_lat, point_b_lng')
        .eq('is_active', true)
        .not('point_a_lat', 'is', null)
        .order('route_name');

    if (error || !routes) {
        console.error('❌ Failed to fetch routes:', error?.message);
        process.exit(1);
    }

    console.log(`   📋 ${routes.length} active routes to decompose into network edges.\n`);

    // Step 2: Find paths through the highway graph for each route
    const allEdgeKeys = new Set<string>();
    const routePaths: { routeId: string; routeName: string; edges: { from: string; to: string; key: string }[] }[] = [];
    let pathNotFound = 0;

    for (const route of routes) {
        let cityPath: string[] | null = null;

        // Multi-leg routes: A → B → C
        if (route.point_c && CITIES[route.point_c]) {
            const pathAB = findPath(route.point_a, route.point_b);
            const pathBC = findPath(route.point_b, route.point_c);
            if (pathAB && pathBC) {
                cityPath = [...pathAB, ...pathBC.slice(1)]; // Merge, skip duplicate B
            }
        } else {
            cityPath = findPath(route.point_a, route.point_b);
        }

        if (!cityPath || cityPath.length < 2) {
            console.log(`   ⚠️  No path: ${route.route_name}`);
            pathNotFound++;

            // Fallback: direct edge
            const key = edgeKey(route.point_a, route.point_b);
            const edges = [{ from: route.point_a, to: route.point_b, key }];
            allEdgeKeys.add(key);
            routePaths.push({ routeId: route.id, routeName: route.route_name, edges });
            continue;
        }

        // Decompose path into edges
        const edges: { from: string; to: string; key: string }[] = [];
        for (let i = 0; i < cityPath.length - 1; i++) {
            const key = edgeKey(cityPath[i], cityPath[i + 1]);
            edges.push({ from: cityPath[i], to: cityPath[i + 1], key });
            allEdgeKeys.add(key);
        }

        routePaths.push({ routeId: route.id, routeName: route.route_name, edges });
        console.log(`   ✅ ${route.route_name}: ${cityPath.join(' → ')} (${edges.length} edges)`);
    }

    // Step 2c: Build return corridors and attach to matching forward routes
    for (const corridor of RETURN_CORRIDORS) {
        const returnEdges: { from: string; to: string; key: string }[] = [];
        for (let i = 0; i < corridor.path.length - 1; i++) {
            const key = edgeKey(corridor.path[i], corridor.path[i + 1]);
            returnEdges.push({ from: corridor.path[i], to: corridor.path[i + 1], key });
            allEdgeKeys.add(key);
        }

        // Attach return edges to all matching forward routes
        let attached = 0;
        for (const rp of routePaths) {
            const matchesForward = routes.find(r => r.id === rp.routeId);
            if (matchesForward &&
                matchesForward.point_a === corridor.forwardPair[0] &&
                matchesForward.point_b === corridor.forwardPair[1]) {
                // Add all return edges to complete the round-trip corridor
                // Do not skip overlapping edges, as the truck physically traverses them again.
                for (const re of returnEdges) {
                    rp.edges.push(re);
                }
                attached++;
            }
        }
        console.log(`   🔄 ${corridor.name}: ${corridor.path.join(' → ')} (${returnEdges.length} edges, attached to ${attached} routes)`);
    }

    // Step 2d: Force extra edges that the user wants to see on the network map
    // even if no specific SAP route actively traverses them right now.
    const FORCE_EDGES = [
        ['Ndola', 'Sakania'],
        ['Sakania', 'Lubumbashi']
    ];
    for (const [a, b] of FORCE_EDGES) {
        allEdgeKeys.add(edgeKey(a, b));
    }

    console.log(`\n   📊 ${allEdgeKeys.size} unique highway segments to fetch.`);
    console.log(`   ⚠️  ${pathNotFound} routes with no graph path (using direct fallback).\n`);

    // Step 3: Clear existing network mappings to allow pure rebuild
    console.log('   🗑️  Clearing old network data...\n');
    await supabase.from('route_edge_mapping').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('route_network_edges').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    // Step 4: Fetch geometry for each unique edge
    console.log(`\n   🌐 Fetching highway geometries from Mapbox...\n`);
    const edgeGeometries = new Map<string, { geometry: any; distance_km: number; duration_hrs: number }>();
    const edgeList = Array.from(allEdgeKeys);

    let fetched = 0, failed = 0;
    for (let i = 0; i < edgeList.length; i++) {
        const key = edgeList[i];
        const [cityA, cityB] = key.split('|');

        process.stdout.write(`   [${i + 1}/${edgeList.length}] ${cityA} ↔ ${cityB}...`);

        const result = await fetchEdgeGeometry(cityA, cityB);
        if (result) {
            edgeGeometries.set(key, result);
            console.log(` ✅ ${result.distance_km} km (${result.geometry.coordinates.length} pts)`);
            fetched++;
        } else {
            console.log(` ❌ failed`);
            failed++;
        }

        await sleep(200); // Rate limit
    }

    console.log(`\n   📊 Fetched: ${fetched} ✅, Failed: ${failed} ❌\n`);

    // Step 5: Insert edges into DB
    console.log('\n   💾 Inserting network edges...');
    const edgeIdMap = new Map<string, string>(); //edge_key → id

    for (const [key, edgeData] of edgeGeometries.entries()) {
        const [from, to] = key.split('|');
        const fromCoords = CITIES[from];
        const toCoords = CITIES[to];
        if (!fromCoords || !toCoords) continue;

        const { data: edge, error } = await supabase
            .from('route_network_edges')
            .insert({
                from_node: from,
                to_node: to,
                from_lat: fromCoords.lat,
                from_lng: fromCoords.lng,
                to_lat: toCoords.lat,
                to_lng: toCoords.lng,
                distance_km: edgeData.distance_km,
                duration_hrs: edgeData.duration_hrs,
                geometry: edgeData.geometry,
                edge_key: key
            })
            .select('id')
            .single();

        if (error || !edge) {
            console.error(`❌ Failed to insert edge ${key}:`, error?.message);
            continue;
        }

        edgeIdMap.set(key, edge.id);
    }

    console.log(`   ✅ ${edgeIdMap.size} directional edges inserted.\n`);

    // Step 6: Map Routes to Edges
    console.log('   🔗 Mapping routes to edges...');
    let mappedCount = 0;
    const routeUpdates: { id: string; estimated_distance_km: number; estimated_duration_hrs: number }[] = [];

    for (const rp of routePaths) {
        let order = 1;
        let totalRouteDistanceKm = 0;
        let totalRouteDurationHrs = 0;

        for (const e of rp.edges) {
            const edgeId = edgeIdMap.get(e.key);
            if (!edgeId) continue;

            const edgeGeomData = edgeGeometries.get(e.key);

            if (edgeGeomData) {
                totalRouteDistanceKm += edgeGeomData.distance_km;
                totalRouteDurationHrs += edgeGeomData.duration_hrs;
            }

            const { error } = await supabase
                .from('route_edge_mapping')
                .insert({
                    route_id: rp.routeId,
                    edge_id: edgeId,
                    sequence_order: order++,
                    direction: 'forward' // Legacy enum constraint bypass: everything is natively "forward" in a directional graph
                });

            if (error) {
                console.error(`❌ Failed to map edge to sequence:`, error.message);
            } else {
                mappedCount++;
            }
        }

        // Track this route to update its root master record
        routeUpdates.push({
            id: rp.routeId,
            estimated_distance_km: Math.round(totalRouteDistanceKm),
            estimated_duration_hrs: Math.round(totalRouteDurationHrs * 10) / 10
        });
    }

    console.log(`   ✅ ${mappedCount} route-edge mappings created.\n`);

    // Step 7: Update top-level table distances
    console.log('   🔄 Updating sap_route_master with exact geographical map distances...');
    let updatedRoutes = 0;
    for (const update of routeUpdates) {
        const { error } = await supabase
            .from('sap_route_master')
            .update({
                estimated_distance_km: update.estimated_distance_km,
                estimated_duration_hrs: update.estimated_duration_hrs
            })
            .eq('id', update.id);

        if (!error) updatedRoutes++;
    }
    console.log(`   ✅ ${updatedRoutes} SAP top-level entries synchronized with highway geometry.\n`);

    // Step 8: Summary
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🏁 Network build complete!`);
    console.log(`   🛣️  ${edgeIdMap.size} directional highway segments`);
    console.log(`   🚛 ${routes.length} routes mapped`);
    console.log(`   🔗 ${mappedCount} route-edge connections`);

    const totalKm = Array.from(edgeGeometries.values()).reduce((s, e) => s + e.distance_km, 0);
    console.log(`   📏 ${totalKm.toLocaleString()} km of directional highway network mapped`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
