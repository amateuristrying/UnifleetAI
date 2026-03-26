// src/context/config.ts
export type OpsId = "zambia" | "tanzania";

export type ApiSet = {
    summaryMetrics: string;
    assetsActive: string;
    inMovementVsIdling: string;
    fuelExpense: string;
    nightDriving: string;
    speedViolations: string;
    geofjson: string;
    vehiclewiseSummary: string;

    // 🔹 Vehicle details
    vehicleDetails1d: string;
    vehicleDetails7d: string;
    vehicleDetails30d: string;
    vehicleDetailsMtd: string;

    // 🔹 Vehicle leaderboards
    vehicleList1dNight: string;
    vehicleList1dViol: string;
    vehicleList1dTrip: string;

    vehicleList7dNight: string;
    vehicleList7dViol: string;
    vehicleList7dTrip: string;

    vehicleList30dNight: string;
    vehicleList30dViol: string;
    vehicleList30dTrip: string;

    // 🔹 Vehicle live location
    vehicleLocation: string;

    // 🔹 NEW Driving Hours Reports
    belowAvgDriving: string;   // working
    aboveAvgDriving: string;   // NEW ✅

    // 🔹 Report automation endpoints
    reportAutomations: string;
    reportSchedules: string;
};

const ZAMBIA: ApiSet = {
    summaryMetrics: "https://91r76oqquk.execute-api.ap-south-1.amazonaws.com/prod/summary",
    assetsActive: "https://ds16ac8znh.execute-api.ap-south-1.amazonaws.com/assets-active",
    inMovementVsIdling: "https://76bfo56hol.execute-api.ap-south-1.amazonaws.com/inmovement-vs-idling",
    fuelExpense: "https://fufmz5ihve.execute-api.ap-south-1.amazonaws.com",
    nightDriving: "https://b8wxy2cdzb.execute-api.ap-south-1.amazonaws.com/night-driving",
    speedViolations: "/api/zambia/speed/speed-violations",
    geofjson: "/api/zambia/geofence/geofence-snapshot",
    vehiclewiseSummary: "/api/zambia/vehiclewise/vehiclewise-summary-metrics",

    // 🔹 Zambia vehicle details
    vehicleDetails1d: "/api/zambia/details/vehicle-details?file=vehicle-details_last1day.json",
    vehicleDetails7d: "/api/zambia/details/vehicle-details?file=vehicle-details_last7days.json",
    vehicleDetails30d: "/api/zambia/details/vehicle-details?file=vehicle-details_last30days.json",
    vehicleDetailsMtd: "/api/zambia/details/vehicle-details?file=vehicle-details_mtd.json",

    // 🔹 Zambia leaderboards
    vehicleList1dNight: "/api/zambia/details/vehicle-details?file=vehicle-list_last1day_nightDriving.json",
    vehicleList1dViol: "/api/zambia/details/vehicle-details?file=vehicle-list_last1day_violations.json",
    vehicleList1dTrip: "/api/zambia/details/vehicle-details?file=vehicle-list_last1day_tripLength.json",

    vehicleList7dNight: "/api/zambia/details/vehicle-details?file=vehicle-list_last7days_nightDriving.json",
    vehicleList7dViol: "/api/zambia/details/vehicle-details?file=vehicle-list_last7days_violations.json",
    vehicleList7dTrip: "/api/zambia/details/vehicle-details?file=vehicle-list_last7days_tripLength.json",

    vehicleList30dNight: "/api/zambia/details/vehicle-details?file=vehicle-list_last30days_nightDriving.json",
    vehicleList30dViol: "/api/zambia/details/vehicle-details?file=vehicle-list_last30days_violations.json",
    vehicleList30dTrip: "/api/zambia/details/vehicle-details?file=vehicle-list_last30days_tripLength.json",

    // 🔹 Live location
    vehicleLocation: "https://xxlvmpqw1b.execute-api.ap-south-1.amazonaws.com/live-location/latest",

    // 🔹 Driving Hours Reports (Zambia)
    belowAvgDriving: "https://g95ejze48d.execute-api.ap-south-1.amazonaws.com/belowAvgDriving",
    aboveAvgDriving: "https://gvv0lxp9ub.execute-api.ap-south-1.amazonaws.com/aboveAvgDriving",

    // 🔹 Report automations
    reportAutomations: "https://xco2hba5z4.execute-api.ap-south-1.amazonaws.com/automations",
    reportSchedules: "https://xco2hba5z4.execute-api.ap-south-1.amazonaws.com/schedules",
};

