SELECT proname, oidvectortypes(proargtypes) as arg_types
FROM pg_proc 
WHERE proname = 'process_tat_chunk'
