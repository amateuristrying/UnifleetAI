export const METRICS = {
    total: 24,
    moving: 12,
    idle: 8,
    stopped: 2,
    notWorking: 2,
    discharged: 2,
    immobilized: 2,
    removed: 2,
    notOnline: 24,
    onJob: 12,
    late: 12,
    waitingToLoad: 8,
    loaded: 2,
    unloading: 2,
    scheduled: 2,
    loading: 2,
    waitingToUnload: 2,
    empty: 2,
    onTime: 2,
    early: 2,
}

export type VehicleStatus = "Running" | "Stopped" | "Idle" | "Not Working" | "Not Online"

export interface Vehicle {
    id: string
    name: string
    driver: string
    timeAgo: string
    speed: number
    address: string
    status: VehicleStatus
    coordinates: [number, number] // [lat, lng]
    heading?: number // GPS heading in degrees
}

export const VEHICLES: Vehicle[] = [
    {
        id: "1",
        name: "HR55AW8004",
        driver: "Assigned",
        timeAgo: "a few seconds ago",
        speed: 51.00,
        address: "NH19, Bardhaman, Burdwan - I, Purba Bardhaman, West Bengal, 713103, India",
        status: "Running",
        coordinates: [14.072, -87.190], // Tegucigalpa approx
    },
    {
        id: "2",
        name: "HR55AW8004", // Duplicate Name test
        driver: "Assigned",
        timeAgo: "a few seconds ago",
        speed: 51.00,
        address: "NH19, Bardhaman, Burdwan - I, Purba Bardhaman, West Bengal, 713103, India",
        status: "Running",
        coordinates: [14.075, -87.195],
    },
    {
        id: "3",
        name: "HR55AW8004",
        driver: "Assigned",
        timeAgo: "a few seconds ago",
        speed: 51.00,
        address: "NH19, Bardhaman, Burdwan - I, Purba Bardhaman, West Bengal, 713103, India",
        status: "Running",
        coordinates: [14.078, -87.188],
    },
]
