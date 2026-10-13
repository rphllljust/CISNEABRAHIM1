-- SEED DO METADATA STORE — CLIENTE (pty.clients)
--
-- Mesmo movimento de `0085_metadata_seed_entities.sql`: registra no store uma entidade que JÁ
-- EXISTE, com os campos correspondendo a colunas REAIS de `pty.clients`. Nenhum campo inventado.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- `DynamicFilterBuilder` e `DynamicList` são engines DIRIGIDAS POR METADADO: elas montam a
-- allow-list de campos e o conjunto de operadores por TIPO lendo `meta.fields` da entidade. Sem
-- entidade registrada, `useEntitySchema('client')` não devolve schema e o construtor de filtro não
-- renderiza. A tela de Clientes tem filtro avançado SERVER-SIDE já implementado
-- (`clients/domain/client-list.query.ts`), mas sem metadado não havia como expor o construtor sem
-- criar um segundo mecanismo de filtro — arquitetura paralela à engine, que é proibida.
--
-- REGRA DE `in_filter` — a decisão mais importante deste arquivo.
--
-- O construtor oferece ao operador exatamente os campos marcados `in_filter = true`. Marcar um
-- campo que o servidor NÃO sabe filtrar produziria o defeito clássico: o operador compõe um
-- recorte, o servidor ignora a condição e devolve a lista inteira, e a leitura é "a lista está
-- vazia/errada". Por isso `in_filter` é marcado SOMENTE nos campos que
-- `buildAdvancedFilterClause` traduz hoje:
--
--   status, purchase_order_requirement, legal_name, trade_name, normalized_tax_id,
--   updated_at, created_at
--
-- Os demais campos (external_erp_id, version, deactivated_at, deactivation_reason) aparecem em
-- lista/formulário conforme o contrato do módulo, mas NÃO entram no construtor avançado enquanto o
-- predicado server-side não os tratar. Ampliar o filtro é ampliar os dois lados na mesma mudança.
--
-- Idempotente: todo INSERT usa ON CONFLICT, então rodar duas vezes não duplica.

INSERT INTO "meta"."entities" (name, label, data_schema, data_table, label_field, description)
VALUES (
  'client', 'Cliente', 'pty', 'clients', 'legal_name',
  'Contraparte comercial do CISNE. Raiz da cadeia: solicitação, proposta, pedido de compra, ordem de serviço e faturamento descem deste cadastro.'
)
ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label;--> statement-breakpoint

INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  --        nome                      rótulo                    tipo        req    ro     lvl  options                                                                                  ord  form  list  lorder filter search
  ('legal_name',              'Razão social',            'data',     true,  false, 0, NULL::jsonb,                                                                               1,  true,  true,  1,  true,  true),
  ('trade_name',              'Nome fantasia',           'data',     false, false, 0, NULL,                                                                                      2,  true,  true,  2,  true,  true),
  ('normalized_tax_id',       'CNPJ',                    'data',     true,  false, 0, NULL,                                                                                      3,  true,  true,  3,  true,  true),
  ('external_erp_id',         'Código no ERP externo',   'data',     false, false, 1, NULL,                                                                                      4,  true,  false, 0,  false, false),
  ('status',                  'Situação',                'select',   false, false, 0,
     '{"options":[{"value":"ACTIVE","label":"Ativo"},{"value":"INACTIVE","label":"Inativo"}]}'::jsonb,                                                                            5,  true,  true,  4,  true,  false),
  ('purchase_order_requirement', 'Exigência de pedido de compra', 'select', false, false, 0,
     '{"options":[{"value":"NOT_REQUIRED","label":"Não exigido"},{"value":"BEFORE_EXECUTION","label":"Antes da execução"},{"value":"BEFORE_BILLING","label":"Antes do faturamento"}]}'::jsonb, 6, true, true, 5, true, false),
  ('deactivated_at',          'Desativado em',           'datetime', false, true,  0, NULL,                                                                                      7,  true,  false, 0,  false, false),
  ('deactivation_reason',     'Motivo da desativação',   'text',     false, true,  0, NULL,                                                                                      8,  true,  false, 0,  false, false),
  ('version',                 'Versão',                  'integer',  false, true,  0, NULL,                                                                                      9,  false, false, 0,  false, false),
  ('created_at',              'Criado em',               'datetime', false, true,  0, NULL,                                                                                     10,  false, true,  6,  true,  false),
  ('updated_at',              'Atualizado em',           'datetime', false, true,  0, NULL,                                                                                     11,  false, true,  7,  true,  false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'client'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

-- VIEW DE LISTA — as três colunas funcionais que a worklist de Clientes já desenha
-- (identidade, situação, tempo). A ordem é a mesma da tela: quem lê a grade reconhece o metadado.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de clientes',
  '{"columns":["legal_name","status","updated_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'client'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- VIEW DE FORMULÁRIO — as seções correspondem ao formulário real do módulo (`ClientCreatePage`).
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'form', 'Formulário de cliente',
  '{"sections":[{"title":"Identificação","fields":["legal_name","trade_name","normalized_tax_id","external_erp_id"]},{"title":"Operação","fields":["status","purchase_order_requirement"]},{"title":"Controle","fields":["deactivated_at","deactivation_reason","version"]}]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'client'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- WORKFLOW — a máquina de estados REAL do domínio de Clientes, publicada como dado.
--
-- As transições abaixo já existem como comandos no backend (`POST /clients/:id/activate` e
-- `/deactivate`, em `clients.controller.ts`) com as mesmas permissões e a mesma exigência de
-- motivo. Nada é criado aqui: o metadado apenas DECLARA o que o domínio já executa.
--
-- `deactivate` tem `requires_reason = true` porque o domain service chama
-- `assertDeactivationReason(reason)`: a exigência é invariante de domínio, não preferência de UI.
INSERT INTO "meta"."workflows" (entity_id, state_field, states)
SELECT e.id, 'status', '["ACTIVE","INACTIVE"]'::jsonb
FROM "meta"."entities" e WHERE e.name = 'client'
ON CONFLICT (entity_id) DO NOTHING;--> statement-breakpoint

INSERT INTO "meta"."workflow_transitions"
  (workflow_id, command, label, from_states, to_state, permission, requires_reason, button_order)
SELECT w.id, t.command, t.label, t.from_states, t.to_state, t.permission, t.requires_reason, t.button_order
FROM "meta"."workflows" w
JOIN "meta"."entities" e ON e.id = w.entity_id AND e.name = 'client'
CROSS JOIN (VALUES
  ('activate',   'Reativar cadastro', '["INACTIVE"]'::jsonb, 'ACTIVE',   'client:client:activate',   false, 1),
  ('deactivate', 'Desativar cadastro','["ACTIVE"]'::jsonb,   'INACTIVE', 'client:client:deactivate', true,  2)
) AS t(command, label, from_states, to_state, permission, requires_reason, button_order)
ON CONFLICT (workflow_id, command) DO UPDATE SET
  label = EXCLUDED.label, from_states = EXCLUDED.from_states, to_state = EXCLUDED.to_state,
  permission = EXCLUDED.permission, requires_reason = EXCLUDED.requires_reason, button_order = EXCLUDED.button_order;--> statement-breakpoint

-- PERMISSÕES — os códigos abaixo são os MESMOS já exigidos pelo módulo de Clientes
-- (`capabilityId: 'client:client:list'` na navegação; activate/deactivate no controller).
INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('read',       0, 'client:client:list',       'Leitura de Clientes'),
  ('create',     0, 'client:client:create',     'Criação de Cliente'),
  ('update',     0, 'client:client:update',     'Alteração de Cliente'),
  ('activate',   0, 'client:client:activate',   'Reativação de Cliente'),
  ('deactivate', 0, 'client:client:deactivate', 'Desativação de Cliente')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'client'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
