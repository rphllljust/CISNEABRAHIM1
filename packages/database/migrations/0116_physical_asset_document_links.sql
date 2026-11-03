-- E05/E06: authoritative GED ↔ physical asset (vehicle uses same asset_id).
-- This table belongs to GED. No parallel document store, asset master or vehicle master.
CREATE TABLE doc.physical_asset_document_links (
  physical_asset_id uuid NOT NULL REFERENCES ast.physical_assets(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES doc.documents(id) ON DELETE RESTRICT,
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT physical_asset_document_links_pkey PRIMARY KEY (physical_asset_id, document_id)
);
--> statement-breakpoint
CREATE INDEX physical_asset_document_links_document_idx
  ON doc.physical_asset_document_links (document_id, physical_asset_id);
--> statement-breakpoint
COMMENT ON TABLE doc.physical_asset_document_links IS
  'GED-owned link between an existing document and an existing physical asset/vehicle. HTTP mutations require authorized read + manage scope on BOTH business resources, matching operational unit. No duplicate file storage.';
