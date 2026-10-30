-- Individual, auditable SoD exceptions. The SOD catalog remains enforced by default.
CREATE TABLE IF NOT EXISTS "authorization".sod_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  rule_id text NOT NULL,
  requested_by_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  approved_by_identity_id uuid REFERENCES identity.identities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING',
  justification text NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  revoked_by_identity_id uuid REFERENCES identity.identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sod_exceptions_status_chk CHECK (status IN ('PENDING','APPROVED','REVOKED','REJECTED')),
  CONSTRAINT sod_exceptions_rule_id_chk CHECK (length(trim(rule_id)) > 0),
  CONSTRAINT sod_exceptions_justification_chk CHECK (length(trim(justification)) > 0),
  CONSTRAINT sod_exceptions_distinct_approver_chk CHECK (
    approved_by_identity_id IS NULL OR approved_by_identity_id <> requested_by_identity_id
  ),
  CONSTRAINT sod_exceptions_valid_until_chk CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT sod_exceptions_revoked_chk CHECK (
    revoked_at IS NULL OR status = 'REVOKED'
  )
);
CREATE INDEX IF NOT EXISTS sod_exceptions_identity_rule_active_idx
  ON "authorization".sod_exceptions(identity_id, rule_id)
  WHERE status = 'APPROVED' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sod_exceptions_approver_idx
  ON "authorization".sod_exceptions(approved_by_identity_id);
