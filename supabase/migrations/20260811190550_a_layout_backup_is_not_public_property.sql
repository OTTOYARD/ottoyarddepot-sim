-- ============================================================================
-- A LAYOUT BACKUP IS NOT PUBLIC PROPERTY
-- ============================================================================
-- Found while verifying the 158-stall lock-in. The snapshots left behind by the
-- LAST layout migration carry 'anon=arwdDxtm/postgres': the anonymous browser role
-- can SELECT, INSERT, UPDATE and DELETE a full copy of the depot —
--   ottoq_layout_backup_0010_stalls      300 rows
--   ottoq_layout_backup_0010_depots        2 rows
--   ottoq_layout_backup_0010_structures   12 rows
-- with RLS OFF and no policies. That is the same shape as the public-policy hole
-- this project has already had to close once across 31 tables.
--
-- These are inert snapshots: no function, view or trigger references them
-- (checked against pg_proc.prosrc), so revoking the browser roles cannot break a
-- reader. They are NOT dropped — they are the rollback path for migration
-- 'unify_depot_layout' — merely restricted to postgres/service_role, which is
-- exactly how the 0011 snapshots were created.
--
-- Enabling RLS with NO policy is deny-by-default for anon/authenticated while
-- leaving service_role (BYPASSRLS) able to restore from them.
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ottoq_layout_backup_0010_stalls',
                           'ottoq_layout_backup_0010_depots',
                           'ottoq_layout_backup_0010_structures'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN
      RAISE NOTICE 'skipping %: not present', t;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
