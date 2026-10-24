-- F1.2 — RECONCILIAÇÃO DOS CONTRATOS DE LEITURA PUBLICADOS
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- O DEFEITO QUE ESTA MIGRATION CORRIGE (MEDIDO)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- `rpt.read_settlements` foi criada na 0044 e NUNCA foi atualizada depois que a
-- 0080/0081 acrescentaram as colunas de estorno em `fin.settlements`:
--
--   fin.settlements      : 15 colunas (inclui reversed_at, reversed_by_identity_id,
--                          reversal_reason, reversal_idempotency_key)
--   rpt.read_settlements : 11 colunas
--
-- O read model da trilha econômica lê `rpt.read_settlements` (contrato publicado,
-- DR-008) e referencia `s.reversed_at`. Resultado observado em produção local:
--
--   ERROR: column s.reversed_at does not exist
--
-- Ou seja: a Central de Contabilidade quebrava ao abrir a trilha de um fato — a
-- superfície operacional da F1.1 ficava sem leitura num caminho real.
--
-- A correção NÃO amplia o contrato: restaura a equivalência que o `SELECT *` da 0044
-- deveria ter mantido. `CREATE OR REPLACE VIEW ... SELECT *` reavalia as colunas.
--
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE VIEW "rpt"."read_settlements" AS
SELECT * FROM "fin"."settlements" OFFSET 0;--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_receivable_installments" AS
SELECT * FROM "fin"."receivable_installments" OFFSET 0;--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_receivables" AS
SELECT * FROM "fin"."receivables" OFFSET 0;--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_payments" AS
SELECT * FROM "fin"."payments" OFFSET 0;--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_payables" AS
SELECT * FROM "fin"."payables" OFFSET 0;--> statement-breakpoint

COMMENT ON VIEW "rpt"."read_settlements" IS
'F1.2 — read-only cross-context contract (DR-008). Must mirror fin.settlements, including reversal columns added by 0080/0081.';
