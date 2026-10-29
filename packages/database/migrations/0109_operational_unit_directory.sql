-- Business identity for authorized UNIT scope references.
-- No fabricated names; an absent row means unconfigured metadata.
CREATE TABLE "authorization".operational_unit_directory (
  ref_id text PRIMARY KEY,
  scope_type "authorization".authz_scope_type NOT NULL DEFAULT 'UNIT',
  code text NOT NULL UNIQUE,
  business_name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_unit_directory_unit_chk CHECK (scope_type = 'UNIT'),
  CONSTRAINT operational_unit_directory_code_chk CHECK (
    code = upper(trim(code)) AND length(code) BETWEEN 2 AND 64
  ),
  CONSTRAINT operational_unit_directory_name_chk CHECK (length(trim(business_name)) BETWEEN 2 AND 200),
  CONSTRAINT operational_unit_directory_version_chk CHECK (version > 0),
  CONSTRAINT operational_unit_directory_scope_ref_fk
    FOREIGN KEY (scope_type, ref_id)
    REFERENCES "authorization".scope_refs(scope_type, ref_id)
    ON DELETE RESTRICT
);
