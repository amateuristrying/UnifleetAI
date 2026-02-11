// src/context/config.ts
export type OpsId = "zambia" | "tanzania";

export type ApiSet = {
    summaryMetrics: string;
    assetsActive: string;
    inMovementVsIdling: string;
    fuelExpense: string;
    nightDriving: string;
    speedViolations?: string;
    geofjson?: string;
    vehiclewiseSummary?: string;
    belowAvgDriving?: string;
    aboveAvgDriving?: string;
};

// Use proxy URLs in development to bypass CORS
// Format: /api/{region}/{service}{path}
// Proxy strips /api/{region}/{service}, remaining path goes to AWS Lambda

// Zambia APIs
// Original: https://91r76oqquk.execute-api.ap-south-1.amazonaws.com/prod/summary?table=s1...
// Proxied:  /api/zambia/summary/prod/summary?table=s1...  -> strips "/api/zambia/summary" -> /prod/summary?...
const ZAMBIA: ApiSet = {
    summaryMetrics: "/api/zambia/summary/prod",             // buildSummaryUrl adds /summary
    assetsActive: "/api/zambia/assets/assets-active",
    inMovementVsIdling: "/api/zambia/movement/inmovement-vs-idling",
    fuelExpense: "/api/zambia/fuel",
    nightDriving: "/api/zambia/night/night-driving",
    speedViolations: "/api/zambia/speed/speed-violations",
    geofjson: "/api/zambia/geofence/geofence-snapshot",
    vehiclewiseSummary: "/api/zambia/vehiclewise/vehiclewise-summary-metrics",
    belowAvgDriving: "/api/zambia/below-avg/below-avg-driving",
    aboveAvgDriving: "/api/zambia/above-avg/above-avg-driving",
};

// Tanzania APIs
// Original: https://6s4huxb9i1.execute-api.ap-south-1.amazonaws.com/summary?table=s1...
// Proxied:  /api/tanzania/summaryapi/summary?table=s1... -> strips "/api/tanzania/summaryapi" -> /summary?...
// Note: Using "summaryapi" as proxy prefix so "/summary" path is preserved after rewrite
const TANZANIA: ApiSet = {
    summaryMetrics: "/api/tanzania/summaryapi",             // buildSummaryUrl adds /summary
    assetsActive: "/api/tanzania/assets/assets-active",
    inMovementVsIdling: "/api/tanzania/movement/inmovement-vs-idling",
    fuelExpense: "/api/tanzania/fuel",
    nightDriving: "/api/tanzania/night",
    speedViolations: "/api/tanzania/speed/SpeedviolationApi",
    geofjson: "/api/tanzania/geofence/geofence-snapshot",
    vehiclewiseSummary: "/api/tanzania/vehiclewise/vehiclewise-summary-metrics",
    belowAvgDriving: "/api/tanzania/below-avg/below-avg-driving",
    aboveAvgDriving: "/api/tanzania/above-avg/above-avg-driving",
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
