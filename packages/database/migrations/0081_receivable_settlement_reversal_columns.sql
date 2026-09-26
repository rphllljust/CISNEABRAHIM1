ALTER TABLE "fin"."settlements" ADD COLUMN "reversed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "fin"."settlements" ADD COLUMN "reversed_by_identity_id" uuid;
--> statement-breakpoint
ALTER TABLE "fin"."settlements" ADD COLUMN "reversal_reason" text;
--> statement-breakpoint
ALTER TABLE "fin"."settlements" ADD COLUMN "reversal_idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "fin"."settlements" ADD CONSTRAINT "settlements_reversed_by_identity_id_identities_id_fk" FOREIGN KEY ("reversed_by_identity_id") REFERENCES "identity"."identities"("id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_reversal_idempotency_uidx" ON "fin"."settlements" USING btree ("receivable_id", "reversal_idempotency_key") WHERE "reversal_idempotency_key" IS NOT NULL;
