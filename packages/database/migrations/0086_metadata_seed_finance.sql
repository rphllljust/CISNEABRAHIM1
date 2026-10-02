-- SEED DO METADATA STORE — FINANCEIRO (fin.*).
--
-- Registra no metadata store as entidades financeiras que JÁ EXISTEM no banco. NÃO cria
-- tabela, NÃO altera coluna, NÃO adiciona endpoint: cada linha abaixo corresponde a uma coluna
-- REAL lida de `information_schema.columns`, e cada estado corresponde ao enum REAL da coluna
-- de ciclo de vida.
--
-- Por que esta migration existe: a engine de renderização só desenha o que `meta.*` declara.
-- Sem estas linhas, migrar qualquer tela de Financeiro seria impossível — não por falta de
-- capacidade da engine, mas por falta de METADADO. Foi exatamente o bloqueio diagnosticado.
--
-- Idempotente: todo INSERT usa ON CONFLICT, então rodar duas vezes não duplica e não quebra.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- CAIXA E BANCOS (fin.financial_accounts) — a tela lista CONTAS, não o subtipo cash_accounts
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- NOTA DE MODELAGEM: `fin.cash_accounts` tem apenas (financial_account_id, location_code) — é
-- um SUBTIPO de `fin.financial_accounts`, que carrega código, nome, moeda e ciclo de vida. A
-- tela "Caixa e Bancos" (`TreasuryListPage`) lista contas por `kind`, então a entidade
-- registrada é a tabela-mãe. Registrar o subtipo daria uma entidade de duas colunas, sem nome
-- nem situação — incapaz de renderizar a tela.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'treasury-accounts', 'Caixa e bancos', 'fin', 'financial_accounts', 'name',
  'Conta financeira (caixa, banco ou aplicação). Subtipo cash_accounts detalha o caixa.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('code',       'Código',        'data',     false, true,  0, NULL::jsonb, 1,  true,  true,  1, true,  true),
  ('name',       'Nome',          'data',     false, false, 0, NULL,        2,  true,  true,  2, false, true),
  ('kind',       'Tipo',          'select',   false, true,  0,
     '{"options":[{"value":"CASH","label":"Caixa"},{"value":"BANK","label":"Banco"},{"value":"INVESTMENT","label":"Aplicação"}]}'::jsonb,
     3,  true,  true,  3, true,  false),
  ('currency_code','Moeda',       'data',     false, false, 0, NULL,        4,  true,  true,  4, false, false),
  ('unit_id',    'Unidade',       'link',     false, true,  0, '{"entity":"units"}'::jsonb, 5, true, true, 5, true, false),
  ('lifecycle',  'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"ACTIVE","label":"Ativa"},{"value":"CLOSED","label":"Encerrada"}]}'::jsonb,
     6,  true,  true,  6, true,  false),
  ('overdraft_allowed','Permite saldo negativo','bool', false, false, 0, NULL, 7, true, false, 0, false, false),
  ('row_version','Versão',        'integer',  false, true,  0, NULL,        8,  false, false, 0, false, false),
  ('created_at', 'Criada em',     'datetime', false, true,  0, NULL,        9,  false, true,  7, false, false),
  ('closed_at',  'Encerrada em',  'datetime', false, true,  0, NULL,       10,  true,  false, 0, false, false),
  ('close_reason','Motivo do encerramento','text', false, true, 0, NULL,    11,  true,  false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'treasury-accounts'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de caixa e bancos',
  '{"columns":["code","name","kind","currency_code","lifecycle","created_at"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'treasury-accounts'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de conta',
  '{"sections":[{"title":"Identificação","fields":["code","name","kind","unit_id"]},{"title":"Financeiro","fields":["currency_code","overdraft_allowed","lifecycle"]},{"title":"Controle","fields":["row_version","created_at","closed_at","close_reason"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'treasury-accounts'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- Workflow: `lifecycle` só tem ACTIVE/CLOSED; o encerramento é transição REAL (colunas
-- `closed_at`/`close_reason` existem). Declaramos a transição porque ela é executável.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'lifecycle', '["ACTIVE","CLOSED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'treasury-accounts'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'treasury-accounts'
CROSS JOIN (VALUES
  ('close', 'Encerrar conta', '["ACTIVE"]'::jsonb, 'CLOSED', 'finance:treasury:close', true, 1)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- CONTAS A RECEBER (fin.receivables)
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'receivables', 'Conta a receber', 'fin', 'receivables', 'external_reference',
  'Título a receber originado de documento de faturamento, OS ou medição.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('external_reference','Referência externa','data', false, true, 0, NULL::jsonb, 1, true, true, 1, false, true),
  ('client_id',  'Cliente',       'link',     false, true,  0, '{"entity":"clients"}'::jsonb, 2, true, true, 2, true, false),
  ('principal',  'Valor principal','currency',false, true,  0, NULL,        3,  true, true,  3, false, false),
  ('currency_code','Moeda',       'data',     false, true,  0, NULL,        4,  true, true,  4, false, false),
  ('due_date',   'Vencimento',    'date',     false, true,  0, NULL,        5,  true, true,  5, true,  false),
  ('payment_terms','Condição de pagamento','data', false, true, 0, NULL,    6,  true, false, 0, false, false),
  ('lifecycle',  'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"CANCELLED","label":"Cancelado"}]}'::jsonb,
     7,  true, true,  6, true,  false),
  ('origin_kind','Origem',        'select',   false, true,  0,
     '{"options":[{"value":"BILLING_DOCUMENT","label":"Documento de faturamento"},{"value":"BILLING_RECORD","label":"Registro de faturamento"},{"value":"SERVICE_ORDER","label":"Ordem de serviço"},{"value":"MEASUREMENT","label":"Medição"}]}'::jsonb,
     8,  true, false, 0, true,  false),
  ('unit_id',    'Unidade',       'link',     false, true,  0, '{"entity":"units"}'::jsonb, 9, true, true, 7, true, false),
  ('row_version','Versão',        'integer',  false, true,  0, NULL,       10,  false, false, 0, false, false),
  ('created_at', 'Criado em',     'datetime', false, true,  0, NULL,       11,  false, true,  8, false, false),
  ('cancelled_at','Cancelado em', 'datetime', false, true,  0, NULL,       12,  true,  false, 0, false, false),
  ('cancel_reason','Motivo do cancelamento','text', false, true, 0, NULL,  13,  true,  false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'receivables'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de contas a receber',
  '{"columns":["external_reference","client_id","principal","due_date","lifecycle","created_at"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'receivables'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de conta a receber',
  '{"sections":[{"title":"Identificação","fields":["external_reference","client_id","origin_kind","unit_id"]},{"title":"Financeiro","fields":["principal","currency_code","due_date","payment_terms","lifecycle"]},{"title":"Controle","fields":["row_version","created_at","cancelled_at","cancel_reason"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'receivables'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'lifecycle', '["ACTIVE","CANCELLED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'receivables'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'receivables'
CROSS JOIN (VALUES
  ('cancel', 'Cancelar título', '["ACTIVE"]'::jsonb, 'CANCELLED', 'finance:receivable:cancel', true, 1)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- CONTAS A PAGAR (fin.payables)
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'payables', 'Conta a pagar', 'fin', 'payables', 'external_reference',
  'Título a pagar a fornecedor, originado de pedido ou despesa aprovada.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('external_reference','Referência externa','data', false, true, 0, NULL::jsonb, 1, true, true, 1, false, true),
  ('origin_reference','Referência de origem','data', false, true, 0, NULL, 2, true, true, 2, false, true),
  ('counterparty_id','Contraparte', 'link',   false, true,  0, '{"entity":"suppliers"}'::jsonb, 3, true, true, 3, true, false),
  ('principal',  'Valor principal','currency',false, true,  0, NULL,        4,  true, true,  4, false, false),
  ('currency_code','Moeda',       'data',     false, true,  0, NULL,        5,  true, true,  5, false, false),
  ('due_date',   'Vencimento',    'date',     false, true,  0, NULL,        6,  true, true,  6, true,  false),
  ('payment_terms','Condição de pagamento','data', false, true, 0, NULL,    7,  true, false, 0, false, false),
  ('lifecycle',  'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"CANCELLED","label":"Cancelado"}]}'::jsonb,
     8,  true, true,  7, true,  false),
  ('cost_center_code','Centro de custo','data', false, true, 0, NULL,       9,  true, false, 0, true,  true),
  ('unit_id',    'Unidade',       'link',     false, true,  0, '{"entity":"units"}'::jsonb, 10, true, true, 8, true, false),
  ('row_version','Versão',        'integer',  false, true,  0, NULL,       11,  false, false, 0, false, false),
  ('created_at', 'Criado em',     'datetime', false, true,  0, NULL,       12,  false, true,  9, false, false),
  ('cancelled_at','Cancelado em', 'datetime', false, true,  0, NULL,       13,  true,  false, 0, false, false),
  ('cancel_reason','Motivo do cancelamento','text', false, true, 0, NULL,  14,  true,  false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'payables'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de contas a pagar',
  '{"columns":["external_reference","counterparty_id","principal","due_date","lifecycle","created_at"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'payables'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de conta a pagar',
  '{"sections":[{"title":"Identificação","fields":["external_reference","origin_reference","counterparty_id","unit_id"]},{"title":"Financeiro","fields":["principal","currency_code","due_date","payment_terms","cost_center_code","lifecycle"]},{"title":"Controle","fields":["row_version","created_at","cancelled_at","cancel_reason"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'payables'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'lifecycle', '["ACTIVE","CANCELLED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'payables'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'payables'
CROSS JOIN (VALUES
  ('cancel', 'Cancelar título', '["ACTIVE"]'::jsonb, 'CANCELLED', 'finance:payable:cancel', true, 1)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- DESPESAS (fin.expenses)
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'expenses', 'Despesa', 'fin', 'expenses', 'description',
  'Despesa operacional com fluxo de aprovação.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('description','Descrição',     'text',     false, false, 0, NULL::jsonb, 1,  true, true,  1, false, true),
  ('status',     'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"SUBMITTED","label":"Enviada"},{"value":"APPROVED","label":"Aprovada"},{"value":"REJECTED","label":"Rejeitada"}]}'::jsonb,
     2,  true, true,  2, true,  false),
  ('total_amount','Valor total',  'currency', false, true,  0, NULL,        3,  true, true,  3, false, false),
  ('currency_code','Moeda',       'data',     false, true,  0, NULL,        4,  true, true,  4, false, false),
  ('due_date',   'Vencimento',    'date',     false, false, 0, NULL,        5,  true, true,  5, true,  false),
  ('payment_terms','Condição de pagamento','data', false, false, 0, NULL,   6,  true, false, 0, false, false),
  ('cost_center_code','Centro de custo','data', false, false, 0, NULL,      7,  true, false, 0, true,  true),
  ('reimbursable','Reembolsável', 'bool',     false, false, 0, NULL,        8,  true, true,  6, true,  false),
  ('unit_id',    'Unidade',       'link',     false, true,  0, '{"entity":"units"}'::jsonb, 9, true, true, 7, true, false),
  ('version',    'Versão',        'integer',  false, true,  0, NULL,       10,  false, false, 0, false, false),
  ('created_at', 'Criada em',     'datetime', false, true,  0, NULL,       11,  false, true,  8, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'expenses'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de despesas',
  '{"columns":["description","status","total_amount","due_date","reimbursable","created_at"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'expenses'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de despesa',
  '{"sections":[{"title":"Identificação","fields":["description","unit_id","cost_center_code"]},{"title":"Financeiro","fields":["total_amount","currency_code","due_date","payment_terms","reimbursable","status"]},{"title":"Controle","fields":["version","created_at"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'expenses'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- `expenses.status` é o único fluxo com máquina de estados REAL de 4 passos (enum
-- DRAFT/SUBMITTED/APPROVED/REJECTED). Declaramos as transições que o fluxo executa.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["DRAFT","SUBMITTED","APPROVED","REJECTED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'expenses'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'expenses'
CROSS JOIN (VALUES
  ('submit',  'Enviar para aprovação', '["DRAFT"]'::jsonb,              'SUBMITTED', 'finance:expense:submit',  false, 1),
  ('approve', 'Aprovar',               '["SUBMITTED"]'::jsonb,          'APPROVED',  'finance:expense:approve', false, 2),
  ('reject',  'Rejeitar',              '["SUBMITTED"]'::jsonb,          'REJECTED',  'finance:expense:reject',  true,  3),
  ('revise',  'Devolver para rascunho','["REJECTED"]'::jsonb,           'DRAFT',     'finance:expense:update',  false, 4)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ORÇAMENTOS (fin.budgets)
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'budgets', 'Orçamento', 'fin', 'budgets', 'name',
  'Orçamento por unidade, com versões e períodos.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('code',       'Código',        'data',     false, false, 0, NULL::jsonb, 1,  true, true,  1, true,  true),
  ('name',       'Nome',          'data',     false, false, 0, NULL,        2,  true, true,  2, false, true),
  ('status',     'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"INACTIVE","label":"Inativo"}]}'::jsonb,
     3,  true, true,  3, true,  false),
  ('currency_code','Moeda',       'data',     false, false, 0, NULL,        4,  true, true,  4, false, false),
  ('unit_id',    'Unidade',       'link',     false, true,  0, '{"entity":"units"}'::jsonb, 5, true, true, 5, true, false),
  ('row_version','Versão',        'integer',  false, true,  0, NULL,        6,  false, false, 0, false, false),
  ('created_at', 'Criado em',     'datetime', false, true,  0, NULL,        7,  false, true,  6, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'budgets'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de orçamentos',
  '{"columns":["code","name","status","currency_code","created_at"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'budgets'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de orçamento',
  '{"sections":[{"title":"Identificação","fields":["code","name","unit_id"]},{"title":"Vigência","fields":["status","currency_code"]},{"title":"Controle","fields":["row_version","created_at"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'budgets'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["ACTIVE","INACTIVE"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'budgets'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'budgets'
CROSS JOIN (VALUES
  ('deactivate', 'Inativar', '["ACTIVE"]'::jsonb,   'INACTIVE', 'finance:budget:update', false, 1),
  ('activate',   'Ativar',   '["INACTIVE"]'::jsonb, 'ACTIVE',   'finance:budget:update', false, 2)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- PREVISÃO DE CAIXA (fin.cash_accounts) — entidade de LEITURA, sem workflow
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- A previsão é CALCULADA pelo servidor a partir de recebíveis e pagáveis; não há tabela de
-- previsão. Declaramos a entidade sobre a conta de caixa porque é ela que a tela agrupa, e
-- marcamos TODOS os campos como `read_only`: não existe escrita nesta superfície. Sem workflow
-- porque não existe transição — inventar um seria mentir sobre o domínio.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'cash-forecast', 'Previsão de caixa', 'fin', 'cash_accounts', 'location_code',
  'Leitura de tesouraria: realizado, previsto e saldo projetado por conta de caixa.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('location_code','Localização',  'data',     false, true,  0, NULL::jsonb, 1,  true, true,  1, true,  true),
  ('financial_account_id','Conta financeira','link', false, true, 0, '{"entity":"treasury-accounts"}'::jsonb, 2, true, true, 2, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'cash-forecast'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de previsão de caixa',
  '{"columns":["location_code","financial_account_id"]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'cash-forecast'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de previsão de caixa',
  '{"sections":[{"title":"Conta","fields":["location_code","financial_account_id"]}]}'::jsonb, true
FROM "meta"."entities" e WHERE e.name = 'cash-forecast'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint
