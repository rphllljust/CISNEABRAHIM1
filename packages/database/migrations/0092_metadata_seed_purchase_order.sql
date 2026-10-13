-- SEED DO METADATA STORE — PEDIDO DE COMPRA (com.purchase_orders)
--
-- Mesmo movimento de `0089`/`0090`/`0091`: registra no store uma entidade que JÁ EXISTE, com
-- campos correspondendo a colunas REAIS. Nenhum campo inventado.
--
-- `in_filter` é marcado SOMENTE nos campos que `buildPurchaseOrderListWhere` e
-- `buildPurchaseOrderAdvancedClause` (`commercial/repositories/purchase-order-list-sql.ts`)
-- traduzem hoje.
--
-- NOTA: `consumed_amount` e `authorized_overrun_amount` NÃO entram no construtor de filtro. Eles
-- são SALDO e consumo derivados, publicados pela projeção de leitura; oferecer filtro sobre eles
-- exigiria decidir no servidor o que significa "consumido" sob cada regra de faturamento — regra de
-- negócio que não está publicada como predicado. Ficam fora até que o backend os trate.
--
-- Idempotente: todo INSERT usa ON CONFLICT.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'purchase-order', 'Pedido de compra', 'com', 'purchase_orders', 'internal_code',
  'Pedido de compra emitido pelo cliente. Autoriza execução e faturamento, com consumo e saldo controlados por regra de faturamento.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('internal_code',   'Código interno',   'data',     true,  true,  0, NULL::jsonb, 1,  true,  true,  1,  true,  true),
  ('po_number',       'Número do pedido','data',     true,  false, 0, NULL,         2,  true,  true,  2,  true,  true),
  ('rc_number',       'Número RC',       'data',     false, false, 0, NULL,         3,  true,  true,  3,  true,  false),
  ('status',          'Situação',        'select',   true,  false, 0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"REGISTERED","label":"Registrado"},{"value":"CANCELLED","label":"Cancelado"}]}'::jsonb,
     4,  true,  true,  4,  true,  false),
  ('client_id',       'Cliente',         'link',     true,  true,  0, '{"entity":"client"}'::jsonb, 5, true, true, 5, false, false),
  ('unit_id',         'Unidade',         'data',     true,  true,  0, NULL,         6,  true,  true,  6,  false, false),
  ('currency_code',   'Moeda',           'data',     true,  true,  0, NULL,         7,  true,  true,  7,  true,  false),
  ('issue_date',      'Emissão',         'datetime', false, false, 0, NULL,         8,  true,  true,  8,  true,  false),
  ('total_amount',    'Valor total',     'currency', false, true,  0, '{"currencyField":"currency_code"}'::jsonb, 9, true, true, 9, false, false),
  ('payment_terms',   'Condição de pagamento', 'data', false, false, 0, NULL,       10,  true,  false, 0,  false, false),
  ('payment_method',  'Forma de pagamento', 'data',  false, false, 0, NULL,         11,  true,  false, 0,  false, false),
  ('service_manager', 'Gestor do serviço','data',     false, false, 0, NULL,        12,  true,  false, 0,  false, false),
  ('registered_at',   'Registrado em',   'datetime', false, true,  0, NULL,        13,  true,  false, 0,  false, false),
  ('cancelled_at',    'Cancelado em',    'datetime', false, true,  0, NULL,        14,  true,  false, 0,  false, false),
  ('cancellation_reason', 'Motivo do cancelamento', 'text', false, true, 0, NULL,  15,  true,  false, 0,  false, false),
  ('row_version',     'Versão',          'integer',  false, true,  0, NULL,        16,  false, false, 0,  false, false),
  ('created_at',      'Criado em',       'datetime', false, true,  0, NULL,        17,  false, true, 10,  true,  false),
  ('updated_at',      'Atualizado em',   'datetime', false, true,  0, NULL,        18,  false, true, 11,  true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'purchase-order'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Fila de pedidos de compra',
  '{"columns":["internal_code","po_number","status","issue_date","total_amount"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'purchase-order'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de pedido de compra',
  '{"sections":[{"title":"Identificação","fields":["internal_code","po_number","rc_number","client_id","unit_id"]},{"title":"Comercial","fields":["status","currency_code","issue_date","total_amount","payment_terms","payment_method"]},{"title":"Operação","fields":["service_manager"]},{"title":"Desfecho","fields":["registered_at","cancelled_at","cancellation_reason","row_version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'purchase-order'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- WORKFLOW — a máquina de estados REAL (`com.purchase_order_status`), declarada como dado.
--
-- `cancel` exige motivo: o domínio recusa o cancelamento sem justificativa registrada.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["DRAFT","REGISTERED","CANCELLED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'purchase-order'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'purchase-order'
CROSS JOIN (VALUES
  ('register', 'Registrar pedido',   '["DRAFT"]'::jsonb,              'REGISTERED', 'commercial:purchase-order:register', false, 1),
  ('cancel',   'Cancelar pedido',    '["DRAFT","REGISTERED"]'::jsonb, 'CANCELLED',  'commercial:purchase-order:cancel',   true,  2)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',     0, 'commercial:purchase-order:list',     'Leitura de pedidos de compra'),
  ('create',   0, 'commercial:purchase-order:create',   'Criação de pedido de compra'),
  ('update',   0, 'commercial:purchase-order:update',   'Alteração de pedido de compra'),
  ('register', 0, 'commercial:purchase-order:register', 'Registro de pedido de compra'),
  ('cancel',   0, 'commercial:purchase-order:cancel',   'Cancelamento de pedido de compra')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'purchase-order'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
