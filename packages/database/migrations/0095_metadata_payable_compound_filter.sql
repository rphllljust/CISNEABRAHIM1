-- FILTRO COMPOSTO — habilita em CONTAS A PAGAR os campos que o servidor JÁ executa
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION CORRIGE
--
-- Mesmo defeito corrigido em Contas a receber pela 0094: a worklist de Pagáveis montava o construtor
-- AND/OR da engine, mas a árvore era aplicada SOMENTE no navegador (`byBuilder` filtrava a página já
-- carregada com `matchesFilterGroup`). Numa carteira maior que uma página, compor um filtro e ver
-- "nenhuma obrigação" não significava "não existe" — significava "não está entre as linhas
-- carregadas", e o indicador ao lado continuava contando o conjunto NÃO filtrado.
--
-- O construtor só oferece ao operador os campos marcados `in_filter = true` em `meta.fields`. Sem
-- esta migration o recorte composto continua inalcançável mesmo com o contrato server-side
-- implementado.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- REGRA DE `in_filter` — a decisão mais importante deste arquivo
--
-- Marca SOMENTE os campos cujo predicado composto existe de fato. O allow-list do servidor está em
-- `apps/api/src/finance/repositories/payable-list-sql.ts` (PAYABLE_FILTER_SPECS) e o da tela em
-- `apps/web/src/finance/pages/finance-title-filter-specs.ts` (PAYABLE_TITLE_FILTER_SPECS).
--
-- HABILITADOS — colunas REAIS de `fin.payables`, com predicado implementado:
--
--   external_reference, origin_reference, cost_center_code, currency_code, due_date, created_at,
--   updated_at
--
-- `origin_reference` e `cost_center_code` são ESPECÍFICOS desta entidade (recebíveis não os tem):
-- são o que diferencia as duas filas, e é por isso que cada uma tem o seu próprio allow-list.
--
-- DELIBERADAMENTE FORA — `lifecycle`:
--
--   O operador vê uma SITUAÇÃO (`OPEN`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`) que é
--   DERIVADA por `derivePayableStatus` de lifecycle + pagamentos liquidados + vencimento; o título
--   NÃO tem coluna de status. O recorte por situação já vive no filtro simples (`?status=`), que o
--   traduz para os predicados reais. `lifecycle` seria um recorte DIFERENTE do que o operador lê
--   como situação, e trocar um filtro correto por um quase-correto é pior — porque parece funcionar.
--
-- DELIBERADAMENTE FORA — `counterparty_id` e `unit_id`:
--
--   Já são o recorte do filtro simples e do escopo de autorização. Duplicá-los no construtor criaria
--   dois caminhos para o mesmo recorte, com semânticas que podem divergir.
--
-- Idempotente: UPDATE por entidade+campo, sem INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

UPDATE "meta"."fields"
   SET in_filter = true
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'payables')
   AND name IN (
     'external_reference', 'origin_reference', 'cost_center_code', 'currency_code',
     'due_date', 'created_at', 'updated_at'
   );
--> statement-breakpoint

-- `cost_center_code` e `updated_at` entram na LISTA: sem a coluna visível o operador não consegue
-- conferir o efeito do recorte que acabou de compor. Só as colunas ainda ocultas mudam.
UPDATE "meta"."fields"
   SET in_list = true,
       list_order = 9
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'payables')
   AND name = 'cost_center_code'
   AND in_list = false;
