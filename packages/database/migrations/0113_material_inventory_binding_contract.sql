-- #193 / fatia 2B: contrato persistido, fail-closed, entre realizado MATERIAL_QUANTITY e Inventory.
-- Apenas a associacao explicita e auditavel. NAO movimenta estoque, nao calcula custo,
-- nao concede autorizacao PDP e nao cria contabilizacao. Esses comandos pertencem
-- as fatias posteriores, via portas publicas e gates empresariais.
--
-- A FK composta do actual congela o snapshot de quantidade/unidade/instante/kind:
-- um realizado vinculado nao pode ser alterado silenciosamente. A API devera
-- rejeitar escala superior a 4 casas ANTES do cast numeric(18,4), que arredonda.
CREATE UNIQUE INDEX IF NOT EXISTS "execution_actuals_material_binding_ref_uidx"
  ON "so"."execution_actuals"
  ("id", "service_order_id", "actual_kind", "actual_value", "unit_of_measure", "occurred_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_orders_material_binding_unit_ref_uidx"
  ON "so"."service_orders" ("id", "unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_material_binding_unit_ref_uidx"
  ON "inv"."inventory_items" ("id", "unit_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_material_binding_unit_ref_uidx"
  ON "inv"."warehouses" ("id", "unit_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "so"."material_inventory_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "actual_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "actual_kind" "so"."execution_actual_kind" NOT NULL,
  "quantity" numeric(18,4) NOT NULL,
  "unit_of_measure" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" uuid NOT NULL,
  "authorized_by_identity_id" uuid NOT NULL,
  "authorized_at" timestamp with time zone NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "material_inventory_bindings_kind_chk"
    CHECK ("actual_kind" = 'MATERIAL_QUANTITY'::"so"."execution_actual_kind"),
  CONSTRAINT "material_inventory_bindings_quantity_chk"
    CHECK ("quantity" > 0),
  CONSTRAINT "material_inventory_bindings_unit_chk"
    CHECK (length(trim("unit_id")) > 0 AND length(trim("unit_of_measure")) > 0),
  CONSTRAINT "material_inventory_bindings_source_chk"
    CHECK ("source_kind" = 'SERVICE_ORDER_EXECUTION_ACTUAL' AND "source_id" = "actual_id"),
  CONSTRAINT "material_inventory_bindings_idempotency_chk"
    CHECK (length(trim("idempotency_key")) > 0)
);
--> statement-breakpoint

-- A mesma OS, o mesmo actual e o mesmo SKU/deposito devem pertencer a unidade
-- explicitamente declarada. Nenhuma inferencia por nome ou physical_asset_id.
ALTER TABLE "so"."material_inventory_bindings"
  ADD CONSTRAINT "material_inventory_bindings_order_unit_fk"
  FOREIGN KEY ("service_order_id", "unit_id")
  REFERENCES "so"."service_orders" ("id", "unit_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "so"."material_inventory_bindings"
  ADD CONSTRAINT "material_inventory_bindings_item_unit_fk"
  FOREIGN KEY ("inventory_item_id", "unit_id")
  REFERENCES "inv"."inventory_items" ("id", "unit_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "so"."material_inventory_bindings"
  ADD CONSTRAINT "material_inventory_bindings_warehouse_unit_fk"
  FOREIGN KEY ("warehouse_id", "unit_id")
  REFERENCES "inv"."warehouses" ("id", "unit_id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Snapshot exato do fato (incluindo kind, valor, unidade e timestamp).
-- Protege contra binding de outro actual, drift de valor e alteracao posterior.
ALTER TABLE "so"."material_inventory_bindings"
  ADD CONSTRAINT "material_inventory_bindings_actual_snapshot_fk"
  FOREIGN KEY ("actual_id", "service_order_id", "actual_kind", "quantity", "unit_of_measure", "occurred_at")
  REFERENCES "so"."execution_actuals"
    ("id", "service_order_id", "actual_kind", "actual_value", "unit_of_measure", "occurred_at")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
--> statement-breakpoint
ALTER TABLE "so"."material_inventory_bindings"
  ADD CONSTRAINT "material_inventory_bindings_authorizer_fk"
  FOREIGN KEY ("authorized_by_identity_id")
  REFERENCES "identity"."identities" ("id") ON DELETE RESTRICT;
--> statement-breakpoint

-- Uma associacao por fato; uma chave nao pode autorizar dois fatos.
CREATE UNIQUE INDEX IF NOT EXISTS "material_inventory_bindings_actual_uidx"
  ON "so"."material_inventory_bindings" ("actual_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "material_inventory_bindings_idempotency_uidx"
  ON "so"."material_inventory_bindings" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_inventory_bindings_order_idx"
  ON "so"."material_inventory_bindings" ("service_order_id", "authorized_at");
--> statement-breakpoint

COMMENT ON TABLE "so"."material_inventory_bindings" IS
'Contrato de associacao estrutural MATERIAL_QUANTITY -> Inventory. Nao representa autorizacao PDP efetiva, reserva, OUT, custo ou contabilizacao; essas etapas exigem comando de dominio e evidencias separadas.';
