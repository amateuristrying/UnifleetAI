import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check(name: string, from: any, to: any) {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}?geometries=geojson&overview=full&access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log(`${name}: ${data.routes[0].distance / 1000} km`);
}

async function run() {
    // Current Nakonde to Tunduma
    await check('Current Nakonde-Tunduma', '32.7500,-9.3333', '32.7667,-9.3000');
    // Adjusted straight highway
    await check('Adjusted Nakonde-Tunduma', '32.756,-9.324', '32.764,-9.309');

    // Kitwe to Kasumbalesa (Mokambo wrong vs Real Kasumbalesa)
    await check('Kitwe to wrong Kasumbalesa', '28.2133,-12.8025', '28.5167,-12.6167');
    await check('Kitwe to real Kasumbalesa', '28.2133,-12.8025', '27.7940,-12.2570');
}
run();
export { };
