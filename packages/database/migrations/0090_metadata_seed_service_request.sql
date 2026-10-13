-- SEED DO METADATA STORE — SOLICITAÇÃO DE SERVIÇO (sr.service_requests)
--
-- Mesmo movimento de `0085`/`0089`: registra no store uma entidade que JÁ EXISTE, com campos
-- correspondendo a colunas REAIS. Nenhum campo inventado.
--
-- `in_filter` é marcado SOMENTE nos campos que `buildAdvancedFilterClause` de
-- `requests/repositories/service-request-list-sql.ts` traduz hoje. Oferecer no construtor um campo
-- que o servidor não filtra produziria um recorte que o operador lê como "lista vazia".
--
-- Idempotente: todo INSERT usa ON CONFLICT.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'service-request', 'Solicitação de serviço', 'sr', 'service_requests', 'request_code',
  'Demanda registrada pelo cliente ou pelo canal de origem. Primeiro elo da cadeia comercial: antecede proposta, pedido de compra e ordem de serviço.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('request_code',      'Código',            'data',     true,  true,  0, NULL::jsonb, 1,  true,  true,  1,  true,  true),
  -- ENUMERAÇÕES: as opções são o vocabulário REAL dos tipos de `0018_service_requests_baseline.sql`.
  ('status',            'Situação',          'select',   true,  false, 0,
     '{"options":[{"value":"DRAFT","label":"Rascunho"},{"value":"SUBMITTED","label":"Enviada"},{"value":"UNDER_REVIEW","label":"Em análise"},{"value":"APPROVED","label":"Aprovada"},{"value":"REJECTED","label":"Rejeitada"},{"value":"CANCELLED","label":"Cancelada"},{"value":"CONVERTED","label":"Convertida em OS"}]}'::jsonb,
     2,  true,  true,  2,  true,  false),
  ('priority',          'Prioridade',        'select',   false, false, 0,
     '{"options":[{"value":"LOW","label":"Baixa"},{"value":"NORMAL","label":"Normal"},{"value":"HIGH","label":"Alta"},{"value":"URGENT","label":"Urgente"}]}'::jsonb,
     3,  true,  true,  3,  true,  false),
  ('origin_source',     'Origem',            'select',   true,  true,  0,
     '{"options":[{"value":"WHATSAPP","label":"WhatsApp"},{"value":"PHONE","label":"Telefone"},{"value":"EMAIL","label":"E-mail"},{"value":"PURCHASE_ORDER","label":"Pedido de compra"},{"value":"CONTRACT","label":"Contrato"},{"value":"PROPOSAL_ACCEPTANCE","label":"Aceite de proposta"},{"value":"DIRECT_REQUEST","label":"Solicitação direta"},{"value":"OTHER","label":"Outro"}]}'::jsonb,
     4,  true,  true,  4,  true,  false),
  ('client_id',         'Cliente',           'link',     false, true,  0, '{"entity":"client"}'::jsonb, 5, true, true, 5, false, false),
  ('description',       'Descrição',         'text',     false, false, 0, NULL,         6,  true,  true,  6,  true,  true),
  ('desired_start_at',  'Início desejado',   'datetime', false, false, 0, NULL,         7,  true,  true,  7,  true,  false),
  ('desired_end_at',    'Fim desejado',      'datetime', false, false, 0, NULL,         8,  true,  false, 0,  false, false),
  ('unit_id',           'Unidade',           'data',     true,  true,  0, NULL,         9,  true,  true,  8,  false, false),
  ('operational_notes', 'Observações operacionais', 'text', false, false, 0, NULL,      10, true,  false, 0,  false, false),
  ('rejection_reason',  'Motivo da rejeição','text',     false, true,  0, NULL,        11,  true,  false, 0,  false, false),
  ('cancellation_reason','Motivo do cancelamento', 'text', false, true, 0, NULL,       12,  true,  false, 0,  false, false),
  ('row_version',       'Versão',            'integer',  false, true,  0, NULL,        13,  false, false, 0,  false, false),
  ('created_at',        'Criada em',         'datetime', false, true,  0, NULL,        14,  false, true,  9,  true,  false),
  ('updated_at',        'Atualizada em',     'datetime', false, true,  0, NULL,        15,  false, true, 10,  true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'service-request'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Fila de solicitações',
  '{"columns":["request_code","status","priority","origin_source","desired_start_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'service-request'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de solicitação',
  '{"sections":[{"title":"Identificação","fields":["request_code","origin_source","client_id","unit_id"]},{"title":"Demanda","fields":["description","priority","desired_start_at","desired_end_at"]},{"title":"Operação","fields":["operational_notes"]},{"title":"Desfecho","fields":["rejection_reason","cancellation_reason","row_version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'service-request'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- WORKFLOW — a máquina de estados REAL, declarada como dado.
--
-- As sete transições correspondem a `ServiceRequestTransition` e às ações de autorização já
-- mapeadas em `TRANSITION_ACTIONS` (`service-requests-access.query.ts`). `reject` e `cancel` têm
-- `requires_reason = true` porque o schema EXIGE o motivo: as constraints
-- `service_requests_rejection_reason_when_rejected_chk` e
-- `service_requests_cancellation_reason_when_cancelled_chk` recusam o estado sem texto. A exigência
-- é do BANCO, não preferência de interface.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status',
  '["DRAFT","SUBMITTED","UNDER_REVIEW","APPROVED","REJECTED","CANCELLED","CONVERTED"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'service-request'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'service-request'
CROSS JOIN (VALUES
  ('submit',      'Enviar para análise', '["DRAFT"]'::jsonb,                                   'SUBMITTED',    'requests:service-request:submit',  false, 1),
  ('startReview', 'Iniciar análise',     '["SUBMITTED"]'::jsonb,                               'UNDER_REVIEW', 'requests:service-request:review',  false, 2),
  ('approve',     'Aprovar',             '["UNDER_REVIEW"]'::jsonb,                            'APPROVED',     'requests:service-request:approve', false, 3),
  ('reject',      'Rejeitar',            '["UNDER_REVIEW"]'::jsonb,                            'REJECTED',     'requests:service-request:reject',  true,  4),
  ('cancel',      'Cancelar',            '["DRAFT","SUBMITTED","UNDER_REVIEW","APPROVED"]'::jsonb, 'CANCELLED', 'requests:service-request:cancel', true,  5),
  ('convert',     'Converter em OS',     '["APPROVED"]'::jsonb,                                'CONVERTED',    'requests:service-request:convert', false, 6)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',        0, 'requests:service-request:list',    'Leitura de solicitações'),
  ('create',      0, 'requests:service-request:create',  'Criação de solicitação'),
  ('update',      0, 'requests:service-request:update',  'Alteração de solicitação'),
  ('submit',      0, 'requests:service-request:submit',  'Envio para análise'),
  ('startReview', 0, 'requests:service-request:review',  'Início de análise'),
  ('approve',     0, 'requests:service-request:approve', 'Aprovação de solicitação'),
  ('reject',      0, 'requests:service-request:reject',  'Rejeição de solicitação'),
  ('cancel',      0, 'requests:service-request:cancel',  'Cancelamento de solicitação'),
  ('convert',     0, 'requests:service-request:convert', 'Conversão em ordem de serviço')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'service-request'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
