-- Unit master belongs to enterprise identity (pty), NOT to authorization.scope_refs.
-- Removing a grant or a technical scope reference must never erase the business unit.
CREATE TABLE pty.operational_units (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  business_name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_units_id_chk CHECK (length(trim(id)) BETWEEN 2 AND 100),
  CONSTRAINT operational_units_code_chk CHECK (
    code = upper(trim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
  ),
  CONSTRAINT operational_units_name_chk CHECK (length(trim(business_name)) BETWEEN 2 AND 200),
  CONSTRAINT operational_units_version_chk CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE pty.operational_unit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id text NOT NULL REFERENCES pty.operational_units(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('CREATED', 'UPDATED')),
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  before_value jsonb,
  after_value jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX operational_unit_history_unit_idx
  ON pty.operational_unit_history(unit_id, version);
--> statement-breakpoint
-- Atomic replay log. (actor, key) identifies exactly one semantic command.
CREATE TABLE pty.operational_unit_commands (
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_identity_id, idempotency_key),
  CONSTRAINT operational_unit_key_chk CHECK (length(trim(idempotency_key)) BETWEEN 8 AND 128)
);
