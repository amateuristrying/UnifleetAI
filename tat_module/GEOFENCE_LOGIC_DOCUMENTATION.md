# TAT Geofence Logic & Trip Lifecycle Documentation

This document provides a comprehensive overview of the Time-to-Arrival (TAT) geofence processing logic, priority zones, and trip lifecycle management as implemented in `tat_optimization_incremental.sql`.

## 1. Overview
The TAT incremental processing engine is designed to parse raw GPS and geofence events into structured, multi-phase trips. It handles multi-year history without API timeouts by processing data in monthly chunks. It uses a cascading priority system (Levels L1 to L3) to categorize geofences and accurately resolve loading regions, borders, and destinations.

---

## 2. Geofence Categorization (Priority Zones)

Geofences are dynamically classified into "Geo Levels" (`geo_level`) to establish their role and priority in the trip lifecycle.

### a. Level 1 (L1) - Core Anchors & Destinations
These are primary anchors that define the start or end of a trip phase.
*   **`L1_TERMINAL`**: Specific physical loading depots (e.g., TIPER DEPOT, PUMA DEPO KURASINI, CAMEL OIL, VIVO ENERGY MOMBASA TERMINAL).
*   **`L1_ZONE`**: Broad loading areas (e.g., TANGA GF, MTWARA GF, BEIRA GF, KURASINI ALL TOGETHER).
*   **`L1_ASAS_BASE`**: Primary operational company bases (e.g., ASAS KIBAHA DSM -YARD, ASAS TABATA).
*   **`L1_OFFLOADING`**: Specific cross-country destinations (e.g., LUSAKA DEPOT, NDOLA OFFLOADING, BLANTYRE).
*   **`L1_DRC_REGION`**: Broad destination regions in the DRC (e.g., DRC OFFLOADING GEO).
*   **`L1_LPG_DEPOT`**: Specific LPG destination depots (e.g., ISAKA LPG DEPOT, DODOMA LPG DEPOT).
*   **`L1_LOCAL_DELIVERY`**: Local delivery destinations (e.g., ASAS HEAD OFFICE IPOGOLO YARD -IRINGA).

### b. Level 2 (L2) - Corridors, Borders & Services
These define transit pathways, custom checkpoints, and intermediary stops.
*   **`L2_BORDER_*`**: Distinct borders, tagged by country or specific names (e.g., `L2_BORDER_TZ`, `L2_BORDER_NAKONDE`, `L2_BORDER_ZMB`, `L2_BORDER_DRC`, `L2_BORDER_CHEMBE`, etc.).
*   **`L2_CUSTOMS_DRC`**: Customs clearing points in DRC (e.g., KANYAKA CUSTOMS, WHISK DRC).
*   **`L2_CHECKPOINT_TRA`**: Tax/Revenue points (e.g., MISUGUSUGU CHECK POINT).
*   **`L2_SERVICE`**: Maintenance/Fueling points (e.g., KIMARA FUELING POINT, SCANIA TANZANIA).
*   **`L2_TZ_LOCAL_DUAL`**: Secondary locations in Tanzania that can act as intermediary stops or destinations (e.g., MOROGORO, MBEYA).
*   **`L2_*_CORRIDOR`**: Specific corridor waypoints categorizing the route being taken (Zambia, Kenya, Zimbabwe, TZ).
*   **`L2_CORRIDOR`**: Fallback level for any uncategorized transit points.

### c. Level 3 (L3) - Broad Regions & End Customers
*   **`L3_ORIGIN_REGION`**: The highest-level macro-region containing the loading zones (e.g., DAR GEOFENCE, BEIRA GEOFENCE).
*   **`L3_CUSTOMER`**: Actual end-customer unloading points, specifically tracked in DRC or mines (e.g., SEP CONGO, UNITED PETROLEUM LUBUMBASHI, LUMWANA MINES).
*   **`L3_DAR_GATEWAY`**: Exit points out of the Dar Origin Region (e.g., KILUVYA TO MBEZI GEOFENCE).

---

## 3. The Data Processing Pipeline (`process_tat_chunk`)

The engine processes data step-by-step to denoise, merge, and segment continuous GPS streams:

### Step 1: Data Normalization
Raw tracking data is uppercase-normalized with uniform spacing to map it correctly against the predefined lists. Redundant whitespace is stripped (e.g., `  TIPER   DEPOT ` -> `TIPER DEPOT`).

### Step 2: Smoothing & Merging (`_chunk_merged`)
To prevent GPS jitter from generating thousands of micro-sessions, consecutive visits to the *same* geofence by the *same* tracker are stitched together if the gap between them is **less than 2 hours**. Continuous presence is treated as a single unified visit session.

