-- ============================================================================
-- ottoq_twin_labor_window — the depot's LABOR constraint.
--
-- WHY THIS MATTERS MORE THAN IT SOUNDS
-- Staffing is not a cosmetic slider. `ottoq_sim_lane_capacity` turns the
-- staffing knobs into HARD concurrency limits:
--
--     effective_lanes = floor(physical x staffing_level x lane_staff)
--
-- and those limits are consumed by ottoq_fifo_tick, both L2 proposers, the
-- itinerary planner and the service flow. Understaffing does not slow a lane
-- down — it stops the lane from opening at all.
--
-- OTTO-Q could see only STALLS. Routing a vehicle to wash because "3 wash
-- stalls are free" is wrong when 1 wash lane is staffed: the vehicle takes a
-- stall and waits. On run 89439eb8 the twin recorded 8 overflow events,
-- 31 vehicle-waits and a peak of 7 vehicles waiting on labor, none of which
-- reached the orchestrator.
--
-- NOTHING HERE IS RECOMPUTED. The caps are READ from `twin.staging_overflow`,
-- which stamps the caps the sim actually used (svc_cap/wash_cap/deploy_cap) —
-- so this reports what the world DID, not what we think it should have done.
-- The consequence is that caps are NULL until a lane is first contended: the
-- sim only stamps them under contention. "No cap observed" means no
-- contention, NOT unlimited capacity, and the client is required to keep that
-- distinction (see the depot_ops note and its regression test).
--
-- A KNOB THAT DOES NOTHING
-- `charging_staff` is registered in ottoq_variability_catalog with
-- wired = true, and is read by NO function in this database — verified by
-- scanning every pg_proc body. It is deliberately NOT published here: giving
-- it an observable would report a slider's own setting as though it were an
-- outcome. It stays unobservable until the simulation actually reads it.
-- ============================================================================
-- deployed definition follows (matches the database as applied)
CREATE OR REPLACE FUNCTION public.ottoq_twin_labor_window(p_sim_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run   ottoq_sim_runs%ROWTYPE;
  v_knobs jsonb;
  v_min   numeric;
  v_out   jsonb;
BEGIN
  SELECT * INTO v_run FROM ottoq_sim_runs WHERE sim_run_id = p_sim_run_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'sim_run not found'); END IF;

  SELECT knobs INTO v_knobs FROM ottoq_variability_profiles WHERE sim_run_id = p_sim_run_id;
  v_min := NULLIF(EXTRACT(EPOCH FROM (v_run.sim_clock_current - v_run.sim_clock_start)) / 60.0, 0);

  WITH ovf AS (
    SELECT payload p, occurred_at FROM ottoq_events
     WHERE sim_run_id = p_sim_run_id AND event_type = 'twin.staging_overflow'
  ), latest AS (SELECT p FROM ovf ORDER BY occurred_at DESC LIMIT 1),
     started AS (SELECT payload p FROM ottoq_events
                  WHERE sim_run_id = p_sim_run_id AND event_type = 'twin.deferred_service_started'),
     done AS (SELECT payload p FROM ottoq_events
               WHERE sim_run_id = p_sim_run_id AND event_type = 'twin.deferred_service_completed')
  SELECT jsonb_build_object(
    'window', jsonb_build_object('basis','run_to_date','sim_minutes_elapsed', v_min),
    'staffing', COALESCE((SELECT jsonb_object_agg(role, headcount)
        FROM ottoq_depot_staffing WHERE depot_id = v_run.depot_id), '{}'::jsonb),
    'knobs', jsonb_build_object(
      'staffing_level',  (v_knobs #>> '{_rates,staffing_level}')::numeric,
      'charging_staff',  (v_knobs #>> '{_rates,charging_staff}')::numeric,
      'cleaning_staff',  (v_knobs #>> '{_rates,cleaning_staff}')::numeric,
      'service_staff',   (v_knobs #>> '{_rates,service_staff}')::numeric,
      'deploy_staff',    (v_knobs #>> '{_rates,deploy_staff}')::numeric,
      'any_set', (v_knobs #> '{_rates}') IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_object_keys(COALESCE(v_knobs -> '_rates', '{}'::jsonb)) k
         WHERE k IN ('staffing_level','charging_staff','cleaning_staff','service_staff','deploy_staff'))),
    -- NULL until a lane is first contended: the sim stamps caps only under
    -- contention. Absence means no contention, NOT unlimited capacity.
    'lanes', jsonb_build_object(
      'wash_cap',   (SELECT (p->>'wash_cap')::int   FROM latest),
      'service_cap',(SELECT (p->>'svc_cap')::int    FROM latest),
      'deploy_cap', (SELECT (p->>'deploy_cap')::int FROM latest),
      'patience_min', (SELECT (p->>'patience_min')::numeric FROM latest),
      'observed_at', (SELECT occurred_at FROM ovf ORDER BY occurred_at DESC LIMIT 1)),
    'overflow', jsonb_build_object(
      'events',        (SELECT count(*) FROM ovf),
      'vehicles_total',(SELECT COALESCE(sum((p->>'overflow')::int),0) FROM ovf),
      'vehicles_max',  (SELECT max((p->>'overflow')::int) FROM ovf),
      'escalated',     (SELECT COALESCE(sum((p->>'escalated')::int),0) FROM ovf),
      'per_sim_hour',  CASE WHEN v_min IS NULL OR v_min = 0 THEN NULL
                       ELSE round((SELECT count(*) FROM ovf)::numeric * 60.0 / v_min, 3) END),
    'backlog', jsonb_build_object(
      'started',   (SELECT count(*) FROM started),
      'completed', (SELECT count(*) FROM done),
      'open',      GREATEST(0, (SELECT count(*) FROM started) - (SELECT count(*) FROM done)),
      'by_service', COALESCE((
        SELECT jsonb_object_agg(svc, jsonb_build_object('started', n, 'est_min_p50', p50, 'requires_bay', bay))
          FROM (SELECT p->'item'->>'svc' svc, count(*) n,
                       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (p->>'dur_min')::numeric)::numeric,1) p50,
                       max(p->'item'->>'requires_bay') bay
                  FROM started WHERE p->'item'->>'svc' IS NOT NULL GROUP BY 1) s), '{}'::jsonb),
      -- bay-bound work is what LABOR gates; digital work runs regardless
      'bay_bound',  (SELECT count(*) FROM started WHERE p->'item'->>'concurrency' = 'bay'),
      'digital',    (SELECT count(*) FROM started WHERE p->'item'->>'concurrency' = 'digital'),
      'blocks_dispatch', (SELECT count(*) FROM started
                           WHERE (p->'item'->>'blocks_dispatch_while_running')::boolean))
  ) INTO v_out;
  RETURN v_out;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ottoq_twin_labor_window(uuid) TO anon, authenticated, service_role;
