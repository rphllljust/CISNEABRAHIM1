-- METADATA STORE V4 — as views que a engine sabe desenhar mas o CHECK não deixava declarar.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- O PROBLEMA, MEDIDO
--
-- A 0084 declarou:
--
--   CONSTRAINT "meta_views_type_chk" CHECK ("view_type" IN ('form','list','kanban','calendar'))
--
-- O conjunto fechado era correto para o que a engine sabia desenhar em 0084. A Track 1
-- (ENGINE V4) implementou três renderizadores novos — `pivot`, `tree` e `graph` — dirigidos
-- por `layout`, e eles NÃO PODEM SER DECLARADOS: o INSERT devolve
--
--   ERROR: new row for relation "views" violates check constraint "meta_views_type_chk"
--
-- Ou seja: a capacidade existe no frontend e o store não tem onde guardá-la. É este CHECK
-- que separa "a engine sabe desenhar" de "a engine consegue ser alimentada".
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- AMPLIAR, NUNCA SUBSTITUIR
--
-- Os quatro tipos originais permanecem. Removê-los quebraria toda view existente
-- (`form`, `list`, `kanban` e `calendar` são usados hoje por 9 entidades registradas). Esta
-- migration só ACRESCENTA ao conjunto.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POR QUE O CHECK AINDA EXISTE
--
-- A alternativa seria remover o CHECK e aceitar qualquer `view_type`. Seria pior: um typo de
-- administrador (`calender`) passaria a criar uma aba que a engine não desenha, e o erro
-- apareceria como tela de "sem renderizador" em vez de erro de escrita. O CHECK é a barreira
-- que transforma um typo em falha imediata e diagnosticável no ponto da gravação.
--
-- Idempotente: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT.

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 1. Ampliar o conjunto de view_type aceito
-- ═══════════════════════════════════════════════════════════════════════════════════════

ALTER TABLE "meta"."views" DROP CONSTRAINT IF EXISTS "meta_views_type_chk";--> statement-breakpoint

ALTER TABLE "meta"."views"
  ADD CONSTRAINT "meta_views_type_chk"
  CHECK ("view_type" IN (
    -- superfícies originais (0084) — preservadas
    'form', 'list', 'kanban', 'calendar',
    -- capacidades da engine V4 (Track 1)
    'pivot', 'tree', 'graph'
  ));--> statement-breakpoint

-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 2. SEED DE DEMONSTRAÇÃO — prova que os três tipos são declaráveis
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- Idempotente por ON CONFLICT. Estes registros dão DECLARAÇÃO REAL no store às três
-- capacidades para `service-orders`, que é a entidade com massa de dado suficiente
-- (17 registros, 5 status distintos, 3 unidades) para que as views tenham o que mostrar.
--
-- O layout de cada uma é o que o renderizador lê — sem ele a view aparece na aba e degrada
-- com a chave que falta, que é o comportamento correto e já provado por E2E.

-- Pivot: quanto por estado. `groupBy` no eixo das linhas, `aggregateOp` na operação.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'pivot', 'Tabela dinâmica', '{"groupBy":["status"],"aggregateOp":"count"}'::jsonb, false
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout, label = EXCLUDED.label;--> statement-breakpoint

-- Árvore: hierarquia por unidade. `parentField` é o eixo; ver GAP 3 no relatório — não há
-- coluna auto-referente em `so.service_orders`, então a hierarquia é de um nível (unidade).
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'tree', 'Árvore por unidade', '{"parentField":"unit_id","labelField":"order_number"}'::jsonb, false
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout, label = EXCLUDED.label;--> statement-breakpoint

-- Gráfico: contagem por estado. `chartType` dirige o desenho; `aggregateOp` a medida.
INSERT INTO "meta"."views" (entity_id, view_type, label, layout, is_default)
SELECT e.id, 'graph', 'Gráfico por estado', '{"categoryField":"status","chartType":"bar","aggregateOp":"count"}'::jsonb, false
FROM "meta"."entities" e WHERE e.name = 'service-orders'
ON CONFLICT (entity_id, view_type) DO UPDATE SET layout = EXCLUDED.layout, label = EXCLUDED.label;
