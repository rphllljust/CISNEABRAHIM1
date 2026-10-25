-- =============================================================================
-- 0108 — MEASUREMENT → ACCEPTANCE → BILLING READINESS (CAPABILITY VERTICAL)
-- =============================================================================
--
-- ESTA MIGRATION FECHA A CADEIA:
--
--   MEASUREMENT_BASIS_READY
--        → MEDIÇÃO AUTORITATIVA (itens derivados da BASE publicada)
--        → PLANEJADO / REALIZADO / MEDIDO
--        → VARIAÇÃO (com tolerância e impacto financeiro)
--        → DECISÃO DE AJUSTE (autoridade + motivo + auditoria)
--        → SUBMIT → REVIEW → APPROVE
--        → ACEITE DO CLIENTE (política + decisão imutável)
--        → ELEGIBILIDADE DE FATURAMENTO (modelo de decisão)
--        → READY_TO_BILL
--
-- FICA FORA, DE PROPÓSITO: emissão de documento fiscal, ciclo de recebível,
-- liquidação, postagem contábil e fechamento de período. A fronteira é
-- `READY_TO_BILL` — a MESMA que a Billing Worklist existente consome.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE JÁ EXISTIA (E NÃO É RECRIADO)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   msr.measurements                  DRAFT..SUBMITTED..UNDER_REVIEW..APPROVED..REJECTED
--   msr.measurement_items             itens com origem, preço e valor de linha
--   msr.measurement_adjustments       ajuste autorizado por item
--   msr.measurement_history_events    trilha da medição
--   msr.measurement_command_idempotency
--   bil.billing_records               preparação de faturamento (capability existente)
--   bil.billing_worklist (SQL)        buckets measurement_pending..ready..issued
--   so.measurement_basis              BASE publicada pelo fechamento da execução
--   so.execution_closures             fato do fechamento
--   so.execution_situations           work item de exceção
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITOS DE CAUSA RAIZ QUE ESTA MIGRATION FECHA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. A MEDIÇÃO NÃO CONSUMIA A BASE PUBLICADA.
--    `msr.measurement_items` derivava de `so.execution_entries` — a leitura
--    INTERNA da execução. A base publicada (`so.measurement_basis`) existia e era
--    publicada no fechamento, mas ninguém a consumia: a vertical anterior
--    entregava `MEASUREMENT_BASIS_READY` para uma capability que continuava lendo
--    a tabela privada alheia. Isso é a segunda verdade que o handoff existia para
--    eliminar. Aqui a origem passa a ser a BASE, com identidade imutável e
--    garantia de "uma execução fechada, uma medição".
--
-- 2. NÃO EXISTIA VARIAÇÃO COMO FATO.
--    A tela comparava planejado × realizado × medido com regra própria em
--    TypeScript, sem tolerância, sem severidade e sem impacto financeiro. O
--    backend não sabia dizer POR QUE a diferença importa. Aqui a variação é
--    calculada e PERSISTIDA com dimensão, deltas, tolerância, severidade,
--    impacto financeiro e nível de decisão exigido.
--
-- 3. O ACEITE DO CLIENTE ERA DOMÍNIO PURO.
--    `service-acceptance.ts` aplicava as regras e não tinha tabela, comando,
--    evento nem consequência. Uma função pura não bloqueia faturamento. Aqui a
--    decisão de aceite é FATO imutável, com política avaliada, autor, instante,
--    evidência e idempotência.
--
-- 4. ELEGIBILIDADE DE FATURAMENTO ERA UM BOOLEANO IMPLÍCITO.
--    A worklist de faturamento filtrava por `m.status = 'APPROVED'` dentro do SQL
--    da própria worklist. O operador não conseguia ver POR QUE estava bloqueado,
--    e o aceite (que é requisito comercial) não participava da decisão. Aqui a
--    elegibilidade é um MODELO DE DECISÃO com dimensões declaradas, resultado,
--    motivo bloqueante e próxima ação.
-- =============================================================================

-- =============================================================================
-- 1. ENUMS
-- =============================================================================

