-- ============================================================================
-- PROPOSED — NOT APPLIED. See supabase/proposed/README.md.
--
-- 002 — Connect the catalog to the calibration corpus, and make an
--       uncalibrated draw loud instead of silent.
--
-- CLOSES: docs/OTTO-Q-WORLD-CONTRACT.md §2.3 and backlog §4.5, §4.6
--
-- WHY
-- ottoq_calibration_distributions holds 41 fitted distributions over 18
-- variables from 9 real datasets — 3.5M NYC TLC trips, 10k NREL fleet shifts,
-- ~20k CA DMV AV records, ACN charging sessions, NOAA/GHCN weather.
--
-- ottoq_twin_deal resolves them through
--   ottoq_sample_calibrated(p_variable_name => var_key, ...)
-- which matches ottoq_calibration_distributions.variable_name = var_key.
--
-- The names do not match. `trip_duration` is not `trip_duration_minutes`;
-- `charge_time` is not `charge_duration_minutes`. So sample_calibrated returns
-- NULL and twin_deal falls through to:
--
--   v_val := min + crn_draw() * (max - min)          -- a UNIFORM draw
--
-- Six variables that look calibrated are uniform noise between catalog bounds.
-- Nothing logs this, which is why it went unnoticed.
--
-- WHAT THIS DOES
--   1. Adds corpus_variable / corpus_segment_expr to the catalog.
--   2. Backfills the six known mappings.
--   3. Adds ottoq_calibration_gaps so every uniform fallback is recorded.
--   4. Replaces ottoq_twin_deal to resolve through the mapping and log gaps.
--
-- BEHAVIOUR CHANGE — READ BEFORE APPLYING
-- The six mapped variables will draw from real distributions instead of
-- uniform. Runs after this migration are NOT comparable to runs before it.
-- Re-baseline any saved benchmark or A/B comparison.
-- ============================================================================

-- ── 1. mapping columns ──────────────────────────────────────────────────────
ALTER TABLE public.ottoq_variability_catalog
  ADD COLUMN IF NOT EXISTS corpus_variable    text,
  ADD COLUMN IF NOT EXISTS corpus_segment_expr text;

COMMENT ON COLUMN public.ottoq_variability_catalog.corpus_variable IS
  'ottoq_calibration_distributions.variable_name this var_key samples from. '
  'NULL = no fitted corpus; the dealer falls back to uniform and logs a gap.';
COMMENT ON COLUMN public.ottoq_variability_catalog.corpus_segment_expr IS
  'Segment selector: ''global'', or a template like ''month:{MM}'' resolved '
  'against the sim clock at deal time.';

-- ── 2. backfill the mappings ────────────────────────────────────────────────
-- Each row below is a name mismatch verified against the live corpus. The
-- sample counts are what is being switched on.
UPDATE public.ottoq_variability_catalog SET
  corpus_variable     = m.corpus_variable,
  corpus_segment_expr = m.segment_expr
FROM (VALUES
  -- var_key,          corpus variable_name,            segment,      samples
  ('trip_duration',    'trip_duration_minutes',         'global'),  -- 3,503,651 (nyc_tlc)
  ('charge_time',      'charge_duration_minutes',       'global'),  --     3,985 (acn_data)
  ('idle_fraction',    'idle_fraction_per_shift',       'global'),  --    10,000 (nrel_fleet)
  ('incident',         'collisions_per_million_miles',  'global'),  --    10,000 (ca_dmv_av)
  ('charger_fault',    'session_success_rate',          'global'),  --    10,000 (charger_reliability)
  -- monthly segmentation is the whole point of the GHCN fit; the previous
  -- global-only match threw away 11 of the 12 seasonal shapes.
  ('precip_mm',        'precip_wet_mm',                 'month:{MM}'),
  ('ambient_temp_c',   'ambient_temp_c',                'month:{MM}')
) AS m(var_key, corpus_variable, segment_expr)
WHERE ottoq_variability_catalog.var_key = m.var_key;

-- Variables with NO fitted corpus stay NULL on purpose. After 002 they will
-- appear in ottoq_calibration_gaps every time they are dealt — that list is the
-- calibration backlog, and it should be visible rather than inferred.

-- ── 3. gap ledger ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ottoq_calibration_gaps (
  gap_id       bigserial PRIMARY KEY,
  sim_run_id   uuid        NOT NULL,
  var_key      text        NOT NULL,
  segment      text,
  reason       text        NOT NULL,   -- 'no_mapping' | 'no_distribution'
  draws        bigint      NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sim_run_id, var_key, segment, reason)
);

COMMENT ON TABLE public.ottoq_calibration_gaps IS
  'Every uniform fallback in ottoq_twin_deal. A row here means a variable that '
  'reads as calibrated is drawing flat noise. Empty is the goal.';

CREATE INDEX IF NOT EXISTS ottoq_calibration_gaps_run_idx
  ON public.ottoq_calibration_gaps (sim_run_id, draws DESC);

