-- SEED DO METADATA STORE — CUSTOMER 360 (migration 0097).
--
-- Mesmo movimento de `0089_metadata_seed_client.sql`: registra no store o que JÁ EXISTE no banco e
-- no backend depois da 0097. Nenhum campo inventado, nenhuma permissão sem comando por trás.
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A 0097 adicionou ao domínio de Clientes: papel e principal de contato, unidades, hierarquia
-- empresarial, qualidade de dados, detecção de duplicidade e trilha de auditoria. Sem registrar os
-- CAMPOS e as PERMISSÕES aqui, a engine dirigida por metadado (`DynamicFilterBuilder`, a coluna
-- configurável e o gate de transição) não enxerga nada disso — e o operador volta a não poder
-- filtrar por grupo econômico nem conceder as capacidades novas.
--
-- REGRA DE `in_filter` — A MESMA DA 0089, E A MAIS IMPORTANTE DESTE ARQUIVO.
--
-- O construtor de filtro oferece apenas os campos marcados `in_filter = true`. Marcar um campo que
-- o servidor NÃO sabe filtrar produz o defeito clássico: o operador compõe um recorte, o servidor
-- ignora a condição e devolve a lista inteira — e a leitura é "a lista está errada".
--
-- ATENÇÃO DELIBERADA: os campos NOVOS desta onda (`group_id`, `parent_client_id`, `units`) NÃO são
-- marcados `in_filter`, e isso é uma decisão registrada, não um esquecimento.
--
-- `clients/domain/client-list.query.ts` (`buildAdvancedFilterClause`) traduz hoje exatamente:
-- status, purchaseOrderRequirement, legalName, tradeName, taxId, updatedAt, createdAt. Ampliar o
-- filtro exige ampliar OS DOIS LADOS na mesma mudança. Como esta onda não alterou o predicado
-- server-side, marcar os campos novos aqui criaria filtros que o servidor ignora — exatamente o
-- defeito que a regra existe para impedir. Eles aparecem em `in_list` (a listagem JÁ os publica, via
-- `ClientSummary`) e permanecem fora de `in_filter` até que o predicado os trate.
--
-- Idempotente: todo INSERT usa ON CONFLICT, então rodar duas vezes não duplica.

-- ─────────────────────────────────────────────────────────────────────────────
-- CAMPOS NOVOS — apenas os que o payload real publica
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `group_name` e `parent_client_name` são os nomes RESOLVIDOS dos vínculos: é `legal_name` do pai e
-- `name` do grupo, devolvidos por LEFT JOIN. Entram na listagem porque a worklist os desenha como
-- colunas; NÃO entram no formulário porque não são coluna editável — o vínculo se declara pelo
-- comando de hierarquia, que é a única escrita que passa pela checagem de ciclo.
INSERT INTO "meta"."fields"
  (entity_id, name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
SELECT e.id, f.name, f.label, f.type, f.required, f.read_only, f.perm_level, f.options, f.field_order, f.in_form, f.in_list, f.list_order, f.in_filter, f.in_search
FROM "meta"."entities" e
CROSS JOIN (VALUES
  --        nome                    rótulo                       tipo       req    ro     lvl  options  ord  form  list  lorder filter search
  ('group_name',            'Grupo econômico',           'data',     false, true,  0, NULL::jsonb,   12, false, true,   8,  false, false),
  ('parent_client_name',    'Matriz',                    'data',     false, true,  0, NULL,          13, false, true,   9,  false, false),
  ('child_count',           'Filiais',                   'integer',  false, true,  0, NULL,          14, false, true,  10,  false, false),
  ('external_reference',    'Referência externa',        'data',     false, true,  0, NULL,          15, false, true,  11,  false, false)
) AS f(name, label, type, required, read_only, perm_level, options, field_order, in_form, in_list, list_order, in_filter, in_search)
WHERE e.name = 'client'
ON CONFLICT (entity_id, name) DO UPDATE SET
  label = EXCLUDED.label, type = EXCLUDED.type, field_order = EXCLUDED.field_order,
  in_form = EXCLUDED.in_form, in_list = EXCLUDED.in_list, list_order = EXCLUDED.list_order,
  in_filter = EXCLUDED.in_filter, in_search = EXCLUDED.in_search, perm_level = EXCLUDED.perm_level;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- VIEW DE LISTA — ampliada com os vínculos, na ordem em que a worklist os lê
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A view de lista dirige a COLUNA CONFIGURÁVEL da worklist. As colunas adicionadas são as que o
-- `GET /clients` de fato publica depois desta onda; nenhuma coluna é oferecida sem fonte.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'list', 'Lista de clientes',
  '{"columns":["legal_name","trade_name","status","group_name","parent_client_name","updated_at"]}'::jsonb,
  true
FROM "meta"."entities" e WHERE e.name = 'client'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- PERMISSÕES — as capacidades NOVAS desta onda
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cada linha corresponde a um comando REAL já implementado no controller. Nenhuma permissão é
-- declarada sem enforcement no servidor: `required_permission` é exatamente o código que
-- `AUTHZ_ACTIONS` publica e que o `ClientAccessService` verifica antes de gravar.
--
-- `read` continua apontando para `client:client:list` e NÃO foi alterado — mudar o código de uma
-- permissão existente revogaria acesso de quem já a possui.
INSERT INTO "meta"."permissions" (entity_id, action, perm_level, required_permission, description)
SELECT e.id, p.action, p.perm_level, p.required_permission, p.description
FROM "meta"."entities" e
CROSS JOIN (VALUES
  ('contact-manage',   0, 'client:contact:manage',    'Gerenciar contatos do Cliente (adicionar, papel, principal, inativar, remover)'),
  ('unit-manage',      0, 'client:unit:manage',       'Gerenciar unidades do Cliente (declarar filial, marcar matriz, remover)'),
  ('hierarchy-manage', 0, 'client:hierarchy:manage',  'Declarar grupo econômico e matriz/filial do Cliente'),
  ('audit-read',       0, 'client:audit:read',        'Ler a trilha de auditoria do cadastro do Cliente')
) AS p(action, perm_level, required_permission, description)
WHERE e.name = 'client'
ON CONFLICT (entity_id, action) DO UPDATE SET required_permission = EXCLUDED.required_permission;
