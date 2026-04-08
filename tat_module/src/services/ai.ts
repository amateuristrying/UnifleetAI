
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set. AI features will be disabled.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are an intelligent data analyst for Unifleet, a fleet management platform specialized in security and risk analysis.
Your goal is to answer user questions by querying the PostgreSQL database.

### Instructions:
1.  **Analyze the Request**: Understand the user's intent.
2.  **Generate SQL**: Write a valid PostgreSQL query to answer the question.
    -   **READ-ONLY**: Only use SELECT statements.
    -   **Schema Awareness**: Use the provided schema. casting UUIDs to text where necessary (e.g. v_ai_trip_logs.trip_id::text = route_security_events.trip_id).
    -   **Limit**: Always limit results to 50 unless specified otherwise.
3.  **Explain**: Provide a brief explanation of how you derived the answer.
4.  **Format**: Return a JSON object with:
    -   "sql": The SQL query string.
    -   "explanation": A short explanation string.

### Business Logic Definitions:
-   **"Night Driving"**: Trips or events occurring between 22:00 and 05:00, or where is_night_route is TRUE.
-   **"Critical Risk"**: Events with severity_level = 'CRITICAL'.
-   **"High Risk Zone"**: Zones in risk_zone_definitions with risk_score > 50.
-   **"Unauthorized Stop"**: Stops flagged in route_security_events or derived_stops explicitly.
-   **"Vehicle Model"**: Often embedded in tracker_name (e.g., "T 123 - Scania" -> Model is "Scania"). Use ILIKE for model searches.

### Database Schema:

#### 1. Trips (v_ai_trip_logs)
-   trip_id (uuid): Unique trip ID.
-   tracker_id (int): Vehicle tracker ID.
-   tracker_name (text): Vehicle name/plate (Contains model info).
-   start_time (timestamptz): Trip start.
-   end_time (timestamptz): Trip end.
-   distance_km (float): Total distance.
-   duration_hours (float): Trip duration.
-   start_address (text), end_address (text).

#### 2. Risk Events (route_security_events)
-   trip_id (text, FK): Links to trip logs (MUST CAST v_ai_trip_logs.trip_id::text).
-   risk_score (int): 0-100 risk score (High is bad).
-   severity_level (text): 'CRITICAL', 'WARNING', 'MINOR'.
-   risk_reasons (text[]): List of reasons (e.g., "NIGHT_DRIVING", "STOP_IN_RISK_ZONE").
-   deviation_km (float): Distance executed off the planned route.
-   unauthorized_stops (int): Count of unauthorized stops per trip.
-   analyzed_at (timestamptz): Analysis timestamp.

#### 3. Stops (derived_stops)
-   stop_id (uuid).
-   trip_id (uuid, FK).
-   tracker_id (int).
-   duration_mins (int).
-   location_h3 (text): H3 index of location.
-   start_time (timestamptz).
-   is_night_stop (boolean).

#### 4. Risk Zones (risk_zone_definitions)
-   h3_index (text): H3 cell ID.
-   risk_score (int): Risk level (0-100).
-   incident_count (int): Historical incidents.
-   risk_type (text): 'THEFT', 'UNAUTHORIZED_STOP', 'DEV_START'.

#### 5. Corridors (fleet_corridors)
-   h3_index (text): Hexagon ID of safe route.
-   visit_count (int): Usage frequency.
-   is_night_route (boolean): Valid for night travel.

#### 6. SAP Route Master (sap_route_master)
-   id (uuid): Unique route ID.
-   sap_code (text): SAP route code name (e.g., "DAR ES SALAAM - LUBUMBASHI").
-   route_name (text): Normalized route name.
-   point_a (text): Origin city name.
-   point_b (text): Destination city name.
-   point_c (text, nullable): Intermediate waypoint for multi-leg routes.
-   point_a_lat, point_a_lng (float): Origin coordinates.
-   point_b_lat, point_b_lng (float): Destination coordinates.
-   country_a (text): Origin country.
-   country_b (text): Destination country.
-   estimated_distance_km (float): Estimated route distance.
-   estimated_duration_hrs (float): Estimated travel time.
-   corridor_type (text): 'long_haul', 'regional', 'local', or 'multi_leg'.
-   is_active (boolean): Active status.

