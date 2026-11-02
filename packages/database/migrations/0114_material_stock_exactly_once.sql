-- #193 / 2D-2E: Inventory owns the exactly-once movement invariant.
-- A bound OS actual can issue ONE physical OUT, regardless of which authorized
-- entrypoint or idempotency key is used. No inference or automatic debit.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movement_os_actual_out_once_uidx"
  ON "inv"."stock_movements" ("source_kind", "source_id")
  WHERE "source_kind" = 'SERVICE_ORDER_EXECUTION_ACTUAL'
    AND "movement_type" = 'OUT'::"inv"."stock_movement_type"
    AND "source_id" IS NOT NULL;
--> statement-breakpoint
-- Any posted movement may have only one compensating reversal. Preserve the
-- original source; never update or delete it as a substitute for compensation.
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movement_reversal_once_uidx"
  ON "inv"."stock_movements" ("reversal_of_movement_id")
  WHERE "reversal_of_movement_id" IS NOT NULL;
--> statement-breakpoint
COMMENT ON INDEX "inv"."stock_movement_os_actual_out_once_uidx" IS
'Exactly one inventory OUT per persisted authorized service order MATERIAL_QUANTITY actual';
--> statement-breakpoint
COMMENT ON INDEX "inv"."stock_movement_reversal_once_uidx" IS
'At most one compensating inventory movement per original stock movement';
