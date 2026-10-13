-- FILTRO COMPOSTO — habilita em ORÇAMENTOS os campos que o servidor JÁ executa
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION HABILITA
--
-- A worklist de Orçamentos oferecia UM termo de busca e UM valor de situação. Combinar "situação
-- ACTIVE E moeda BRL E criado depois de X" não era expressável. O contrato server-side do recorte
-- composto foi implementado em `apps/api/src/finance/repositories/budget-list-sql.ts` e a tela já
-- monta o construtor — mas o construtor só oferece ao operador os campos marcados `in_filter = true`
-- em `meta.fields`. Sem esta migration a árvore renderiza VAZIA e a capability fica inalcançável.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- `status` ENTRA AQUI — e a diferença em relação a recebíveis/pagáveis é de DOMÍNIO
--
-- Nas filas de TÍTULOS a situação é DERIVADA (lifecycle + liquidações + vencimento) e por isso não
-- tem coluna; filtrá-la exigiria negar disjunções de predicados, e foi deliberadamente excluída.
--
-- `fin.budgets` é diferente: TEM a coluna `status` (`fin.budget_status`, ACTIVE/INACTIVE), e o
-- filtro simples desta mesma tela já filtra por ela. O recorte composto por situação é executável de
-- verdade, e é o que o operador compõe ao cruzar situação com código e janela.
--
-- HABILITADOS — colunas REAIS de `fin.budgets`, com predicado implementado:
--
--   code, name, currency_code, status, created_at, updated_at
--
-- DELIBERADAMENTE FORA — `unit_id`:
--
--   Já é o recorte do filtro simples e o escopo de autorização. Duplicá-lo no construtor criaria dois
--   caminhos para o mesmo recorte, com semânticas que podem divergir.
--
-- Idempotente: UPDATE por entidade+campo, sem INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

UPDATE "meta"."fields"
   SET in_filter = true
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'budgets')
   AND name IN ('code', 'name', 'currency_code', 'status', 'created_at', 'updated_at');
--> statement-breakpoint

-- `updated_at` entra na LISTA: sem a coluna visível o operador não consegue conferir o efeito do
-- recorte temporal que acabou de compor. Só as colunas ainda ocultas mudam.
UPDATE "meta"."fields"
   SET in_list = true,
       list_order = 7
 WHERE entity_id = (SELECT id FROM "meta"."entities" WHERE name = 'budgets')
   AND name = 'updated_at'
   AND in_list = false;
