-- SEED DO METADATA STORE — CONTRATO (com.contracts)
--
-- Mesmo movimento de `0089`–`0092`: registra no store uma entidade que JÁ EXISTE, com campos
-- correspondendo a colunas REAIS. Nenhum campo inventado.
--
-- `in_filter` é marcado SOMENTE nos campos que `buildContractListWhere` e
-- `buildContractAdvancedClause` (`commercial/repositories/contract-list-sql.ts`) traduzem hoje.
--
-- VIGÊNCIA: `valid_from` é obrigatório e `valid_to` é OPCIONAL — `NULL` significa prazo
-- INDETERMINADO, e o predicado server-side trata esse caso explicitamente para não excluir o
-- contrato mais relevante da pergunta "o que está vigente agora?".
--
-- Idempotente: todo INSERT usa ON CONFLICT.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'contract', 'Contrato', 'com', 'contracts', 'contract_number',
  'Contrato de prestação continuada com a contraparte. Rege vigência e condições comerciais que autorizam ordens de serviço e faturamento.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('internal_code',     'Código interno',    'data',     true,  true,  0, NULL::jsonb, 1,  true,  true,  1,  true,  true),
  ('contract_number',   'Número do contrato','data',     true,  false, 0, NULL,         2,  true,  true,  2,  true,  true),
  ('title',             'Título',            'data',     true,  false, 0, NULL,         3,  true,  true,  3,  true,  true),
  ('status',            'Situação',          'select',   true,  false, 0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"ACTIVE","label":"Ativo"},{"value":"CLOSED","label":"Encerrado"},{"value":"EXPIRED","label":"Expirado"}]}'::jsonb,
     4,  true,  true,  4,  true,  false),
  ('client_id',         'Contraparte',       'link',     true,  true,  0, '{"entity":"client"}'::jsonb, 5, true, true, 5, false, false),
  ('unit_id',           'Unidade',           'data',     true,  true,  0, NULL,         6,  true,  true,  6,  false, false),
  ('valid_from',        'Vigente de',        'date',     true,  false, 0, NULL,         7,  true,  true,  7,  true,  false),
  ('valid_to',          'Vigente até',       'date',     false, false, 0, NULL,         8,  true,  true,  8,  true,  false),
  ('currency_code',     'Moeda',             'data',     true,  true,  0, NULL,         9,  true,  true,  9,  true,  false),
  ('payment_terms',     'Condição de pagamento', 'data', false, false, 0, NULL,        10,  true,  false, 0,  false, false),
  ('payment_method',    'Forma de pagamento','data',     false, false, 0, NULL,        11,  true,  false, 0,  false, false),
  ('scope_description', 'Escopo',            'text',     false, false, 0, NULL,        12,  true,  false, 0,  false, false),
  ('activated_at',      'Ativado em',        'datetime', false, true,  0, NULL,        13,  true,  false, 0,  false, false),
  ('closed_at',         'Encerrado em',      'datetime', false, true,  0, NULL,        14,  true,  false, 0,  false, false),
  ('closure_reason',    'Motivo do encerramento', 'text', false, true, 0, NULL,        15,  true,  false, 0,  false, false),
  ('row_version',       'Versão',            'integer',  false, true,  0, NULL,        16,  false, false, 0,  false, false),
  ('created_at',        'Criado em',         'datetime', false, true,  0, NULL,        17,  false, true, 10,  true,  false),
  ('updated_at',        'Atualizado em',     'datetime', false, true,  0, NULL,        18,  false, true, 11,  true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'contract'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Área de trabalho de contratos',
  '{"columns":["contract_number","title","status","valid_from","valid_to"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'contract'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de contrato',
  '{"sections":[{"title":"Identificação","fields":["internal_code","contract_number","title","client_id","unit_id"]},{"title":"Vigência","fields":["status","valid_from","valid_to"]},{"title":"Comercial","fields":["currency_code","payment_terms","payment_method"]},{"title":"Escopo","fields":["scope_description"]},{"title":"Desfecho","fields":["activated_at","closed_at","closure_reason","row_version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'contract'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- WORKFLOW — a máquina de estados REAL (`com.contract_status`), declarada como dado.
--
-- `close` exige motivo: o domínio recusa o encerramento sem justificativa registrada.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["DRAFT","ACTIVE","CLOSED","EXPIRED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'contract'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'contract'
CROSS JOIN (VALUES
  ('activate', 'Ativar contrato',    '["DRAFT"]'::jsonb,  'ACTIVE',  'commercial:contract:activate', false, 1),
  ('close',    'Encerrar contrato',  '["ACTIVE"]'::jsonb, 'CLOSED',  'commercial:contract:close',    true,  2)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',     0, 'commercial:contract:list',     'Leitura de contratos'),
  ('create',   0, 'commercial:contract:create',   'Criação de contrato'),
  ('update',   0, 'commercial:contract:update',   'Alteração de contrato'),
  ('activate', 0, 'commercial:contract:activate', 'Ativação de contrato'),
  ('close',    0, 'commercial:contract:close',    'Encerramento de contrato')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'contract'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
