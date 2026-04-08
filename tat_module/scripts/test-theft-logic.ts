/**
 * Verification Script: Fuel Theft Detection Logic
 * 
 * Tests the analyzeStop and evaluateStopRisk functions with mock data.
 */

import { SCORING_THRESHOLDS } from '../src/lib/telematics-config';
import { analyzeStop } from '../src/lib/stop-analysis';
import { RouteLearningService } from '../src/services/route-learning';

// Mock Config if necessary, but we want to test the REAL config
const T = SCORING_THRESHOLDS.STOP_RISK.THRESHOLDS;
const W = SCORING_THRESHOLDS.STOP_RISK.WEIGHTS;

async function runTests() {
    console.log('--- Verification: Fuel Theft Detection ---');
    console.log(`Highway Threshold: ${T.REMOTE_HIGHWAY_SPEED_THRESHOLD} km/h`);
    console.log(`Min Duration: ${T.REMOTE_STOP_MIN_DURATION_MINUTES} mins`);
    console.log(`Max Duration: ${T.REMOTE_STOP_MAX_DURATION_MINUTES} mins\n`);

    const mockStop: any = {
        id: 'test-stop-1',
        tracker_id: 123,
        start_time: '2026-02-08T12:00:00Z',
        end_time: '2026-02-08T12:10:00Z', // 10 mins
        duration_seconds: 600,
        lat: -1.283333, // Nairobi approx
        lng: 36.816667,
    };

    const mockProfile: any = {
        medianDurationSeconds: 1800,
        frequentLocations: [],
    };

    // Case 1: Stop on 80km/h Highway Corridor (Suspected Theft)
    console.log('Test Case 1: Stop on 80km/h Highway (10 mins, Unauthorized)');
    const result1 = analyzeStop({
        stop: mockStop,
        safeZones: [],
        riskHexes: [],
        vehicleProfile: mockProfile,
        corridorAvgSpeed: 100, // HIGHWAY
    });

    if (result1 && result1.riskReasons.includes('REMOTE_HIGHWAY_STOP')) {
        console.log('✅ PASS: Detected REMOTE_HIGHWAY_STOP');
        console.log(`   Score: ${result1.riskScore} (Expected >= ${W.REMOTE_HIGHWAY_STOP})`);
    } else {
        console.log('❌ FAIL: REMOTE_HIGHWAY_STOP not detected');
    }

    // Case 2: Stop on 20km/h Urban Corridor (Normal traffic)
    console.log('\nTest Case 2: Stop on 20km/h Urban (10 mins)');
    const result2 = analyzeStop({
        stop: mockStop,
        safeZones: [],
        riskHexes: [],
        vehicleProfile: mockProfile,
        corridorAvgSpeed: 20, // URBAN
    });

    if (result2 && !result2.riskReasons.includes('REMOTE_HIGHWAY_STOP')) {
        console.log('✅ PASS: Did NOT detect REMOTE_HIGHWAY_STOP for urban route');
    } else {
        console.log('❌ FAIL: Improperly flagged urban stop');
    }

    // Case 3: Stop in Safe Zone on 80km/h Highway
    console.log('\nTest Case 3: Stop in Safe Zone on 80km/h Highway');
    const result3 = analyzeStop({
        stop: mockStop,
        safeZones: [{
            id: 1,
            name: 'Depot A',
            geometry: {
                type: 'Polygon',
                coordinates: [[[36.8, -1.27], [36.83, -1.27], [36.83, -1.3], [36.8, -1.3], [36.8, -1.27]]]
            }
        }],
        riskHexes: [],
        vehicleProfile: mockProfile,
        corridorAvgSpeed: 80,
    });

    if (result3 && !result3.riskReasons.includes('REMOTE_HIGHWAY_STOP')) {
        console.log('✅ PASS: Did NOT detect REMOTE_HIGHWAY_STOP in Safe Zone');
    } else {
        console.log('❌ FAIL: Flagged stop in Safe Zone');
    }

    console.log('\n--- Verification Complete ---');
}

runTests().catch(console.error);
