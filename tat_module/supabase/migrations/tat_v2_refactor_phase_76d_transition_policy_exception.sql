-- =============================================================
-- TAT V2 REFACTOR: Phase 76d
-- Transition Policy: Allow Loading -> Closure
--
-- Problem: 
--   Rebuilds fail when a trip is closed (e.g. by P2 skip or P1 
--   early return) directly from the loading phase without 
--   an intervening origin_exit.
--
-- Fix:
--   Update tat_state_transition_policy_v2 to allow:
--     origin_loading_stop -> trip_closure
-- =============================================================

DELETE FROM public.tat_state_transition_policy_v2 
WHERE from_stop_state = 'origin_loading_stop' 
  AND event_code = 'trip_closed' 
  AND to_stop_state = 'trip_closure';

INSERT INTO public.tat_state_transition_policy_v2 
    (policy_name, from_stop_state, event_code, to_stop_state, is_active, description)
VALUES 
    ('p76_loading_to_closure', 'origin_loading_stop', 'trip_closed', 'trip_closure', TRUE, 'p76_direct_closure');
