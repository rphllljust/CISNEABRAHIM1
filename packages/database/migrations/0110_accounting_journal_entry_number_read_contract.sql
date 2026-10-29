-- 0110 — Economic Trace: restore the published journal read contract.
--
-- acc.journal_entries.entry_number was added in migration 0075, after the
-- rpt.read_journal_entries SELECT * view was created in 0047. PostgreSQL views
-- retain their projected columns after ALTER TABLE ADD COLUMN, so
-- EconomicTraceReadModelService.forSettlement read of entry_number fails.
-- CREATE OR REPLACE preserves existing projected columns and appends the new one.
-- No business history is rewritten; no column is removed.
CREATE OR REPLACE VIEW "rpt"."read_journal_entries" AS
SELECT * FROM "acc"."journal_entries" OFFSET 0;--> statement-breakpoint

COMMENT ON VIEW "rpt"."read_journal_entries" IS
'Economic Trace read-only ledger contract: journal entry_number must remain visible after migration 0075; posted journals remain immutable.';
