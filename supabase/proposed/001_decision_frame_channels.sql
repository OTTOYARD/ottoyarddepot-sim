-- ============================================================================
-- PROPOSED — NOT APPLIED. See supabase/proposed/README.md.
--
-- 001 — Widen the OTTO-Q decision frame to the five channels, and scope it to
--       a sim run.
--
-- CLOSES: docs/OTTO-Q-WORLD-CONTRACT.md §2.6 and §2.7
--
-- WHY
-- `ottoq_build_decision_frame(p_depot_id)` gives OTTO-Q vehicles, stalls,
-- sessions, six energy fields and a BESS row. `ottoq_twin_snapshot` gives the
-- RENDERER weather, grid, LMP, carbon, voltage, frequency, DR state, tariff and
-- incidents. The optimizer is working with less information than the 3D scene.
--
-- It is also keyed on depot, not run, so the frame it produces cannot be
-- replayed from a Black Box bundle and two runs on one depot cannot be A/B'd on
-- identical inputs.
--
-- WHAT THIS DOES
-- Adds `ottoq_build_decision_frame_v2(p_sim_run_id)` emitting the five channels
-- of src/lib/ottoq/contracts.ts, with the same envelope discipline: every
-- channel carries its own `observed_at`, so a consumer can compute staleness
-- rather than assume freshness.
--
-- v1 IS LEFT IN PLACE. Its three callers (ottoq_api_twin_get_state,
-- ottoq_capture_decision_snapshot, ottoq_score_run) keep working; migrate them
-- one at a time behind their own review.
--
-- STILL REQUIRED AFTER THIS LANDS
-- A frame nobody reads is what v1 already is. `ottoq_decide_tick` must actually
-- consume the new channels — see backlog item §4.4. This migration is the
-- enabling half, not the whole fix.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ottoq_build_decision_frame_v2(p_sim_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH run AS (
    SELECT sim_run_id, depot_id, sim_clock_current, sim_clock_start,
           tick_count, random_seed, scenario_code, status
      FROM ottoq_sim_runs WHERE sim_run_id = p_sim_run_id
  )
  SELECT jsonb_build_object(
    'contract_version', '2.0',
    'endpoint',         'ottoq.decision_frame',
    'sim_run_id',       r.sim_run_id,
    'depot_id',         r.depot_id,
    'scenario',         r.scenario_code,
    'seed',             r.random_seed,
    'tick',             r.tick_count,
    'sim_clock',        r.sim_clock_current,

    -- ── channel: fleet_telemetry ─────────────────────────────────────────
    'fleet_telemetry', jsonb_build_object(
      'observed_at', r.sim_clock_current,
      'vehicles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'av_id', v.av_api_vehicle_id, 'state', v.current_state,
          'soc', ROUND(v.current_soc::numeric, 2),
          'target_soc', v.target_soc, 'min_soc_threshold', v.min_soc_threshold,
          'stall_id', v.current_stall_id,
          'inlet_type', v.inlet_type, 'inlet_max_kw', v.inlet_max_kw,
          'make', v.make, 'platform', v.platform,
          'fleet_operator_id', v.fleet_operator_id,
          'svc_step', v.config->>'svc_step',
          -- NEW: wear travels with the vehicle. Scheduling a PM-due vehicle
          -- into a 45-minute charge is a decision OTTO-Q cannot currently avoid
          -- making, because it cannot see the counter.
          'wear', (SELECT jsonb_build_object(
                     'drive_km_total',   w.drive_km_total,
                     'km_at_last_pm',    w.km_at_last_pm,
                     'km_since_pm',      w.drive_km_total - COALESCE(w.km_at_last_pm, 0),
                     'hours_since_calib',w.drive_hours_total - COALESCE(w.hours_at_last_calibration, 0),
                     'soil_index',       w.soil_index,
                     'open_dtc_count',   w.open_dtc_count,
                     'worst_open_dtc',   w.worst_open_dtc_rank)
                     FROM ottoq_vehicle_wear w
                    WHERE w.vehicle_id = v.id AND w.sim_run_id = r.sim_run_id)
        ) ORDER BY v.id)
        FROM vehicles v
       WHERE v.home_depot_id = r.depot_id AND v.category = 'autonomous'
      ), '[]'::jsonb)
    ),

    -- ── channel: depot_ops ───────────────────────────────────────────────
    'depot_ops', jsonb_build_object(
      'observed_at', r.sim_clock_current,
      'stalls', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', s.id, 'type', s.stall_type, 'status', s.status,
          'vehicle_id', s.current_vehicle_id,
          'connector_type', s.connector_type, 'connector_max_kw', s.connector_max_kw
        ) ORDER BY s.id)
        FROM stalls s WHERE s.depot_id = r.depot_id
      ), '[]'::jsonb),
      -- NEW: per-visit service timing, from the open dwell legs. Unblocks
      -- charge_time / wash_time / detail_time / maintenance_time, four
      -- variables the card engine deals every visit and that reach nothing.
      'service_timers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'vehicle_id',       l.vehicle_id,
          'stall_id',         COALESCE(l.to_stall_id, l.from_stall_id),
          'leg_type',         l.leg_type,
          'intent',           l.duration_basis->>'intent',
          'started_sim',      COALESCE(l.actual_start_sim, l.planned_start_sim),
          'expected_end_sim', l.planned_end_sim,
          'planned_s',        l.planned_duration_s,
          'elapsed_s',   GREATEST(0, EXTRACT(EPOCH FROM
                           (r.sim_clock_current - COALESCE(l.actual_start_sim, l.planned_start_sim)))::int),
          'remaining_s', GREATEST(0, EXTRACT(EPOCH FROM
                           (l.planned_end_sim - r.sim_clock_current))::int)
        ) ORDER BY l.vehicle_id, l.seq)
        FROM ottoq_itinerary_legs l
       WHERE l.sim_run_id = r.sim_run_id
         AND COALESCE(l.duration_basis->>'kind', 'dwell') = 'dwell'
         AND l.status NOT IN ('done', 'amended', 'skipped')
      ), '[]'::jsonb),
      'incidents_open', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'incident_id', i.incident_id, 'vehicle_id', i.vehicle_id,
          'type', i.incident_type, 'severity', i.severity,
          'requires_tow', i.requires_tow, 'occurred_at', i.occurred_at
        ) ORDER BY i.occurred_at DESC)
        FROM ottoq_vehicle_incidents i
       WHERE i.sim_run_id = r.sim_run_id AND i.resolution_status = 'open'
      ), '[]'::jsonb),
      -- NEW: staffing is a hard capacity constraint on every service lane and
      -- is currently invisible to the scheduler.
      'staffing', COALESCE((
        SELECT jsonb_object_agg(st.role, st.headcount)
          FROM ottoq_depot_staffing st WHERE st.depot_id = r.depot_id
      ), '{}'::jsonb)
    ),

    -- ── channel: charger_systems ─────────────────────────────────────────
    'charger_systems', jsonb_build_object(
      'observed_at', r.sim_clock_current,
      'sessions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', cs.id, 'stall_id', cs.stall_id, 'vehicle_id', cs.vehicle_id,
          'status', cs.status, 'started_at', cs.started_at,
          'power_kw', (cs.last_meter_value->>'power_kw')::numeric
        ) ORDER BY cs.id)
        FROM ocpp_sessions cs
       WHERE cs.depot_id = r.depot_id AND cs.status = 'active'
      ), '[]'::jsonb),
      -- NEW: charger health. A Faulted station and an idle station are
      -- currently the same thing to the assignment logic.
      'chargers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'charger_id', c.charger_id, 'ocpp_id', c.ocpp_identifier,
          'station_state', c.station_state, 'max_kw', c.max_kw,
          'num_connectors', c.num_connectors, 'connector_states', c.connector_states,
          'last_fault_code', c.last_fault_code, 'last_fault_at', c.last_fault_at,
          'last_heartbeat_at', c.last_heartbeat_at,
          'heartbeat_age_s', CASE WHEN c.last_heartbeat_at IS NULL THEN NULL
                                  ELSE EXTRACT(EPOCH FROM (r.sim_clock_current - c.last_heartbeat_at))::int END
        ) ORDER BY c.ocpp_identifier)
        FROM ottoq_ocpp_chargers c
       WHERE c.depot_id = r.depot_id AND c.decommissioned_at IS NULL
      ), '[]'::jsonb)
    ),

    -- ── channel: energy_grid ─────────────────────────────────────────────
    'energy_grid', (
      SELECT jsonb_build_object(
        'site', (
          SELECT jsonb_build_object(
            'grid_import_kw', se.grid_import_kw, 'grid_export_kw', se.grid_export_kw,
            'solar_kw', se.solar_generation_kw, 'bess_output_kw', se.bess_output_kw,
            'ev_charging_kw', se.total_ev_charging_kw, 'building_kw', se.building_load_kw,
            'peak_15min_kw', se.peak_demand_kw_15min,
            'tariff_label', se.current_tariff_label, 'rate_per_kwh', se.current_rate_per_kwh,
            'observed_at', se.timestamp)
            FROM site_energy_snapshots se
           WHERE se.depot_id = r.depot_id
             AND se.timestamp <= r.sim_clock_current
             AND se.timestamp >= r.sim_clock_start
           ORDER BY se.timestamp DESC LIMIT 1),
        'bess', (
          SELECT jsonb_build_object(
            'soc_pct', b.current_soc_pct, 'power_kw', b.current_power_kw,
            'state', b.current_state, 'temp_c', b.current_temperature_c,
            'soh_pct', b.current_soh_pct)
            FROM ottoq_bess_units b WHERE b.depot_id = r.depot_id LIMIT 1),
        -- NEW: the grid channel in full. LMP and carbon are the price signals
        -- any charge-scheduling objective needs; voltage/frequency are the
        -- safety envelope.
        'grid', (
          SELECT jsonb_build_object(
            'lmp_usd_mwh', g.lmp_usd_per_mwh,
            'carbon_gco2_kwh', g.carbon_intensity_gco2_per_kwh,
            'voltage_status', g.voltage_status, 'frequency_hz', g.frequency_hz,
            'reserve_margin_pct', g.reserve_margin_pct,
            'tariff_label', g.current_tariff_label,
            'observed_at', g.sim_clock_at)
            FROM ottoq_grid_snapshots g
           WHERE g.sim_run_id = r.sim_run_id
           ORDER BY g.sim_clock_at DESC LIMIT 1),
        -- NEW: the active DR call and its cap. Without the cap OTTO-Q has no
        -- target to shed to; it can only react after the fact.
        'demand_response', COALESCE((
          SELECT jsonb_build_object(
            'active', TRUE, 'dr_call_id', d.dr_call_id,
            'cap_kw', d.required_load_cap_kw, 'program', d.program,
            'issued_at', d.issued_at, 'expires_at', d.expires_at,
            'minutes_remaining', GREATEST(0, EXTRACT(EPOCH FROM (d.expires_at - r.sim_clock_current))/60)::int,
            'reason', d.reason)
            FROM ottoq_dr_calls d
           WHERE d.sim_run_id = r.sim_run_id AND d.call_status = 'active'
             AND d.expires_at > r.sim_clock_current
           ORDER BY d.issued_at DESC LIMIT 1
        ), jsonb_build_object('active', FALSE, 'cap_kw', NULL)),
        -- NEW: the tariff WINDOW, not just the label. Knowing that off-peak
        -- starts in 40 minutes is what turns "charge now" into "wait".
        'tariff_window', (
          SELECT jsonb_build_object(
            'label', t.label, 'rate_usd_per_kwh', t.rate_usd_per_kwh,
            'hour_start', t.hour_start, 'hour_end', t.hour_end, 'season', t.season,
            'minutes_until_change', (
              ((t.hour_end - EXTRACT(HOUR FROM r.sim_clock_current)::int + 24) % 24) * 60
              - EXTRACT(MINUTE FROM r.sim_clock_current)::int))
            FROM ottoq_tariff_windows t
           WHERE t.depot_id = r.depot_id AND t.active
             AND EXTRACT(HOUR FROM r.sim_clock_current)::int
                 >= t.hour_start
             AND EXTRACT(HOUR FROM r.sim_clock_current)::int
                 <  t.hour_end
           LIMIT 1)
      )
    ),

    -- ── channel: environment ─────────────────────────────────────────────
    -- NEW in its entirety. Temperature drives charge acceptance and BESS
    -- derate; irradiance drives solar; precipitation drives wash demand and
    -- incident rate. None of it currently reaches the optimizer.
    'environment', (
      SELECT jsonb_build_object(
        'temp_c', w.ambient_temp_c, 'cloud_pct', w.cloud_cover_pct,
        'conditions', w.conditions_label, 'precip_state', w.precip_state,
        'ghi_wm2', w.ghi_wm2, 'wind_kmh', w.wind_speed_kmh,
        'solar_elevation_deg', w.solar_elevation_deg,
        'daylight', (w.solar_elevation_deg > 0),
        'observed_at', w.sim_clock_at)
        FROM ottoq_weather_snapshots w
       WHERE w.sim_run_id = r.sim_run_id
       ORDER BY w.sim_clock_at DESC LIMIT 1
    ),

    -- the knobs shaping this run, so a decision can be tied to the world that
    -- produced it
    'variability', COALESCE((
      SELECT knobs FROM ottoq_variability_profiles WHERE sim_run_id = r.sim_run_id
    ), '{}'::jsonb)
  )
  FROM run r;
$function$;

COMMENT ON FUNCTION public.ottoq_build_decision_frame_v2(uuid) IS
  'OTTO-Q decision frame v2 — run-scoped, five channels (fleet_telemetry, depot_ops, '
  'charger_systems, energy_grid, environment). Mirrors src/lib/ottoq/contracts.ts. '
  'v1 (depot-scoped) is retained until all callers migrate.';

-- Suggested follow-up, deliberately NOT included here so it can be reviewed on
-- its own: point ottoq_api_twin_get_state at v2, then teach ottoq_decide_tick
-- to read tariff_window, demand_response and charger_systems.chargers.
