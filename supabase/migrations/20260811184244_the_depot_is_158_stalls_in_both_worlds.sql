-- ============================================================================
-- THE DEPOT IS 158 STALLS IN BOTH WORLDS
-- ============================================================================
--
-- WHY THIS MIGRATION EXISTS
--   The renderer's depot was replanned to the founder's 24 ft two-way spec
--   (sitePlan.ts / unreal/layoutSeed.json, branch claude/depot-geometry-replan).
--   Two stalls were DELETED because their centres sat on the south collector's
--   centreline and their footprints overlapped its eastbound lane body by 6.42 ft:
--       NASH-STG-B013  (temp block, west column)
--       NASH-STG-I013  (temp block, east column)
--   Four columns MOVED to open the aisles, and the L2 west columns were lengthened
--   so the stall is no longer shorter than the car.
--
--   The database was never told. It still carried 160 stalls at the pre-replan
--   coordinates. That is not cosmetic: TwinMotionDriver.setTwinStallMap packs the
--   twin's staging codes into renderer slots in (group, index) order, so a single
--   extra code shifts EVERY staging stall after it. With B013 and I013 present, the
--   twin's 115 staging stalls packed into STAGE-01..115 while the renderer draws
--   STAGE-01..113 — the last two resolved to stalls that do not exist, and every
--   stall from E001 onward was aimed one or two slots off its real position.
--
-- WHY THIS IS TARGETED AND NOT A SEED RE-RUN
--   scripts/buildLayoutSeed.mjs re-homes retired stall codes onto minted ones by
--   POSITION — a sorted-leaving to sorted-minted zip. Removing two codes shifts
--   every pair after them, so re-applying the seed would relocate ~14 UNRELATED
--   staging stalls across the site. Migration 'unify_depot_layout' (20260806223619)
--   is already applied; this migration edits the delta only.
--
-- WHAT IT TOUCHES — measured, not assumed. Every one of the 158 surviving codes was
-- hashed field-by-field against unreal/layoutSeed.sql before this was written:
--   * ZERO attribute drift. zone, staging_role, stall_kind, stall_type,
--     display_name, canopy_code and covered ALREADY match the seed on all 158.
--     This migration does not write them.
--   * 72 rows differ on GEOMETRY only, and they are not the four columns the
--     replan brief named. They are FIVE groups:
--        TW / staging_buffer      NASH-STG-B001..B012   12
--        TE / arrival_inspection  NASH-STG-I001..I012   12
--        E  / staging_east        NASH-STG-E001..E025   25
--        N1 / staging_north       NASH-STG-N001..N007    7
--        L2 west columns          NASH-L2-STALL-01..08,
--                                 16..20, 26..28        16
--     The L2 west column is the one the brief did not list. It moved in commit
--     bb422e4 ("Make the L2 west-column stalls long enough to hold the car":
--     depth 15.6698 -> 16.1407 ft against a 16.0 ft design vehicle). Had this
--     migration only covered E/N1/TW/TE, sixteen charging stalls would have kept
--     a footprint the renderer no longer draws.
--   * 86 rows (DCFC, S, W, the bays, the L2 east columns) are already correct and
--     are NOT rewritten — the UPDATE is guarded by IS DISTINCT FROM.
--
-- DEPOT SCOPE — 11111111-1111-1111-1111-111111111111 ONLY.
--   Both depots carry the same 160-stall layout. 22222222-2222-2222-2222-222222222222
--   is the CRN A/B benchmark: every row in ottoq_sim_runs points at ...1111, the
--   renderer hardcodes ...1111 (src/lib/ottoTwin.ts NASHVILLE_DEPOT), and ...2222
--   still holds four occupied stalls from A/B work whose results were measured
--   against a 160-stall depot. Changing its capacity would silently re-baseline
--   those comparisons, so it is left alone and reported instead.
--
-- REFERENCING ROWS — found by walking all 17 foreign keys into public.stalls:
--   vehicle_state_log     56 rows (52 B013 + 4 I013), FK ON DELETE NO ACTION.
--                         stall_id is NULLABLE and these are VEHICLE history, not
--                         stall history, so the audit row is KEPT: the pointer is
--                         nulled and the retired code is written into metadata.
--                         Deleting them would have been the easy way and it would
--                         have destroyed 56 telemetry records.
--   ottoq_stall_bookings   1 row (B013, purpose temp_hold, state released,
--                         release_reason run_stopped), FK ON DELETE CASCADE.
--                         Archived below, then allowed to cascade.
--   The other 15 FKs hold zero rows for these two stalls.
--
-- ROLLBACK. Everything mutated is snapshotted first into
-- ottoq_layout_backup_0011_* (CREATE TABLE IF NOT EXISTS, so a re-run preserves the
-- ORIGINAL pre-migration state rather than overwriting it with the post state).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SNAPSHOT BEFORE ANYTHING CHANGES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ottoq_layout_backup_0011_stalls AS
  SELECT * FROM public.stalls WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid;

