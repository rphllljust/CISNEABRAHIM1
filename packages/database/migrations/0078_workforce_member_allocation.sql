ALTER TABLE "res"."resource_allocations"
  ADD COLUMN IF NOT EXISTS "workforce_member_id" uuid;

ALTER TABLE "res"."resource_allocations"
  ALTER COLUMN "physical_asset_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resource_allocations_workforce_member_id_workforce_members_id_fk'
  ) THEN
    ALTER TABLE "res"."resource_allocations"
      ADD CONSTRAINT "resource_allocations_workforce_member_id_workforce_members_id_fk"
      FOREIGN KEY ("workforce_member_id") REFERENCES "wrk"."workforce_members"("id")
      ON DELETE restrict ON UPDATE cascade;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resource_allocations_exactly_one_resource_chk'
  ) THEN
    ALTER TABLE "res"."resource_allocations"
      ADD CONSTRAINT "resource_allocations_exactly_one_resource_chk"
      CHECK (((physical_asset_id IS NOT NULL)::int + (workforce_member_id IS NOT NULL)::int) = 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "resource_allocations_workforce_member_id_idx"
  ON "res"."resource_allocations" USING btree ("workforce_member_id");

ALTER TABLE "res"."resource_allocations"
  DROP CONSTRAINT IF EXISTS "resource_allocations_no_overlap_active_excl";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resource_allocations_physical_no_overlap_active_excl'
  ) THEN
    ALTER TABLE "res"."resource_allocations"
      ADD CONSTRAINT "resource_allocations_physical_no_overlap_active_excl"
      EXCLUDE USING gist (
        "physical_asset_id" WITH =,
        "operational_period" WITH &&
      )
      WHERE (status = 'ACTIVE'::res.resource_allocation_status AND physical_asset_id IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resource_allocations_workforce_no_overlap_active_excl'
  ) THEN
    ALTER TABLE "res"."resource_allocations"
      ADD CONSTRAINT "resource_allocations_workforce_no_overlap_active_excl"
      EXCLUDE USING gist (
        "workforce_member_id" WITH =,
        "operational_period" WITH &&
      )
      WHERE (status = 'ACTIVE'::res.resource_allocation_status AND workforce_member_id IS NOT NULL);
  END IF;
END $$;
