
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const SESSION_KEY = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
const NAVIXY_BASE_URL = 'https://api.navixy.com/v2';

async function testNavixy() {
    console.log('Testing Navixy API...');
    console.log('Session Key:', SESSION_KEY);

    try {
        // Test listZones
        console.log('\nTesting /zone/list...');
        const zoneRes = await fetch(`${NAVIXY_BASE_URL}/zone/list?hash=${SESSION_KEY}&with_points=true`);
        const zoneData = await zoneRes.json();
        console.log('Zone List Success:', zoneData.success);
        if (zoneData.success) {
            console.log('Number of zones:', zoneData.list?.length);
        } else {
            console.log('Error:', zoneData.status);
        }

        // Test getTrack (using a dummy tracker and time range)
        console.log('\nTesting /track/read...');
        const trackerId = 3429967; // From previous test script
        const from = '2026-03-14 00:00:00';
        const to = '2026-03-14 12:00:00';
        const trackRes = await fetch(`${NAVIXY_BASE_URL}/track/read?tracker_id=${trackerId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&hash=${SESSION_KEY}`);
        const trackData = await trackRes.json();
        console.log('Track Read Success:', trackData.success);
        if (trackData.success) {
            console.log('Number of points:', trackData.list?.length);
        } else {
            console.log('Error:', trackData.status);
        }

    } catch (err) {
        console.error('Test Failed:', err);
    }
}

testNavixy();