CREATE TABLE IF NOT EXISTS public.ottoq_layout_backup_0011_vehicle_state_log AS
  SELECT l.* FROM public.vehicle_state_log l
   WHERE l.stall_id IN (SELECT id FROM public.stalls
                         WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid
                           AND stall_code IN ('NASH-STG-B013', 'NASH-STG-I013'));

CREATE TABLE IF NOT EXISTS public.ottoq_layout_backup_0011_stall_bookings AS
  SELECT b.* FROM public.ottoq_stall_bookings b
   WHERE b.stall_id IN (SELECT id FROM public.stalls
                         WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid
                           AND stall_code IN ('NASH-STG-B013', 'NASH-STG-I013'));

-- A backup table is still a table. public.ottoq_layout_backup_0010_stalls — the
-- snapshot the LAST layout migration left behind — carries
-- 'anon=arwdDxtm', i.e. the anonymous web role can INSERT, UPDATE and DELETE a full
-- copy of the depot. That is the same shape as the RLS hole this project has already
-- had to close once. These three do not repeat it: RLS on, no policy, and the two
-- browser roles revoked, so only postgres/service_role can read them.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ottoq_layout_backup_0011_stalls',
                           'ottoq_layout_backup_0011_vehicle_state_log',
                           'ottoq_layout_backup_0011_stall_bookings'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. REFUSE TO RUN ON A LIVE WORLD
--    Stall geometry is read by an in-flight tick. Moving a column under a running
--    run would teleport parked cars. FAIL LOUDLY rather than half-apply.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_running int;
BEGIN
  SELECT count(*) INTO v_running
    FROM public.ottoq_sim_runs
   WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid AND status = 'running';
  IF v_running > 0 THEN
    RAISE EXCEPTION 'refusing to replan the depot: % sim run(s) are RUNNING on depot %',
      v_running, '11111111-1111-1111-1111-111111111111';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. THE TARGET LAYOUT, LIFTED VERBATIM FROM unreal/layoutSeed.sql
--    All 158 surviving codes, so the assertions at the bottom can be absolute
--    ("the DB equals the seed") rather than a delta nobody can re-check.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE ottoq_lockin_0011 (
  stall_code       text PRIMARY KEY,
  relative_x       numeric  NOT NULL,
  relative_y       numeric  NOT NULL,
  heading_degrees  smallint NOT NULL,
  stall_width_ft   numeric  NOT NULL,
  stall_depth_ft   numeric  NOT NULL,
  absolute_lat     numeric  NOT NULL,
  absolute_lng     numeric  NOT NULL
);

INSERT INTO ottoq_lockin_0011
  (stall_code, relative_x, relative_y, heading_degrees, stall_width_ft, stall_depth_ft,
   absolute_lat, absolute_lng)
