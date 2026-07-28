-- ============================================================================
-- ottoq_twin_fleet_condition — publish the per-vehicle condition the twin has
-- been drawing all along.
--
-- WHAT WAS ACTUALLY WRONG
-- Not the world model. `ottoq_run_boot_draw` deals all eight `veh_*` attributes
-- per vehicle at every run boot — seeded, reproducible, written to
-- `vehicles.config` as hot-loop truth and mirrored into
-- `ottoq_variability_cards` as provenance (928 cards = 8 vars x 116 vehicles).
-- The fleet is genuinely heterogeneous: SoH 88.2-100.0, charge-curve scalar
-- 0.850-1.098.
--
-- What was wrong is the PIPE. `ottoq_twin_snapshot` publishes seven scalar
-- fields per vehicle — id, av_id, make, platform, state, soc, stall_id — and
-- drops `config` entirely. So every one of those eight knobs moved a world
-- OTTO-Q could not see, and the coverage audit correctly graded the whole
-- vehicle domain 0/8 while the catalog claimed `wired: true` on all of them.
--
-- WHY A SEPARATE RPC AND NOT A SNAPSHOT FIELD
-- Condition has `lifespan = 'run'`: dealt once at boot, constant thereafter.
-- Putting it on a 1.5s snapshot poll would re-ship 116 unchanging rows forever.
-- The client fetches this ONCE at boot and joins it onto the fleet rows.
--
-- THE PROVENANCE FLAG IS THE POINT
-- `vehicles.config` is a single mutable row per vehicle, overwritten by the
-- next run's draw, while the cards are per-run and purged with old runs. So the
-- config can legitimately belong to a DIFFERENT run than the one being asked
-- about. `drawn_for_this_run` compares `config.condition_drawn_run` against the
-- requested run and says so. Without it, a stale draw reads exactly like a
-- fresh one, and a demo would present another run's fleet as this one's.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ottoq_twin_fleet_condition(p_sim_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run   ottoq_sim_runs%ROWTYPE;
  v_out   jsonb;
BEGIN
  SELECT * INTO v_run FROM ottoq_sim_runs WHERE sim_run_id = p_sim_run_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'sim_run not found');
  END IF;

  WITH fleet AS (
    SELECT v.id,
           v.av_api_vehicle_id AS av_id,
           COALESCE(v.config, '{}'::jsonb) AS cfg
      FROM vehicles v
     WHERE v.category = 'autonomous'
       AND v.home_depot_id = v_run.depot_id
  ), rows AS (
    SELECT id, av_id,
           -- NULLIF guards the case where a key is present but empty; a
           -- condition that failed to draw must read NULL, never 0.
           (NULLIF(cfg->>'battery_soh_pct',      ''))::numeric AS battery_soh_pct,
           (NULLIF(cfg->>'consumption_scalar',   ''))::numeric AS consumption_scalar,
           (NULLIF(cfg->>'charge_curve_scalar',  ''))::numeric AS charge_curve_scalar,
           (NULLIF(cfg->>'soil_rate',            ''))::numeric AS soil_rate,
           (NULLIF(cfg->>'pm_interval_km',       ''))::numeric AS pm_interval_km,
           (NULLIF(cfg->>'calib_interval_h',     ''))::numeric AS calib_interval_h,
           (NULLIF(cfg->>'service_speed_scalar', ''))::numeric AS service_speed_scalar,
           (NULLIF(cfg->>'wash_cadence_cycles',  ''))::numeric AS wash_cadence_cycles,
           (NULLIF(cfg->>'cycles_since_wash',    ''))::numeric AS cycles_since_wash,
           cfg->>'condition_drawn_run' AS drawn_run
      FROM fleet
  )
  SELECT jsonb_build_object(

    'fleet_size', (SELECT count(*) FROM rows),
    'with_condition', (SELECT count(*) FROM rows WHERE battery_soh_pct IS NOT NULL),

    -- PROVENANCE. TRUE only when every vehicle carrying a condition drew it for
    -- THIS run. NULL when no vehicle carries one at all — "nothing was drawn"
    -- and "what was drawn belongs to another run" are different failures.
    'drawn_for_this_run', (
      SELECT CASE
        WHEN count(*) FILTER (WHERE drawn_run IS NOT NULL) = 0 THEN NULL
        ELSE bool_and(drawn_run = p_sim_run_id::text)
               FILTER (WHERE drawn_run IS NOT NULL)
      END FROM rows),
    'drawn_run_ids', (
      SELECT jsonb_agg(DISTINCT drawn_run) FROM rows WHERE drawn_run IS NOT NULL),

    'vehicles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'vehicle_id',           id,
        'av_id',                av_id,
        'battery_soh_pct',      battery_soh_pct,
        'consumption_scalar',   consumption_scalar,
        'charge_curve_scalar',  charge_curve_scalar,
        'soil_rate',            soil_rate,
        'pm_interval_km',       pm_interval_km,
        'calib_interval_h',     calib_interval_h,
        'service_speed_scalar', service_speed_scalar,
        'wash_cadence_cycles',  wash_cadence_cycles,
        'cycles_since_wash',    cycles_since_wash,
        -- derived: how close this vehicle is to needing a wash. The scheduler
        -- cares about the ratio, not the raw counters.
        'wash_due_ratio', CASE
          WHEN wash_cadence_cycles IS NULL OR wash_cadence_cycles = 0 THEN NULL
          ELSE round(cycles_since_wash / wash_cadence_cycles, 3) END)
        ORDER BY av_id)
      FROM rows), '[]'::jsonb),

    -- Fleet-level SPREAD. This is what `soh_spread` and the other dispersion
    -- knobs actually move; a median alone cannot show a distribution widening.
    'spread', (
      SELECT jsonb_object_agg(k, stat) FROM (
        SELECT 'battery_soh_pct' AS k, ottoq_twin_spread_stat(array_agg(battery_soh_pct)) AS stat FROM rows
        UNION ALL SELECT 'consumption_scalar',   ottoq_twin_spread_stat(array_agg(consumption_scalar))   FROM rows
        UNION ALL SELECT 'charge_curve_scalar',  ottoq_twin_spread_stat(array_agg(charge_curve_scalar))  FROM rows
        UNION ALL SELECT 'soil_rate',            ottoq_twin_spread_stat(array_agg(soil_rate))            FROM rows
        UNION ALL SELECT 'pm_interval_km',       ottoq_twin_spread_stat(array_agg(pm_interval_km))       FROM rows
        UNION ALL SELECT 'calib_interval_h',     ottoq_twin_spread_stat(array_agg(calib_interval_h))     FROM rows
        UNION ALL SELECT 'service_speed_scalar', ottoq_twin_spread_stat(array_agg(service_speed_scalar)) FROM rows
        UNION ALL SELECT 'wash_cadence_cycles',  ottoq_twin_spread_stat(array_agg(wash_cadence_cycles))  FROM rows
      ) s)

  ) INTO v_out;

  RETURN v_out;
