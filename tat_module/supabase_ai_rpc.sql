-- ============================================================
-- Text2SQL Support: Read-Only Query Executor
-- ============================================================

-- Function to execute dynamic SQL safely (Read-Only)
-- Used by the AI Service to run generated SELECT queries.

CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  -- Basic safety check to prevent data modification
  -- This is a fallback; the AI should be prompted to only generate SELECTs, 
  -- and the database user should ideally have restricted permissions.
  IF lower(query) ~ '\s*(insert|update|delete|drop|alter|truncate|create|grant|revoke)\s+' THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed.';
  END IF;

  -- Execute the query and return the result as a JSON array
  EXECUTE 'SELECT json_agg(t) FROM (' || query || ') t' INTO result;
  
  -- Return empty array if null (no rows)
  RETURN COALESCE(result, '[]'::json);
END;
$$;
