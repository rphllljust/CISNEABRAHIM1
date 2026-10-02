-- SEED DO METADATA STORE — registra as entidades que JÁ EXISTEM no sistema.
--
-- Não inventa entidade nem campo: cada linha abaixo corresponde a uma coluna real do schema
-- (`information_schema`), e cada transição corresponde a uma transição real da state machine
-- de service-orders publicada antes desta sessão.
--
-- Idempotente: todo INSERT usa ON CONFLICT, então rodar duas vezes não duplica.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- FORNECEDOR (pty.suppliers) — a entidade mais simples; valida a engine
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'suppliers', 'Fornecedor', 'pty', 'suppliers', 'legal_name',
  'Cadastro de fornecedor. Entidade global (sem unidade): a mesma empresa fornece para todas as unidades.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('legal_name',        'Razão social',          'data',     true,  false, 0, NULL::jsonb, 1,  true,  true,  1, false, true),
  ('trade_name',        'Nome fantasia',         'data',     false, false, 0, NULL,        2,  true,  true,  2, false, true),
  ('normalized_tax_id', 'CNPJ',                  'data',     true,  false, 0, NULL,        3,  true,  true,  3, false, true),
  ('external_erp_id',   'Código no ERP externo', 'data',     false, false, 1, NULL,        4,  true,  false, 0, false, false),
  ('payment_terms',     'Condição de pagamento', 'data',     false, false, 0, NULL,        5,  true,  true,  4, false, false),
  ('currency_code',     'Moeda',                 'data',     false, false, 0, NULL,        6,  true,  true,  5, false, false),
  ('status',            'Situação',              'select',   false, true,  0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"INACTIVE","label":"Inativo"},{"value":"ARCHIVED","label":"Arquivado"}]}'::jsonb,
     7,  false, true,  6, true,  false),
  ('version',           'Versão',                'integer',  false, true,  0, NULL,        8,  false, false, 0, false, false),
  ('created_at',        'Criado em',             'datetime', false, true,  0, NULL,        9,  false, true,  7, false, false),
  ('updated_at',        'Atualizado em',         'datetime', false, true,  0, NULL,       10,  false, false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'suppliers'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de fornecedor',
  '{"sections":[{"title":"Identificação","fields":["legal_name","trade_name","normalized_tax_id","external_erp_id"]},{"title":"Comercial","fields":["payment_terms","currency_code"]},{"title":"Situação","fields":["status","version","created_at","updated_at"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'suppliers'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de fornecedores',
  '{"columns":["legal_name","trade_name","normalized_tax_id","payment_terms","currency_code","status"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'suppliers'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- Workflow de fornecedor: espelha SUPPLIER_COMMANDS de supplier-metadata.service.ts
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["ACTIVE","INACTIVE","ARCHIVED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'suppliers'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'suppliers'
CROSS JOIN (VALUES
  ('activate',   'Ativar',   '["INACTIVE","ARCHIVED"]'::jsonb, 'ACTIVE',   'supplier:supplier:activate',   false, 1),
  ('deactivate', 'Inativar', '["ACTIVE"]'::jsonb,              'INACTIVE', 'supplier:supplier:deactivate', true,  2),
  ('archive',    'Arquivar', '["INACTIVE"]'::jsonb,            'ARCHIVED', 'supplier:supplier:archive',    true,  3)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',   0, 'supplier:supplier:read',   'Leitura do cadastro'),
  ('create', 0, 'supplier:supplier:create', 'Criação de fornecedor'),
  ('update', 0, 'supplier:supplier:update', 'Alteração de cadastro'),
  ('delete', 0, 'supplier:supplier:delete', 'Remoção de cadastro')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'suppliers'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ORDEM DE SERVIÇO (so.service_orders) — valida workflow configurável
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'service-orders', 'Ordem de serviço', 'so', 'service_orders', 'order_number',
  'Ordem de serviço. Entidade transacional com ciclo de vida por comando.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('order_number', 'Número da OS',  'data',     false, true,  0, NULL::jsonb, 1,  false, true,  1, false, true),
  ('internal_code','Código interno','data',     false, true,  0, NULL,        2,  false, true,  2, false, true),
  ('status',       'Situação',      'select',   false, true,  0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"PREPARED","label":"Preparada"},{"value":"RELEASED","label":"Liberada"},{"value":"IN_EXECUTION","label":"Em execução"},{"value":"PAUSED","label":"Pausada"},{"value":"COMPLETED","label":"Concluída"},{"value":"CANCELLED","label":"Cancelada"}]}'::jsonb,
     3,  false, true,  3, true,  false),
  ('unit_id',      'Unidade',       'link',     false, false, 0, '{"entity":"units"}'::jsonb, 4, true, true, 4, true, false),
  ('origin',       'Origem',        'select',   false, true,  0,
     '{"options":[{"value":"SERVICE_REQUEST","label":"Solicitação"},{"value":"PROPOSAL","label":"Proposta"},{"value":"PURCHASE_ORDER","label":"Pedido de compra"},{"value":"AUTHORIZED_DIRECT","label":"Autorizada direta"}]}'::jsonb,
     5,  true, true,  5, true,  false),
  ('description',  'Descrição',     'text',     false, false, 0, NULL,        6,  true, false, 0, false, true),
  ('priority',     'Prioridade',    'data',     false, false, 0, NULL,        7,  true, false, 0, false, false),
  ('row_version',  'Versão',        'integer',  false, true,  0, NULL,        8,  false, false, 0, false, false),
  ('created_at',   'Criada em',     'datetime', false, true,  0, NULL,        9,  false, true,  6, false, false),
  ('contract_reference', 'Contrato','data',     false, false, 0, NULL,       10,  true, false, 0, false, false),
  /*
   * PRAZO OPERACIONAL — o EIXO TEMPORAL REAL da OS.
   *
   * `created_at` existe como campo, mas a LISTAGEM não o devolve (`ServiceOrderSummary` traz
   * apenas `updatedAt` e `deadlineAt`). Sem `deadline_at` declarado, o aging da lista não tem
   * por onde ser calculado e o indicador some. É a distância até o PRAZO que diz se uma OS
   * está atrasada — não a data de criação.
   */
  ('deadline_at',  'Prazo',         'datetime', false, true,  0, NULL,       12,  true, true,  7, false, false),
  ('client_snapshot',    'Cliente', 'text',     false, true,  1, NULL,       11,  true, false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de ordem de serviço',
  '{"sections":[{"title":"Identificação","fields":["order_number","internal_code","status","origin"]},{"title":"Execução","fields":["unit_id","description","priority","contract_reference"]},{"title":"Auditoria","fields":["row_version","created_at","client_snapshot"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de ordens de serviço',
  '{"columns":["order_number","internal_code","status","unit_id","origin","created_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- Kanban por estado do workflow: as colunas são os ESTADOS, não uma lista fixa em JSX.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'kanban', 'Kanban de ordens de serviço',
  '{"groupBy":"status","cardFields":["order_number","unit_id","created_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status',
  '["DRAFT","PREPARED","RELEASED","IN_EXECUTION","PAUSED","COMPLETED","CANCELLED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

-- Transições espelhando EXATAMENTE TRANSITIONS de service-order.state-machine.ts
INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'service-orders'
CROSS JOIN (VALUES
  ('prepare',  'Preparar',         '["DRAFT"]'::jsonb,                        'PREPARED',     'service-orders:service-order:prepare', false, 1),
  ('release',  'Liberar',          '["PREPARED"]'::jsonb,                     'RELEASED',     'service-orders:service-order:release', false, 2),
  ('cancel',   'Cancelar',         '["DRAFT","PREPARED","RELEASED"]'::jsonb,  'CANCELLED',    'service-orders:service-order:cancel',  false, 3),
  ('start',    'Iniciar execução', '["RELEASED"]'::jsonb,                     'IN_EXECUTION', 'service-orders:execution:start',       false, 4),
  ('pause',    'Pausar',           '["IN_EXECUTION"]'::jsonb,                 'PAUSED',       'service-orders:execution:pause',       false, 5),
  ('resume',   'Retomar',          '["PAUSED"]'::jsonb,                       'IN_EXECUTION', 'service-orders:execution:resume',      false, 6),
  ('complete', 'Concluir',         '["IN_EXECUTION"]'::jsonb,                 'COMPLETED',    'service-orders:execution:complete',    false, 7)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',   0, 'service-orders:service-order:read',   'Leitura de OS'),
  ('create', 0, 'service-orders:service-order:create', 'Criação de OS'),
  ('update', 0, 'service-orders:service-order:update', 'Alteração de OS'),
  /*
   * CUSTO OPERACIONAL é `permLevel 1` — campo sensível, declarado no campo
   * `read_operational_cost` abaixo. NÃO reusa a action 'read': a chave única é
   * (entity_id, action), então duas linhas com action='read' na mesma instrução violariam
   * a constraint. O nível de campo vive em `meta.fields.perm_level`; aqui a permissão
   * adicional que o nível 1 exige é declarada como ação própria.
   */
  ('read_cost', 1, 'service-orders:operational-cost:read', 'Leitura de custo (permLevel 1)')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- FATURAMENTO (bil.billing_records) — valida kanban dinâmico
-- ═══════════════════════════════════════════════════════════════════════════════════════

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'billing-records', 'Registro de faturamento', 'bil', 'billing_records', 'id',
  'Registro de faturamento derivado de medição aprovada.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('service_order_id', 'Ordem de serviço', 'link',     true,  true,  0, '{"entity":"service-orders"}'::jsonb, 1, true,  true,  1, true,  false),
  ('measurement_id',   'Medição',          'link',     true,  true,  0, '{"entity":"measurements"}'::jsonb,   2, true,  false, 0, false, false),
  ('client_id',        'Cliente',          'link',     false, true,  0, '{"entity":"clients"}'::jsonb,        3, true,  true,  2, false, false),
  ('status',           'Situação',         'select',   false, true,  0,
     '{"options":[{"value":"PREPARED","label":"Pronto para faturar"},{"value":"VOIDED","label":"Cancelado"}]}'::jsonb,
     4, false, true,  3, true,  false),
  ('total_amount',     'Valor total',      'currency', false, true,  1, '{"currencyField":"currency_code"}'::jsonb, 5, true, true, 4, false, false),
  ('currency_code',    'Moeda',            'data',     false, true,  0, NULL,        6,  true,  true,  5, false, false),
  ('payment_terms',    'Condição de pagamento', 'data', false, true, 0, NULL,        7,  true,  true,  6, false, false),
  ('prepared_at',      'Preparado em',     'datetime', false, true,  0, NULL,        8,  true,  true,  7, false, false),
  ('void_reason',      'Motivo do cancelamento', 'text', false, true, 0, NULL,       9,  true,  false, 0, false, false),
  ('row_version',      'Versão',           'integer',  false, true,  0, NULL,       10,  false, false, 0, false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'billing-records'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de faturamento',
  '{"sections":[{"title":"Origem","fields":["service_order_id","measurement_id","client_id"]},{"title":"Comercial","fields":["status","total_amount","currency_code","payment_terms"]},{"title":"Controle","fields":["prepared_at","void_reason","row_version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'billing-records'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de faturamento',
  '{"columns":["service_order_id","client_id","status","total_amount","currency_code","prepared_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'billing-records'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- KANBAN: as colunas do quadro atual ("Pronto para faturar", "Em preparação", "Com
-- divergência") deixam de ser JSX e passam a ser ESTADOS do workflow + agrupamento.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'kanban', 'Kanban de faturamento',
  '{"groupBy":"status","cardFields":["service_order_id","client_id","total_amount","currency_code"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'billing-records'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["PREPARED","VOIDED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'billing-records'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'billing-records'
CROSS JOIN (VALUES
  ('void', 'Cancelar faturamento', '["PREPARED"]'::jsonb, 'VOIDED', 'billing:billing-record:void', true, 1)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',   0, 'billing:billing-record:read',   'Leitura de faturamento'),
  ('update', 0, 'billing:billing-record:prepare','Preparação de faturamento'),
  ('void',   0, 'billing:billing-record:void',   'Cancelamento de faturamento')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'billing-records'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