const TANZANIA: ApiSet = {
    summaryMetrics: "https://6s4huxb9i1.execute-api.ap-south-1.amazonaws.com",
    assetsActive: "https://pjagc4397d.execute-api.ap-south-1.amazonaws.com/assets-active",
    inMovementVsIdling: "https://jvpjgxnfxf.execute-api.ap-south-1.amazonaws.com/inmovement-vs-idling",
    fuelExpense: "https://f53djzy7o9.execute-api.ap-south-1.amazonaws.com",
    nightDriving: "https://vofgulra92.execute-api.ap-south-1.amazonaws.com",
    speedViolations: "/api/tanzania/speed/SpeedviolationApi",
    geofjson: "/api/tanzania/geofence/geofence-snapshot",
    vehiclewiseSummary: "/api/tanzania/vehiclewise/vehiclewise-summary-metrics",

    vehicleDetails1d: "/api/tanzania/details/vehicle-details?file=vehicle-details_last1day.json",
    vehicleDetails7d: "/api/tanzania/details/vehicle-details?file=vehicle-details_last7days.json",
    vehicleDetails30d: "/api/tanzania/details/vehicle-details?file=vehicle-details_last30days.json",
    vehicleDetailsMtd: "/api/tanzania/details/vehicle-details?file=vehicle-details_mtd.json",

    vehicleList1dNight: "/api/tanzania/details/vehicle-details?file=vehicle-list_last1day_nightDriving.json",
    vehicleList1dViol: "/api/tanzania/details/vehicle-details?file=vehicle-list_last1day_violations.json",
    vehicleList1dTrip: "/api/tanzania/details/vehicle-details?file=vehicle-list_last1day_tripLength.json",

    vehicleList7dNight: "/api/tanzania/details/vehicle-details?file=vehicle-list_last7days_nightDriving.json",
    vehicleList7dViol: "/api/tanzania/details/vehicle-details?file=vehicle-list_last7days_violations.json",
    vehicleList7dTrip: "/api/tanzania/details/vehicle-details?file=vehicle-list_last7days_tripLength.json",

    vehicleList30dNight: "/api/tanzania/details/vehicle-details?file=vehicle-list_last30days_nightDriving.json",
    vehicleList30dViol: "/api/tanzania/details/vehicle-details?file=vehicle-list_last30days_violations.json",
    vehicleList30dTrip: "/api/tanzania/details/vehicle-details?file=vehicle-list_last30days_tripLength.json",

    vehicleLocation: "https://f5e0iaysnk.execute-api.ap-south-1.amazonaws.com/live-location/latest",

    // 🔹 Driving Hours Reports (Tanzania)
    belowAvgDriving: "https://rjgup9a7el.execute-api.ap-south-1.amazonaws.com/below-avg-driving",
    aboveAvgDriving: "https://rjgup9a7el.execute-api.ap-south-1.amazonaws.com/above-avg-driving",

    reportAutomations: "https://hatrbmyged.execute-api.ap-south-1.amazonaws.com/automations",
    reportSchedules: "https://hatrbmyged.execute-api.ap-south-1.amazonaws.com/schedules",
};

export const OPS_ENDPOINTS: Record<OpsId, ApiSet> = {
    zambia: ZAMBIA,
    tanzania: TANZANIA,
};

export function api(ops: OpsId, key: keyof ApiSet): string {
    const set = OPS_ENDPOINTS[ops];
    const url = set[key];
    if (!url) throw new Error(`Missing API endpoint for ${ops}.${String(key)} in config.ts`);
    return url;
}
