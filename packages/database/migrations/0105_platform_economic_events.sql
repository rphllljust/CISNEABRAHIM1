-- F1.2 — TRANSACTIONAL POSTING RELIABILITY
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- O DEFEITO QUE ESTA MIGRATION CORRIGE
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- A F1.1 fechou a espinha FINANCE → ACCOUNTING. FISCAL, INVENTORY e PAYROLL
-- continuavam publicando a contabilidade por chamada SÍNCRONA ACOPLADA:
--
--   domain.transition(...)  // COMMIT aqui
--   await accounting.postConfirmedEvent(...)   // segunda transação, fora
--
-- Se o processo cai entre as duas, o documento fiscal está autorizado (ou o
-- estoque movimentado, ou a folha fechada) e o journal NÃO existe. Nenhum evento
-- fica registrado. Nada aparece na fila de trabalho. É o defeito que a F1.2 elimina.
--
-- A correção NÃO cria segunda espinha: promove o ledger de fatos econômicos,
-- criado na F1.1 em `fin.*`, a um ledger de PLATAFORMA, porque o FATO ECONÔMICO
-- é um conceito do mecanismo — não propriedade de um contexto de negócio.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE MOVER, E NÃO DUPLICAR
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Duplicar (`fin.economic_events` + `fis.economic_events` + `inv.economic_events`)
-- criaria N ledgers com a MESMA chave de idempotência, prontos para divergir — e o
-- gate de fronteira passaria a ter N lugares para auditar em vez de um.
--
-- Um ledger só, em `plt.*` (PLATFORM), com `event_kind` e `source_kind` dizendo
-- quem declarou o fato. ACCOUNTING continua dono da decisão contábil; o produtor
-- continua dono do fato. Nenhum domínio perde ownership.
--
-- Idempotente: IF NOT EXISTS / ON CONFLICT em tudo.

CREATE SCHEMA IF NOT EXISTS "plt";--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════
-- F1.2 — os VALORES do enum `evt.domain_event_type` que os novos produtores usam
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- O DEFEITO MEDIDO. A F1.2 passou FISCAL, INVENTORY e PAYROLL a publicar o fato
-- econômico pela outbox, e esses fatos entram em `evt.domain_events`, cujo
-- `event_type` é o enum `evt.domain_event_type`. A 0104 registrou apenas os quatro
-- valores de FINANCE. Os demais produtores gravavam um rótulo que o enum não
-- conhecia:
--
--   invalid input value for enum evt.domain_event_type: "FISCAL_DOCUMENT_AUTHORIZED"
--
-- O efeito era o PIOR possível: o documento fiscal era autorizado, e a publicação
-- do FATO econômico estourava. `plt.economic_events.event_kind` é `text` com
-- CHECK (não enum), então a tabela do ledger aceitaria o valor — o que reprovava
-- era só o transporte. Um novo produtor parecia pronto em revisão de código e
-- quebrava na primeira autorização real.
--
-- A LISTA É A DO CONTRATO, NÃO A DO CHAMADOR. `ECONOMIC_EVENT_KINDS`
-- (`platform/bounded-contexts/economic-event-contract.ts`) é a fonte de verdade e
-- tem 16 valores; `economic-event-contract.spec.ts` fixa essa lista. Aqui os 16
-- são registrados no enum, para que ledger, transporte e contrato não possam
-- divergir sem uma migration.
--
-- ADD VALUE IF NOT EXISTS é idempotente e seguro em enum já existente.
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'RECEIVABLE_RECOGNIZED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'PAYABLE_RECOGNIZED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FISCAL_DOCUMENT_AUTHORIZED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FISCAL_DOCUMENT_CANCELLED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'TAX_CALCULATION_CONFIRMED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'INVENTORY_MOVEMENT_POSTED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'PAYROLL_CLOSED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'PAYROLL_REOPENED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FIXED_ASSET_ACQUIRED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FIXED_ASSET_DISPOSED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FIXED_ASSET_TRANSFERRED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'FIXED_ASSET_DEPRECIATED';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plt"."economic_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "unit_id" text NOT NULL,
  "event_kind" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_id" uuid NOT NULL,
  "amount" numeric(18, 4) NOT NULL,
  "currency_code" text NOT NULL,
  "occurred_on" date NOT NULL,
  "actor_identity_id" uuid NOT NULL REFERENCES "identity"."identities"("id"),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "outbox_event_id" uuid REFERENCES "evt"."outbox_events"("id"),
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  -- Fato de estorno aponta o fato original. Nunca há UPDATE/DELETE do original.
  "reverses_source_id" uuid,
  CONSTRAINT "plt_economic_events_unit_id_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "plt_economic_events_source_kind_chk" CHECK (
    length(trim("source_kind")) > 0
  ),
  CONSTRAINT "plt_economic_events_event_kind_chk" CHECK (
    "event_kind" IN (
      -- FINANCE
      'RECEIVABLE_RECOGNIZED',
      'SETTLEMENT_CONFIRMED',
      'SETTLEMENT_REVERSED',
      'PAYABLE_RECOGNIZED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REVERSED',
      -- FISCAL
      'FISCAL_DOCUMENT_AUTHORIZED',
      'FISCAL_DOCUMENT_CANCELLED',
      'TAX_CALCULATION_CONFIRMED',
      -- INVENTORY
      'INVENTORY_MOVEMENT_POSTED',
      -- PAYROLL
      'PAYROLL_CLOSED',
      'PAYROLL_REOPENED',
      -- ACCOUNTING (imobilizado)
      'FIXED_ASSET_ACQUIRED',
      'FIXED_ASSET_DISPOSED',
      'FIXED_ASSET_TRANSFERRED',
      'FIXED_ASSET_DEPRECIATED'
    )
  ),
  CONSTRAINT "plt_economic_events_amount_positive_chk" CHECK ("amount" > 0),
  CONSTRAINT "plt_economic_events_currency_code_chk" CHECK (length(trim("currency_code")) = 3)
);
--> statement-breakpoint

