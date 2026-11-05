-- LT-02 / OS-15: specialize the canonical OS list/count query without another
-- transport or rental table. Both use so.service_orders.service_snapshot->>'archetype'.
-- An expression index allows PostgreSQL to apply an authorized unit scope and
-- archetype before walking the newest records, including filtered page totals.
-- No source records are rewritten and no business statuses are invented.
CREATE INDEX IF NOT EXISTS service_orders_unit_archetype_created_idx
  ON so.service_orders (
    unit_id,
    ((service_snapshot ->> 'archetype')),
    created_at DESC,
    id DESC
  );
