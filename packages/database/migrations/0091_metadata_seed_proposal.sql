-- SEED DO METADATA STORE — PROPOSTA COMERCIAL (com.proposals)
--
-- Mesmo movimento de `0089`/`0090`: registra no store uma entidade que JÁ EXISTE, com campos
-- correspondendo a colunas REAIS. Nenhum campo inventado.
--
-- `in_filter` é marcado SOMENTE nos campos que `buildProposalAdvancedClause`
-- (`commercial/repositories/proposal-list-sql.ts`) traduz hoje.
--
-- NOTA DE MODELO: `status`, `currency_code` e `valid_until` vivem em `com.proposal_versions` (a
-- versão CORRENTE, por `p.current_version_number`), não em `com.proposals`. O metadado declara a
-- entidade pelo que a LISTAGEM publica — que é o join já existente — e não finge que o campo mora
-- na tabela-pai. O predicado server-side usa o mesmo join, então UI e servidor concordam.
--
-- Idempotente: todo INSERT usa ON CONFLICT.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'proposal', 'Proposta comercial', 'com', 'proposals', 'proposal_code',
  'Proposta enviada ao cliente. Elo comercial entre a solicitação e o pedido de compra ou contrato, com revisões versionadas.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('proposal_code',      'Código',            'data',     true,  true,  0, NULL::jsonb, 1,  true,  true,  1,  true,  true),
  ('title',              'Título',            'data',     true,  false, 0, NULL,         2,  true,  true,  2,  true,  true),
  ('status',             'Situação da versão corrente', 'select', false, true, 0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"ISSUED","label":"Emitida"},{"value":"ACCEPTED","label":"Aceita"},{"value":"REJECTED","label":"Rejeitada"},{"value":"EXPIRED","label":"Expirada"},{"value":"CANCELLED","label":"Cancelada"}]}'::jsonb,
     3,  true,  true,  3,  true,  false),
  ('client_id',          'Cliente',           'link',     true,  true,  0, '{"entity":"client"}'::jsonb, 4, true, true, 4, false, false),
  ('unit_id',            'Unidade',           'data',     true,  true,  0, NULL,         5,  true,  true,  5,  false, false),
  ('currency_code',      'Moeda',             'data',     false, true,  0, NULL,         6,  true,  true,  6,  true,  false),
  ('valid_until',        'Válida até',        'datetime', false, true,  0, NULL,         7,  true,  true,  7,  true,  false),
  ('current_version_number', 'Revisão corrente', 'integer', false, true, 0, NULL,       8,  true,  true,  8,  false, false),
  ('row_version',        'Versão',            'integer',  false, true,  0, NULL,         9,  false, false, 0,  false, false),
  ('created_at',         'Criada em',         'datetime', false, true,  0, NULL,        10,  false, true,  9,  true,  false),
  ('updated_at',         'Atualizada em',     'datetime', false, true,  0, NULL,        11,  false, true, 10,  true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'proposal'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Fila de propostas',
  '{"columns":["proposal_code","title","status","valid_until","current_version_number"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'proposal'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de proposta',
  '{"sections":[{"title":"Identificação","fields":["proposal_code","title","client_id","unit_id"]},{"title":"Comercial","fields":["status","currency_code","valid_until"]},{"title":"Controle","fields":["current_version_number","row_version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'proposal'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- WORKFLOW — a máquina de estados REAL de `com.proposal_version_status`, declarada como dado.
--
-- As transições correspondem a `ProposalTransition` e às ações já mapeadas em `TRANSITION_ACTIONS`
-- (`proposals-access.service.ts`). `reject` e `cancel` exigem motivo: o domínio recusa a transição
-- sem justificativa, então `requires_reason` é a tradução da invariante, não escolha de interface.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status',
  '["DRAFT","ISSUED","ACCEPTED","REJECTED","EXPIRED","CANCELLED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'proposal'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'proposal'
CROSS JOIN (VALUES
  ('issue',  'Emitir proposta',   '["DRAFT"]'::jsonb,                         'ISSUED',    'commercial:proposal:issue',  false, 1),
  ('accept', 'Registrar aceite',  '["ISSUED"]'::jsonb,                        'ACCEPTED',  'commercial:proposal:accept', false, 2),
  ('reject', 'Registrar recusa',  '["ISSUED"]'::jsonb,                        'REJECTED',  'commercial:proposal:reject', true,  3),
  ('cancel', 'Cancelar proposta', '["DRAFT","ISSUED"]'::jsonb,                'CANCELLED', 'commercial:proposal:cancel', true,  4)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',   0, 'commercial:proposal:list',   'Leitura de propostas'),
  ('create', 0, 'commercial:proposal:create', 'Criação de proposta'),
  ('update', 0, 'commercial:proposal:update', 'Alteração de proposta'),
  ('issue',  0, 'commercial:proposal:issue',  'Emissão de proposta'),
  ('accept', 0, 'commercial:proposal:accept', 'Aceite de proposta'),
  ('reject', 0, 'commercial:proposal:reject', 'Recusa de proposta'),
  ('cancel', 0, 'commercial:proposal:cancel', 'Cancelamento de proposta')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'proposal'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
