ALTER TYPE "pty"."supplier_status" ADD VALUE IF NOT EXISTS 'ARCHIVED';--> statement-breakpoint
ALTER TABLE "pty"."suppliers" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pty"."suppliers" ADD COLUMN IF NOT EXISTS "archived_by_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "pty"."suppliers" ADD COLUMN IF NOT EXISTS "archive_reason" text;
