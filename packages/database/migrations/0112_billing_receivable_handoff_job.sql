-- MASTER 001 / Incremento 03: durable Billing -> Finance receivable handoff.
-- Existing job lease, retry, and dead-letter semantics remain authoritative.
ALTER TYPE "plt"."background_job_kind" ADD VALUE IF NOT EXISTS 'BILLING_RECEIVABLE_HANDOFF';
