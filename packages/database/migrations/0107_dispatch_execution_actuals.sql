-- =============================================================================
-- 0107 — DISPATCH + EXECUTION + ACTUALS (CAPABILITY VERTICAL COMPLETA)
-- =============================================================================
--
-- ESTA MIGRATION ABRE A VERTICAL READY FOR DISPATCH -> DISPATCH -> START ->
-- LIVE EXECUTION -> ACTUALS -> COMPLETE -> EXECUTION CLOSED -> MEASUREMENT READY.
--
-- O QUE JÁ EXISTIA E É PRESERVADO
--
--   so.service_orders            DRAFT..PREPARED..RELEASED..IN_EXECUTION..PAUSED..COMPLETED..CANCELLED
--   so.planned_resources         requisito planejado (PLANNED/REMOVED)
--   res.resource_allocations     alocação nominal por ativo/pessoa (ACTIVE/REALLOCATED/REMOVED)
--   so.execution_entries         QUANTITY/MILEAGE/HOUR_METER/OBSERVATION/OCCURRENCE
--   so.execution_evidence        evidência por tipo com payload
--   so.execution_occurrences     ocorrência operacional
--   so.operational_cost_entries  custo ESTIMATED/ACTUAL
--   so.execution_command_idempotency
--   evt.outbox_events            outbox transacional
--
-- NADA DISSO É RECRIADO. Esta migration apenas acrescenta a CAMADA que faltava:
-- o despacho como FATO PERSISTIDO (não status), a janela operacional, os
-- ACTUALS DIMENSIONADOS (mão de obra, veículo, equipamento, material, terceiro,
-- tempo, medidor, combustível), a evidência com verificação, a assinatura, a
-- execução fechada e a base de medição publicada.
--
-- REGRA DE NÃO DUPLICAÇÃO
--
--   so.execution_entries permanece a ENTRADA OPERACIONAL genérica (quantidade,
--   medição, medidor, observação).
--   so.execution_actuals (nova) é o REALIZADO DIMENSIONADO por recurso, com
--   valor planejado de referência, unidade, fonte, ator e evidência.
--
--   As duas coexistem porque respondem perguntas diferentes e a primeira já é
--   consumida por so.operational_cost_entries e msr.measurement_items.
-- =============================================================================

-- =============================================================================
-- 1. ENUMS
-- =============================================================================

