-- MASTER 015 — additive, HML-only; run manually under change control.
-- No transactional table alteration, no destructive migration and no test data.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bi_superset;
CREATE OR REPLACE VIEW bi_superset.service_orders WITH (security_barrier = true) AS
SELECT id, unit_id, internal_code, status, origin, created_at, started_at, completed_at
FROM so.service_orders;
CREATE OR REPLACE VIEW bi_superset.physical_assets WITH (security_barrier = true) AS
SELECT id, unit_id, asset_code, name, lifecycle_status, allocation_status, created_at
FROM ast.physical_assets;
CREATE OR REPLACE VIEW bi_superset.contracts WITH (security_barrier = true) AS
SELECT id, unit_id, internal_code, status, valid_from, valid_to, currency_code, created_at
FROM com.contracts;
CREATE OR REPLACE VIEW bi_superset.measurements WITH (security_barrier = true) AS
SELECT id, service_order_id, unit_id, status, created_at, decided_at
FROM msr.measurements;
CREATE OR REPLACE VIEW bi_superset.receivables WITH (security_barrier = true) AS
SELECT id, unit_id, currency_code, principal, lifecycle, due_date, created_at
FROM fin.receivables;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cisne_superset_reader') THEN
    CREATE ROLE cisne_superset_reader NOLOGIN;
  END IF;
END $role$;
GRANT USAGE ON SCHEMA bi_superset TO cisne_superset_reader;
GRANT SELECT ON
  bi_superset.service_orders,
  bi_superset.physical_assets,
  bi_superset.contracts,
  bi_superset.measurements,
  bi_superset.receivables
TO cisne_superset_reader;
COMMIT;
-- HML DBA must provision a separate LOGIN role and GRANT this NOLOGIN role.
-- Reader must have no direct SELECT on OLTP schemas, generic rpt views, or other BI datasets.
