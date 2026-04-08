import { NavixyServerService } from '../src/services/navixy-server';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function debugZones() {
    const sessionKey = process.env.NEXT_PUBLIC_NAVIXY_SESSION_KEY;
    if (!sessionKey) {
        console.error("Missing NEXT_PUBLIC_NAVIXY_SESSION_KEY");
        return;
    }

    console.log("Session Key:", sessionKey.substring(0, 5) + "...");

    // 1. Fetch default (no params)
    console.log("\n--- Test 1: Default Fetch ---");
    const API_BASE = 'https://api.navixy.com/v2';
    // Try adding commonly used flags for points
    const urlDefault = `${API_BASE}/zone/list?hash=${sessionKey}&with_points=true&flags=1`;
    const resDefault = await fetch(urlDefault);
    const dataDefault = await resDefault.json();
    console.log("Success:", dataDefault.success);
    if (dataDefault.list) {
        console.log("Count:", dataDefault.list.length);
        const types: any = {};
        let missingPoints = 0;
        let firstPolygonId: any = null;

        dataDefault.list.forEach((z: any) => {
            types[z.type] = (types[z.type] || 0) + 1;
            if ((z.type === 'polygon' || z.type === 'sausage') && (!z.points || z.points.length === 0)) {
                missingPoints++;
                if (!firstPolygonId) firstPolygonId = z.id;
            }
        });
        console.log("Types:", types);
        console.log("Polygons/Sausages missing points in list:", missingPoints);

        if (firstPolygonId) {
            console.log(`\n--- Test 4: Fetch Details for Zone ${firstPolygonId} (zone/read) ---`);
            const pointsBase = 'https://api.navixy.com/v2';
            // Try zone/read
            const urlRead = `${pointsBase}/zone/read?zone_id=${firstPolygonId}&hash=${sessionKey}`;
            const resRead = await fetch(urlRead);
            const dataRead = await resRead.json();
            console.log("Success:", dataRead.success);
            if (dataRead.value) {
                // Check if points are in dataRead.value.points or similar
                const z = dataRead.value;
                console.log(`Zone Type: ${z.type}`);
                if (z.points) console.log("Points count:", z.points.length);
                else console.log("No points in value", z);
            } else {
                console.log("No value returned", dataRead);
            }
        }
    } else {
        console.log("No list returned");
    }

    // 2. Fetch with limit=1 (to see if pagination works)
    console.log("\n--- Test 2: Fetch limit=1 ---");
    const urlLimit = `${API_BASE}/zone/list?hash=${sessionKey}&limit=1`;
    const resLimit = await fetch(urlLimit);
    const dataLimit = await resLimit.json();
    if (dataLimit.list) {
        console.log("Count (expect 1):", dataLimit.list.length);
    }

    // 3. Fetch with offset=1
    console.log("\n--- Test 3: Fetch offset=1 ---");
    const urlOffset = `${API_BASE}/zone/list?hash=${sessionKey}&limit=1&offset=1`;
    const resOffset = await fetch(urlOffset);
    const dataOffset = await resOffset.json();
    if (dataOffset.list) {
        console.log("Count (expect 1):", dataOffset.list.length);
        console.log("First Item ID (should differ from Test 2):", dataOffset.list[0]?.id);
    }
}

debugZones();
export {};