-- Dimensão de comparação. Vocabulário FECHADO: cada valor é uma pergunta de
-- negócio, não um rótulo de tela.
DO $$ BEGIN
  CREATE TYPE "msr"."measurement_variance_dimension" AS ENUM(
    'QUANTITY',
    'LABOR_HOURS',
    'EQUIPMENT_HOURS',
    'VEHICLE_DISTANCE',
    'FUEL_VOLUME',
    'MATERIAL_QUANTITY',
    'THIRD_PARTY_AMOUNT',
    'UNIT_PRICE',
    'LINE_AMOUNT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Severidade da variação. Escala fechada e curta, igual à de situações.
DO $$ BEGIN
  CREATE TYPE "msr"."measurement_variance_severity" AS ENUM(
    'NONE',
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Quem precisa decidir sobre a variação. `NONE` quando não há decisão pendente.
DO $$ BEGIN
  CREATE TYPE "msr"."measurement_variance_decision" AS ENUM(
    'NONE',
    'ACKNOWLEDGE',
    'AUTHORIZE_ADJUSTMENT',
    'REJECT_MEASUREMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Política de aceite do cliente, derivada do snapshot comercial da OS.
DO $$ BEGIN
  CREATE TYPE "msr"."acceptance_policy" AS ENUM(
    'NOT_REQUIRED',
    'REQUIRED_BEFORE_BILLING',
    'REQUIRED_WITH_EVIDENCE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Resultado da decisão de aceite. `PENDING` é ESTADO da dimensão, não resultado
-- gravado: uma linha de aceite sempre carrega uma decisão (ACCEPTED/REJECTED).
DO $$ BEGIN
  CREATE TYPE "msr"."acceptance_result" AS ENUM(
    'ACCEPTED',
    'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Dimensão avaliada na elegibilidade de faturamento. Cada uma responde sozinha
-- "por que esta medição ainda não pode virar faturamento?".
DO $$ BEGIN
  CREATE TYPE "msr"."billing_eligibility_dimension" AS ENUM(
    'EXECUTION_CLOSED',
    'MEASUREMENT_APPROVED',
    'CUSTOMER_ACCEPTANCE',
    'PURCHASE_ORDER',
    'COMMERCIAL_TERMS',
    'PRICING_BASIS',
    'BILLING_RECORD_ABSENT',
    'VARIANCE_CLEARED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Resultado de uma dimensão de elegibilidade.
DO $$ BEGIN
  CREATE TYPE "msr"."billing_eligibility_status" AS ENUM(
    'SATISFIED',
    'PENDING',
    'BLOCKED',
    'NOT_APPLICABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Estágio da cadeia Service-to-Cash em que a lacuna de receita está.
DO $$ BEGIN
  CREATE TYPE "msr"."revenue_leakage_stage" AS ENUM(
    'EXECUTED_NOT_MEASURED',
    'MEASURED_NOT_APPROVED',
    'APPROVED_NOT_ACCEPTED',
    'ACCEPTED_NOT_BILLABLE',
    'READY_NOT_PREPARED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =============================================================================
-- 2. OUTBOX — os fatos desta capability
-- =============================================================================
--
-- `evt.domain_event_type` é ENUM: sem o valor registrado, o INSERT do outbox
-- falha no COMMIT e o comando inteiro reverte. A lição da 0105 aplica-se
-- integralmente. Idempotente por natureza.
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'MEASUREMENT_CREATED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'MEASUREMENT_ADJUSTMENT_AUTHORIZED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'CUSTOMER_ACCEPTANCE_RECORDED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'CUSTOMER_REJECTION_RECORDED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'BILLING_ELIGIBILITY_GRANTED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'BILLING_ELIGIBILITY_BLOCKED';
--> statement-breakpoint

-- =============================================================================
-- 3. ORIGEM AUTORITATIVA DO ITEM DE MEDIÇÃO
-- =============================================================================
--
-- O item passa a apontar para a BASE de medição publicada e para a LINHA dela.
-- `source_execution_entry_id` continua existindo porque um item já gravado não
-- pode perder sua linhagem histórica; para itens NOVOS ele é `null` e a origem é
-- a base.
--
-- POR QUE A COLUNA `source_execution_entry_id` NÃO É REMOVIDA
--
-- Migração compatível com rolling deploy (EXPAND): a coluna antiga é preservada
-- e o NOT NULL sobre ela é RELAXADO. Contratos antigos continuam funcionando
-- enquanto o código novo grava a origem nova. O contrato da coluna antiga
-- (contract phase) é decisão de uma release FUTURA, não desta — remover aqui
-- quebraria um deploy em andamento.
ALTER TABLE "msr"."measurement_items"
  ADD COLUMN IF NOT EXISTS "source_measurement_basis_id" uuid;
--> statement-breakpoint

ALTER TABLE "msr"."measurement_items"
  ADD COLUMN IF NOT EXISTS "source_basis_line_key" text;
--> statement-breakpoint

-- Quantidade PLANEJADA da linha, congelada no momento da medição. É a terceira
-- verdade: planejado ≠ realizado ≠ medido. Sem esta coluna a tela comparava
-- contra o planejamento ATUAL, e um replanejamento posterior reescrevia o
-- passado da medição.
ALTER TABLE "msr"."measurement_items"
  ADD COLUMN IF NOT EXISTS "planned_quantity" numeric(18, 6);
--> statement-breakpoint

ALTER TABLE "msr"."measurement_items"
  ADD COLUMN IF NOT EXISTS "planned_unit_of_measure" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."measurement_items"
    ADD CONSTRAINT "measurement_items_source_measurement_basis_id_measurement_basis_id_fk"
    FOREIGN KEY ("source_measurement_basis_id") REFERENCES "so"."measurement_basis"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- A origem antiga deixa de ser obrigatória. Registros históricos mantêm o valor.
ALTER TABLE "msr"."measurement_items"
  ALTER COLUMN "source_execution_entry_id" DROP NOT NULL;
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A CONSTRAINT DA 0023 PRECISA SER SUBSTITUÍDA, NÃO ACOMPANHADA
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A 0023 criou `measurement_item_origin_ck CHECK (source_execution_entry_id IS NOT NULL)`.
-- Ela é a expressão registrada de "todo item tem procedência" — e depois desta
-- migration ela passa a REPROVAR item novo, que tem procedência pela BASE e não
-- pela entrada de execução.
--
-- Remover sem substituir deixaria item SEM PROCEDÊNCIA passar: o CHECK some e
-- nenhuma regra ocupa o lugar. Por isso ele é REMOVIDO e RECRIADO abaixo com a
-- regra a nova: uma das duas origens, nunca nenhuma.
ALTER TABLE "msr"."measurement_items"
  DROP CONSTRAINT IF EXISTS "measurement_item_origin_ck";
--> statement-breakpoint

-- ORIGEM OBRIGATÓRIA, UMA SÓ. Um item sem procedência não é auditável: não se
-- sabe de qual base publicada (ou de qual entrada de execução) ele veio. A
-- constraint aceita a origem NOVA ou a HISTÓRICA, nunca nenhuma, e nunca as
-- duas — as duas significariam duas derivações do mesmo item.
DO $$ BEGIN
  ALTER TABLE "msr"."measurement_items"
    ADD CONSTRAINT "measurement_items_origin_present_chk" CHECK (
      ("source_measurement_basis_id" IS NOT NULL AND "source_execution_entry_id" IS NULL)
      OR ("source_measurement_basis_id" IS NULL AND "source_execution_entry_id" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Uma linha da base gera UM item por medição. Reenviar o comando com outra chave
-- de idempotência não cria segundo item para a mesma linha.
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_items_basis_line_uidx"
  ON "msr"."measurement_items" ("measurement_id", "source_measurement_basis_id", "source_basis_line_key")
  WHERE "source_basis_line_key" IS NOT NULL;
--> statement-breakpoint

-- UMA MEDIÇÃO POR BASE PUBLICADA. É o banco garantindo "uma execução fechada,
-- uma verdade operacional": o segundo comando de criação responde `already_exists`
-- mesmo fora do fluxo da aplicação.
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_items_basis_consumed_uidx"
  ON "msr"."measurement_items" ("source_measurement_basis_id", "source_basis_line_key")
  WHERE "source_basis_line_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "measurement_items_basis_line_idx"
  ON "msr"."measurement_items" ("source_measurement_basis_id", "source_basis_line_key");
--> statement-breakpoint

-- =============================================================================
-- 4. VARIAÇÃO COMO FATO PERSISTIDO
-- =============================================================================
--
-- A variação não é conta de tela: ela é o MOTIVO pelo qual uma aprovação pode
-- estar bloqueada. Sem persistir, o bloqueio seria recalcular uma regra a cada
-- leitura, e duas leituras poderiam discordar sobre a mesma medição.
--
-- A tabela é REPROJETÁVEL: cada recálculo substitui as linhas da medição dentro
-- da MESMA transação que alterou os itens. Ela não é a verdade da medição — é a
-- PROJEÇÃO da diferença entre três verdades que já existem.
CREATE TABLE IF NOT EXISTS "msr"."measurement_variances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "measurement_id" uuid NOT NULL,
  "measurement_item_id" uuid,
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "dimension" "msr"."measurement_variance_dimension" NOT NULL,
  -- Chave lógica estável da variação dentro da medição. Permite reconhecer a
  -- MESMA divergência entre recálculos sem duplicar linha.
  "dimension_key" text NOT NULL,
  -- AS TRÊS VERDADES. Qualquer uma pode ser nula quando a fonte não existe — e
  -- nulo significa "não informado", nunca zero.
  "planned_value" numeric(18, 6),
  "actual_value" numeric(18, 6),
  "measured_value" numeric(18, 6),
  "absolute_delta" numeric(18, 6) NOT NULL,
  "percentage_delta" numeric(9, 4),
  -- Tolerância APLICADA e sua origem declarada (`CONTRACT`, `SERVICE`, `DEFAULT`).
  "tolerance_percentage" numeric(9, 4),
  "tolerance_source" text,
  "severity" "msr"."measurement_variance_severity" NOT NULL,
  -- Impacto financeiro da divergência, na moeda da medição.
  "financial_impact" numeric(18, 4),
  "currency_code" char(3),
  "requires_decision" boolean DEFAULT false NOT NULL,
  "decision_kind" "msr"."measurement_variance_decision" DEFAULT 'NONE' NOT NULL,
  "blocking_reason" text,
  "recommended_resolution" text,
  "explanation" text NOT NULL,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "measurement_variances_key_not_empty_chk" CHECK (length(trim("dimension_key")) > 0),
  CONSTRAINT "measurement_variances_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "measurement_variances_explanation_not_empty_chk" CHECK (
    length(trim("explanation")) > 0
  ),
  CONSTRAINT "measurement_variances_row_version_positive_chk" CHECK ("row_version" >= 1),
  CONSTRAINT "measurement_variances_impact_non_negative_chk" CHECK (
    "financial_impact" IS NULL OR "financial_impact" >= 0
  ),
  -- Uma variação que NÃO exige decisão não pode declarar decisão. E uma variação
  -- que EXIGE decisão precisa declarar QUAL — sem isso a tela não sabe o que
  -- oferecer ao operador.
  CONSTRAINT "measurement_variances_decision_consistency_chk" CHECK (
    ("requires_decision" = false AND "decision_kind" = 'NONE'::"msr"."measurement_variance_decision")
    OR ("requires_decision" = true AND "decision_kind" <> 'NONE'::"msr"."measurement_variance_decision")
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."measurement_variances"
    ADD CONSTRAINT "measurement_variances_measurement_id_measurements_id_fk"
    FOREIGN KEY ("measurement_id") REFERENCES "msr"."measurements"("id")
    ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."measurement_variances"
    ADD CONSTRAINT "measurement_variances_measurement_item_id_measurement_items_id_fk"
    FOREIGN KEY ("measurement_item_id") REFERENCES "msr"."measurement_items"("id")
    ON DELETE cascade ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."measurement_variances"
    ADD CONSTRAINT "measurement_variances_service_order_id_service_orders_id_fk"
    FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "measurement_variances_measurement_dimension_uidx"
  ON "msr"."measurement_variances" ("measurement_id", "dimension", "dimension_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "measurement_variances_measurement_severity_idx"
  ON "msr"."measurement_variances" ("measurement_id", "severity", "requires_decision");
--> statement-breakpoint

-- =============================================================================
-- 5. AJUSTE — DECISÃO, NÃO EDIÇÃO
-- =============================================================================
--
-- `msr.measurement_adjustments` já existia com quantidade, unidade, motivo e
-- autor. O que faltava era a DECISÃO: antes/depois, delta, impacto financeiro,
-- instante da decisão, correlação, versão esperada e chave de idempotência. Sem
-- esses campos o ajuste é uma edição com motivo no texto — não uma decisão
-- auditável com consequência econômica declarada.
ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "quantity_before" numeric(18, 6);
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "quantity_after" numeric(18, 6);
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "financial_impact" numeric(18, 4);
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "currency_code" char(3);
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "variance_dimension" "msr"."measurement_variance_dimension";
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "decided_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "correlation_id" text;
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "expected_row_version" integer;
--> statement-breakpoint

ALTER TABLE "msr"."measurement_adjustments"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

-- A decisão de ajuste nasce DENTRO da transação e é idempotente: a mesma chave
-- não produz dois ajustes.
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_adjustments_idempotency_key_uidx"
  ON "msr"."measurement_adjustments" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- Um ajuste autorizado é uma decisão com delta positivo: reduzir quantidade não é
-- ajuste, é correção de item e não tem autoridade para ser feita por aqui.
DO $$ BEGIN
  ALTER TABLE "msr"."measurement_adjustments"
    ADD CONSTRAINT "measurement_adjustments_quantity_positive_chk" CHECK ("adjustment_quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =============================================================================
-- 6. ACEITE DO CLIENTE — CAPABILITY, NÃO FUNÇÃO PURA
-- =============================================================================
--
-- A DECISÃO É IMUTÁVEL. Uma linha de aceite registrada não é editada nem
-- apagada: uma segunda decisão para o mesmo ciclo violaria a UNIQUE parcial e o
-- operador leria um conflito, não uma sobrescrita silenciosa. Retratar exige
-- NOVO ciclo, o que preserva a história (HISTORY LOSS 0).
CREATE TABLE IF NOT EXISTS "msr"."customer_acceptances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "measurement_id" uuid NOT NULL,
  "service_order_id" uuid NOT NULL,
  "client_id" uuid,
  "unit_id" text NOT NULL,
  -- Ciclo de aceite. `1` é o primeiro; um segundo ciclo só existe quando o
  -- anterior foi REJEITADO e a medição foi corrigida.
  "cycle_number" integer DEFAULT 1 NOT NULL,
  "policy" "msr"."acceptance_policy" NOT NULL,
  "result" "msr"."acceptance_result" NOT NULL,
  "observation" text NOT NULL,
  -- Motivo obrigatório em rejeição; garantido pelo CHECK abaixo.
  "rejection_reason" text,
  "evidence_id" uuid,
  "signature_id" uuid,
  -- Quem aceitou do lado do CLIENTE (texto declarado) e qual ator do sistema
  -- registrou a decisão. São coisas diferentes e ficam separadas.
  "customer_signer_name" text,
  "accepted_by_identity_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "correlation_id" text,
  "idempotency_key" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_acceptances_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "customer_acceptances_observation_not_empty_chk" CHECK (
    length(trim("observation")) > 0
  ),
  CONSTRAINT "customer_acceptances_cycle_positive_chk" CHECK ("cycle_number" >= 1),
  CONSTRAINT "customer_acceptances_row_version_positive_chk" CHECK ("row_version" >= 1),
  -- REJEIÇÃO SEM MOTIVO É INUTILIZÁVEL: a correção não sabe o que corrigir.
  CONSTRAINT "customer_acceptances_rejection_reason_chk" CHECK (
    ("result" = 'ACCEPTED'::"msr"."acceptance_result" AND "rejection_reason" IS NULL)
    OR (
      "result" = 'REJECTED'::"msr"."acceptance_result"
      AND "rejection_reason" IS NOT NULL
      AND length(trim("rejection_reason")) > 0
    )
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."customer_acceptances"
    ADD CONSTRAINT "customer_acceptances_measurement_id_measurements_id_fk"
    FOREIGN KEY ("measurement_id") REFERENCES "msr"."measurements"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."customer_acceptances"
    ADD CONSTRAINT "customer_acceptances_service_order_id_service_orders_id_fk"
    FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."customer_acceptances"
    ADD CONSTRAINT "customer_acceptances_evidence_id_documents_id_fk"
    FOREIGN KEY ("evidence_id") REFERENCES "doc"."documents"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."customer_acceptances"
    ADD CONSTRAINT "customer_acceptances_signature_id_execution_signatures_id_fk"
    FOREIGN KEY ("signature_id") REFERENCES "so"."execution_signatures"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."customer_acceptances"
    ADD CONSTRAINT "customer_acceptances_accepted_by_identity_id_identities_id_fk"
    FOREIGN KEY ("accepted_by_identity_id") REFERENCES "identity"."identities"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- UMA decisão por ciclo. O banco impede a segunda; a aplicação responde 409.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_acceptances_cycle_uidx"
  ON "msr"."customer_acceptances" ("measurement_id", "cycle_number");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "customer_acceptances_idempotency_key_uidx"
  ON "msr"."customer_acceptances" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "customer_acceptances_unit_result_idx"
  ON "msr"."customer_acceptances" ("unit_id", "result", "occurred_at");
--> statement-breakpoint

-- =============================================================================
-- 7. ELEGIBILIDADE DE FATURAMENTO — MODELO DE DECISÃO
-- =============================================================================
--
-- PostgreSQL não tem REPLACE VIEW com menos colunas já criadas, então a view é
-- recriada de forma idempotente. Esta tabela é a PROJEÇÃO da decisão: qual foi o
-- resultado, por qual motivo, quando foi avaliada e com que versão de fonte.
-- `READY` aqui é o que o prompt chama de READY_TO_BILL.

CREATE TABLE IF NOT EXISTS "msr"."billing_eligibility_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "measurement_id" uuid NOT NULL,
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "measurement_row_version" integer NOT NULL,
  -- Política aplicada (`MEASUREMENT_APPROVED`, `FIXED_PRICE`, `PERIODIC`, `MILESTONE`).
  "policy" text NOT NULL,
  -- `READY` é o único resultado que libera faturamento. `BLOCKED` e `PENDING`
  -- não liberam, e a diferença entre os dois é de AÇÃO: `PENDING` espera fato
  -- futuro (aceite do cliente); `BLOCKED` exige resolução de algo já conhecido.
  "result" text NOT NULL,
  -- `[{ dimension, status, reasonCode, detail }]` — as dimensões avaliadas.
  "dimensions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "blocking_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "total_amount" numeric(18, 4),
  "currency_code" char(3),
  -- Fato imutável publicado no outbox, quando o resultado mudou de BLOCKED para
  -- READY. Nulo quando não houve liberação nesta avaliação.
  "granted_at" timestamp with time zone,
  "evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "evaluated_by_identity_id" uuid,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "billing_eligibility_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "billing_eligibility_policy_not_empty_chk" CHECK (length(trim("policy")) > 0),
  CONSTRAINT "billing_eligibility_result_chk" CHECK ("result" IN ('READY', 'PENDING', 'BLOCKED')),
  CONSTRAINT "billing_eligibility_row_version_positive_chk" CHECK ("row_version" >= 1),
  -- Liberação exige instante declarado, e ausência de liberação não pode carregar
  -- instante: um campo dessincronizado do resultado é mentira em dobro.
  CONSTRAINT "billing_eligibility_granted_consistency_chk" CHECK (
    ("result" = 'READY' AND "granted_at" IS NOT NULL)
    OR ("result" <> 'READY' AND "granted_at" IS NULL)
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."billing_eligibility_evaluations"
    ADD CONSTRAINT "billing_eligibility_measurement_id_measurements_id_fk"
    FOREIGN KEY ("measurement_id") REFERENCES "msr"."measurements"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."billing_eligibility_evaluations"
    ADD CONSTRAINT "billing_eligibility_service_order_id_service_orders_id_fk"
    FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- UMA avaliação VIGENTE por medição: a última vence, as anteriores permanecem
-- como história. O índice parcial é o que torna "a vigente" consultável.
CREATE INDEX IF NOT EXISTS "billing_eligibility_measurement_evaluated_idx"
  ON "msr"."billing_eligibility_evaluations" ("measurement_id", "evaluated_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "billing_eligibility_unit_result_idx"
  ON "msr"."billing_eligibility_evaluations" ("unit_id", "result", "evaluated_at" DESC);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_eligibility_measurement_version_uidx"
  ON "msr"."billing_eligibility_evaluations" ("measurement_id", "measurement_row_version", "result");
--> statement-breakpoint

-- =============================================================================
-- 8. LACUNA DE RECEITA — PROJEÇÃO CROSS-STAGE
-- =============================================================================
--
-- NÃO é uma segunda máquina de faturamento: é a MESMA cadeia vista por estágio.
-- Cada linha é um valor de serviço criado que NÃO chegou ao faturamento, com o
-- estágio onde parou, a idade, o dono e a próxima ação.
--
-- A tabela guarda a PROJEÇÃO corrente (uma linha por medição). Recalcular
-- substitui; não acumula. O histórico do que aconteceu está nas tabelas de fato
-- (medição, aceite, elegibilidade, billing), não aqui.
CREATE TABLE IF NOT EXISTS "msr"."revenue_leakage_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Chave do valor de serviço: a OS concluída. A projeção é por ordem porque é a
  -- ordem que gera valor, mesmo quando ainda não há medição.
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "client_id" uuid,
  "measurement_id" uuid,
  "stage" "msr"."revenue_leakage_stage" NOT NULL,
  "order_number" text NOT NULL,
  "client_label" text,
  "amount" numeric(18, 4),
  "currency_code" char(3),
  -- Idade no estágio, em segundos, calculada na projeção. A tela formata; o
  -- backend não devolve texto de tempo porque texto não é comparável.
  "age_seconds" bigint,
  "owner_role" text,
  "blocker_code" text,
  "next_action_code" text,
  "next_action_label" text,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "revenue_leakage_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "revenue_leakage_order_number_not_empty_chk" CHECK (
    length(trim("order_number")) > 0
  ),
  CONSTRAINT "revenue_leakage_age_non_negative_chk" CHECK ("age_seconds" IS NULL OR "age_seconds" >= 0),
  CONSTRAINT "revenue_leakage_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."revenue_leakage_positions"
    ADD CONSTRAINT "revenue_leakage_service_order_id_service_orders_id_fk"
    FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "msr"."revenue_leakage_positions"
    ADD CONSTRAINT "revenue_leakage_measurement_id_measurements_id_fk"
    FOREIGN KEY ("measurement_id") REFERENCES "msr"."measurements"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- UMA posição por ordem: o valor criado está em UM estágio, não em vários.
CREATE UNIQUE INDEX IF NOT EXISTS "revenue_leakage_service_order_uidx"
  ON "msr"."revenue_leakage_positions" ("service_order_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "revenue_leakage_unit_stage_idx"
  ON "msr"."revenue_leakage_positions" ("unit_id", "stage", "age_seconds" DESC);
--> statement-breakpoint

-- =============================================================================
-- 9. READ MODELS PUBLICADOS (rpt.*)
-- =============================================================================
--
-- Contrato de leitura cross-context (DR-008): frontend e outras capabilities
-- leem AQUI, nunca das tabelas privadas de `msr`.
CREATE OR REPLACE VIEW "rpt"."read_measurement_variances" AS
SELECT * FROM "msr"."measurement_variances" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_customer_acceptances" AS
SELECT * FROM "msr"."customer_acceptances" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_billing_eligibility_evaluations" AS
SELECT * FROM "msr"."billing_eligibility_evaluations" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_revenue_leakage_positions" AS
SELECT * FROM "msr"."revenue_leakage_positions" OFFSET 0;
--> statement-breakpoint

-- `rpt.read_measurement_items` precisa das colunas novas de origem e planejado.
CREATE OR REPLACE VIEW "rpt"."read_measurement_items" AS
SELECT * FROM "msr"."measurement_items" OFFSET 0;
--> statement-breakpoint

COMMENT ON TABLE "msr"."measurement_variances" IS
'measurement→acceptance→billing: variação PLANEJADO×REALIZADO×MEDIDO com tolerância, severidade, impacto financeiro e decisão exigida.';
--> statement-breakpoint
COMMENT ON TABLE "msr"."customer_acceptances" IS
'measurement→acceptance→billing: decisão imutável de aceite do cliente (uma por ciclo, motivo obrigatório na rejeição).';
--> statement-breakpoint
COMMENT ON TABLE "msr"."billing_eligibility_evaluations" IS
'measurement→acceptance→billing: modelo de decisão de elegibilidade; result=READY é o READY_TO_BILL.';
--> statement-breakpoint
COMMENT ON TABLE "msr"."revenue_leakage_positions" IS
'measurement→acceptance→billing: projeção cross-stage do valor de serviço que não chegou ao faturamento.';
--> statement-breakpoint
COMMENT ON VIEW "rpt"."read_revenue_leakage_positions" IS
'measurement→acceptance→billing: read-only cross-context contract for the revenue leakage projection.';
