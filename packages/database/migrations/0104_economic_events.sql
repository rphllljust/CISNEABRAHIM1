-- F1.1 — ECONOMIC POSTING SPINE
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- O FINANCE altera estado econômico (liquidação de recebível, pagamento de
-- título) e o ACCOUNTING nunca fica sabendo. O fato econômico vive em
-- `fin.settlements` / `fin.payments`, o lançamento contábil em `acc.*`, e não
-- havia NENHUM canal transacional entre os dois: a única ponte era chamada
-- síncrona `try*` best-effort, que engolia a falha.
--
-- A correção NÃO cria broker nem fila paralela: usa a outbox transacional que
-- já existe (`evt.outbox_events`, migration 0028). O que faltava era
-- (a) o vocabulário de evento econômico e (b) o registro do fato econômico
-- publicado, para que a decisão contábil seja rastreável e reprocessável.
--
-- REGRA ARQUITETURAL (mantida):
--   FINANCE publica o FATO econômico. ACCOUNTING decide a CONTABILIDADE.
--   FINANCE nunca escreve journal. ACCOUNTING nunca lê `fin.*` diretamente.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Vocabulário de evento econômico — ADITIVO ao enum existente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Os 8 valores originais da 0026 permanecem intactos. Os novos cobrem o efeito
-- econômico que hoje não tem consequência contábil confiável:
--   SETTLEMENT_CONFIRMED   → liquidação de recebível (entrada de caixa)
--   SETTLEMENT_REVERSED    → estorno de liquidação
--   PAYMENT_CONFIRMED      → pagamento de título (saída de caixa)
--   PAYMENT_REVERSED       → estorno de pagamento
--
-- Idempotente: ADD VALUE IF NOT EXISTS.

ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SETTLEMENT_CONFIRMED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SETTLEMENT_REVERSED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMED';--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'PAYMENT_REVERSED';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 1b. Eventos de posting contábil de ESTORNO — ADITIVO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `acc.accounting_posting_requests` é único por
-- (origin_kind, event_kind, source_id). Antes, o estorno reutilizava o event_kind do
-- fato ORIGINAL, então a compensação colidia com o registro do original e não podia
-- existir como posting próprio — o estorno financeiro ficava sem journal compensatório.
--
-- Estes dois valores dão ao estorno uma CHAVE PRÓPRIA. Eles são o `event_kind` do
-- posting de compensação; o `source_id` continua sendo o do fato ORIGINAL, e a ligação
-- ao journal revertido é feita por `reverses_entry_id`.
--
-- Idempotente: ADD VALUE IF NOT EXISTS.

ALTER TYPE "acc"."posting_event_kind" ADD VALUE IF NOT EXISTS 'SETTLEMENT_REVERSED';--> statement-breakpoint
ALTER TYPE "acc"."posting_event_kind" ADD VALUE IF NOT EXISTS 'PAYMENT_REVERSED';--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Ledger de eventos econômicos publicados pelo FINANCE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUE UMA TABELA, E NÃO SÓ A OUTBOX
--
-- `evt.outbox_events` é infraestrutura de transporte: ela pode ser podada,
-- reentregue e reprocessada. A TRILHA de "qual fato econômico o FINANCE
-- declarou, com qual valor, em qual competência" é registro EMPRESARIAL e
-- precisa sobreviver ao transporte. É ela que fecha a cadeia exigida:
--
--   settlement/payment → accounting event → posting rule → journal
--
-- O `outbox_event_id` liga a linha ao transporte (rastreabilidade completa).
-- Escrita SEMPRE na mesma transação do `INSERT` em `fin.settlements` /
-- `fin.payments` — é essa co-localização que prova a atomicidade.

CREATE TABLE IF NOT EXISTS "fin"."economic_events" (
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
  CONSTRAINT "economic_events_unit_id_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "economic_events_event_kind_chk" CHECK (
    "event_kind" IN (
      'RECEIVABLE_RECOGNIZED',
      'SETTLEMENT_CONFIRMED',
      'SETTLEMENT_REVERSED',
      'PAYABLE_RECOGNIZED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_REVERSED'
    )
  ),
  CONSTRAINT "economic_events_source_kind_chk" CHECK (length(trim("source_kind")) > 0),
  CONSTRAINT "economic_events_amount_positive_chk" CHECK ("amount" > 0),
  CONSTRAINT "economic_events_currency_code_chk" CHECK (length(trim("currency_code")) = 3)
);
--> statement-breakpoint