-- ── 4. dealer: resolve through the mapping, log every fallback ──────────────
CREATE OR REPLACE FUNCTION public.ottoq_twin_deal(
  p_run_id         uuid,
  p_var_key        text,
  p_scope_instance text,
  p_sim_clock      timestamptz,
  p_sim_day        integer DEFAULT 0,
  p_tick           bigint  DEFAULT 0,
  p_segment        text    DEFAULT 'global'
) RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lifespan text; v_min numeric; v_max numeric;
  v_corpus_var text; v_segment_expr text;
  v_seed bigint; v_bucket text; v_val numeric; v_salt text;
  v_segment text; v_gap_reason text;
  v_block_hrs constant int := 4;
BEGIN
  SELECT lifespan, min_value, max_value, corpus_variable, corpus_segment_expr
    INTO v_lifespan, v_min, v_max, v_corpus_var, v_segment_expr
    FROM ottoq_variability_catalog WHERE var_key = p_var_key;
  IF v_lifespan IS NULL THEN RETURN NULL; END IF;           -- unknown variable

  SELECT COALESCE(random_seed, 42) INTO v_seed FROM ottoq_sim_runs WHERE sim_run_id = p_run_id;
  v_seed := COALESCE(v_seed, 42);

  -- the lifespan epoch (when a fresh card is dealt) — UNCHANGED from v1
  v_bucket := CASE v_lifespan
    WHEN 'run'   THEN 'run'
    WHEN 'day'   THEN 'day:' || p_sim_day
    WHEN 'block' THEN 'block:' || p_sim_day || ':' || (EXTRACT(HOUR FROM p_sim_clock)::int / v_block_hrs)
    ELSE v_lifespan || ':' || p_scope_instance
  END;

  SELECT value INTO v_val FROM ottoq_variability_cards
   WHERE sim_run_id = p_run_id AND var_key = p_var_key
     AND scope_instance = p_scope_instance AND bucket_key = v_bucket;
  IF FOUND THEN RETURN v_val; END IF;                       -- card still valid

  -- NEW: resolve the segment template against the sim clock, so a monthly fit
  -- is actually sampled month-by-month instead of collapsing to 'global'.
  v_segment := COALESCE(
    replace(v_segment_expr, '{MM}', to_char(p_sim_clock, 'MM')),
    p_segment);

  v_salt := p_var_key || '|' || p_scope_instance || '|' || v_bucket;

  -- NEW: sample the MAPPED corpus variable. Falls back to the var_key itself so
  -- the three names that already matched keep working unchanged.
  v_val := ottoq_sample_calibrated(COALESCE(v_corpus_var, p_var_key), v_segment, v_seed, v_salt);

  IF v_val IS NULL THEN
    -- NEW: record the gap before falling back, so silent uniform draws become
    -- a countable defect instead of an invisible one.
    v_gap_reason := CASE WHEN v_corpus_var IS NULL THEN 'no_mapping' ELSE 'no_distribution' END;
    INSERT INTO ottoq_calibration_gaps (sim_run_id, var_key, segment, reason)
      VALUES (p_run_id, p_var_key, v_segment, v_gap_reason)
      ON CONFLICT (sim_run_id, var_key, segment, reason)
      DO UPDATE SET draws = ottoq_calibration_gaps.draws + 1, last_seen = now();

    v_val := COALESCE(v_min, 0)
           + ottoq_crn_draw(v_seed, p_var_key, v_bucket, p_sim_day, 0)
             * (COALESCE(v_max, 1) - COALESCE(v_min, 0));
  END IF;

  UPDATE ottoq_variability_cards SET active = false
    WHERE sim_run_id = p_run_id AND var_key = p_var_key
      AND scope_instance = p_scope_instance AND active;
  INSERT INTO ottoq_variability_cards(sim_run_id, var_key, scope_instance, lifespan,
                                      bucket_key, value, drawn_at_clock, drawn_at_tick)
    VALUES (p_run_id, p_var_key, p_scope_instance, v_lifespan, v_bucket, v_val, p_sim_clock, p_tick)
    ON CONFLICT (sim_run_id, var_key, scope_instance, bucket_key) DO UPDATE SET active = true
    RETURNING value INTO v_val;
  RETURN v_val;
END $function$;

-- ── verification (run after applying, on a branch) ──────────────────────────
--   -- mapped variables should stop appearing here:
--   SELECT var_key, segment, reason, draws
--     FROM ottoq_calibration_gaps
--    WHERE sim_run_id = '<new run>' ORDER BY draws DESC;
--
--   -- and the dealt values should now show the corpus's shape, not a flat one:
--   SELECT var_key, count(*), round(avg(value),2), round(stddev(value),2),
--          min(value), max(value)
--     FROM ottoq_variability_cards
--    WHERE sim_run_id = '<new run>' AND var_key IN
--          ('trip_duration','charge_time','idle_fraction','incident','charger_fault')
--    GROUP BY var_key;
