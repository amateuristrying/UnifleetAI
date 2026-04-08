
const sessionKey = '7ec319317abad720dd5be071c0512d98';
const BASE_URL = 'https://api.navixy.com/v2';
const TRACKER_ID = 3223820; // The ID from the error message

async function fetchJson(url) {
    console.log(`Fetching: ${url}`);
    try {
        const res = await fetch(url);
        console.log(`Status: ${res.status} ${res.statusText}`);
        if (!res.ok) {
            const text = await res.text();
            console.log(`Body: ${text}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(e);
        return null;
    }
}

async function run() {
    console.log(`Attempting to reproduce 500 error for Tracker ${TRACKER_ID}...`);

    const fromStr = '2026-01-30 13:29:18';
    const toStr = '2026-01-31 13:29:18';
    const eventsFilter = encodeURIComponent(JSON.stringify(['inzone', 'outzone']));

    // Construct URL exactly as seen in the error (but pointing to real API)
    const url = `${BASE_URL}/history/tracker/list?tracker_id=${TRACKER_ID}&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&events=${eventsFilter}&limit=100&hash=${sessionKey}`;

    const res = await fetchJson(url);
    if (res) {
        console.log("Success!");
        console.log(`Events found: ${res.list ? res.list.length : 0}`);
    } else {
        console.log("Failed.");
    }
}

run();