### Step 3: Session Splitting logic (`_chunk_loading`)
The engine maps out specific cycles:
1.  **Anchor Identification:** It searches for primary anchors (`L1_TERMINAL`, `L1_ZONE`, `L1_ASAS_BASE`). It can also use broad regions (`L3_ORIGIN_REGION`) as a fallback anchor **if** the dwell time is > 6 hours and is followed by a non-origin transit event.
2.  **Splitting logic:** A new session triggers if there is a verified trip activity (Unloading, Border, Transit) or a visit to a "Home" stabilizer after the start of a previous load.
    *   *Smart Split (Broad Origins):* If inside an `L3_ORIGIN_REGION`, it only triggers a split if a *real* destination or base is hit (ignoring borders to handle pass-through behaviors in places like Tanga).
    *   *Hard Split (Terminals):* If at a distinct terminal or base, any subsequent trip activity cleanly cuts a new session.

### Step 4: Building Trip Phases (`tat_trips_data`)
Timestamps are sequentially assigned based on strict temporal boundaries around the loading anchor.
*   **Arrival (`dar_arrival`):** Resolved based on the most precise return signal. Priority: `Local Base -> Origin Region -> Loading Start`.
*   **Exit (`dar_exit`):** Calculated as the final exit from the Origin Region before hitting major corridors or borders.

---

## 4. Destination Resolution Priority

Trips do not rely purely on the last ping. When multiple valid end-points exist, the system relies on a **priority tree** to designate the final destination (`dest_name`, `dest_entry`, `dest_exit`):

1.  **Highest Priority:** Sub-regions (`L1_OFFLOADING`) & End Customers (`L3_CUSTOMER`).
2.  **High Priority:** Broad DRC Regions (`L1_DRC_REGION`).
3.  **Mid Priority:** Local LPG depots (`L1_LPG_DEPOT`).
4.  **Low Priority:** Secondary TZ towns (`L2_TZ_LOCAL_DUAL`) — **but only if dwell > 3 hours** to filter out pass-throughs.
5.  **Base Priority:** General Local Delivery (`L1_LOCAL_DELIVERY`).

---

## 5. Border Tracking (Onward vs. Return Legs)

Because vehicles cross the same borders twice (going and returning), the SQL explicitly isolates variables:
*   **Onward Leg (`border_tunduma_entry`):** Trapped strictly *after* `loading_exit` and *before* `dest_entry`.
*   **Return Leg (`return_border_tunduma_entry`):** Trapped strictly *after* `dest_exit` and *before* the next trip's `loading_entry`.
*   **Pass-through Filters:** Select borders (e.g., `Mokambo Border`) force a dwell time validation of **> 1 hour** to distinguish actual border clearing operations from driving past the geofence perimeter.

---

## 6. Dashboard Standardization & Views

The `get_tat_trip_details` RPC processes these raw times into actionable statuses:
*   **Statuses:** `loading` -> `pre_transit` -> `in_transit` -> `at_destination` -> `returning` -> `completed`.
*   **Event Generation (JSON):** Real-time playback logs map raw location names into 4 standardized UI buckets: `loading`, `unloading`, `border`, and `transit`.
*   **Gap Smoothing for UI:** The view further smooths rapid entering/exiting from neighboring terminal geofences (e.g., moving between two Kurasini depots) if the gap is under 36 hours for loading areas, merging them visually into a single `Loading Operations (...)` span.

---

## 7. Full Geofence Mapping List

Below is the exhaustive list of all geofences recognized by the engine and how they map to the priority zones:

