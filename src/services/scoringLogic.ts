import type { Trip, Stop, EngineHours, SpeedViolation, VehicleScore, DailyScore } from '@/types/driverScore';

export function calculateDriverScores(
    trips: Trip[],
    stops: Stop[],
    engineHours: EngineHours[],
    speedViolations: SpeedViolation[]
): VehicleScore[] {
    const vehicles = new Map<number, {
        name: string,
        trips: Trip[],
        stops: Stop[],
        engine: EngineHours[],
        violations: SpeedViolation[]
    }>();

    // Helper to initialize or get vehicle bucket
    const getVehicle = (id: number, name: string) => {
        if (!vehicles.has(id)) {
            vehicles.set(id, { name, trips: [], stops: [], engine: [], violations: [] });
        }
        return vehicles.get(id)!;
    };

    // Group Data
    trips.forEach(t => getVehicle(t.tracker_id, t.tracker_name).trips.push(t));
    stops.forEach(s => getVehicle(s.tracker_id, "Unknown").stops.push(s)); // Stops might not have name, but usually tracker_id matches
    engineHours.forEach(e => getVehicle(e.tracker_id, e.tracker_name).engine.push(e));
    speedViolations.forEach(v => getVehicle(v.tracker_id, v.tracker_name).violations.push(v));

    const scores: VehicleScore[] = [];

    vehicles.forEach((data, trackerId) => {
        let currentScore = 100; // Base Score
        const dailyScores: DailyScore[] = [];

        // Collect all unique dates for this vehicle
        const dates = new Set<string>();
        data.trips.forEach(t => dates.add(t.trip_date));
        data.engine.forEach(e => dates.add(e.report_date));
        data.violations.forEach(v => dates.add(v.trip_date));

        const sortedDates = Array.from(dates).sort();

        // Totals for summary
        let totalDist = 0;
        let totalDur = 0;
        let totalIdle = 0;
        let totalViolations = data.violations.length;

        // Daily Analysis
        sortedDates.forEach(dateStr => {
            const dateObj = new Date(dateStr);
            const isSunday = dateObj.getDay() === 0;

            // Get daily data
            const dayViolations = data.violations.filter(v => v.trip_date === dateStr);
            const dayEngine = data.engine.find(e => e.report_date === dateStr);
            const dayTrips = data.trips.filter(t => t.trip_date === dateStr);

            // Metrics
            const speedCount = dayViolations.length;
            const distKm = dayEngine ? dayEngine.mileage_km : dayTrips.reduce((sum, t) => sum + t.distance_km, 0);
            const idleSec = dayEngine ? dayEngine.idle_seconds : 0; // Using engine hours is best for idle
            const durationSec = dayEngine ? dayEngine.duration_seconds : dayTrips.reduce((sum, t) => sum + t.duration_seconds, 0);

            totalDist += distKm;
            totalDur += durationSec;
            totalIdle += idleSec;

            if (isSunday) {
                dailyScores.push({
                    date: dateStr,
                    isNoTaskDay: true,
                    speedTaskPassed: true,
                    distanceTaskPassed: true,
                    idlingTaskPassed: true,
                    speedViolationsCount: speedCount,
                    durationSeconds: durationSec,
                    distanceKm: distKm,
                    idleSeconds: idleSec,
                    pointsDeducted: 0,
                    pointsAdded: 0
                });
                return; // Skip scoring
            }

            let pointsDeducted = 0;
            let pointsAdded = 0;

            // 1. Speeding Penalty (-5 per event)
            pointsDeducted += (speedCount * 5);

            // 2. Idling Penalty (-2 if > 30m)
            const isExcessIdle = idleSec > (30 * 60);
            if (isExcessIdle) {
                pointsDeducted += 2;
            }

            // 3. Distance Bonus (+1 if > 50km)
            const isGoodDist = distKm > 50;
            if (isGoodDist) {
                pointsAdded += 1;
            }

            // 4. Perfect Day Bonus (+2 if NO speed violations)
            const isPerfect = speedCount === 0;
            if (isPerfect) {
                pointsAdded += 2;
            }

            currentScore = currentScore - pointsDeducted + pointsAdded;

            dailyScores.push({
                date: dateStr,
                isNoTaskDay: false,
                speedTaskPassed: speedCount === 0,
                distanceTaskPassed: isGoodDist,
                idlingTaskPassed: !isExcessIdle,
                speedViolationsCount: speedCount,
                durationSeconds: durationSec,
                distanceKm: distKm,
                idleSeconds: idleSec,
                pointsDeducted,
                pointsAdded
            });
        });

        // Clamp Score
        if (currentScore > 100) currentScore = 100;
        if (currentScore < 0) currentScore = 0;

        scores.push({
            trackerId,
            vehicleName: data.name || `Vehicle #${trackerId}`,
            rank: 0, // Assigned later
            totalScore: currentScore,
            tripCount: data.trips.length,
            totalDistanceKm: totalDist,
            totalDurationSeconds: totalDur,
            totalIdleSeconds: totalIdle,
            violationCount: totalViolations,
            dailyScores,
            baseScore: 100
        });
    });

    // Rank
    scores.sort((a, b) => b.totalScore - a.totalScore);
    scores.forEach((s, idx) => s.rank = idx + 1);

    return scores;
}