VALUES
    ('NASH-DCFC-STALL-01', 141.2894, 185.2461, 180, 10.0000, 20.0000, 36.14020892, -86.77231936),
    ('NASH-DCFC-STALL-02', 141.2894, 160.1280, 180, 10.0000, 20.0000, 36.14013991, -86.77231936),
    ('NASH-DCFC-STALL-03', 141.2894, 135.0098, 180, 10.0000, 20.0000, 36.14007091, -86.77231936),
    ('NASH-DCFC-STALL-04', 141.2894, 109.8917, 180, 10.0000, 20.0000, 36.14000190, -86.77231936),
    ('NASH-DCFC-STALL-05', 141.2894, 84.7736, 180, 10.0000, 20.0000, 36.13993289, -86.77231936),
    ('NASH-DCFC-STALL-06', 163.2677, 185.2461, 180, 10.0000, 20.0000, 36.14020892, -86.77224459),
    ('NASH-DCFC-STALL-07', 163.2677, 160.1280, 180, 10.0000, 20.0000, 36.14013991, -86.77224459),
    ('NASH-DCFC-STALL-08', 163.2677, 135.0098, 180, 10.0000, 20.0000, 36.14007091, -86.77224459),
    ('NASH-DCFC-STALL-09', 163.2677, 109.8917, 180, 10.0000, 20.0000, 36.14000190, -86.77224459),
    ('NASH-DCFC-STALL-10', 163.2677, 84.7736, 180, 10.0000, 20.0000, 36.13993289, -86.77224459),
    ('NASH-L2-STALL-01', 215.0738, 188.5428, 180, 10.0000, 16.1407, 36.14021797, -86.77206836),
    ('NASH-L2-STALL-02', 215.0738, 171.9021, 180, 10.0000, 16.1407, 36.14017226, -86.77206836),
    ('NASH-L2-STALL-03', 215.0738, 155.2613, 180, 10.0000, 16.1407, 36.14012654, -86.77206836),
    ('NASH-L2-STALL-04', 215.0738, 138.6206, 180, 10.0000, 16.1407, 36.14008083, -86.77206836),
    ('NASH-L2-STALL-05', 215.0738, 121.9798, 180, 10.0000, 16.1407, 36.14003511, -86.77206836),
    ('NASH-L2-STALL-06', 215.0738, 105.3391, 180, 10.0000, 16.1407, 36.13998939, -86.77206836),
    ('NASH-L2-STALL-07', 215.0738, 88.6983, 180, 10.0000, 16.1407, 36.13994368, -86.77206836),
    ('NASH-L2-STALL-08', 215.0738, 72.0576, 180, 10.0000, 16.1407, 36.13989796, -86.77206836),
    ('NASH-L2-STALL-09', 237.0522, 180.5364, 180, 10.0000, 16.7687, 36.14019598, -86.77199359),
    ('NASH-L2-STALL-10', 237.0522, 163.2677, 180, 10.0000, 16.7687, 36.14014854, -86.77199359),
    ('NASH-L2-STALL-11', 237.0522, 145.9990, 180, 10.0000, 16.7687, 36.14010110, -86.77199359),
    ('NASH-L2-STALL-12', 237.0522, 128.7303, 180, 10.0000, 16.7687, 36.14005365, -86.77199359),
    ('NASH-L2-STALL-13', 237.0522, 111.4616, 180, 10.0000, 16.7687, 36.14000621, -86.77199359),
    ('NASH-L2-STALL-14', 237.0522, 94.1929, 180, 10.0000, 16.7687, 36.13995877, -86.77199359),
    ('NASH-L2-STALL-15', 237.0522, 76.9242, 180, 10.0000, 16.7687, 36.13991133, -86.77199359),
    ('NASH-L2-STALL-16', 288.8583, 188.5428, 180, 10.0000, 16.1407, 36.14021797, -86.77181735),
    ('NASH-L2-STALL-17', 288.8583, 171.9021, 180, 10.0000, 16.1407, 36.14017226, -86.77181735),
    ('NASH-L2-STALL-18', 288.8583, 155.2613, 180, 10.0000, 16.1407, 36.14012654, -86.77181735),
    ('NASH-L2-STALL-19', 288.8583, 138.6206, 180, 10.0000, 16.1407, 36.14008083, -86.77181735),
    ('NASH-L2-STALL-20', 288.8583, 121.9798, 180, 10.0000, 16.1407, 36.14003511, -86.77181735),
    ('NASH-L2-STALL-26', 288.8583, 105.3391, 180, 10.0000, 16.1407, 36.13998939, -86.77181735),
    ('NASH-L2-STALL-27', 288.8583, 88.6983, 180, 10.0000, 16.1407, 36.13994368, -86.77181735),
    ('NASH-L2-STALL-28', 288.8583, 72.0576, 180, 10.0000, 16.1407, 36.13989796, -86.77181735),
    ('NASH-L2-STALL-29', 310.8366, 180.5364, 180, 10.0000, 16.7687, 36.14019598, -86.77174259),
    ('NASH-L2-STALL-30', 310.8366, 163.2677, 180, 10.0000, 16.7687, 36.14014854, -86.77174259),
    ('NASH-L2-STALL-31', 310.8366, 145.9990, 180, 10.0000, 16.7687, 36.14010110, -86.77174259),
    ('NASH-L2-STALL-32', 310.8366, 128.7303, 180, 10.0000, 16.7687, 36.14005365, -86.77174259),
    ('NASH-L2-STALL-33', 310.8366, 111.4616, 180, 10.0000, 16.7687, 36.14000621, -86.77174259),
    ('NASH-L2-STALL-34', 310.8366, 94.1929, 180, 10.0000, 16.7687, 36.13995877, -86.77174259),
    ('NASH-L2-STALL-35', 310.8366, 76.9242, 180, 10.0000, 16.7687, 36.13991133, -86.77174259),
    ('NASH-STG-B001', 357.1481, 188.1503, 270, 10.0000, 18.0000, 36.14021690, -86.77158504),
    ('NASH-STG-B002', 357.1481, 177.6321, 270, 10.0000, 18.0000, 36.14018800, -86.77158504),
    ('NASH-STG-B003', 357.1481, 167.1139, 270, 10.0000, 18.0000, 36.14015910, -86.77158504),
    ('NASH-STG-B004', 357.1481, 156.5957, 270, 10.0000, 18.0000, 36.14013021, -86.77158504),
    ('NASH-STG-B005', 357.1481, 146.0775, 270, 10.0000, 18.0000, 36.14010131, -86.77158504),
    ('NASH-STG-B006', 357.1481, 135.5593, 270, 10.0000, 18.0000, 36.14007242, -86.77158504),
    ('NASH-STG-B007', 357.1481, 125.0411, 270, 10.0000, 18.0000, 36.14004352, -86.77158504),
    ('NASH-STG-B008', 357.1481, 114.5229, 270, 10.0000, 18.0000, 36.14001462, -86.77158504),
    ('NASH-STG-B009', 357.1481, 104.0047, 270, 10.0000, 18.0000, 36.13998573, -86.77158504),
    ('NASH-STG-B010', 357.1481, 93.4865, 270, 10.0000, 18.0000, 36.13995683, -86.77158504),
    ('NASH-STG-B011', 357.1481, 82.9683, 270, 10.0000, 18.0000, 36.13992793, -86.77158504),
    ('NASH-STG-B012', 357.1481, 72.4500, 270, 10.0000, 18.0000, 36.13989904, -86.77158504),
    ('NASH-STG-E001', 441.9218, 251.1811, 90, 8.4483, 18.0000, 36.14039006, -86.77129666),
    ('NASH-STG-E002', 441.9218, 242.2328, 90, 8.4483, 18.0000, 36.14036547, -86.77129666),
    ('NASH-STG-E003', 441.9218, 233.2844, 90, 8.4483, 18.0000, 36.14034089, -86.77129666),
    ('NASH-STG-E004', 441.9218, 224.3361, 90, 8.4483, 18.0000, 36.14031631, -86.77129666),
    ('NASH-STG-E005', 441.9218, 215.3878, 90, 8.4483, 18.0000, 36.14029172, -86.77129666),
    ('NASH-STG-E006', 441.9218, 206.4395, 90, 8.4483, 18.0000, 36.14026714, -86.77129666),
    ('NASH-STG-E007', 441.9218, 197.4911, 90, 8.4483, 18.0000, 36.14024256, -86.77129666),
    ('NASH-STG-E008', 441.9218, 188.5428, 90, 8.4483, 18.0000, 36.14021797, -86.77129666),
    ('NASH-STG-E009', 441.9218, 179.5945, 90, 8.4483, 18.0000, 36.14019339, -86.77129666),
    ('NASH-STG-E010', 441.9218, 170.6462, 90, 8.4483, 18.0000, 36.14016881, -86.77129666),
    ('NASH-STG-E011', 441.9218, 161.6978, 90, 8.4483, 18.0000, 36.14014422, -86.77129666),
    ('NASH-STG-E012', 441.9218, 152.7495, 90, 8.4483, 18.0000, 36.14011964, -86.77129666),
    ('NASH-STG-E013', 441.9218, 143.8012, 90, 8.4483, 18.0000, 36.14009506, -86.77129666),
    ('NASH-STG-E014', 441.9218, 134.8529, 90, 8.4483, 18.0000, 36.14007047, -86.77129666),
    ('NASH-STG-E015', 441.9218, 125.9045, 90, 8.4483, 18.0000, 36.14004589, -86.77129666),
    ('NASH-STG-E016', 441.9218, 116.9562, 90, 8.4483, 18.0000, 36.14002131, -86.77129666),
    ('NASH-STG-E017', 441.9218, 108.0079, 90, 8.4483, 18.0000, 36.13999672, -86.77129666),
    ('NASH-STG-E018', 441.9218, 99.0595, 90, 8.4483, 18.0000, 36.13997214, -86.77129666),
    ('NASH-STG-E019', 441.9218, 90.1112, 90, 8.4483, 18.0000, 36.13994756, -86.77129666),
    ('NASH-STG-E020', 441.9218, 81.1629, 90, 8.4483, 18.0000, 36.13992297, -86.77129666),
    ('NASH-STG-E021', 441.9218, 72.2146, 90, 8.4483, 18.0000, 36.13989839, -86.77129666),
    ('NASH-STG-E022', 441.9218, 63.2662, 90, 8.4483, 18.0000, 36.13987381, -86.77129666),
    ('NASH-STG-E023', 441.9218, 54.3179, 90, 8.4483, 18.0000, 36.13984923, -86.77129666),
    ('NASH-STG-E024', 441.9218, 45.3696, 90, 8.4483, 18.0000, 36.13982464, -86.77129666),
    ('NASH-STG-E025', 441.9218, 36.4213, 90, 8.4483, 18.0000, 36.13980006, -86.77129666),
    ('NASH-STG-I001', 399.5349, 188.1503, 90, 10.0000, 18.0000, 36.14021690, -86.77144085),
    ('NASH-STG-I002', 399.5349, 177.6321, 90, 10.0000, 18.0000, 36.14018800, -86.77144085),
    ('NASH-STG-I003', 399.5349, 167.1139, 90, 10.0000, 18.0000, 36.14015910, -86.77144085),
    ('NASH-STG-I004', 399.5349, 156.5957, 90, 10.0000, 18.0000, 36.14013021, -86.77144085),
    ('NASH-STG-I005', 399.5349, 146.0775, 90, 10.0000, 18.0000, 36.14010131, -86.77144085),
    ('NASH-STG-I006', 399.5349, 135.5593, 90, 10.0000, 18.0000, 36.14007242, -86.77144085),
    ('NASH-STG-I007', 399.5349, 125.0411, 90, 10.0000, 18.0000, 36.14004352, -86.77144085),
    ('NASH-STG-I008', 399.5349, 114.5229, 90, 10.0000, 18.0000, 36.14001462, -86.77144085),
    ('NASH-STG-I009', 399.5349, 104.0047, 90, 10.0000, 18.0000, 36.13998573, -86.77144085),
    ('NASH-STG-I010', 399.5349, 93.4865, 90, 10.0000, 18.0000, 36.13995683, -86.77144085),
    ('NASH-STG-I011', 399.5349, 82.9683, 90, 10.0000, 18.0000, 36.13992793, -86.77144085),
    ('NASH-STG-I012', 399.5349, 72.4500, 90, 10.0000, 18.0000, 36.13989904, -86.77144085),
    ('NASH-STG-N001', 343.8041, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77163044),
    ('NASH-STG-N002', 353.2234, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77159839),
    ('NASH-STG-N003', 362.6427, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77156635),
    ('NASH-STG-N004', 372.0620, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77153431),
    ('NASH-STG-N005', 381.4813, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77150227),
    ('NASH-STG-N006', 390.9006, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77147022),
    ('NASH-STG-N007', 400.3199, 266.8799, 0, 8.9193, 18.0000, 36.14043319, -86.77143818),
    ('NASH-STG-S001', 28.2579, 14.1289, 0, 9.0824, 18.0000, 36.13973882, -86.77270387),
    ('NASH-STG-S002', 38.3051, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77266969),
    ('NASH-STG-S003', 48.3524, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77263551),
    ('NASH-STG-S004', 58.3996, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77260133),
    ('NASH-STG-S005', 68.4469, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77256716),
    ('NASH-STG-S006', 78.4941, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77253298),
    ('NASH-STG-S007', 88.5413, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77249880),
    ('NASH-STG-S008', 98.5886, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77246462),
    ('NASH-STG-S009', 108.6358, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77243044),
    ('NASH-STG-S010', 118.6831, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77239626),
    ('NASH-STG-S011', 128.7303, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77236208),
    ('NASH-STG-S012', 166.4075, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77223391),
    ('NASH-STG-S013', 177.2397, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77219706),
    ('NASH-STG-S014', 188.0719, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77216021),
    ('NASH-STG-S015', 198.9040, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77212336),
    ('NASH-STG-S016', 209.7362, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77208651),
    ('NASH-STG-S017', 220.5684, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77204966),
    ('NASH-STG-S018', 231.4006, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77201282),
    ('NASH-STG-S019', 242.2328, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77197597),
    ('NASH-STG-S020', 253.0650, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77193912),
    ('NASH-STG-S021', 263.8971, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77190227),
    ('NASH-STG-S022', 274.7293, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77186542),
    ('NASH-STG-S023', 285.5615, 14.1289, 0, 10.0000, 18.0000, 36.13973882, -86.77182857),
    ('NASH-STG-S024', 323.3957, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77169986),
    ('NASH-STG-S025', 333.4429, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77166568),
    ('NASH-STG-S026', 343.4902, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77163151),
    ('NASH-STG-S027', 353.5374, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77159733),
    ('NASH-STG-S028', 363.5846, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77156315),
    ('NASH-STG-S029', 373.6319, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77152897),
    ('NASH-STG-S030', 383.6791, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77149479),
    ('NASH-STG-S031', 393.7264, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77146061),
    ('NASH-STG-S032', 403.7736, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77142643),
    ('NASH-STG-S033', 413.8209, 14.1289, 0, 9.5472, 18.0000, 36.13973882, -86.77139225),
    ('NASH-STG-W001', 14.9139, 232.3425, 90, 8.4483, 18.0000, 36.14033830, -86.77274927),
    ('NASH-STG-W002', 14.9139, 223.3942, 90, 8.4483, 18.0000, 36.14031372, -86.77274927),
    ('NASH-STG-W003', 14.9139, 214.4459, 90, 8.4483, 18.0000, 36.14028914, -86.77274927),
    ('NASH-STG-W004', 14.9139, 205.4975, 90, 8.4483, 18.0000, 36.14026455, -86.77274927),
    ('NASH-STG-W005', 14.9139, 196.5492, 90, 8.4483, 18.0000, 36.14023997, -86.77274927),
    ('NASH-STG-W006', 14.9139, 187.6009, 90, 8.4483, 18.0000, 36.14021539, -86.77274927),
    ('NASH-STG-W007', 14.9139, 178.6526, 90, 8.4483, 18.0000, 36.14019080, -86.77274927),
    ('NASH-STG-W008', 14.9139, 169.7042, 90, 8.4483, 18.0000, 36.14016622, -86.77274927),
    ('NASH-STG-W009', 14.9139, 160.7559, 90, 8.4483, 18.0000, 36.14014164, -86.77274927),
    ('NASH-STG-W010', 14.9139, 151.8076, 90, 8.4483, 18.0000, 36.14011705, -86.77274927),
    ('NASH-STG-W011', 14.9139, 142.8593, 90, 8.4483, 18.0000, 36.14009247, -86.77274927),
    ('NASH-STG-W012', 14.9139, 133.9109, 90, 8.4483, 18.0000, 36.14006789, -86.77274927),
    ('NASH-STG-W013', 14.9139, 124.9626, 90, 8.4483, 18.0000, 36.14004330, -86.77274927),
    ('NASH-STG-W014', 14.9139, 116.0143, 90, 8.4483, 18.0000, 36.14001872, -86.77274927),
    ('NASH-STG-W015', 14.9139, 107.0659, 90, 8.4483, 18.0000, 36.13999414, -86.77274927),
    ('NASH-STG-W016', 14.9139, 98.1176, 90, 8.4483, 18.0000, 36.13996955, -86.77274927),
    ('NASH-STG-W017', 14.9139, 89.1693, 90, 8.4483, 18.0000, 36.13994497, -86.77274927),
    ('NASH-STG-W018', 14.9139, 80.2210, 90, 8.4483, 18.0000, 36.13992039, -86.77274927),
    ('NASH-STG-W019', 14.9139, 71.2726, 90, 8.4483, 18.0000, 36.13989580, -86.77274927),
    ('NASH-STG-W020', 14.9139, 62.3243, 90, 8.4483, 18.0000, 36.13987122, -86.77274927),
    ('NASH-STG-W021', 14.9139, 53.3760, 90, 8.4483, 18.0000, 36.13984664, -86.77274927),
    ('NASH-STG-W022', 14.9139, 44.4277, 90, 8.4483, 18.0000, 36.13982205, -86.77274927),
    ('NASH-STG-W023', 14.9139, 35.4793, 90, 8.4483, 18.0000, 36.13979747, -86.77274927),
    ('NASH-STG-W024', 14.9139, 26.5310, 90, 8.4483, 17.5352, 36.13977289, -86.77274927),
    ('NASH-SVC-01', 178.9665, 259.0305, 0, 14.0000, 30.0000, 36.14041162, -86.77219119),
    ('NASH-SVC-02', 207.2244, 259.0305, 0, 14.0000, 30.0000, 36.14041162, -86.77209506),
    ('NASH-WSH-01', 254.3209, 259.0305, 0, 14.0000, 35.0000, 36.14041162, -86.77193484),
    ('NASH-WSH-02', 282.5787, 259.0305, 0, 14.0000, 35.0000, 36.14041162, -86.77183872),
    ('NASH-WSH-03', 310.8366, 259.0305, 0, 14.0000, 35.0000, 36.14041162, -86.77174259);

DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM ottoq_lockin_0011;
  IF v_n <> 158 THEN
    RAISE EXCEPTION 'seed table carries % rows, expected 158', v_n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. HANDLE THE REFERENCING ROWS EXPLICITLY, BEFORE THE DELETE
-- ---------------------------------------------------------------------------
-- vehicle_state_log: keep the history, drop the pointer, record what it pointed at.
UPDATE public.vehicle_state_log l
   SET stall_id = NULL,
       metadata = COALESCE(l.metadata, '{}'::jsonb) || jsonb_build_object(
         'retired_stall_code', s.stall_code,
         'retired_by', 'the_depot_is_158_stalls_in_both_worlds',
         'retired_reason', 'stall footprint stood in the south collector; removed with the 24 ft replan')
  FROM public.stalls s
 WHERE l.stall_id = s.id
   AND s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid
   AND s.stall_code IN ('NASH-STG-B013', 'NASH-STG-I013');

-- ---------------------------------------------------------------------------
-- 5. DELETE THE TWO STALLS THAT STOOD IN THE ROAD
--    ottoq_stall_bookings cascades (archived in step 1). Every other FK is empty
--    for these ids; if that ever stops being true the FK raises here rather than
--    letting the layout drift on silently.
-- ---------------------------------------------------------------------------
DELETE FROM public.stalls
 WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid
   AND stall_code IN ('NASH-STG-B013', 'NASH-STG-I013');

