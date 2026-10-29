-- 0109 — Operational units: organizational master owned by Party/Establishments.
-- Fiscal establishments and organizational units remain distinct types.
-- Authorization.scope_refs is a separate access anchor, NOT a parent of this
-- table: revoking/removing access cannot delete master business identity.
-- Legacy scope refs without identity metadata remain supported (unconfigured).
CREATE TABLE pty.operational_units (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  business_name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_units_id_chk CHECK (length(trim(id)) BETWEEN 2 AND 64),
  CONSTRAINT operational_units_code_chk CHECK (
    code = upper(trim(code)) AND code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
  ),
  CONSTRAINT operational_units_name_chk CHECK (length(trim(business_name)) BETWEEN 2 AND 200),
  CONSTRAINT operational_units_version_chk CHECK (version > 0)
);
--> statement-breakpoint
-- The command receipt commits with the business mutation. Replaying a key
-- returns exactly the first immutable outcome; a changed payload is rejected.
CREATE TABLE pty.operational_unit_commands (
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_identity_id, idempotency_key),
  CONSTRAINT operational_unit_commands_key_chk CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT operational_unit_commands_hash_chk CHECK (request_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- Append-only, transactional audit history. No cascade to scope refs or grants.
CREATE TABLE pty.operational_unit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id text NOT NULL REFERENCES pty.operational_units(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('CREATED', 'UPDATED')),
  actor_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  version integer NOT NULL CHECK (version > 0),
  before_value jsonb,
  after_value jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(unit_id, version)
);
--> statement-breakpoint
CREATE INDEX operational_unit_history_time_idx
  ON pty.operational_unit_history(unit_id, occurred_at DESC);
