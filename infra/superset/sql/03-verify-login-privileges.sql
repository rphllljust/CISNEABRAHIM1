-- MASTER 015 — HML LOGIN role effective-privilege preflight.
-- Run with psql -X -v ON_ERROR_STOP=1 -v reader_login=cisne_superset_login
--          -f infra/superset/sql/03-verify-login-privileges.sql
-- Execute as a HML auditor. This is READ ONLY and does not validate guest RLS.
-- The DBA must create the actual LOGIN role separately. Never use production credentials here.
\if :{?reader_login}
\else
  \echo 'BI gate: supply -v reader_login=<existing Superset database LOGIN role>'
  \quit 3
\endif
SELECT set_config('cisne.bi_reader_login', :'reader_login', false);
DO $gate$
DECLARE
  login_name text := current_setting('cisne.bi_reader_login', true);
  r record;
  missing_view text;
BEGIN
  IF login_name IS NULL OR login_name = '' THEN
    RAISE EXCEPTION 'BI gate: reader role not configured';
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname = login_name;
  IF NOT FOUND OR NOT r.rolcanlogin THEN
    RAISE EXCEPTION 'BI gate: existing LOGIN role required';
  END IF;
  IF r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'BI gate: reader role has elevated PostgreSQL privileges';
  END IF;
  IF NOT pg_has_role(login_name, 'cisne_superset_reader', 'MEMBER') THEN
    RAISE EXCEPTION 'BI gate: LOGIN role must be a member of the NOLOGIN reader role';
  END IF;
  IF NOT has_schema_privilege(login_name, 'bi_superset', 'USAGE') THEN
    RAISE EXCEPTION 'BI gate: analytics schema USAGE missing';
  END IF;
  IF has_schema_privilege(login_name, 'bi_superset', 'CREATE') OR
     has_database_privilege(login_name, current_database(), 'CREATE') OR
     has_database_privilege(login_name, current_database(), 'TEMP') THEN
    RAISE EXCEPTION 'BI gate: reader must not have schema/database CREATE or TEMP privileges';
  END IF;
  FOREACH missing_view IN ARRAY ARRAY[
    'service_orders','physical_assets','contracts','measurements','receivables'
  ] LOOP
    IF NOT has_table_privilege(login_name, format('bi_superset.%I', missing_view), 'SELECT') THEN
      RAISE EXCEPTION 'BI gate: reader missing SELECT on %', missing_view;
    END IF;
  END LOOP;
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','bi_superset')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege(login_name, c.oid, 'SELECT')
  LOOP
    RAISE EXCEPTION 'BI gate: reader can SELECT outside BI: %.%', r.nspname, r.relname;
  END LOOP;
  RAISE NOTICE 'BI login preflight passed: effective read scope restricted to five views';
END $gate$;