| Geofence Level | Zone Type | Geofence Names |
| --- | --- | --- |
| `L1_TERMINAL` | Primary Loading Terminal | TIPER DEPOT, PUMA DEPO KURASINI, ORYX LOADING DEPO (KIGAMBONI), ORYX DAR DEPO, OILCOM DAR DEPO, OILCOM LIMITED TERMINAL DEPOT, MERU TERMINAL DEPOT, MOGAS OIL DEPOT, SUPERSTAR FUEL DEPOT, GBP DRS DEPOT, ORYX FUEL DEPOT, WORLD OIL DEPOT, GBP TANGA TERMINAL, CAMEL OIL, PETROBEIRA, PETRODA, LAKE OIL, INPETRO, XSTORAGE, MOUNT MERU, ORYX MTWARA DEPOT, OILCOM MTWARA DEPOT, VIVO ENERGY MOMBASA TERMINAL |
| `L1_ZONE` | Broad Loading Zone | TANGA GF, MTWARA GF, BEIRA, BEIRA GF, KURASINI ALL TOGETHER, MOMBASA GF |
| `L1_DRC_REGION` | DRC Regional Dest. | DRC OFFLOADING GEO |
| `L1_OFFLOADING` | Cross-Country Dest. | LUSAKA DEPOT, NDOLA OFFLOADING, MZUZU OFFLOADING, LILONGWE, JINJA GF, KAMPALA GF, BUJUMBURA GF, KIGALI GF, BLANTYRE, BLANTYRE OFFLOADING |
| `L1_LPG_DEPOT` | Gas/LPG Dest. | ISAKA LPG DEPOT, DODOMA LPG DEPOT, ORYX DODOMA LPG DEPOT, MWANZA LPG DEPOT, MOSHI LPG DEPOT, IRINGA LPG DEPOT, MBEYA LPG DEPOT |
| `L1_LOCAL_DELIVERY` | Local Destination | ASAS HEAD OFFICE IPOGOLO YARD -IRINGA |
| `L1_ASAS_BASE` | Company Bases | ASAS DSM OFFICE / DAR W/SHOP, ASAS KIBAHA DSM -YARD, ASAS TABATA |
| `L2_SERVICE` | Maintenance / Staging | KIMARA FUELING POINT, MLANDIZI WASHING BAY, DELTA CAR WASH MSOLWA, ASAS CHAPWA YARD, GRW ENGINEERING, SCANIA DAR ES SALAAM SERVICE YARD, SCANIA TANZANIA, SERIN YARD |
| `L2_CHECKPOINT_TRA` | Revenue / Tax Points | MISUGUSUGU CHECK POINT, MISUGUSUGU, MISGUSUGU |
| `L2_BORDER_TZ` | Border (TZ Side) | TUNDUMA BORDER TZ SIDE, TANZANIA TUNDUMA BORDER |
| `L2_BORDER_NAKONDE` | Border (Nakonde Side) | NAKONDE BORDER ZMB SIDE, ZAMBIA NAKONDE BORDER |
| `L2_BORDER_TUNDUMA_ALL` | Border (Tunduma Broad) | TUNDUMA BORDER 1 |
| `L2_BORDER_ZMB` | Border (Zambia Side) | KASUMBALESA ZMB SIDE, SAKANIA ZMB SIDE, SAKANIA BORDER |
| `L2_BORDER_DRC` | Border (DRC Side) | KASUMBALESA BORDER DRC SIDE, KASUMBALESA BORDER (DRC), KASUMBALESA, SAKANIA DRC |
| `L2_BORDER_MOKAMBO` | Mokambo Border | MOKAMBO BORDER |
| `L2_BORDER_CHEMBE` | Chembe Border | CHEMBE BORDER, CHEMBE BORDER POST |
| `L2_BORDER_KASUMULU` | Kasumulu Border | KASUMULU BORDER |
| `L2_BORDER_OTHER` | Various Other Borders | CHIRUNDU BORDER, CHIRUNDU BORDER ZIM SIDE, CHIRUNDU BORDER ZAMBIA SIDE, CHIMEFUSA BORDER, KABANGA BORDER, RUSUMO BORDER, MALABA BORDER, HOROHORO BORDER, MUTUKULA BORDER, MANYOUVU BORDER, MUTARE BORDER |
| `L2_CUSTOMS_DRC` | DRC Customs | KANYAKA CUSTOMS, WHISK DRC |
| `L2_TZ_LOCAL_DUAL` | Tanzania Dual-Role | MOROGORO, IPOGORO, MBEYA, MBEYA (UYOLE - MBALIZI) |
| `L2_TZ_CORRIDOR` | TZ Transit Waypoints | IFUNDA, MAKAMBAKO, NYORORO, TUKUYU, UYOLE MIZANI, UYOLE, IGAWA, RUAHA MBUYUNI, MIKUMI, RUVU, KIGOMA, TUKUYU (USHILIKA) |
| `L2_ZAMBIA_CORRIDOR` | ZMB Transit Waypoints | KAPIRI, SERENJE, CHIMUTANDA, MPIKA, MATUMBO, MKUSHI, KANONA, KASAMA, ISOKA, SANGA HILL, LUWINGU, MPIKA, ZAMBIA |
| `L2_KENYA_CORRIDOR` | KEN Transit Waypoints | NAIROBI GF |
| `L2_ZIM_CORRIDOR` | ZIM Transit Waypoints | HARARE GF |
| `L3_CUSTOMER` | Private Customers | EXPREE OIL DEPOT, SEP CONGO, UNITED PETROLEUM LUBUMBASHI, KANATA PETROLEUM DEPOT (CONSTALINA), KOLWEZI OFFLOADING, LUALABA OIL (KOLWEZI), UNITED PETROLEUM KOLWEZI, FRONTIER, LUMWANA MINES |
| `L3_DAR_GATEWAY` | Origins Outer Gateway | KILUVYA TO MBEZI GEOFENCE, KILUVYA GEOFENCE |
| `L3_ORIGIN_REGION` | Origin Macro-Regions | DAR GEOFENCE, TANGA GF, MTWARA GF, BEIRA GEOFENCE, BEIRA GF, MOMBASA GF, TANGA PARKING |
| `L3_LUBUMBASHI` | Lubumbashi Zone | LUBUMBASHI |
| `L3_CHAPWA` | Chapwa Zone | CHAPWA |
