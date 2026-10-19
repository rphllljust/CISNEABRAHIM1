-- CUSTOMER PURCHASE ORDER — referência ao PEDIDO DO CLIENTE, aditiva e mínima.
--
-- ESCOPO DESTA MIGRATION
--
-- O CISNE já modela o Purchase Order INTERNO: a compra que a CISNE faz de um fornecedor
-- (`com.purchase_orders`, referenciado por `service_orders.purchase_order_id` com snapshot em
-- `purchase_orders.purchase_order_snapshot`).
--
-- O que NÃO existia era o outro lado da relação: o PEDIDO DE COMPRA QUE O CLIENTE EMITE CONTRA A
-- CISNE. Documento real (AMAGGI, pedido 41926266) em que a CISNE é FORNECEDORA. Sem lugar tipado
-- para esse número, ele só poderia ser escondido em `contract_reference`, em `notes` ou em
-- `receivables.external_reference` — todos com semântica própria e já ocupados. Esconder ali
-- seria afirmar um vínculo que o dado não tem.
--
--   1. `so.service_orders.customer_purchase_order_number` — número do pedido do CLIENTE. Opcional,
--      texto, preservado como referência EXTERNA. NÃO é único globalmente: clientes diferentes
--      podem usar o mesmo número de pedido, e impor unicidade criaria uma restrição que a realidade
--      não tem.
--   2. `bil.billing_documents.customer_purchase_order_number_snapshot` — o número como estava no
--      momento da emissão. Snapshot separado do interno (`purchase_order_number_snapshot`), porque
--      os dois podem coexistir e significam coisas opostas: um é compra da CISNE, o outro é venda
--      para o cliente.
--
-- NADA É REMOVIDO OU RENOMEADO. As duas colunas são ANULÁVEIS, sem DEFAULT, sem backfill: uma OS
-- que não veio de pedido do cliente continua exatamente como está. O índice é apenas de busca
-- (OS por número de pedido do cliente) e não impõe unicidade.

ALTER TABLE "so"."service_orders"
  ADD COLUMN IF NOT EXISTS "customer_purchase_order_number" text;
--> statement-breakpoint

ALTER TABLE "bil"."billing_documents"
  ADD COLUMN IF NOT EXISTS "customer_purchase_order_number_snapshot" text;
--> statement-breakpoint

-- Busca operacional por referência do cliente. Não único de propósito: o mesmo número pode existir
-- em clientes diferentes.
CREATE INDEX IF NOT EXISTS "service_orders_customer_purchase_order_number_idx"
  ON "so"."service_orders" USING btree ("customer_purchase_order_number");
--> statement-breakpoint
