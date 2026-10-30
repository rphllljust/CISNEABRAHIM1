-- SOD-007: persistent, independently approved and revocable access exception.
-- No pre-approved rows or production grants. Audit and transitions are transactional.
CREATE TABLE "authorization".sod_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id text NOT NULL DEFAULT 'SOD-007' CHECK (rule_id = 'SOD-007'),
  subject_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  scope_type "authorization".authz_scope_type NOT NULL,
  scope_anchor text,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 500),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REVOKED')),
  requested_by_identity_id uuid NOT NULL REFERENCES identity.identities(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by_identity_id uuid REFERENCES identity.identities(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  revoked_by_identity_id uuid REFERENCES identity.identities(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  CONSTRAINT sod_exception_scope_chk CHECK (
    (scope_type = 'GLOBAL' AND scope_anchor IS NULL)
    OR (scope_type IN ('UNIT','CLIENT','CONTRACT','DOCUMENT','FINANCIAL')
      AND scope_anchor IS NOT NULL AND length(trim(scope_anchor)) > 0)
  ),
  CONSTRAINT sod_exception_approval_chk CHECK (
    (status = 'PENDING' AND approved_by_identity_id IS NULL AND approved_at IS NULL
      AND revoked_at IS NULL AND revoked_by_identity_id IS NULL)
    OR (status = 'APPROVED' AND approved_by_identity_id IS NOT NULL AND approved_at IS NOT NULL
      AND revoked_at IS NULL AND revoked_by_identity_id IS NULL)
    OR (status = 'REVOKED' AND revoked_by_identity_id IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT sod_exception_distinct_approver_chk CHECK (
    approved_by_identity_id IS NULL OR (approved_by_identity_id <> requested_by_identity_id
       AND approved_by_identity_id <> subject_identity_id)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX sod_exceptions_one_open_per_scope_idx
  ON "authorization".sod_exceptions (subject_identity_id, rule_id, scope_type, COALESCE(scope_anchor, ''))
  WHERE status IN ('PENDING', 'APPROVED');
--> statement-breakpoint
CREATE INDEX sod_exceptions_status_idx ON "authorization".sod_exceptions (status, requested_at DESC);
--> statement-breakpoint
ALTER TABLE "authorization".access_role_assignments
  ADD COLUMN sod_exception_id uuid REFERENCES "authorization".sod_exceptions(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX access_role_assignments_sod_exception_idx
  ON "authorization".access_role_assignments (sod_exception_id)
  WHERE sod_exception_id IS NOT NULL;
