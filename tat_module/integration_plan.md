# Unifleet TAT v2: Integration & Architecture Plan

This document provides a comprehensive blueprint for integrating the `tat_module` into a new, larger Next.js application stack. It acts as an instruction manual for an integrating LLM (like Antigravity) to properly port this module.

## 1. Important Theming Instruction (CRITICAL)
Currently, this entire codebase is natively styled in a **Dark Mode** theme. It uses Tailwind CSS classes such as `bg-[#020617]`, `text-slate-200`, `border-slate-800`, and other slate-heavy dark palettes.

**When integrating this into the new codebase, you must rebuild/convert the components to a Day Mode (Light Mode) theme.** 
You must keep all logic completely intact, but replace the dark Tailwind classes with bright, appropriate light-mode equivalents (e.g., `bg-white`, `text-slate-900`, `border-gray-200`) so it seamlessly fits the new project's daytime UI layout.

---

## 2. Directory & Architecture Overview

The `tat_module` implements a Turnaround Time (TAT) Intelligence Engine, visualizing fleet operations via a combination of Next.js UI components and complex Supabase PostgreSQL logic.

Below is the entire file architecture you will be porting over:

### A. Frontend Components
Found in `src/components/TAT/v2/`. Place these in your new project's respective components structure (e.g., `components/TAT/v2/`).
* **`TATDashboardV2.tsx`**: The main entry point and master layout. Includes global filters (Date pickers, Destinations) and the tab navigation.
* **`PrimaryDashboardTab.tsx`**: High-level metrics, KPIs, and general trip states.
* **`LoadingZonesTab.tsx`**: Focuses on origin delays and loading operations.
* **`BorderManagementTab.tsx`**: Deals with corridor transits and border bottlenecks.
* **`UnloadingZonesTab.tsx`**: destination delivery analytics.
* **`DestinationIntelligenceTab.tsx`**: Deeper analytical breakdowns relative to destinations.
* **`CoverageLabTab.tsx`**: Visualizes missing data and "orphan" anomalies based on the `uncovered-tracker-detail` API.
* **`v2-common.tsx`**: Fundamental building blocks. Includes layout wrappers, base cards, chart containers, and shared styling variables.

### B. Next.js API Middleware
Found in `src/app/api/tat/v2/`. Place these inside the Next.js App Router API hierarchy. These files execute server-side Supabase requests using `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS and aggregate heavy data.
* **`route.ts` (in `/uncovered-tracker-detail/`)**: Orchestrates the fetching and stitching of raw anomaly data using the `get_tat_operational_visit_stream_v2` RPC.
* **`route.ts` (in `/uncovered-summary/`)**: Aggregates higher-level summaries of uncovered tracker segments.
* **`route.ts` (in `/raw-geofence/`)**: Reads unadulterated points or logged events for debugging or deep inspection.
* **Note on Auth**: When porting, remember to bind the integrating app's native layout or auth-guards to protect these endpoints.

### C. Supabase / Database Logic
Found mostly in the `/supabase/migrations/` directory and several root-level `.js`/`.sql` apply scripts. The module uses extreme event-driven PostgREST logic to stitch visits dynamically.
* **`supabase/migrations/tat_v2_refactor_*.sql`**: A large history of iterative migration patches (phases 10 to 76). These govern the actual trip building, border definitions, state machines, and temporal anomalies (e.g., `tat_v2_refactor_phase_66_multi_destination.sql`, `tat_v2_refactor_phase_30_midnight_continuity_fix.sql`).
* **RPC Functions**:
  - `get_tat_trip_details_v2`
  - `get_tat_operational_visit_stream_v2` (Ensure you pass `p_start` and `p_end`, not `p_start_date` and `p_end_date`).
  - `build_trip_state_events_v2`
* **Node Deploy Scripts**: The root contains scripts like `apply_tat_v2_sequence.js` and `apply_sql_only.js`. You may need to adapt these connection strings and rerun them against the new project's database environment to ensure the schema cache and stored procedures match.

---

## 3. Step-by-Step Integration Plan for the LLM

1. **Dependency Syncing**: Add `lucide-react`, `recharts`, `clsx`, `tailwind-merge`, `@supabase/supabase-js` to the target project's `package.json`.
2. **Copy Structure**: Copy `src/components/TAT/v2` and `src/app/api/tat/v2` entirely into the new directory. DO NOT reduce or trim the logic. 
3. **Execute Day Mode Transpiling**: 
   * Open each component (`TATDashboardV2.tsx`, `CoverageLabTab.tsx`, `v2-common.tsx`, etc.).
   * Locate dark-mode hardcoded classes like `bg-[#020617]` and swap them out structurally for the Light Mode theme of the integration host. Look out for text contrasts (e.g., changing `text-white` to `text-black` or `text-gray-900`).
4. **Environment Hooks**: Make sure `process.env.SUPABASE_SERVICE_ROLE_KEY` and URL configurations are pointing to the new project's secure variables in `lib/supabase-server.ts` (or equivalent).
5. **Database Syncing**: Analyze the SQL files in `supabase/migrations/`. If the target database is entirely fresh regarding TAT, ensure you migrate or execute the core table deployments and `tat_v2_*.sql` sequences natively.

*You are now equipped to deploy, translate (to Day Mode), and integrate the TAT Intelligence Engine securely into the new stack.*
