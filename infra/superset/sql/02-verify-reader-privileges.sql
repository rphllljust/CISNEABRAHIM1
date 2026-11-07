-- MASTER 015 — HML privilege preflight (read-only, psql -v ON_ERROR_STOP=1).
-- Execute as HML DBA after applying 01-read-views.sql, before registering datasets.
-- This checks the NOLOGIN group role, not the eventual LOGIN account or Superset guest role.
DO $$
DECLARE
  v_role oid;
  v_view text;
  v_count integer;
BEGIN
  SELECT oid INTO v_role FROM pg_roles WHERE rolname = 'cisne_superset_reader' AND NOT rolcanlogin;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'BI gate: cisne_superset_reader NOLOGIN role missing';
  END IF;

  FOREACH v_view IN ARRAY ARRAY[
    'service_orders', 'physical_assets', 'contracts', 'measurements', 'receivables'
  ] LOOP
    IF to_regclass(format('bi_superset.%I', v_view)) IS NULL THEN
      RAISE EXCEPTION 'BI gate: missing analytic view %', v_view;
    END IF;
    IF NOT has_table_privilege('cisne_superset_reader', format('bi_superset.%I', v_view), 'SELECT') THEN
      RAISE EXCEPTION 'BI gate: SELECT missing for view %', v_view;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = to_regclass(format('bi_superset.%I', v_view))
        AND attname = 'unit_id' AND NOT attisdropped
    ) THEN
      RAISE EXCEPTION 'BI gate: unit_id missing from %; guest RLS would be unsafe', v_view;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'bi_superset' AND c.relname = v_view
        AND c.relkind = 'v'
        AND COALESCE(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_barrier=true']
    ) THEN
      RAISE EXCEPTION 'BI gate: expected security-barrier view missing: %', v_view;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'bi_superset')
    AND n.nspname NOT LIKE 'pg_toast%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege('cisne_superset_reader', c.oid, 'SELECT');
  IF v_count > 0 THEN
    RAISE EXCEPTION 'BI gate: reader role has SELECT on % non-BI relations', v_count;
  END IF;
  RAISE NOTICE 'BI gate passed: five unit-scoped views, no direct non-BI SELECT for group role';
END $$;
