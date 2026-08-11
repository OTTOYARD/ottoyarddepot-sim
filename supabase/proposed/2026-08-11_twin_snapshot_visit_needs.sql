-- ============================================================================
-- ottoq_twin_snapshot — publish each vehicle's OPEN visit workflow
-- ============================================================================
-- APPLIED to gxdrcyphqjzjsuhxuqtg on 2026-08-11 (migration
-- `twin_snapshot_publish_open_visit_needs`). This file is the in-repo record.
--
-- WHY. `ottoq_visit_needs` has carried, since the service_manifest.v1 generator
-- shipped, exactly the thing the cockpit could not show: the per-visit list of
-- service ATOMS OTTO-Q decided this car needs, each with its own status that
-- `ottoq_start_concurrent_atoms` / `ottoq_mark_visit_atoms_done` advance
-- (pending -> in_progress -> done). Nothing on the wire carried it, so the
-- renderer's hover card could only show a SoC bar and an empty
-- "Services: 0/0" — the client store's serviceQueue is always [] in TWIN mode.
--
-- WHAT IS ADDED. One key, `visit`, on every entry of fleet.vehicles. NULL when
-- the vehicle has no open visit for THIS run — absence is published as absence,
-- never as an empty checklist implying "nothing needed". Nothing else in the
-- function changed; the previous definition was captured with
-- pg_get_functiondef before the replace.
--
-- SOURCING. Every field is read, not derived:
--   target_soc      ottoq_visit_needs.target_soc     (OTTO-Q's target for this visit)
--   soc_at_arrival  meta->>'soc_at_arrival'          (SoC the car entered on)
--   urgency         ottoq_visit_needs.urgency
--   est_charge_min  the CHARGE atom's own est_min    (OTTO-Q's estimate, not a
--                                                     re-derivation of it)
-- `ottoq_vehicle_needs_card` was deliberately NOT joined: measured at 77 ms for
-- 116 vehicles with ZERO open visits (vs 26 ms for the whole snapshot), and its
-- internal `run` CTE resolves the depot's CURRENTLY RUNNING run, which is not
-- necessarily p_sim_run_id — a historical snapshot would have been served live
-- numbers. Everything the card needs is on ottoq_visit_needs, run-scoped.
--
-- VISIT SELECTION mirrors what OTTO-Q itself operates on
-- (ottoq_mark_visit_atoms_done): status IN ('open','in_progress'),
-- ORDER BY created_at DESC LIMIT 1 — plus sim_run_id = this run, so a snapshot
-- of a finished run can never borrow a live run's workflow. Served by the
-- partial index idx_visit_needs_open_by_vehicle.
--
-- TOTALITY. An atom with no `status` key reads as 'pending' (the same COALESCE
-- decide_tick uses). `est_min` is regex-guarded before its cast, so a malformed
-- atom yields NULL instead of aborting the whole snapshot.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ottoq_twin_snapshot(p_sim_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'twin', 'ottoq', 'public', 'extensions'
AS $function$
DECLARE
  v_run     ottoq_sim_runs%ROWTYPE;
  v_depot   UUID;
  v_clock   TIMESTAMPTZ;
  v_out     JSONB;
BEGIN
  SELECT * INTO v_run FROM ottoq_sim_runs WHERE sim_run_id = p_sim_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'sim_run not found', 'sim_run_id', p_sim_run_id);
  END IF;
  v_depot := v_run.depot_id;
  v_clock := v_run.sim_clock_current;

  SELECT jsonb_build_object(

    'run', jsonb_build_object(
      'sim_run_id',  v_run.sim_run_id,
      'scenario',    v_run.scenario_code,
      'status',      v_run.status,
      'sim_clock',   v_clock,
      'tick_count',  v_run.tick_count,
      'time_scale',  v_run.time_scale,
      'seed',        v_run.random_seed,
      -- PLAYBACK CONTRACT for the renderer.
      -- 'live'  => 1 real second advances the sim clock by speed_x sim seconds (true 1:1 at 1x)
      -- 'fixed' => historical tick_interval_seconds * time_scale behaviour (certs/benchmarks)
      'playback_mode', COALESCE(v_run.payload->>'playback_mode','fixed'),
      'speed_x',       COALESCE((v_run.payload->>'speed_x')::numeric, 1.0),
      -- T5: MEASURED, not configured. NULL until >=2 ticks are logged.
      'clock_measured', (
         SELECT jsonb_build_object(
                  'ratio',            f.ratio,
                  'target',           f.target_ratio,
                  'ticks',            f.ticks_measured,
                  'p50_tick_ms',      f.p50_tick_ms,
                  'p95_tick_ms',      f.p95_tick_ms,
                  'max_speed',        f.max_sustainable_speed,
                  'within_tolerance', f.within_tolerance,
                  'verdict',          f.verdict)
           FROM ottoq_clock_fidelity(v_run.sim_run_id, 20) f),
      -- present ONLY while a fast-forward is in flight; drives the planning pause + progress
      'jump',             v_run.payload->'jump',
      -- pacing inputs: elapsed-since-last-tick and clock skew
      'last_tick_at',     v_run.last_tick_at,
      'next_tick_due_at', v_run.next_tick_due_at,
      'server_now',       now()
    ),

    -- T3 RENDER CONTRACT: timed legs. The renderer INTERPOLATES these; it must
    -- never invent motion the contract did not specify.
    'legs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'leg_id',      l.leg_id,
        'vehicle_id',  l.vehicle_id,
        'seq',         l.seq,
        'leg_type',    l.leg_type,
        'intent',      l.duration_basis->>'intent',
        'kind',        COALESCE(l.duration_basis->>'kind','dwell'),
        'from_stall',  l.from_stall_id,
        'to_stall',    l.to_stall_id,
        'from_x',      fs.relative_x, 'from_y', fs.relative_y,
        'to_x',        ts.relative_x, 'to_y',   ts.relative_y,
        'start_sim',   l.planned_start_sim,
        'end_sim',     l.planned_end_sim,
        'duration_s',  l.planned_duration_s,
        'status',      l.status,
        'geometry',    COALESCE(l.duration_basis->>'geometry','n/a'))
        ORDER BY l.vehicle_id, l.seq)
        FROM ottoq_itinerary_legs l
        LEFT JOIN stalls fs ON fs.id = l.from_stall_id
        LEFT JOIN stalls ts ON ts.id = l.to_stall_id
       WHERE l.sim_run_id = v_run.sim_run_id
         AND (
           CASE WHEN COALESCE(l.duration_basis->>'kind','dwell') = 'travel'
                -- TRAVEL: covered until CLOSED. ottoq_itin_close_travel_legs bounds
                -- it (arrived / superseded / stale), so a drive that overruns its
                -- estimate stays covered instead of falling off a time cliff.
                THEN l.status NOT IN ('done','amended','skipped')
                -- DWELL: durations are authoritative, keep the time window.
                ELSE l.status <> 'done'
                     AND l.planned_end_sim   >= v_clock - interval '10 minutes'
                     AND l.planned_start_sim <= v_clock + interval '10 minutes'
           END)
    ), '[]'::jsonb),

    -- #173 (D): server half of the CONTRACT COVERAGE ratio. The renderer knows
    -- how many cars are physically taxiing; only it can close the ratio. Publish
    -- the denominator so coverage is measurable instead of assumed.
    'legs_meta', jsonb_build_object(
      'open_travel_legs', (
        SELECT count(*) FROM ottoq_itinerary_legs l2
         WHERE l2.sim_run_id = v_run.sim_run_id
           AND l2.duration_basis->>'kind' = 'travel'
           AND l2.status NOT IN ('done','amended','skipped')),
      'vehicles_with_open_leg', (
        SELECT count(DISTINCT l3.vehicle_id) FROM ottoq_itinerary_legs l3
         WHERE l3.sim_run_id = v_run.sim_run_id
           AND l3.duration_basis->>'kind' = 'travel'
           AND l3.status NOT IN ('done','amended','skipped')),
      'closed_this_run', (
        SELECT count(*) FROM ottoq_itinerary_legs l4
         WHERE l4.sim_run_id = v_run.sim_run_id
           AND l4.duration_basis->>'kind' = 'travel'
           AND l4.status = 'done'),
      'median_deviation_s', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY l5.deviation_s)::numeric, 1)
          FROM ottoq_itinerary_legs l5
         WHERE l5.sim_run_id = v_run.sim_run_id
           AND l5.duration_basis->>'kind' = 'travel'
           AND l5.deviation_s IS NOT NULL)),

    'fleet', jsonb_build_object(
      'counts', (
        SELECT jsonb_object_agg(state, n) FROM (
          SELECT current_state::text AS state, COUNT(*) AS n
            FROM vehicles WHERE category = 'autonomous' AND home_depot_id = v_depot
           GROUP BY current_state
        ) c
      ),
      'total', (SELECT COUNT(*) FROM vehicles WHERE category = 'autonomous' AND home_depot_id = v_depot),
      'vehicles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'av_id', v.av_api_vehicle_id, 'make', v.make,
          'platform', v.platform, 'state', v.current_state,
          'soc', ROUND(v.current_soc::numeric, 1), 'stall_id', v.current_stall_id,
          -- VISIT WORKFLOW. What OTTO-Q decided this car needs THIS visit, and
          -- how far through it the car is. NULL when there is no open visit for
          -- this run — the renderer must show that as "no workflow published",
          -- never as an empty checklist meaning "nothing needed".
          -- Selection mirrors ottoq_mark_visit_atoms_done (open/in_progress,
          -- newest first) and is additionally scoped to THIS run so a snapshot
          -- of a finished run can never borrow a live run's workflow.
          'visit', vn.card
        ) ORDER BY v.av_api_vehicle_id)
        FROM vehicles v
        LEFT JOIN LATERAL (
          SELECT jsonb_build_object(
            'visit_id',       n.visit_id,
            'visit_status',   n.status,
            'archetype',      n.archetype,
            'urgency',        n.urgency,
            'arrived_at',     n.arrived_at,
            'target_soc',     n.target_soc,
            -- SoC the car ENTERED on, stamped by the needs generator.
            'soc_at_arrival', CASE WHEN n.meta->>'soc_at_arrival' ~ '^-?[0-9]+(\.[0-9]+)?$'
                                   THEN (n.meta->>'soc_at_arrival')::numeric END,
            -- OTTO-Q's OWN charge estimate, lifted from the charge atom, not a
            -- re-derivation. NULL when this visit has no charge atom.
            'est_charge_min', (
              SELECT CASE WHEN ca.value->>'est_min' ~ '^[0-9]+(\.[0-9]+)?$'
                          THEN round((ca.value->>'est_min')::numeric)::int END
                FROM jsonb_array_elements(COALESCE(n.atoms,'[]'::jsonb)) ca
               WHERE ca.value->>'svc' = 'charge'
               LIMIT 1),
            -- THE BULLET LIST, in the order OTTO-Q wrote it. An atom with no
            -- status key reads 'pending' — the same COALESCE decide_tick uses.
            -- est_min is regex-guarded before its cast so one malformed atom
            -- cannot abort the whole snapshot.
            'atoms', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'svc',     a.value->>'svc',
                       'status',  lower(COALESCE(a.value->>'status','pending')),
                       'must_do', COALESCE((a.value->>'must_do')::boolean, false),
                       'est_min', CASE WHEN a.value->>'est_min' ~ '^[0-9]+(\.[0-9]+)?$'
                                       THEN (a.value->>'est_min')::numeric END)
                     ORDER BY a.ord)
                FROM jsonb_array_elements(COALESCE(n.atoms,'[]'::jsonb))
                     WITH ORDINALITY AS a(value, ord)
            ), '[]'::jsonb)
          ) AS card
            FROM ottoq_visit_needs n
           WHERE n.vehicle_id = v.id
             AND n.sim_run_id = v_run.sim_run_id
             AND n.status IN ('open','in_progress')
           ORDER BY n.created_at DESC
           LIMIT 1
        ) vn ON TRUE
        WHERE v.category = 'autonomous' AND v.home_depot_id = v_depot
      ), '[]'::jsonb)
    ),

    -- Live stall status only (geometry comes from layout, cached once)
    -- 0011-TETHER: 'tethered' is what lets the cockpit draw a CONNECTED CABLE. The car is
    -- no longer charging and no longer points at the stall, so without this flag the
    -- renderer has nothing to distinguish "robot still mated" from "stall simply busy".
    -- 'tether_until' is the sim-clock demate deadline, so the arm retract can be animated
    -- against the same clock the legs use. The LEFT JOIN is filtered on v_clock, so an
    -- expired tether reads as false even in the beat before the sweep clears it.
    -- The status filter gains an OR: a tethered stall must stay in the payload even if
    -- something flips its status to 'available' mid-window, or the cable would vanish.
    'stalls_status', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', st.id, 'status', st.status, 'vehicle_id', st.current_vehicle_id,
        'tethered', (tv.id IS NOT NULL),
        'tether_until', tv.robotic_tether_until
      ))
      FROM stalls st
      LEFT JOIN vehicles tv
        ON tv.robotic_tether_stall_id = st.id
       AND tv.robotic_tether_until IS NOT NULL
       AND tv.robotic_tether_until > v_clock
      WHERE st.depot_id = v_depot
        AND (st.status::text <> 'available'       -- only occupied/charging/faulted (light payload)
             OR tv.id IS NOT NULL)                -- ...plus any stall a robot is still holding
    ), '[]'::jsonb),

    'energy', (
      SELECT jsonb_build_object(
        'grid_import_kw', se.grid_import_kw, 'grid_export_kw', se.grid_export_kw,
        'solar_kw', se.solar_generation_kw, 'bess_output_kw', se.bess_output_kw,
        'ev_charging_kw', se.total_ev_charging_kw, 'building_kw', se.building_load_kw,
        'peak_15min_kw', se.peak_demand_kw_15min,
        'tariff', se.current_tariff_label, 'rate_per_kwh', se.current_rate_per_kwh,
        'at', se.timestamp
      )
      FROM site_energy_snapshots se WHERE se.depot_id = v_depot
        AND se.sim_run_id = v_run.sim_run_id
        AND se.timestamp <= v_clock
        AND se.timestamp >= v_run.sim_clock_start   -- scope to THIS run's sim-time window
      ORDER BY se.timestamp DESC LIMIT 1
    ),

    'bess', (
      SELECT jsonb_build_object(
        'soc_pct', b.current_soc_pct, 'power_kw', b.current_power_kw,
        'state', b.current_state, 'temp_c', b.current_temperature_c,
        'soh_pct', b.current_soh_pct
      )
      FROM ottoq_bess_units b WHERE b.depot_id = v_depot LIMIT 1
    ),

    'weather', (
      SELECT jsonb_build_object(
        'temp_c', w.ambient_temp_c, 'cloud_pct', w.cloud_cover_pct,
        'conditions', w.conditions_label, 'precip', w.precip_state,
        'ghi_wm2', w.ghi_wm2, 'wind_kmh', w.wind_speed_kmh,
        'solar_elev_deg', w.solar_elevation_deg, 'at', w.sim_clock_at,
        'humidity_pct', w.relative_humidity_pct
      )
      FROM ottoq_weather_snapshots w WHERE w.sim_run_id = p_sim_run_id
      ORDER BY w.sim_clock_at DESC LIMIT 1
    ),

    'grid', (
      SELECT jsonb_build_object(
        'lmp_usd_mwh', g.lmp_usd_per_mwh, 'tariff', g.current_tariff_label,
        'carbon_gco2_kwh', g.carbon_intensity_gco2_per_kwh,
        'voltage_status', g.voltage_status, 'frequency_hz', g.frequency_hz,
        'reserve_margin_pct', g.reserve_margin_pct,
        'dr_active', (g.active_dr_call_id IS NOT NULL),
        'dr_cap_kw', g.dr_required_load_cap_kw, 'at', g.sim_clock_at
      )
      FROM ottoq_grid_snapshots g WHERE g.sim_run_id = p_sim_run_id
      ORDER BY g.sim_clock_at DESC LIMIT 1
    ),

    'counters', jsonb_build_object(
      'dispatches_active', (SELECT COUNT(*) FROM ottoq_vehicle_dispatches
                             WHERE sim_run_id = p_sim_run_id AND status IN ('active','returning')),
      'dispatches_total',  (SELECT COUNT(*) FROM ottoq_vehicle_dispatches WHERE sim_run_id = p_sim_run_id),
      'telemetry_packets', (SELECT COUNT(*) FROM ottoq_telemetry_packets WHERE sim_run_id = p_sim_run_id),
      'charge_sessions',   (SELECT COUNT(*) FROM ocpp_sessions cs WHERE cs.sim_run_id = p_sim_run_id),
      'events_total',      (SELECT COUNT(*) FROM ottoq_events WHERE sim_run_id = p_sim_run_id),
      'open_incidents',    (SELECT COUNT(*) FROM ottoq_vehicle_incidents
                             WHERE sim_run_id = p_sim_run_id AND resolution_status = 'open')
    ),

    'recent_events', COALESCE((
      SELECT jsonb_agg(e) FROM (
        SELECT jsonb_build_object(
          'type', event_type, 'severity', severity,
          'at', occurred_at, 'entity', entity_type,
          'payload', payload
        ) AS e
        FROM ottoq_events
        WHERE sim_run_id = p_sim_run_id
          AND event_type NOT IN (
            'twin.bess_dispatch','twin.weather_tick','twin.solar_tick','twin.grid_tick',
            'twin.sim_tick_advanced','twin.telemetry_emitted','twin.bess_soh_degradation'
          )
        ORDER BY occurred_at DESC LIMIT 15
      ) sub
    ), '[]'::jsonb),

    'variability', COALESCE((
      SELECT knobs FROM ottoq_variability_profiles WHERE sim_run_id = p_sim_run_id
    ), '{}'::jsonb)

  ) INTO v_out;

  RETURN v_out;
END;
$function$;