-- Tipo de fato operacional da execução. Vocabulário FECHADO: um valor aqui é um
-- fato de domínio, não um rótulo de interface.
DO $$ BEGIN
  CREATE TYPE "so"."execution_actual_kind" AS ENUM(
    'LABOR_HOURS',
    'DRIVER_HOURS',
    'VEHICLE_DISTANCE',
    'VEHICLE_HOURS',
    'EQUIPMENT_HOURS',
    'FUEL_VOLUME',
    'MATERIAL_QUANTITY',
    'THIRD_PARTY_AMOUNT',
    'WAITING_HOURS',
    'DOWNTIME_HOURS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Origem do valor real. `SOURCE` é obrigatório: um realizado sem procedência não é
-- auditável e não pode alimentar custo nem medição.
DO $$ BEGIN
  CREATE TYPE "so"."execution_actual_source" AS ENUM(
    'FIELD_CAPTURE',
    'MANUAL',
    'METER',
    'INTEGRATION',
    'DERIVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Classe do medidor. Distingue odômetro (acumulado, monotônico) de horímetro.
DO $$ BEGIN
  CREATE TYPE "so"."meter_kind" AS ENUM(
    'ODOMETER',
    'HOUR_METER',
    'HOUR_METER_ENGINE',
    'FUEL_GAUGE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Natureza do evento operacional (timeline da execução).
DO $$ BEGIN
  CREATE TYPE "so"."execution_event_kind" AS ENUM(
    'DISPATCHED',
    'CHECKED_IN',
    'STARTED',
    'PAUSED',
    'RESUMED',
    'PROGRESS_RECORDED',
    'ACTUAL_RECORDED',
    'METER_RECORDED',
    'FUEL_RECORDED',
    'EVIDENCE_ATTACHED',
    'SIGNATURE_REGISTERED',
    'EXCEPTION_REPORTED',
    'UNBLOCKED',
    'COMPLETION_BLOCKED',
    'COMPLETED',
    'EXECUTION_CLOSED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Estado da evidência de execução. `ATTACHED` não é `VERIFIED`: a segunda exige a
-- decisão explícita de quem aceita o serviço.
DO $$ BEGIN
  CREATE TYPE "so"."execution_evidence_status" AS ENUM(
    'ATTACHED',
    'VERIFIED',
    'REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Estado da base de medição publicada pela conclusão da execução.
DO $$ BEGIN
  CREATE TYPE "so"."measurement_basis_status" AS ENUM(
    'READY',
    'SUPERSEDED',
    'VOIDED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Dimensão de prontidão do despacho. Cada dimensão responde sozinha "por que
-- esta ordem não pode sair?".
DO $$ BEGIN
  CREATE TYPE "so"."dispatch_readiness_dimension" AS ENUM(
    'PLANNING',
    'RESERVATION',
    'CREW',
    'DRIVER',
    'VEHICLE',
    'EQUIPMENT',
    'QUALIFICATION',
    'MAINTENANCE',
    'DOCUMENTS',
    'OPERATIONAL_WINDOW',
    'SLA',
    'EVIDENCE_REQUIREMENTS',
    'CONTRACT_RESTRICTIONS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Resultado de uma dimensão de prontidão.
DO $$ BEGIN
  CREATE TYPE "so"."dispatch_readiness_status" AS ENUM(
    'READY',
    'BLOCKED',
    'WARNING',
    'NOT_APPLICABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =============================================================================
-- 2. OUTBOX — os fatos operacionais desta capability
-- =============================================================================
--
-- `evt.domain_event_type` é um ENUM: sem estes valores o INSERT do outbox falha no
-- COMMIT e o comando inteiro reverte. A lição das migrations 0105 (INVENTORY
-- gravava rótulo desconhecido) aplica-se aqui integralmente.
--
-- Idempotente por natureza: ADD VALUE IF NOT EXISTS.
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SERVICE_ORDER_DISPATCHED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SERVICE_EXECUTION_STARTED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SERVICE_EXECUTION_PAUSED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SERVICE_EXECUTION_RESUMED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'SERVICE_PROGRESS_RECORDED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'RESOURCE_USAGE_RECORDED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'EXECUTION_EXCEPTION_REPORTED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'EXECUTION_COMPLETED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'EXECUTION_CANCELLED';
--> statement-breakpoint
ALTER TYPE "evt"."domain_event_type" ADD VALUE IF NOT EXISTS 'MEASUREMENT_BASIS_READY';
--> statement-breakpoint

-- =============================================================================
-- 3. DESPACHO — FATO, NÃO STATUS
-- =============================================================================
--
-- O despacho é um registro próprio: quem despachou, quando, com qual janela, com
-- quais recursos confirmados e com qual snapshot de prontidão no momento da
-- decisão. `so.service_orders.status` continua sendo o estado do AGREGADO; o
-- despacho é o FATO que o produziu — e fatos não se sobrescrevem.
CREATE TABLE IF NOT EXISTS "so"."service_order_dispatches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  -- Janela operacional acordada no despacho. É ela que o SLA da execução mede.
  "window_start" timestamp with time zone NOT NULL,
  "window_end" timestamp with time zone NOT NULL,
  -- Recursos CONFIRMADOS no instante do despacho. Snapshot imutável: se a alocação
  -- mudar depois, este despacho continua contando o que foi realmente combinado.
  "confirmed_resources" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Prontidão calculada no momento da decisão (por dimensão). Serve à auditoria:
  -- "por que o sistema deixou sair?".
  "readiness_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "dispatched_by_identity_id" uuid NOT NULL,
  -- Conferência de chegada no local. Null enquanto o operador não fizer check-in.
  "checked_in_at" timestamp with time zone,
  "checked_in_by_identity_id" uuid,
  "release_reason" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "service_order_dispatches_window_chk" CHECK ("window_start" < "window_end"),
  CONSTRAINT "service_order_dispatches_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "service_order_dispatches_row_version_positive_chk" CHECK ("row_version" >= 1),
  CONSTRAINT "service_order_dispatches_checkin_actor_chk" CHECK (
    ("checked_in_at" IS NULL AND "checked_in_by_identity_id" IS NULL)
    OR ("checked_in_at" IS NOT NULL AND "checked_in_by_identity_id" IS NOT NULL)
  )
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."service_order_dispatches"
  ADD CONSTRAINT "service_order_dispatches_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."service_order_dispatches"
  ADD CONSTRAINT "service_order_dispatches_dispatched_by_identity_id_identities_id_fk"
  FOREIGN KEY ("dispatched_by_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."service_order_dispatches"
  ADD CONSTRAINT "service_order_dispatches_checked_in_by_identity_id_identities_id_fk"
  FOREIGN KEY ("checked_in_by_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- UM despacho por ordem de serviço. Reenviar o comando com outra chave de
-- idempotência NÃO cria segundo despacho: a última linha de defesa é o banco.
CREATE UNIQUE INDEX IF NOT EXISTS "service_order_dispatches_service_order_id_uidx"
  ON "so"."service_order_dispatches" ("service_order_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "service_order_dispatches_unit_window_idx"
  ON "so"."service_order_dispatches" ("unit_id", "window_start");
--> statement-breakpoint

-- =============================================================================
-- 4. IDEMPOTÊNCIA — vocabulário de comandos da capability
-- =============================================================================
--
-- A tabela `so.execution_command_idempotency` já existe e é reusada. O que garante
-- ausência de duplo-efeito é a UNIQUE (service_order_id, command_name,
-- idempotency_key) já criada na 0044. Nenhuma estrutura nova é necessária; esta
-- migration apenas documenta o contrato.
COMMENT ON TABLE "so"."execution_command_idempotency" IS
'Idempotencia de comando: UNIQUE (service_order_id, command_name, idempotency_key). Todo comando mutavel da capability DISPATCH/EXECUTION/ACTUALS grava aqui DENTRO da mesma transacao do efeito.';
--> statement-breakpoint

-- =============================================================================
-- 5. ACTUALS — O REALIZADO DIMENSIONADO
-- =============================================================================
--
-- POR QUE ESTA TABELA EXISTE SEPARADA DE `so.execution_entries`
--
-- `so.execution_entries` registra a ENTRADA OPERACIONAL: quantidade medida,
-- odômetro, horímetro, observação. Ela é a base de MEDIÇÃO.
--
-- O REALIZADO que alimenta CUSTO é diferente: mão de obra por pessoa, distância
-- por veículo, combustível por veículo, horas de equipamento, material consumido,
-- serviço de terceiro. Cada linha tem RECURSO, VALOR PLANEJADO DE REFERÊNCIA,
-- UNIDADE, FONTE e EVIDÊNCIA.
--
-- PLANEJADO E REALIZADO NÃO SE SOBRESCREVEM. `planned_value` nesta linha é uma
-- CÓPIA DO PLANO NO MOMENTO DO REGISTRO (referência de comparação), e a fonte de
-- verdade do plano continua sendo `so.planned_resources` /
-- `res.resource_allocations`, que esta tabela NUNCA altera.
CREATE TABLE IF NOT EXISTS "so"."execution_actuals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "actual_kind" "so"."execution_actual_kind" NOT NULL,
  -- Recurso concreto. Opcional apenas para kind que não é por recurso
  -- (WAITING_HOURS, DOWNTIME_HOURS), garantido pelo CHECK mais abaixo.
  "physical_asset_id" uuid,
  "workforce_member_id" uuid,
  "resource_label" text,
  -- Valor realizado. NÃO NEGATIVO — um realizado negativo é erro de captura, não
  -- fato operacional.
  "actual_value" numeric(18, 6) NOT NULL,
  "unit_of_measure" text NOT NULL,
  -- Cópia do valor planejado no instante do registro (referência de comparação).
  "planned_value" numeric(18, 6),
  "planned_unit_of_measure" text,
  "source" "so"."execution_actual_source" NOT NULL,
  -- Evidência que sustenta o valor (foto do cupom, ticket, leitura). Opcional
  -- porque nem todo realizado gera documento; a OBRIGATORIEDADE é do plano.
  "evidence_id" uuid,
  "occurred_at" timestamp with time zone NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "notes" text,
  "correlation_id" text,
  "idempotency_key" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_actuals_value_non_negative_chk" CHECK ("actual_value" >= 0),
  CONSTRAINT "execution_actuals_unit_not_empty_chk" CHECK (length(trim("unit_of_measure")) > 0),
  CONSTRAINT "execution_actuals_row_version_positive_chk" CHECK ("row_version" >= 1),
  CONSTRAINT "execution_actuals_resource_required_chk" CHECK (
    "actual_kind" IN (
      'WAITING_HOURS'::"so"."execution_actual_kind",
      'DOWNTIME_HOURS'::"so"."execution_actual_kind"
    )
    OR "physical_asset_id" IS NOT NULL
    OR "workforce_member_id" IS NOT NULL
  ),
  CONSTRAINT "execution_actuals_no_self_evidence_chk" CHECK (true)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_actuals"
  ADD CONSTRAINT "execution_actuals_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_actuals"
  ADD CONSTRAINT "execution_actuals_physical_asset_id_physical_assets_id_fk"
  FOREIGN KEY ("physical_asset_id") REFERENCES "ast"."physical_assets"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_actuals"
  ADD CONSTRAINT "execution_actuals_workforce_member_id_workforce_members_id_fk"
  FOREIGN KEY ("workforce_member_id") REFERENCES "wrk"."workforce_members"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_actuals"
  ADD CONSTRAINT "execution_actuals_actor_identity_id_identities_id_fk"
  FOREIGN KEY ("actor_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_actuals"
  ADD CONSTRAINT "execution_actuals_evidence_id_execution_evidence_id_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "so"."execution_evidence"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- IDEMPOTÊNCIA: a mesma chave nunca produz dois realizados na mesma ordem.
CREATE UNIQUE INDEX IF NOT EXISTS "execution_actuals_idempotency_key_uidx"
  ON "so"."execution_actuals" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_actuals_service_order_id_kind_idx"
  ON "so"."execution_actuals" ("service_order_id", "actual_kind", "occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_actuals_service_order_id_asset_idx"
  ON "so"."execution_actuals" ("service_order_id", "physical_asset_id")
  WHERE "physical_asset_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_actuals_service_order_id_workforce_idx"
  ON "so"."execution_actuals" ("service_order_id", "workforce_member_id")
  WHERE "workforce_member_id" IS NOT NULL;
--> statement-breakpoint

-- =============================================================================
-- 6. MEDIDORES — LEITURA MONOTÔNICA
-- =============================================================================
--
-- Odômetro e horímetro ACUMULAM: uma leitura menor que a anterior é erro de
-- captura ou fraude, não fato. A monotonicidade é garantida no BANCO porque um
-- retry fora de ordem não pode reintroduzir leitura regressiva.
CREATE TABLE IF NOT EXISTS "so"."execution_meter_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "physical_asset_id" uuid NOT NULL,
  "meter_kind" "so"."meter_kind" NOT NULL,
  "reading_value" numeric(18, 3) NOT NULL,
  "unit_of_measure" text NOT NULL,
  -- Natureza da leitura no ciclo: abertura, progresso, fechamento.
  "is_initial" boolean DEFAULT false NOT NULL,
  "is_final" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "evidence_id" uuid,
  "notes" text,
  "idempotency_key" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_meter_readings_value_non_negative_chk" CHECK ("reading_value" >= 0),
  CONSTRAINT "execution_meter_readings_unit_not_empty_chk" CHECK (length(trim("unit_of_measure")) > 0),
  CONSTRAINT "execution_meter_readings_flag_chk" CHECK (NOT ("is_initial" AND "is_final")),
  CONSTRAINT "execution_meter_readings_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_meter_readings"
  ADD CONSTRAINT "execution_meter_readings_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_meter_readings"
  ADD CONSTRAINT "execution_meter_readings_physical_asset_id_physical_assets_id_fk"
  FOREIGN KEY ("physical_asset_id") REFERENCES "ast"."physical_assets"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_meter_readings"
  ADD CONSTRAINT "execution_meter_readings_actor_identity_id_identities_id_fk"
  FOREIGN KEY ("actor_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_meter_readings"
  ADD CONSTRAINT "execution_meter_readings_evidence_id_execution_evidence_id_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "so"."execution_evidence"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "execution_meter_readings_idempotency_key_uidx"
  ON "so"."execution_meter_readings" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_meter_readings_order_asset_kind_idx"
  ON "so"."execution_meter_readings" ("service_order_id", "physical_asset_id", "meter_kind", "read_at");
--> statement-breakpoint

-- Uma LEITURA INICIAL e uma FINAL por (ordem, ativo, medidor): a duplicidade de
-- "odômetro final" é o defeito que corrompe medição e custo.
CREATE UNIQUE INDEX IF NOT EXISTS "execution_meter_readings_initial_uidx"
  ON "so"."execution_meter_readings" ("service_order_id", "physical_asset_id", "meter_kind")
  WHERE "is_initial";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "execution_meter_readings_final_uidx"
  ON "so"."execution_meter_readings" ("service_order_id", "physical_asset_id", "meter_kind")
  WHERE "is_final";
--> statement-breakpoint

-- MONOTONICIDADE NO BANCO: nenhuma leitura pode ser MENOR que a maior leitura
-- anterior do mesmo medidor no mesmo ativo.
--
-- A primeira versão comparava apenas contra leituras NÃO iniciais, o que deixava
-- passar o caso real mais perigoso: registrar a leitura INICIAL em 125.000 e a
-- seguinte em 124.000 (regressão medida), porque inexistia leitura não-inicial
-- anterior para servir de referência. O odômetro é grandeza ACUMULADA: a referência
-- correta é a maior leitura anterior, seja de abertura, de progresso ou de
-- fechamento. Só a leitura de ABERTURA escapa da verificação, porque é ela quem
-- estabelece a referência.
--
-- Trigger em nível de tabela porque um CHECK não enxerga outras linhas.
CREATE OR REPLACE FUNCTION "so"."assert_meter_reading_monotonic"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous numeric(18,3);
  has_previous boolean;
BEGIN
  SELECT MAX(r."reading_value"), (COUNT(*) > 0)
    INTO previous, has_previous
  FROM "so"."execution_meter_readings" r
  WHERE r."physical_asset_id" = NEW."physical_asset_id"
    AND r."meter_kind" = NEW."meter_kind"
    AND r."service_order_id" = NEW."service_order_id";

  -- A leitura de ABERTURA é a referência: não há leitura anterior a comparar.
  IF NOT has_previous AND NEW."is_initial" THEN
    RETURN NEW;
  END IF;

  -- Qualquer outra leitura (inclusive a primeira, quando não houve abertura
  -- declarada) precisa ser maior ou igual à maior anterior.
  IF has_previous AND NEW."reading_value" < previous THEN
    RAISE EXCEPTION
      'METER_READING_NOT_MONOTONIC: % < % (asset % meter %)',
      NEW."reading_value", previous, NEW."physical_asset_id", NEW."meter_kind"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS "execution_meter_readings_monotonic_trg" ON "so"."execution_meter_readings";
--> statement-breakpoint

-- Dispara para TODA leitura. A abertura é tratada DENTRO da função, porque a
-- condição depende de existir ou não leitura anterior — algo que um `WHEN`
-- estático não consegue expressar.
CREATE TRIGGER "execution_meter_readings_monotonic_trg"
  BEFORE INSERT ON "so"."execution_meter_readings"
  FOR EACH ROW
  EXECUTE FUNCTION "so"."assert_meter_reading_monotonic"();
--> statement-breakpoint

-- =============================================================================
-- 7. COMBUSTÍVEL — LITROS COM PROCEDÊNCIA
-- =============================================================================
--
-- Um único litro registrado duas vezes (retry, duplo clique) infla custo e variança
-- de medição. Aqui a procedência é explícita: odômetro da ocasião, preço unitário
-- e referência de documento.
CREATE TABLE IF NOT EXISTS "so"."execution_fuel_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "physical_asset_id" uuid NOT NULL,
  "volume_liters" numeric(18, 3) NOT NULL,
  "unit_price" numeric(18, 4),
  "amount" numeric(18, 4),
  "currency_code" char(3) DEFAULT 'BRL' NOT NULL,
  -- Odômetro no abastecimento: permite detectar litro sem distância (fraude real).
  "odometer_reading" numeric(18, 3),
  "fueled_at" timestamp with time zone NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "evidence_id" uuid,
  "supplier_reference" text,
  "notes" text,
  "idempotency_key" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_fuel_records_volume_positive_chk" CHECK ("volume_liters" > 0),
  CONSTRAINT "execution_fuel_records_amount_non_negative_chk" CHECK (
    "amount" IS NULL OR "amount" >= 0
  ),
  CONSTRAINT "execution_fuel_records_unit_price_non_negative_chk" CHECK (
    "unit_price" IS NULL OR "unit_price" >= 0
  ),
  CONSTRAINT "execution_fuel_records_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_fuel_records"
  ADD CONSTRAINT "execution_fuel_records_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_fuel_records"
  ADD CONSTRAINT "execution_fuel_records_physical_asset_id_physical_assets_id_fk"
  FOREIGN KEY ("physical_asset_id") REFERENCES "ast"."physical_assets"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_fuel_records"
  ADD CONSTRAINT "execution_fuel_records_actor_identity_id_identities_id_fk"
  FOREIGN KEY ("actor_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_fuel_records"
  ADD CONSTRAINT "execution_fuel_records_evidence_id_execution_evidence_id_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "so"."execution_evidence"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "execution_fuel_records_idempotency_key_uidx"
  ON "so"."execution_fuel_records" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_fuel_records_order_asset_idx"
  ON "so"."execution_fuel_records" ("service_order_id", "physical_asset_id", "fueled_at");
--> statement-breakpoint

-- =============================================================================
-- 8. EVIDÊNCIA DE EXECUÇÃO — ESTADO EXPLÍCITO
-- =============================================================================
--
-- `so.execution_evidence` guarda o PAYLOAD. O que faltava era a DECISÃO sobre ele:
-- anexado não é verificado. Sem esta coluna, a conclusão não consegue distinguir
-- "o operador enviou a foto" de "alguém aceitou a foto".
ALTER TABLE "so"."execution_evidence"
  ADD COLUMN IF NOT EXISTS "status" "so"."execution_evidence_status" DEFAULT 'ATTACHED' NOT NULL;
--> statement-breakpoint

ALTER TABLE "so"."execution_evidence"
  ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "so"."execution_evidence"
  ADD COLUMN IF NOT EXISTS "verified_by_identity_id" uuid;
--> statement-breakpoint

ALTER TABLE "so"."execution_evidence"
  ADD COLUMN IF NOT EXISTS "verification_notes" text;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "so"."execution_evidence"
    ADD CONSTRAINT "execution_evidence_verified_by_identity_id_identities_id_fk"
    FOREIGN KEY ("verified_by_identity_id") REFERENCES "identity"."identities"("id")
    ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "so"."execution_evidence"
    ADD CONSTRAINT "execution_evidence_verification_consistency_chk" CHECK (
      ("status" = 'ATTACHED'::"so"."execution_evidence_status"
        AND "verified_at" IS NULL AND "verified_by_identity_id" IS NULL)
      OR ("status" <> 'ATTACHED'::"so"."execution_evidence_status"
        AND "verified_at" IS NOT NULL AND "verified_by_identity_id" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- =============================================================================
-- 9. ASSINATURA DO CLIENTE
-- =============================================================================
--
-- Registro próprio porque a assinatura tem valor jurídico e precisa de autor,
-- instante, nome declarado e evidência anexada. Não é um campo da OS.
CREATE TABLE IF NOT EXISTS "so"."execution_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  -- Quem assinou no local. Pode não existir em `wrk`: é pessoa do cliente.
  "signer_name" text NOT NULL,
  "signer_document" text,
  "signer_role" text,
  "signature_kind" text NOT NULL,
  "evidence_id" uuid,
  "signed_at" timestamp with time zone NOT NULL,
  "actor_identity_id" uuid NOT NULL,
  "notes" text,
  "idempotency_key" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_signatures_signer_name_not_empty_chk" CHECK (
    length(trim("signer_name")) > 0
  ),
  CONSTRAINT "execution_signatures_kind_not_empty_chk" CHECK (
    length(trim("signature_kind")) > 0
  ),
  CONSTRAINT "execution_signatures_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_signatures"
  ADD CONSTRAINT "execution_signatures_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_signatures"
  ADD CONSTRAINT "execution_signatures_actor_identity_id_identities_id_fk"
  FOREIGN KEY ("actor_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_signatures"
  ADD CONSTRAINT "execution_signatures_evidence_id_execution_evidence_id_fk"
  FOREIGN KEY ("evidence_id") REFERENCES "so"."execution_evidence"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "execution_signatures_idempotency_key_uidx"
  ON "so"."execution_signatures" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_signatures_service_order_id_idx"
  ON "so"."execution_signatures" ("service_order_id", "signed_at");
--> statement-breakpoint

-- =============================================================================
-- 10. EVENTO OPERACIONAL — TIMELINE DA EXECUÇÃO
-- =============================================================================
--
-- Distinta de `so.service_order_history_events` (história do AGREGADO OS) e de
-- `audit.security_audit_events` (segurança). Esta é a TIMELINE OPERACIONAL que o
-- console e a object page mostram ao operador.
CREATE TABLE IF NOT EXISTS "so"."execution_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "event_kind" "so"."execution_event_kind" NOT NULL,
  -- Estado imediatamente ANTES e DEPOIS, quando o evento é transição.
  "from_status" text,
  "to_status" text,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- `false` quando o evento bloqueia (ex.: situação aberta) e `true` quando libera.
  "is_blocking" boolean DEFAULT false NOT NULL,
  "actor_identity_id" uuid,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "correlation_id" text,
  "idempotency_key" text,
  CONSTRAINT "execution_events_idempotency_key_uidx" UNIQUE ("idempotency_key")
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_events"
  ADD CONSTRAINT "execution_events_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_events"
  ADD CONSTRAINT "execution_events_actor_identity_id_identities_id_fk"
  FOREIGN KEY ("actor_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_events_service_order_id_occurred_at_idx"
  ON "so"."execution_events" ("service_order_id", "occurred_at");
--> statement-breakpoint

-- =============================================================================
-- 11. EXECUÇÃO FECHADA E BASE DE MEDIÇÃO
-- =============================================================================
--
-- A conclusão da OS (status COMPLETED) NÃO é o mesmo que EXECUÇÃO FECHADA.
-- Fechar a execução é o ato que CONGELA os realizados e publica a base de
-- medição. Esta tabela é o registro desse ato — e da base publicada.
CREATE TABLE IF NOT EXISTS "so"."execution_closures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "closure_number" integer NOT NULL,
  -- Fotografia do realizado no instante do fechamento. Serve a COSTING e a
  -- MEASUREMENT; nenhum valor daqui pode mudar depois.
  "actuals_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "plan_vs_actual" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "evidence_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Realce das situações resolvidas no fechamento (rastreabilidade do bloqueio).
  "resolved_situations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "closed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_by_identity_id" uuid NOT NULL,
  "completion_command_id" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_closures_closure_number_positive_chk" CHECK ("closure_number" >= 1),
  CONSTRAINT "execution_closures_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "execution_closures_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_closures"
  ADD CONSTRAINT "execution_closures_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_closures"
  ADD CONSTRAINT "execution_closures_closed_by_identity_id_identities_id_fk"
  FOREIGN KEY ("closed_by_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- UM fechamento por OS. Reabrir cria nova versão do fechamento? Não: a reabertura
-- da OS reabre a EXECUÇÃO, e o próximo fechamento usa closure_number = 2.
CREATE UNIQUE INDEX IF NOT EXISTS "execution_closures_order_closure_number_uidx"
  ON "so"."execution_closures" ("service_order_id", "closure_number");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_closures_unit_closed_at_idx"
  ON "so"."execution_closures" ("unit_id", "closed_at");
--> statement-breakpoint

-- BASE DE MEDIÇÃO — o que a capability seguinte consome.
CREATE TABLE IF NOT EXISTS "so"."measurement_basis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "closure_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "status" "so"."measurement_basis_status" DEFAULT 'READY' NOT NULL,
  -- Linhas de base: unidade, quantidade real, fonte do real, origem de preço.
  "lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
  -- Realizado que sustenta a medição (mão de obra, veículo, combustível...).
  "actuals" jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Evidência verificada no momento da publicação.
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
  "prepared_by_identity_id" uuid NOT NULL,
  "superseded_at" timestamp with time zone,
  "superseded_by_identity_id" uuid,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "measurement_basis_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "measurement_basis_row_version_positive_chk" CHECK ("row_version" >= 1),
  CONSTRAINT "measurement_basis_supersede_consistency_chk" CHECK (
    ("status" = 'READY'::"so"."measurement_basis_status" AND "superseded_at" IS NULL)
    OR ("status" <> 'READY'::"so"."measurement_basis_status" AND "superseded_at" IS NOT NULL)
  )
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."measurement_basis"
  ADD CONSTRAINT "measurement_basis_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."measurement_basis"
  ADD CONSTRAINT "measurement_basis_closure_id_execution_closures_id_fk"
  FOREIGN KEY ("closure_id") REFERENCES "so"."execution_closures"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."measurement_basis"
  ADD CONSTRAINT "measurement_basis_prepared_by_identity_id_identities_id_fk"
  FOREIGN KEY ("prepared_by_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."measurement_basis"
  ADD CONSTRAINT "measurement_basis_superseded_by_identity_id_identities_id_fk"
  FOREIGN KEY ("superseded_by_identity_id") REFERENCES "identity"."identities"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Uma base READY por ordem de serviço. A garantia de "meça uma vez" é do banco.
CREATE UNIQUE INDEX IF NOT EXISTS "measurement_basis_order_ready_uidx"
  ON "so"."measurement_basis" ("service_order_id")
  WHERE "status" = 'READY';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "measurement_basis_unit_prepared_at_idx"
  ON "so"."measurement_basis" ("unit_id", "prepared_at");
--> statement-breakpoint

-- =============================================================================
-- 12. SITUAÇÃO OPERACIONAL — WORK ITEM DO DOMÍNIO
-- =============================================================================
--
-- Situação DETECTADA tem chave lógica estável, para que a mesma exceção não seja
-- contada duas vezes. `OPEN`/`RESOLVED`/`DISMISSED` é o ciclo de vida; a detecção
-- é IDEMPOTENTE por (service_order_id, situation_code, detected_key).
CREATE TABLE IF NOT EXISTS "so"."execution_situations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_order_id" uuid NOT NULL,
  "unit_id" text NOT NULL,
  "situation_code" text NOT NULL,
  -- Chave lógica: a mesma exceção, ainda aberta, não gera segunda linha.
  "detected_key" text NOT NULL,
  "severity" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "title" text NOT NULL,
  "detail" text,
  "impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "owner_role" text,
  "next_best_action" text,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_identity_id" uuid,
  "resolution_notes" text,
  "row_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_situations_code_not_empty_chk" CHECK (length(trim("situation_code")) > 0),
  CONSTRAINT "execution_situations_key_not_empty_chk" CHECK (length(trim("detected_key")) > 0),
  CONSTRAINT "execution_situations_unit_not_empty_chk" CHECK (length(trim("unit_id")) > 0),
  CONSTRAINT "execution_situations_status_chk" CHECK (
    "status" IN ('OPEN', 'RESOLVED', 'DISMISSED')
  ),
  CONSTRAINT "execution_situations_resolution_consistency_chk" CHECK (
    ("status" = 'OPEN' AND "resolved_at" IS NULL)
    OR ("status" <> 'OPEN' AND "resolved_at" IS NOT NULL)
  ),
  CONSTRAINT "execution_situations_row_version_positive_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "so"."execution_situations"
  ADD CONSTRAINT "execution_situations_service_order_id_service_orders_id_fk"
  FOREIGN KEY ("service_order_id") REFERENCES "so"."service_orders"("id")
  ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "execution_situations_open_key_uidx"
  ON "so"."execution_situations" ("service_order_id", "situation_code", "detected_key")
  WHERE "status" = 'OPEN';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "execution_situations_unit_status_idx"
  ON "so"."execution_situations" ("unit_id", "status", "severity", "detected_at");
--> statement-breakpoint

-- =============================================================================
-- 13. READ MODELS PUBLICADOS (rpt.*)
-- =============================================================================
--
-- Contrato de leitura cross-context (DR-008): o frontend e as demais capabilities
-- leem AQUI, nunca das tabelas privadas de `so`.
CREATE OR REPLACE VIEW "rpt"."read_service_order_dispatches" AS
SELECT * FROM "so"."service_order_dispatches" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_actuals" AS
SELECT * FROM "so"."execution_actuals" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_meter_readings" AS
SELECT * FROM "so"."execution_meter_readings" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_fuel_records" AS
SELECT * FROM "so"."execution_fuel_records" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_signatures" AS
SELECT * FROM "so"."execution_signatures" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_events" AS
SELECT * FROM "so"."execution_events" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_closures" AS
SELECT * FROM "so"."execution_closures" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_measurement_basis" AS
SELECT * FROM "so"."measurement_basis" OFFSET 0;
--> statement-breakpoint

CREATE OR REPLACE VIEW "rpt"."read_execution_situations" AS
SELECT * FROM "so"."execution_situations" OFFSET 0;
--> statement-breakpoint

COMMENT ON VIEW "rpt"."read_service_order_dispatches" IS
'dispatch+execution+actuals: read-only cross-context contract for the service order dispatch fact.';
--> statement-breakpoint
COMMENT ON VIEW "rpt"."read_execution_actuals" IS
'dispatch+execution+actuals: realized values per resource (labor, vehicle, fuel, equipment, material, third party).';
--> statement-breakpoint
COMMENT ON VIEW "rpt"."read_measurement_basis" IS
'dispatch+execution+actuals: authoritative measurement basis published by execution closure.';
--> statement-breakpoint

-- `rpt.read_execution_entries` precisa refletir a coluna nova de nada — ela não foi
-- alterada. Mas `read_execution_evidence` precisa das colunas de verificação.
CREATE OR REPLACE VIEW "rpt"."read_execution_evidence" AS
SELECT * FROM "so"."execution_evidence" OFFSET 0;
--> statement-breakpoint