import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import fs from 'fs';

async function run() {
    // 1. Fetch Mpika to Mbeya
    const from = "31.4500,-11.8333"; // Mpika
    const to = "33.4500,-8.9000"; // Mbeya
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}?geometries=geojson&overview=full&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    const coords = data.routes[0].geometry.coordinates;
    
    // Target approx Nakonde/Tunduma: 32.75, -9.33
    // We want the point on this route closest to -9.324, 32.755 setup
    // Let's print out points between -9.33 and -9.30
    for(const pt of coords) {
        if(pt[1] > -9.36 && pt[1] < -9.28) {
            console.log(`[${pt[0].toFixed(5)}, ${pt[1].toFixed(5)}]`);
        }
    }
}
run();