-- DUPLICATE PREVENTION NO NÍVEL DO FATO.
--
-- (event_kind, source_id) identifica UM fato. Redelivery da outbox não cria segundo
-- FATO aqui; `acc.posting_requests_event_source_uidx` (0054) impede segundo posting.
-- As duas constraints juntas fecham `evento → posting` de ponta a ponta.
CREATE UNIQUE INDEX IF NOT EXISTS "plt_economic_events_kind_source_uidx"
  ON "plt"."economic_events" ("event_kind", "source_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plt_economic_events_unit_occurred_idx"
  ON "plt"."economic_events" ("unit_id", "occurred_on");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plt_economic_events_outbox_idx"
  ON "plt"."economic_events" ("outbox_event_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plt_economic_events_reverses_idx"
  ON "plt"."economic_events" ("reverses_source_id")
  WHERE "reverses_source_id" IS NOT NULL;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════
-- PRESERVAÇÃO DO HISTÓRICO DA F1.1
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Os fatos já gravados em `fin.economic_events` são MIGRADOS, não descartados.
-- Nothing is deleted: a tabela origem permanece no schema até que uma migration
-- posterior (com decisão registrada) a remova. `ON CONFLICT DO NOTHING` torna o
-- bloco seguro em reexecução.
DO $$
BEGIN
  IF to_regclass('fin.economic_events') IS NOT NULL THEN
    INSERT INTO plt.economic_events (
      unit_id, event_kind, source_kind, source_id, amount, currency_code,
      occurred_on, actor_identity_id, payload, outbox_event_id, created_at
    )
    SELECT
      unit_id, event_kind, source_kind, source_id, amount, currency_code,
      occurred_on, actor_identity_id, payload, outbox_event_id, created_at
    FROM fin.economic_events
    ON CONFLICT (event_kind, source_id) DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTRATO DE LEITURA PUBLICADO (DR-008)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW "rpt"."read_economic_events" AS
SELECT * FROM "plt"."economic_events" OFFSET 0;--> statement-breakpoint

COMMENT ON TABLE "plt"."economic_events" IS
'F1.2 — fato econômico declarado por QUALQUER domínio produtor (FINANCE, FISCAL, INVENTORY, PAYROLL). Escrito na MESMA transação do comando de origem. ACCOUNTING é o dono da decisão contábil a partir daqui.';
--> statement-breakpoint
COMMENT ON VIEW "rpt"."read_economic_events" IS
'Read-only cross-context application contract (DR-008). Domain writes remain owned by the producing context.';
