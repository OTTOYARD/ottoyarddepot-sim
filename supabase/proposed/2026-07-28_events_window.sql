-- ============================================================================
-- ottoq_twin_events_window — turn the event log into a SIGNAL CHANNEL.
--
-- WHY THIS EXISTS
-- `ottoq_twin_snapshot.recent_events` is a 15-row tail ordered by occurred_at.
-- That is a UI ticker. It cannot express a RATE, and rates are most of what a
-- reliability model is: how often chargers fault, how late arrivals run, how
-- much repair time the depot is carrying. OTTO-Q was blind to all of it while
-- the twin had been recording it since the first run.
--
-- WINDOW BASIS
-- `ottoq_events` has no sim-clock column — `occurred_at` is WALL time. So a
-- "last 60 sim-minutes" window is not computable here. Rather than fake one,
-- this aggregates RUN-TO-DATE over the signal population and publishes
-- `sim_minutes_elapsed` so the caller can turn any count into a per-sim-hour
-- rate. Point-in-time state (the arrival forecast) is published as `latest`.
--
-- SIGNAL POPULATION
-- Same exclusion list `recent_events` uses: per-tick physics chatter is not
-- signal, it is the clock ticking. Everything else counts.
--
-- NULL DISCIPLINE
-- Every derived statistic is NULL when its source set is empty. A depot with
-- no charge sessions has a NULL fault rate, not 0.0 — "we saw none" and "there
-- was nothing to see" are different claims and OTTO-Q must be able to tell
-- them apart. `battery_soh_pct_p50` is the live example: the twin records the
-- key but never populates it, so it reports NULL rather than inventing health.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ottoq_twin_events_window(p_sim_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run   ottoq_sim_runs%ROWTYPE;
  v_min   numeric;
  v_out   jsonb;
BEGIN
  SELECT * INTO v_run FROM ottoq_sim_runs WHERE sim_run_id = p_sim_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'sim_run not found');
  END IF;

  -- Sim-time span of the run so far. NULL (not 0) if the clock never moved —
  -- dividing by it would manufacture infinite rates on a run that has not run.
  v_min := NULLIF(
    EXTRACT(EPOCH FROM (v_run.sim_clock_current - v_run.sim_clock_start)) / 60.0, 0);

  WITH sig AS (
    SELECT event_type, severity, occurred_at, payload
      FROM ottoq_events
     WHERE sim_run_id = p_sim_run_id
       AND event_type NOT IN (
         'twin.bess_dispatch','twin.weather_tick','twin.solar_tick','twin.grid_tick',
         'twin.sim_tick_advanced','twin.telemetry_emitted','twin.bess_soh_degradation')
  ),
  started AS (SELECT payload p FROM sig WHERE event_type = 'charge.session_started'),
  ended   AS (SELECT payload p FROM sig WHERE event_type = 'charge.session_completed'),
  faulted AS (SELECT payload p FROM sig WHERE event_type = 'charge.session_faulted'),
  delayed AS (SELECT payload p FROM sig WHERE event_type = 'fleet.arrival_delayed'),
  excepted AS (SELECT payload p FROM sig WHERE event_type LIKE 'vehicle.exception%'),
  valve   AS (SELECT payload p, occurred_at FROM sig WHERE event_type = 'twin.rush_valve_hold'),
  fcast   AS (SELECT payload p, occurred_at
                FROM sig WHERE event_type = 'ottoq.arrival_forecast'
               ORDER BY occurred_at DESC LIMIT 1)
  SELECT jsonb_build_object(

    'window', jsonb_build_object(
      'basis',               'run_to_date',
      'signal_events',       (SELECT count(*) FROM sig),
      'first_at',            (SELECT min(occurred_at) FROM sig),
      'last_at',             (SELECT max(occurred_at) FROM sig),
      'sim_minutes_elapsed', v_min),

    'by_type', COALESCE((
      SELECT jsonb_object_agg(event_type, n)
        FROM (SELECT event_type, count(*) n FROM sig GROUP BY 1) t), '{}'::jsonb),

    'by_severity', COALESCE((
      SELECT jsonb_object_agg(severity, n)
        FROM (SELECT severity, count(*) n FROM sig GROUP BY 1) s), '{}'::jsonb),

    -- ── Reliability ────────────────────────────────────────────────────────
    'reliability', jsonb_build_object(
      'charge_sessions',   (SELECT count(*) FROM started),
      'charge_faults',     (SELECT count(*) FROM faulted),
      -- NULL when no session ever started: no denominator, no rate.
      'charge_fault_rate', (
        SELECT CASE WHEN count(*) = 0 THEN NULL
               ELSE round((SELECT count(*) FROM faulted)::numeric / count(*), 4) END
          FROM started),
      'fault_reasons', COALESCE((
        SELECT jsonb_object_agg(reason, n) FROM (
          SELECT COALESCE(p->>'reason','unspecified') reason, count(*) n
            FROM faulted GROUP BY 1) fr), '{}'::jsonb),
      'repair_minutes_total', (
        SELECT CASE WHEN count(*) FILTER (WHERE p->>'repair_minutes' IS NOT NULL) = 0
               THEN NULL ELSE sum((p->>'repair_minutes')::numeric) END FROM faulted),
      'arrival_delays',   (SELECT count(*) FROM delayed),
      'delay_min_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'delay_min')::numeric)::numeric, 1)
          FROM delayed WHERE p->>'delay_min' IS NOT NULL),
      'delay_causes', COALESCE((
        SELECT jsonb_object_agg(cause, n) FROM (
          SELECT COALESCE(p->>'cause','unspecified') cause, count(*) n
            FROM delayed GROUP BY 1) dc), '{}'::jsonb),
      'stranded_recharges', (
        SELECT count(*) FROM sig WHERE event_type = 'twin.recharge_stranded'),
      -- A vehicle that had to be towed in did not drive in. This is the
      -- breakdown signal; nothing else on any frame carries it.
      'tow_events', (
        SELECT count(*) FROM sig WHERE event_type LIKE 'vehicle.tow%'),
      'exceptions_by_severity', COALESCE((
        SELECT jsonb_object_agg(sev, n) FROM (
          SELECT COALESCE(p->>'severity','unspecified') sev, count(*) n
            FROM excepted GROUP BY 1) es), '{}'::jsonb),
      -- Per-sim-hour so a 2-hour run and a 24-hour run are comparable.
      'faults_per_sim_hour', (
        SELECT CASE WHEN v_min IS NULL THEN NULL
               ELSE round(count(*) * 60.0 / v_min, 3) END FROM faulted),
      'delays_per_sim_hour', (
        SELECT CASE WHEN v_min IS NULL THEN NULL
               ELSE round(count(*) * 60.0 / v_min, 3) END FROM delayed)),

    -- ── Charging physics observed on the wire ──────────────────────────────
    'charging', jsonb_build_object(
      'target_soc_p50', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (p->>'soc_target')::numeric)
          FROM started WHERE p->>'soc_target' IS NOT NULL),
      'soc_start_p50', (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (p->>'soc_start')::numeric)
          FROM started WHERE p->>'soc_start' IS NOT NULL),
      -- initial_rate / max_rate: how far off nameplate the vehicle actually
      -- pulled. This IS the charge-curve scalar, observed rather than declared.
      'charge_curve_ratio_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'initial_rate_kw')::numeric
                        / NULLIF((p->>'max_rate_kw')::numeric, 0))::numeric, 3)
          FROM started
         WHERE p->>'initial_rate_kw' IS NOT NULL AND p->>'max_rate_kw' IS NOT NULL),
      'battery_temp_c_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'battery_temp_c')::numeric)::numeric, 1)
          FROM started WHERE p->>'battery_temp_c' IS NOT NULL),
      -- NULL today: the twin records the key and never fills it. Reporting the
      -- absence is the point — it is how the coverage audit stays honest.
      'battery_soh_pct_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'battery_soh_pct')::numeric)::numeric, 2)
          FROM started WHERE p->>'battery_soh_pct' IS NOT NULL),
      'sessions_completed', (SELECT count(*) FROM ended),
      'energy_kwh_total', (
        SELECT CASE WHEN count(*) FILTER (WHERE p->>'energy_kwh' IS NOT NULL) = 0
               THEN NULL ELSE round(sum((p->>'energy_kwh')::numeric), 2) END FROM ended),
      'avg_power_kw_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'avg_power_kw')::numeric)::numeric, 2)
          FROM ended WHERE p->>'avg_power_kw' IS NOT NULL),
      'session_duration_s_p50', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY (p->>'duration_s')::numeric)::numeric, 1)
          FROM ended WHERE p->>'duration_s' IS NOT NULL),
      'auto_rerouted', (
        SELECT count(*) FILTER (WHERE (p->>'auto_rerouted')::boolean) FROM ended)),

    -- ── Demand forecast: the twin's own look-ahead, previously invisible ────
    'demand_forecast', (SELECT jsonb_build_object(
        'at',                  f.occurred_at,
        'horizon_min',         (f.p->>'horizon_min')::numeric,
        'incoming_count',      (f.p->>'incoming_count')::numeric,
        'charge_needed_count', (f.p->>'charge_needed_count')::numeric,
        'predicted_charge_kw', (f.p->>'predicted_charge_kw')::numeric,
        'predicted_charge_kwh',(f.p->>'predicted_charge_kwh')::numeric)
      FROM fcast f),

    -- ── Depot throughput throttling ────────────────────────────────────────
    'throughput', jsonb_build_object(
      'valve_holds',    (SELECT count(*) FROM valve),
      'held_total', (
        SELECT CASE WHEN count(*) FILTER (WHERE p->>'held' IS NOT NULL) = 0
               THEN NULL ELSE sum((p->>'held')::numeric) END FROM valve),
      'released_total', (
        SELECT CASE WHEN count(*) FILTER (WHERE p->>'released' IS NOT NULL) = 0
               THEN NULL ELSE sum((p->>'released')::numeric) END FROM valve),
      'cap_last', (
        SELECT (p->>'cap')::numeric FROM valve ORDER BY occurred_at DESC LIMIT 1))

  ) INTO v_out;

  RETURN v_out;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ottoq_twin_events_window(uuid) TO anon, authenticated, service_role;