END;
$function$;

-- min / p50 / max / spread for one attribute. NULL throughout when nothing was
-- drawn — an undrawn attribute has no distribution, and a zeroed one would read
-- as a perfectly uniform fleet.
CREATE OR REPLACE FUNCTION public.ottoq_twin_spread_stat(p_vals numeric[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN count(v) = 0 THEN
      jsonb_build_object('n', 0, 'min', NULL, 'p50', NULL, 'max', NULL, 'spread', NULL)
    ELSE jsonb_build_object(
      'n',      count(v),
      'min',    round(min(v), 3),
      'p50',    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v)::numeric, 3),
      'max',    round(max(v), 3),
      'spread', round(max(v) - min(v), 3))
    END
  FROM unnest(p_vals) v WHERE v IS NOT NULL;
$function$;

GRANT EXECUTE ON FUNCTION public.ottoq_twin_fleet_condition(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ottoq_twin_spread_stat(numeric[]) TO anon, authenticated, service_role;

-- ============================================================================
-- ottoq_twin_run_context — which depot does this run actually simulate?
--
-- `ottoq_twin_snapshot` publishes the run block WITHOUT depot_id, so the client
-- had no way to know and hardcoded NASHVILLE_DEPOT. There are two seeded
-- 150-stall depots — "OTTOYARD Nashville Flagship" and "OTTOYARD Benchmark
-- (CRN A/B)" — that share ZERO stall ids, and most runs are on the second.
-- Measured on run 6256a99f: 25 of 25 occupied stalls and 25 of 25 vehicle
-- stall-bindings resolved to NOTHING against the hardcoded layout, so the frame
-- reported a pristine empty depot with integrity "ok". Against the correct
-- depot's layout, all 25 resolve.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ottoq_twin_run_context(p_sim_run_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT COALESCE(
    (SELECT jsonb_build_object(
       'sim_run_id',  r.sim_run_id,
       'depot_id',    r.depot_id,
       'depot_name',  d.name,
       'scenario',    r.scenario_code,
       'status',      r.status,
       'seed',        r.random_seed,
       'stall_count', (SELECT count(*) FROM stalls s WHERE s.depot_id = r.depot_id),
       'fleet_count', (SELECT count(*) FROM vehicles v
                        WHERE v.category = 'autonomous' AND v.home_depot_id = r.depot_id))
       FROM ottoq_sim_runs r
       LEFT JOIN depots d ON d.id = r.depot_id
      WHERE r.sim_run_id = p_sim_run_id),
    jsonb_build_object('error', 'sim_run not found'));
$function$;

GRANT EXECUTE ON FUNCTION public.ottoq_twin_run_context(uuid) TO anon, authenticated, service_role;
