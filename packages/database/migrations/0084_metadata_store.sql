-- METADATA STORE — Camada 1 da engine de ERP.
--
-- POR QUE ESTAS TABELAS EXISTEM
--
-- Até aqui, adicionar um campo a uma entidade exigia: coluna no banco, tipo TypeScript,
-- DTO, serializer e JSX. Em ERPNext/Odoo/Tryton, exige UM registro de metadado — o resto é
-- derivado. Estas tabelas são o registro.
--
-- O schema `meta` é distinto de `infrastructure`/`platform` de propósito: é a camada de
-- DEFINIÇÃO, consumida em runtime tanto pela API quanto pela engine de renderização.
-- Não contém dado de negócio — contém a FORMA do dado de negócio.

CREATE SCHEMA IF NOT EXISTS "meta";--> statement-breakpoint

-- ── Entidades ────────────────────────────────────────────────────────────────────────────
--
-- Uma linha por entidade exposta pela engine. `data_schema`/`data_table` permitem que a
-- engine resolva o recurso real sem embutir o nome da tabela no código do frontend.
CREATE TABLE IF NOT EXISTS "meta"."entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar(80) NOT NULL,
  "label" varchar(120) NOT NULL,
  "data_schema" varchar(63) NOT NULL,
  "data_table" varchar(63) NOT NULL,
  "label_field" varchar(80) NOT NULL,
  "description" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_entities_name_not_empty_chk" CHECK (length(trim("name")) > 0),
  CONSTRAINT "meta_entities_name_uq" UNIQUE ("name")
);--> statement-breakpoint

-- ── Campos ───────────────────────────────────────────────────────────────────────────────
--
-- `perm_level` é o Odoo `groups=` traduzido: 0 = público para quem lê a entidade,
-- 1+ = exige permissão adicional declarada em `meta.permissions`. O FieldRenderer NÃO
-- renderiza campo acima do nível do usuário — não é "desabilitado", não existe no DOM.
--
-- `field_order` no formulário e `list_order` na lista são colunas separadas de propósito:
-- a mesma entidade pode querer ordem diferente em cada superfície.
CREATE TABLE IF NOT EXISTS "meta"."fields" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "meta"."entities"("id") ON DELETE CASCADE,
  "name" varchar(80) NOT NULL,
  "label" varchar(160) NOT NULL,
  "type" varchar(24) NOT NULL,
  "required" boolean NOT NULL DEFAULT false,
  "read_only" boolean NOT NULL DEFAULT false,
  "perm_level" integer NOT NULL DEFAULT 0,
  "options" jsonb,
  "field_order" integer NOT NULL DEFAULT 0,
  "in_form" boolean NOT NULL DEFAULT true,
  "in_list" boolean NOT NULL DEFAULT false,
  "list_order" integer NOT NULL DEFAULT 0,
  "in_filter" boolean NOT NULL DEFAULT false,
  "in_search" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_fields_name_not_empty_chk" CHECK (length(trim("name")) > 0),
  CONSTRAINT "meta_fields_perm_level_chk" CHECK ("perm_level" >= 0),
  CONSTRAINT "meta_fields_type_chk" CHECK (
    "type" IN ('data','text','currency','select','link','date','datetime','bool','integer')
  ),
  CONSTRAINT "meta_fields_entity_name_uq" UNIQUE ("entity_id", "name")
);--> statement-breakpoint

-- ── Views ────────────────────────────────────────────────────────────────────────────────
--
-- A forma da tela é um REGISTRO, não JSX. `layout` guarda a ordem e os grupos em jsonb para
-- que a engine renderize sem conhecer a entidade.
CREATE TABLE IF NOT EXISTS "meta"."views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "meta"."entities"("id") ON DELETE CASCADE,
  "view_type" varchar(16) NOT NULL,
  "label" varchar(120) NOT NULL,
  "layout" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_views_type_chk" CHECK ("view_type" IN ('form','list','kanban','calendar')),
  CONSTRAINT "meta_views_entity_type_uq" UNIQUE ("entity_id", "view_type")
);--> statement-breakpoint

-- ── Workflow ─────────────────────────────────────────────────────────────────────────────
--
-- A state machine de service-orders (`TRANSITIONS` em TypeScript) vira DADO. Cada transição
-- carrega o comando, os estados de origem/destino e a permissão exigida — a mesma
-- informação que `available-actions` devolvia por código.
CREATE TABLE IF NOT EXISTS "meta"."workflows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "meta"."entities"("id") ON DELETE CASCADE,
  "state_field" varchar(80) NOT NULL,
  "states" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_workflows_entity_uq" UNIQUE ("entity_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "meta"."workflow_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workflow_id" uuid NOT NULL REFERENCES "meta"."workflows"("id") ON DELETE CASCADE,
  "command" varchar(60) NOT NULL,
  "label" varchar(120) NOT NULL,
  "from_states" jsonb NOT NULL,
  "to_state" varchar(60) NOT NULL,
  "permission" varchar(120) NOT NULL,
  "requires_reason" boolean NOT NULL DEFAULT false,
  "button_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_workflow_transitions_cmd_uq" UNIQUE ("workflow_id", "command")
);--> statement-breakpoint

-- ── Permissões ───────────────────────────────────────────────────────────────────────────
--
-- Permissão por CAMPO (além da permissão por ação que o RBAC já cobre). `min_perm_level`
-- define o nível mínimo para ver/editar; o RBAC continua decidindo a ação.
CREATE TABLE IF NOT EXISTS "meta"."permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entity_id" uuid NOT NULL REFERENCES "meta"."entities"("id") ON DELETE CASCADE,
  "action" varchar(40) NOT NULL,
  "perm_level" integer NOT NULL DEFAULT 0,
  "required_permission" varchar(120),
  "description" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meta_permissions_level_chk" CHECK ("perm_level" >= 0),
  CONSTRAINT "meta_permissions_entity_action_uq" UNIQUE ("entity_id", "action")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "meta_fields_entity_order_idx"
  ON "meta"."fields" ("entity_id", "field_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_views_entity_idx"
  ON "meta"."views" ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_workflow_transitions_workflow_idx"
  ON "meta"."workflow_transitions" ("workflow_id", "button_order");
