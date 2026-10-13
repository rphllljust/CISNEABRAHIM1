-- FILTRO COMPOSTO — habilita no metadata store os campos que o servidor JÁ executa
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION CORRIGE
--
-- A worklist de Contas a receber montava o construtor AND/OR da engine
-- (`DynamicFilterBuilder`) desde a adoção do padrão de worklists, mas a árvore era aplicada
-- SOMENTE no navegador: `byBuilder` filtrava a página já carregada, com `matchesFilterGroup`.
-- Numa carteira maior que uma página, compor um filtro e ver "nenhum título" não significava
-- "não existe" — significava "não está entre as 20 linhas carregadas". O total exibido ao lado
-- continuava contando o conjunto NÃO filtrado.
--
-- O construtor só oferece ao operador os campos marcados `in_filter = true` em `meta.fields`.
-- Sem esta migration o construtor não renderiza os campos, e o recorte composto continua
-- inalcançável mesmo com o contrato server-side implementado.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- REGRA DE `in_filter` — a decisão mais importante deste arquivo
--
-- Marca SOMENTE os campos cujo predicado composto existe de fato. O allow-list do servidor está
-- em `apps/api/src/finance/repositories/receivable-list-sql.ts` (RECEIVABLE_FILTER_SPECS) e o da
-- tela em `apps/web/src/finance/pages/finance-title-filter-specs.ts`. Os três têm de concordar:
-- marcar um campo que o servidor não traduz faria o operador compor um recorte, o servidor
-- ignorar a condição e a lista inteira voltar como se fosse o resultado.
--
-- HABILITADOS — colunas REAIS de `fin.receivables`, com predicado implementado:
--
--   external_reference, currency_code, due_date, created_at, updated_at
--
-- DELIBERADAMENTE FORA — `lifecycle`:
--
--   O operador vê uma SITUAÇÃO (`OPEN`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`) que é
--   DERIVADA por `deriveReceivableStatus` de lifecycle + soma das liquidações + vencimento; o
--   título NÃO tem coluna de status. No filtro simples o recorte por situação já é traduzido para
--   os predICADOS REAIS de cada status (`?status=`), e é por lá que ele continua disponível.
--   `lifecycle` seria um recorte DIFERENTE do que o operador lê como "situação", e marcá-lo aqui
--   trocaria um filtro correto por um quase-correto — que é pior, porque parece funcionar.
--
-- DELIBERADAMENTE FORA — `client_id`, `unit_id`, `origin_kind`:
--
--   Já são o recorte da barra simples / do escopo de autorização. Duplicá-los no construtor
--   criaria dois caminhos para o mesmo recorte, com semânticas que podem divergir.
--
-- Idempotente: UPDATE por entidade+campo, sem INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

UPDATE "meta"."fields"
   SET in_filter = true
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'receivables')
   AND name IN ('external_reference', 'currency_code', 'due_date', 'created_at', 'updated_at');
--> statement-breakpoint

-- `updated_at` entra na LISTA também: sem coluna visível o operador não consegue conferir o
-- efeito do recorte temporal que acabou de compor. `in_list = true` já é o estado de due_date e
-- external_reference; aqui só a coluna de controle passa a ser exibida.
UPDATE "meta"."fields"
   SET in_list = true,
       list_order = 9
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'receivables')
   AND name = 'updated_at'
   AND in_list = false;
