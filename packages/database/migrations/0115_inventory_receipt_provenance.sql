-- #193 / 2F-a: Persist explicit source provenance BEFORE choosing a costing policy.
-- This is not a valuation or GL posting. A goods receipt line alone does not
-- prove which inventory SKU/warehouse was physically received.
-- No inference from description, quantity, price, or an asset identifier.
CREATE TABLE inv.receipt_inventory_provenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_line_id uuid NOT NULL REFERENCES prc.goods_receipt_lines(id) ON DELETE RESTRICT,
  inventory_item_id uuid NOT NULL REFERENCES inv.inventory_items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES inv.warehouses(id) ON DELETE RESTRICT,
  unit_id text NOT NULL,
  allocated_quantity numeric(18,4) NOT NULL,
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_inventory_provenance_unit_chk CHECK (length(trim(unit_id)) > 0),
  CONSTRAINT receipt_inventory_provenance_quantity_chk CHECK (allocated_quantity > 0),
  CONSTRAINT receipt_inventory_provenance_idempotency_chk CHECK (length(trim(idempotency_key)) > 0),
  CONSTRAINT receipt_inventory_provenance_receipt_item_warehouse_uidx
    UNIQUE (receipt_line_id, inventory_item_id, warehouse_id),
  CONSTRAINT receipt_inventory_provenance_idempotency_uidx UNIQUE (idempotency_key)
);
--> statement-breakpoint
CREATE INDEX receipt_inventory_provenance_inventory_idx
  ON inv.receipt_inventory_provenance (unit_id, inventory_item_id, warehouse_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION inv.forbid_receipt_inventory_provenance_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'INVENTORY_RECEIPT_PROVENANCE_IMMUTABLE'
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER receipt_inventory_provenance_immutable_trg
BEFORE UPDATE OR DELETE ON inv.receipt_inventory_provenance
FOR EACH ROW EXECUTE FUNCTION inv.forbid_receipt_inventory_provenance_mutation();
--> statement-breakpoint
COMMENT ON TABLE inv.receipt_inventory_provenance IS
'Explicit immutable purchase receipt line to stock item/warehouse evidence. NOT a stock IN, cost valuation, currency conversion, or accounting journal. Service must verify receipt quantities, ownership, unit, authorization, and allocation totals transactionally before insert. No automatic allocation.';

--> statement-breakpoint
-- Defensive invariants for the cross-owner reference. This table is NOT an
-- inventory receipt and must never create stock or economic events by itself.
CREATE INDEX receipt_inventory_provenance_receipt_line_idx
  ON inv.receipt_inventory_provenance (receipt_line_id);
--> statement-breakpoint
CREATE OR REPLACE VIEW rpt.read_receipt_inventory_provenance AS
SELECT id, receipt_line_id, inventory_item_id, warehouse_id, unit_id,
       allocated_quantity, actor_identity_id, idempotency_key, recorded_at
FROM inv.receipt_inventory_provenance OFFSET 0;
