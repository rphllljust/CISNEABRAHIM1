-- 0109: Operational UNIT master is independent of authorization scope_refs.
-- The fiscal establishment registry (pty.establishments) is not an operational
-- unit; scope_refs are authorization anchors, not the enterprise master.
-- No seed of invented business names, no cascade from grant/reference deletion.
CREATE TABLE plt.operational_units (
  ref_id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  business_name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  updated_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_units_ref_chk CHECK (length(trim(ref_id)) BETWEEN 2 AND 64),
  CONSTRAINT operational_units_code_chk CHECK (code = upper(trim(code)) AND length(code) BETWEEN 2 AND 64),
  CONSTRAINT operational_units_name_chk CHECK (length(trim(business_name)) BETWEEN 2 AND 200),
  CONSTRAINT operational_units_version_chk CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE plt.operational_unit_commands (
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_identity_id, idempotency_key),
  CONSTRAINT operational_unit_commands_key_chk CHECK (length(idempotency_key) BETWEEN 8 AND 128)
);
--> statement-breakpoint
CREATE TABLE plt.operational_unit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_ref_id text NOT NULL REFERENCES plt.operational_units(ref_id) ON DELETE RESTRICT,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED')),
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  idempotency_key text NOT NULL,
  old_code text,
  new_code text NOT NULL,
  old_name text,
  new_name text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_ref_id, version)
);
--> statement-breakpoint
CREATE INDEX operational_unit_history_time_idx ON plt.operational_unit_history (unit_ref_id, occurred_at DESC);