-- ---------------------------------------------------------------------------
-- 6. MOVE THE COLUMNS THE REPLAN MOVED
--    IS DISTINCT FROM: a row already at its target is not rewritten, so this does
--    not churn 86 correct rows or fire their state-change events.
--    absolute_point is a plain geography column (not generated) and is rebuilt from
--    the same lat/lng, or it would silently keep the old position.
-- ---------------------------------------------------------------------------
UPDATE public.stalls s
   SET relative_x      = t.relative_x,
       relative_y      = t.relative_y,
       heading_degrees = t.heading_degrees,
       stall_width_ft  = t.stall_width_ft,
       stall_depth_ft  = t.stall_depth_ft,
       absolute_lat    = t.absolute_lat,
       absolute_lng    = t.absolute_lng,
       absolute_point  = ST_SetSRID(ST_MakePoint(t.absolute_lng::float8, t.absolute_lat::float8), 4326)::geography
  FROM ottoq_lockin_0011 t
 WHERE s.stall_code = t.stall_code
   AND s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid
   AND ( s.relative_x::numeric      IS DISTINCT FROM t.relative_x
      OR s.relative_y::numeric      IS DISTINCT FROM t.relative_y
      OR s.heading_degrees          IS DISTINCT FROM t.heading_degrees
      OR s.stall_width_ft           IS DISTINCT FROM t.stall_width_ft
      OR s.stall_depth_ft           IS DISTINCT FROM t.stall_depth_ft
      OR s.absolute_lat::numeric    IS DISTINCT FROM t.absolute_lat
      OR s.absolute_lng::numeric    IS DISTINCT FROM t.absolute_lng );

