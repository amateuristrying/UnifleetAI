import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
async function check(name: string, from: string, to: string) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}?geometries=geojson&overview=full&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    if(data.routes && data.routes[0]) {
        console.log(`${name}: ${data.routes[0].distance / 1000} km`);
    } else {
        console.log(`${name}: No route`);
    }
}
async function run() {
    await check('Ndola to Sakania', '28.6366,-12.9587', '28.5667,-12.7500');
}
run();
