-- MASTER 001 / Incremento 03: durable finance cancellation fence.
ALTER TYPE "plt"."background_job_kind" ADD VALUE IF NOT EXISTS 'BILLING_RECEIVABLE_CANCEL';
