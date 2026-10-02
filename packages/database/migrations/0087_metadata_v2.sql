-- METADATA STORE V2 — as quatro capacidades que a v1 não cobria.
--
-- A v1 (0084/0085/0086) descrevia CAMPOS: nome, rótulo, tipo, ordem, permissão. Isso basta para
-- um CRUD e não basta para uma tela de ERP, porque a massa de uma tela de ERP está no que NÃO é
-- campo: valor derivado, total de coluna, campo que só aparece sob condição, e linha colorida
-- por regra de negócio.
--
-- Esta migration ACRESCENTA o que falta ao STORE. Não altera tabela de negócio, não toca
-- `pty.*`, `fin.*` nem `so.*` — só `meta.*`.
--
-- Idempotente: todo DDL usa IF NOT EXISTS e todo INSERT usa ON CONFLICT.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 1. COMPUTED FIELDS — campo derivado por fórmula, sem coluna no banco
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Tabela própria e não coluna em `meta.fields`: um campo computado NÃO tem coluna no banco. Ele
-- é a expressão de uma FÓRMULA sobre outros campos. Misturá-lo em `meta.fields` faria a engine
-- acreditar que existe dado persistido onde não existe — e a distinção é o que impede a tela de
-- tentar gravar um valor derivado.

CREATE TABLE IF NOT EXISTS "meta"."computed_fields" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES "meta"."entities"(id) ON DELETE CASCADE,
  name character varying(80) NOT NULL,
  label character varying(160) NOT NULL,
  type character varying(24) NOT NULL,
  -- Fórmula em JSON simples: {"op": "diff_days", "args": ["today", "updated_at"]}.
  -- Não é SQL nem JS: é uma ÁRVORE que a engine interpreta com um conjunto FECHADO de
  -- operadores. Fórmula livre seria execução de código vindo do banco.
  formula jsonb NOT NULL,
  field_order integer NOT NULL DEFAULT 0,
  in_list boolean NOT NULL DEFAULT true,
  list_order integer NOT NULL DEFAULT 0,
  in_form boolean NOT NULL DEFAULT false,
  perm_level integer NOT NULL DEFAULT 0,
  aggregation character varying(8),
  visible_when jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT computed_fields_entity_name_uq UNIQUE (entity_id, name),
  CONSTRAINT computed_fields_name_not_empty_chk CHECK (length(TRIM(BOTH FROM name)) > 0),
  CONSTRAINT computed_fields_label_not_empty_chk CHECK (length(TRIM(BOTH FROM label)) > 0),
  CONSTRAINT computed_fields_perm_level_chk CHECK (perm_level >= 0),
  CONSTRAINT computed_fields_aggregation_chk CHECK (
    aggregation IS NULL OR aggregation IN ('sum','count','avg','min','max')
  ),
  CONSTRAINT computed_fields_type_chk CHECK (
    type IN ('data','text','currency','select','link','date','datetime','bool','integer')
  )
);

CREATE INDEX IF NOT EXISTS "computed_fields_entity_order_idx"
  ON "meta"."computed_fields" (entity_id, field_order);--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 2. AGGREGATIONS — totalização por coluna, declarada no campo
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- A v1 tinha `showTotals` no COMPONENTE: a tela pedia "mostre totais" e a engine somava
-- qualquer coluna `currency`. Isso é decisão de apresentação no código. Aqui a decisão volta
-- para o metadado: cada campo DIZ como se totaliza, e campo sem `aggregation` não é totalizado
-- — em vez de a engine adivinhar por tipo.

ALTER TABLE "meta"."fields" ADD COLUMN IF NOT EXISTS aggregation character varying(8);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_fields_aggregation_chk') THEN
    ALTER TABLE "meta"."fields"
      ADD CONSTRAINT meta_fields_aggregation_chk
      CHECK (aggregation IS NULL OR aggregation IN ('sum','count','avg','min','max'));
  END IF;
END $$;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 3. CONDITIONAL FIELDS — visibilidade condicional declarada no campo
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Era o bloqueio declarado na sessão anterior: o formulário de conta tinha campos bancários que
-- só aparecem quando `kind = BANK`, e o metadado não sabia expressar isso. Sem esta coluna,
-- migrar aquela tela perderia a condicionalidade — que é regra visível.

ALTER TABLE "meta"."fields" ADD COLUMN IF NOT EXISTS visible_when jsonb;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 4. ROW ACCENTS — cor de linha por regra de negócio, declarada na view
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Fica na VIEW e não no campo: "linha vermelha quando vencido" é decisão sobre a LISTA, e a
-- mesma entidade pode ter listas com regras diferentes. É uma lista ORDENADA — a primeira regra
-- que casar vence, o que permite declarar precedência (crítico antes de aviso).

ALTER TABLE "meta"."views" ADD COLUMN IF NOT EXISTS row_accent jsonb;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- SEED DE DEMONSTRAÇÃO — prova as 4 capacidades sobre `service-orders`, entidade já registrada
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Idempotente por ON CONFLICT. Estes registros existem para que as 4 capacidades tenham
-- DECLARAÇÃO REAL no store: sem eles, a engine lê os campos novos e não encontra nada.

-- Campo computado: dias desde a última alteração da OS.
INSERT INTO "meta"."computed_fields"
  (entity_id, name, label, type, formula, field_order, in_list, list_order, aggregation, perm_level)
SELECT e.id, 'aging_days', 'Dias em atraso', 'integer',
       '{"op":"diff_days","args":["today","updated_at"]}'::jsonb,
       1, true, 7, 'max', 0
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, formula = EXCLUDED.formula, aggregation = EXCLUDED.aggregation;--> statement-breakpoint

-- Agregação: `row_version` totaliza por soma.
UPDATE "meta"."fields"
   SET aggregation = 'sum'
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'service-orders')
   AND name = 'row_version';--> statement-breakpoint

-- Condicional: `contract_reference` só aparece quando a origem é PROPOSTA.
UPDATE "meta"."fields"
   SET visible_when = '{"field":"origin","equals":"PROPOSAL"}'::jsonb
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'service-orders')
   AND name = 'contract_reference';--> statement-breakpoint

-- Accent de linha: RELEASED recebe `critical`.
UPDATE "meta"."views"
   SET row_accent = '[{"when":{"field":"status","equals":"RELEASED"},"accent":"critical"}]'::jsonb
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'service-orders')
   AND view_type = 'list';--> statement-breakpoint
