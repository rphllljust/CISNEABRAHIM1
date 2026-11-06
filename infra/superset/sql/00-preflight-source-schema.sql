-- MASTER 015 — HML source-schema preflight: READ ONLY, no DDL or mutations.
-- psql -X -v ON_ERROR_STOP=1 -f infra/superset/sql/00-preflight-source-schema.sql
-- Must pass BEFORE applying existing sql/01-read-views.sql.
DO $preflight$
DECLARE
  relation RECORD;
  column_name TEXT;
  missing_columns TEXT;
BEGIN
  FOR relation IN
    SELECT * FROM (VALUES
      ('so','service_orders',ARRAY['id','unit_id','internal_code','status','origin','created_at','started_at','completed_at']::text[]),
      ('ast','physical_assets',ARRAY['id','unit_id','asset_code','name','lifecycle_status','allocation_status','created_at']::text[]),
      ('com','contracts',ARRAY['id','unit_id','internal_code','status','valid_from','valid_to','currency_code','created_at']::text[]),
      ('msr','measurements',ARRAY['id','service_order_id','unit_id','status','created_at','decided_at']::text[]),
      ('fin','receivables',ARRAY['id','unit_id','currency_code','principal','lifecycle','due_date','created_at']::text[])
    ) AS required(schema_name, table_name, column_names)
  LOOP
    IF to_regclass(format('%I.%I', relation.schema_name, relation.table_name)) IS NULL THEN
      RAISE EXCEPTION 'MASTER 015 HML: source relation missing: %.%', relation.schema_name, relation.table_name;
    END IF;
    missing_columns := NULL;
    FOREACH column_name IN ARRAY relation.column_names LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(format('%I.%I', relation.schema_name, relation.table_name))
          AND attname = column_name AND attnum > 0 AND NOT attisdropped
      ) THEN
        missing_columns := concat_ws(', ', missing_columns, column_name);
      END IF;
    END LOOP;
    IF missing_columns IS NOT NULL THEN
      RAISE EXCEPTION 'MASTER 015 HML: missing %.% columns: %', relation.schema_name, relation.table_name, missing_columns;
    END IF;
  END LOOP;
  RAISE NOTICE 'MASTER 015 HML: source schema exists for five projected views. NOT proof of RLS or datasets.';
END
$preflight$;
