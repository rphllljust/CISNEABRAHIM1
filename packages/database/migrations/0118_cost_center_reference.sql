-- CENTRO DE CUSTO — entidade de referencia que faltava.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- O QUE ESTA MIGRATION CORRIGE (diagnostico medido no repositorio, nao em documentacao)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- `fin.payables.cost_center_id` (0045) e `fin.expenses.cost_center_id` (0069) sao `uuid NOT NULL`
-- SEM `REFERENCES`: nao existe tabela `fin.cost_centers` em nenhum ponto desta cadeia. O valor
-- persistido so podia vir de um literal, e todas as suites de teste o alimentam exatamente assim
-- (`costCenterId: crypto.randomUUID()`).
--
-- O efeito no produto: `POST finance/payables` e `POST finance/expenses` exigem um centro de custo
-- que ninguem consegue consultar. A `CISNE_FINISH_MATRIX` registra isso como
-- `PARK: HUMAN_LOOKUP_API_GAP` em quatro consumidores (procurement receive, supplier-invoice,
-- fiscal tax-assessment, finance expenses). Sem esta tabela nao ha como fechar a lacuna sem
-- inventar dado — e inventar dado e proibido.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- O QUE ESTA MIGRATION NAO FAZ (limites explicitos)
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   1. NAO adiciona `REFERENCES` em `cost_center_id`. Os registros existentes carregam UUIDs
--      arbitrarios; uma FK exigiria backfill e falharia em massa sobre dado real. A tabela passa
--      a existir como FONTE AUTORITATIVA de referencia para quem ESCOLHE, e a integridade para
--      escritas NOVAS e impostos no servico (validacao de existencia), nao por constraint
--      destrutiva. Registrado como pendencia de convergencia.
--   2. NAO cria dado de negocio. Nenhuma linha de centro de custo e inserida: a taxonomia real e
--      decisao empresarial (AGENTS.md §24 — nao inventar identificadores nem cardinalidades).
--   3. NAO altera nenhuma coluna existente.
--
-- Nenhuma migration anterior e reescrita; nenhum dado e apagado.

CREATE SCHEMA IF NOT EXISTS fin;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS fin.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CONSTRAINT cost_centers_status_ck
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_identity_id uuid NOT NULL REFERENCES identity.identities(id),
  updated_by_identity_id uuid NOT NULL REFERENCES identity.identities(id)
);--> statement-breakpoint

-- Codigo unico: e o identificador HUMANO usado por quem escolhe o centro de custo. Duplicar
-- codigo tornaria a busca ambigua e a referencia enganosa.
CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_code_uidx
  ON fin.cost_centers (code);--> statement-breakpoint

-- A listagem filtra por status e ordena por codigo (padrao de toda referencia humana do ERP).
CREATE INDEX IF NOT EXISTS cost_centers_status_code_idx
  ON fin.cost_centers (status, code);

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- METADADO — a engine de renderizacao so desenha o que `meta.*` declara (precedente: 0086).
-- Sem estas linhas a tela de centro de custo nao renderiza, mesmo com a tabela existindo.
-- Idempotente via ON CONFLICT.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'cost-centers', 'Centros de custo', 'fin', 'cost_centers', 'name',
  'Centro de custo: unidade de acumulacao de gasto usada por despesa e conta a pagar.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('code',   'Código', 'data',   true,  false, 0, NULL::jsonb, 1, true, true,  1, true,  true),
  ('name',   'Nome',   'data',   true,  false, 0, NULL,        2, true, true,  2, false, true),
  ('status', 'Situação', 'select', true, false, 0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"INACTIVE","label":"Inativo"}]}'::jsonb,
     3, true, true,  3, true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'cost-centers'
ON CONFLICT (entity_id, name) DO UPDATE SET label = EXCLUDED.label;
