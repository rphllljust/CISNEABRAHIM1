-- Link workforce member to login identity. Does not assign service orders.

ALTER TABLE wrk.workforce_members
  ADD COLUMN IF NOT EXISTS identity_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workforce_members_identity_id_fk'
  ) THEN
    ALTER TABLE wrk.workforce_members
      ADD CONSTRAINT workforce_members_identity_id_fk
      FOREIGN KEY (identity_id) REFERENCES identity.identities(id)
      ON DELETE restrict ON UPDATE cascade;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS workforce_members_identity_id_uidx
  ON wrk.workforce_members (identity_id)
  WHERE identity_id IS NOT NULL;