-- DUPLICATE PREVENTION NO NÍVEL DO FATO ECONÔMICO.
--
-- A chave natural é (event_kind, source_id): a liquidação X produz UM evento
-- SETTLEMENT_CONFIRMED, e só um. Redelivery da outbox NÃO cria segundo
-- journal porque o `posting_requests_event_source_uidx` (acc, 0054) barra o
-- segundo posting; esta constraint barra o segundo FATO. As duas junta fecham
-- o caminho ponta a ponta.
CREATE UNIQUE INDEX IF NOT EXISTS "economic_events_kind_source_uidx"
  ON "fin"."economic_events" ("event_kind", "source_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "economic_events_unit_occurred_idx"
  ON "fin"."economic_events" ("unit_id", "occurred_on");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "economic_events_outbox_idx"
  ON "fin"."economic_events" ("outbox_event_id");--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Contrato de leitura publicado (DR-008)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O ACCOUNTING precisa saber qual fato econômico chegou para decidir postar.
-- Ele o faz pelo evento da outbox (contrato `AccountingEconomicEventV1`) e
-- NUNCA por leitura direta de `fin.*` — mas o read model publicado permite
-- que a superfície operacional (Control Tower de eventos econômicos) mostre a
-- trilha sem violar fronteira.

CREATE OR REPLACE VIEW "rpt"."read_economic_events" AS
SELECT * FROM "fin"."economic_events" OFFSET 0;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Contratos de leitura publicados para a TRILHA econômica
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A trilha `settlement/payment → event → posting → journal` atravessa PLATFORM
-- (`evt.outbox_events`), ACCOUNTING (`acc.accounting_posting_requests`,
-- `acc.journal_entries`) e FINANCE (`fin.economic_events`). O read model que monta
-- essa trilha vive em ACCOUNTING (que pode ler os três), mas o gate de fronteira
-- proíbe SQL direto contra schema privado de outro contexto — corretamente.
--
-- Estas views são o CONTRATO PUBLICADO (DR-008), no mesmo padrão de
-- `rpt.read_journal_entries`. Nenhum dado novo: só a forma de leitura cross-context.

CREATE OR REPLACE VIEW "rpt"."read_accounting_posting_requests" AS
SELECT * FROM "acc"."accounting_posting_requests" OFFSET 0;--> statement-breakpoint

-- Estado do TRANSPORTE (outbox) exposto como contrato de leitura. É o que permite à
-- operação ver "a contabilização falhou após N tentativas, motivo X" sem que o
-- consumidor leia `evt` diretamente.
CREATE OR REPLACE VIEW "rpt"."read_outbox_events" AS
SELECT id, event_type, aggregate_type, aggregate_id, payload, payload_version,
       occurred_at, available_at, attempts, max_attempts, status,
       idempotency_key, ordering_key, published_at, last_error, created_at, updated_at
  FROM "evt"."outbox_events" OFFSET 0;--> statement-breakpoint

COMMENT ON VIEW "rpt"."read_accounting_posting_requests" IS
'Read-only cross-context application contract (DR-008). Domain writes remain owned by ACCOUNTING.';
--> statement-breakpoint
COMMENT ON VIEW "rpt"."read_outbox_events" IS
'Read-only cross-context application contract (DR-008). Transport state for operational surfaces; leases are intentionally NOT exposed.';

COMMENT ON TABLE "fin"."economic_events" IS
'F1.1 — fato econômico declarado pelo FINANCE. Escrito na MESMA transação de fin.settlements/fin.payments. ACCOUNTING é o dono da decisão contábil a partir daqui.';
--> statement-breakpoint

COMMENT ON VIEW "rpt"."read_economic_events" IS
'Read-only cross-context application contract (DR-008). Domain writes remain owned by FINANCE.';