-- ---------------------------------------------------------------------------
-- 7. ASSERT. A migration that cannot prove its own result is a hope, not a change.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total     int;
  v_extra     text;
  v_missing   text;
  v_offgeom   text;
  v_offpoint  int;
  v_leftover  int;
BEGIN
  SELECT count(*) INTO v_total FROM public.stalls WHERE depot_id = '11111111-1111-1111-1111-111111111111'::uuid;
  IF v_total <> 158 THEN
    RAISE EXCEPTION 'depot % has % stalls, expected 158', '11111111-1111-1111-1111-111111111111', v_total;
  END IF;

  -- the code SET must be exactly the seed's: no extras, none missing
  SELECT string_agg(s.stall_code, ', ' ORDER BY s.stall_code) INTO v_extra
    FROM public.stalls s
   WHERE s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid
     AND NOT EXISTS (SELECT 1 FROM ottoq_lockin_0011 t WHERE t.stall_code = s.stall_code);
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'stall codes in the DB that the seed does not declare: %', v_extra;
  END IF;

  SELECT string_agg(t.stall_code, ', ' ORDER BY t.stall_code) INTO v_missing
    FROM ottoq_lockin_0011 t
   WHERE NOT EXISTS (SELECT 1 FROM public.stalls s
                      WHERE s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid AND s.stall_code = t.stall_code);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'stall codes the seed declares that the DB is missing: %', v_missing;
  END IF;

  -- and every surviving row must sit exactly where the seed puts it
  SELECT string_agg(s.stall_code, ', ' ORDER BY s.stall_code) INTO v_offgeom
    FROM public.stalls s JOIN ottoq_lockin_0011 t ON t.stall_code = s.stall_code
   WHERE s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid
     AND ( s.relative_x::numeric   IS DISTINCT FROM t.relative_x
        OR s.relative_y::numeric   IS DISTINCT FROM t.relative_y
        OR s.heading_degrees       IS DISTINCT FROM t.heading_degrees
        OR s.stall_width_ft        IS DISTINCT FROM t.stall_width_ft
        OR s.stall_depth_ft        IS DISTINCT FROM t.stall_depth_ft
        OR s.absolute_lat::numeric IS DISTINCT FROM t.absolute_lat
        OR s.absolute_lng::numeric IS DISTINCT FROM t.absolute_lng );
  IF v_offgeom IS NOT NULL THEN
    RAISE EXCEPTION 'stalls not at their seed coordinates: %', v_offgeom;
  END IF;

  -- absolute_point must agree with the lat/lng it is supposed to mirror
  SELECT count(*) INTO v_offpoint
    FROM public.stalls s
   WHERE s.depot_id = '11111111-1111-1111-1111-111111111111'::uuid
     AND ( s.absolute_point IS NULL
        OR s.absolute_point <> ST_SetSRID(ST_MakePoint(s.absolute_lng, s.absolute_lat), 4326)::geography );
  IF v_offpoint > 0 THEN
    RAISE EXCEPTION '% stall(s) carry an absolute_point that disagrees with absolute_lat/lng', v_offpoint;
  END IF;

  -- nothing may still point at a deleted stall.
  -- jsonb_exists(), not the ? operator: some clients read ? as a bind placeholder.
  SELECT count(*) INTO v_leftover
    FROM public.vehicle_state_log l
   WHERE jsonb_exists(l.metadata, 'retired_stall_code') AND l.stall_id IS NOT NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION '% vehicle_state_log row(s) still point at a retired stall', v_leftover;
  END IF;

  RAISE NOTICE 'depot % locked to the 158-stall replan', '11111111-1111-1111-1111-111111111111';
END $$;

DROP TABLE ottoq_lockin_0011;

