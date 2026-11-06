-- MASTER 015 — HML read-only audit of actual Superset LOGIN.
-- psql -X -v ON_ERROR_STOP=1 -v reader_login=cisne_superset_login -f 04-verify-exact-dataset-scope.sql
\if :{?reader_login}
\else
  \echo 'BI gate: reader_login required'
  \quit 3
\endif
SELECT set_config('cisne.bi_reader_login', :'reader_login', false);
DO $gate$
DECLARE
  login_name text := current_setting('cisne.bi_reader_login', true);
  relation_record record;
  actual_count integer := 0;
  unexpected_columns text;
BEGIN
  IF login_name IS NULL OR login_name = '' OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = login_name AND rolcanlogin
  ) THEN
    RAISE EXCEPTION 'BI gate: valid LOGIN role required';
  END IF;
  FOR relation_record IN
    SELECT n.nspname AS schema_name, c.relname AS relation_name, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(login_name, c.oid, 'SELECT')
  LOOP
    IF relation_record.schema_name <> 'bi_superset'
      OR relation_record.relkind <> 'v'
      OR relation_record.relation_name NOT IN (
        'service_orders','physical_assets','contracts','measurements','receivables'
      ) THEN
      RAISE EXCEPTION 'BI gate: unexpected SELECT scope %.%',
        relation_record.schema_name, relation_record.relation_name;
    END IF;
    actual_count := actual_count + 1;
  END LOOP;
  IF actual_count <> 5 THEN
    RAISE EXCEPTION 'BI gate: expected five selectable views, found %', actual_count;
  END IF;
  SELECT string_agg(format('%I.%I', c.relname, a.attname), ', ')
    INTO unexpected_columns
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'bi_superset'
    AND c.relname IN (
      'service_orders','physical_assets','contracts','measurements','receivables'
    )
    AND a.attnum > 0 AND NOT a.attisdropped
    AND NOT (
      (c.relname = 'service_orders' AND a.attname IN (
        'id','unit_id','internal_code','status','origin','created_at','started_at','completed_at'))
      OR (c.relname = 'physical_assets' AND a.attname IN (
        'id','unit_id','asset_code','name','lifecycle_status','allocation_status','created_at'))
      OR (c.relname = 'contracts' AND a.attname IN (
        'id','unit_id','internal_code','status','valid_from','valid_to','currency_code','created_at'))
      OR (c.relname = 'measurements' AND a.attname IN (
        'id','service_order_id','unit_id','status','created_at','decided_at'))
      OR (c.relname = 'receivables' AND a.attname IN (
        'id','unit_id','currency_code','principal','lifecycle','due_date','created_at'))
    );
  IF unexpected_columns IS NOT NULL THEN
    RAISE EXCEPTION 'BI gate: unexpected analytic columns: %', unexpected_columns;
  END IF;
  RAISE NOTICE 'BI exact-scope gate passed: five views, no extra relations or columns';
END $gate$;
