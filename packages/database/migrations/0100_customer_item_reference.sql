-- CUSTOMER ITEM REFERENCE — como o CLIENTE identifica o item, aditiva e mínima.
--
-- ESCOPO DESTA MIGRATION
--
-- A linha comercial (`com.proposal_items`) já distingue o lado INTERNO do serviço:
-- `service_definition_id` / `service_definition_version_id` apontam para o Catálogo da CISNE
-- (`LOC-VEIC-LEVE-V2`, por exemplo). O que NÃO existia era o lado EXTERNO: como o CLIENTE chama
-- esse mesmo item no documento dele.
--
-- Caso real (pedido 41926266 da AMAGGI): o item 1 tem código externo `2010000213`, especificação
-- `SERVICO LOCACAO`, referência `3003201 EQUIPAMENTO` e unidade `UA`. Sem campo tipado, esse código
-- só cabia na `description` — e a pergunta "qual código a AMAGGI usa para este serviço?" só teria
-- resposta lendo texto livre.
--
--   1. `customer_item_reference` — o código que o cliente usa. Texto opcional, NÃO único: dois
--      clientes podem ter códigos iguais, e o mesmo cliente pode repeti-lo em pedidos diferentes.
--   2. `customer_unit_code` — a unidade NA ORIGEM (`UA`), separada de `unit_code`, que é a unidade
--      interna do Catálogo (`DAY`). Não são intercambiáveis: `UA` não tem mapeamento declarado para
--      nenhuma unidade interna, e traduzir sem regra seria inventar equivalência.
--
-- NADA É REMOVIDO OU RENOMEADO. As duas colunas são ANULÁVEIS e sem DEFAULT: linhas que não vêm de
-- pedido do cliente continuam exatamente como estão. O índice é apenas de busca (responder "onde
-- este código externo aparece") e não impõe unicidade.

ALTER TABLE "com"."proposal_items"
  ADD COLUMN IF NOT EXISTS "customer_item_reference" text;
--> statement-breakpoint

ALTER TABLE "com"."proposal_items"
  ADD COLUMN IF NOT EXISTS "customer_unit_code" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "proposal_items_customer_item_reference_idx"
  ON "com"."proposal_items" USING btree ("customer_item_reference");
--> statement-breakpoint
