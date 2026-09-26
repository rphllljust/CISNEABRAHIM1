-- Índices de listagem do master data de Clientes.
--
-- Cada índice abaixo foi autorizado por EXPLAIN (ANALYZE, BUFFERS) em PostgreSQL 18 real, com
-- 50.000 Clientes + endereços sintéticos em banco descartável, comparando o plano antes e depois.
-- A ordem padrão da listagem passou a ser razão social ascendente (diretório, não fila de
-- cadastro), e sem estes índices a listagem padrão fazia varredura completa + ordenação de toda a
-- tabela a cada requisição: 712 ms contra 0,54 ms.
--
-- Levantamento (limite 20, página 1):
--   listagem padrão (legal_name asc) .......... 712,6 ms -> 0,54 ms  (clients_legal_name_id_idx)
--   status = ACTIVE + legal_name asc .......... 509,9 ms -> 0,31 ms  (coberto pelo mesmo índice)
--   ordenação por updated_at desc ............. 446,5 ms -> 0,40 ms  (clients_updated_at_id_idx)
--   prefixo de CNPJ seletivo (12 dígitos) ......   9,1 ms -> 0,10 ms  (clients_normalized_tax_id_pattern_idx)
--
-- Índice REJEITADO com medida: `(status, legal_name, id)` mediu 1,36 ms no filtro por status, ou
-- seja, pior do que os 0,31 ms obtidos por `(legal_name, id)` sozinho — ACTIVE é ~89% da base e a
-- varredura ordenada encerra após 20 linhas. Não foi criado.
--
-- Por que `text_pattern_ops`: o banco usa colação `en_US.utf8`, não `C`. Sob colação linguística o
-- btree padrão não pode servir `LIKE 'prefixo%'`, então o índice único existente
-- (`clients_normalized_tax_id_uidx`) não cobre a busca por prefixo de documento. Mesmo padrão já
-- adotado em 0033 para `so.service_orders.order_number` / `internal_code`.
--
-- Custo aceito: três índices btree adicionais em tabela de master data, cuja taxa de escrita é
-- baixa por natureza (cadastro e edição pontuais) em comparação com as tabelas transacionais.
CREATE INDEX IF NOT EXISTS "clients_legal_name_id_idx"
  ON "pty"."clients" ("legal_name", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_updated_at_id_idx"
  ON "pty"."clients" ("updated_at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_normalized_tax_id_pattern_idx"
  ON "pty"."clients" ("normalized_tax_id" text_pattern_ops);