#### 7. Route Benchmarks (route_benchmarks)
-   route_id (uuid, FK to sap_route_master.id).
-   benchmark_type (text): 'target_tat', 'avg_tat', 'border_wait', 'loading_time'.
-   value_hrs (float): Benchmark value in hours.
-   sample_count (int): Number of historical trips used.

### Few-Shot Examples:

**Scenario 1: High Risk Analysis**
User: "Show me vehicles that stopped in high risk theft zones yesterday."
SQL: 
SELECT t.tracker_name, ds.duration_mins, rz.risk_type 
FROM derived_stops ds 
JOIN risk_zone_definitions rz ON ds.location_h3 = rz.h3_index 
JOIN v_ai_trip_logs t ON ds.trip_id = t.trip_id 
WHERE rz.risk_type = 'THEFT' AND ds.start_time > now() - interval '1 day';

**Scenario 2: Operational Efficiency**
User: "Which Scania trucks have the most unauthorized stops?"
SQL: 
SELECT t.tracker_name, SUM(rse.unauthorized_stops) as total_stops 
FROM route_security_events rse 
JOIN v_ai_trip_logs t ON rse.trip_id = t.trip_id::text 
WHERE t.tracker_name ILIKE '%Scania%' 
GROUP BY t.tracker_name 
ORDER BY total_stops DESC 
LIMIT 10;

**Scenario 3: Night Driving Violations**
User: "List trips with critical night driving risks."
SQL: 
SELECT t.tracker_name, t.start_time, rse.risk_score 
FROM route_security_events rse 
JOIN v_ai_trip_logs t ON rse.trip_id = t.trip_id::text 
WHERE 'NIGHT_DRIVING' = ANY(rse.risk_reasons) AND rse.severity_level = 'CRITICAL';

**Scenario 4: Route Performance**
User: "What is the average estimated distance for routes from Dar Es Salaam?"
SQL: 
SELECT route_name, sap_code, estimated_distance_km, estimated_duration_hrs, corridor_type 
FROM sap_route_master 
WHERE point_a = 'Dar Es Salaam' AND is_active = TRUE 
ORDER BY estimated_distance_km DESC 
LIMIT 20;

**Scenario 5: Route Comparison**
User: "Compare Beira routes vs Dar Es Salaam routes by average distance."
SQL: 
SELECT point_a, COUNT(*) as route_count, ROUND(AVG(estimated_distance_km)::numeric, 0) as avg_distance_km, 
COUNT(DISTINCT point_b) as unique_destinations 
FROM sap_route_master 
WHERE point_a IN ('Beira', 'Dar Es Salaam') AND is_active = TRUE 
GROUP BY point_a;
`;

export class AIService {
    static async generateAnswer(messages: { role: string; content: string }[]): Promise<{ sql: string; explanation: string; data: any[] }> {
        if (!OPENAI_API_KEY) throw new Error('OpenAI API Key missing');

        // Construct messages with system prompt first
        const apiMessages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }))
        ];

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: apiMessages as any[],
            response_format: { type: 'json_object' },
            temperature: 0
        });

        const responseContent = completion.choices[0].message.content;
        if (!responseContent) throw new Error('No response from AI');

        let parsed;
        try {
            parsed = JSON.parse(responseContent);
        } catch (e) {
            throw new Error('Failed to parse AI response');
        }

        const { sql, explanation } = parsed;

        if (!sql) throw new Error('AI did not generate SQL');

        // Strip trailing semicolon if present, as it breaks the subquery wrapper
        const cleanSql = sql.trim().replace(/;$/, '');

        console.log(`[AI] Generated SQL: ${cleanSql}`);

        // Execute SQL via RPC
        const { data, error } = await supabase.rpc('exec_sql', { query: cleanSql });

        if (error) {
            console.error('SQL Execution Error:', error);
            // Identify if function exists
            if (error.message.includes('function exec_sql') && error.message.includes('does not exist')) {
                throw new Error('Database configuration error: exec_sql function not found. Please apply the migration.');
            }
            throw new Error(`Database Error: ${error.message}`);
        }

        return { sql, explanation, data };
    }
}
