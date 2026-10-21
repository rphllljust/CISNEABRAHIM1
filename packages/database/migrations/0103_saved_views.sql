-- SAVED VIEWS — PERSISTÊNCIA CORPORATIVA (substitui o `localStorage` como fonte).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- O DEFEITO QUE ESTA MIGRATION ELIMINA
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- O contrato de Saved Views em `apps/web/src/platform/saved-views/types.ts` já descreve tudo o
-- que uma view precisa carregar: filtros, ordenação, colunas, larguras, `pinned`, `groupBy`,
-- `pageSize`, `isDefault`, escopo (PERSONAL/ROLE) e versão de contrato. O que NÃO existia era
-- onde guardar isso fora do navegador.
--
-- Consequências reais do armazenamento exclusivamente local:
--
--   1. O operador que troca de máquina perde todas as views. Recorte construído em 20 minutos
--      não sobrevive ao segundo dispositivo — e a promessa "funciona entre sessões" só valia
--      para a mesma máquina.
--
--   2. `scope: ROLE` era MENTIRA na interface. Uma view "publicada para o perfil FINANCEIRO"
--      gravada no navegador de quem a criou não é publicada: ninguém do time a vê. O próprio
--      `describeSavedViewScope` já admitia isso ao operador. Persistir no servidor é o que
--      transforma a promessa em fato.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- DECISÕES DE MODELO
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- 1. A view guarda CONFIGURAÇÃO, nunca dado de negócio. Nenhuma coluna aqui pode receber valor
--    monetário, nome de cliente, CPF ou resultado de lista. O `config` é JSONB porque a forma
--    (colunas, larguras, grupos) evolui com a UI; o que é tipado — dono, escopo, papel, versão —
--    fica em coluna, porque é o que a autorização e a integridade precisam consultar.
--
-- 2. Isolamento por identidade é ESTRUTURAL, não uma convenção de chave de storage. `owner_id`
--    é NOT NULL com FK: uma view sem dono não existe.
--
-- 3. `scope = 'ROLE'` exige `role_id` — restrição de CHECK, não validação de aplicação. Uma view
--    "de perfil" sem perfil ou é invisível ou vaza para todos; o banco recusa as duas.
--    A FK aponta para `authorization.access_roles`, o papel REAL do produto; um `role_id`
--    inventado pelo cliente não entra.
--
-- 4. Default é ÚNICO por (dono, superfície). Dois defaults para a mesma viewKey tornariam
--    "qual abre primeiro" dependente da ordem de leitura — índice parcial único resolve.
--
-- 5. `contract_version` no banco permite DESCARTAR/MIGRAR uma view de contrato antigo em vez de
--    aplicá-la sobre colunas que já não existem (o que produziria lista vazia, lida pelo
--    operador como "não há título").
--
-- 6. `is_shared_default` NÃO existe: o default de perfil é o `is_default` da view de escopo ROLE.
--    Um campo para a mesma ideia criaria a segunda fonte de verdade que esta frente elimina.
--
-- NADA é removido. A tabela é nova; nenhum dado existente é tocado.

CREATE SCHEMA IF NOT EXISTS "plt";
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plt"."saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Dono: sempre presente, inclusive em view de perfil (autoria é auditável).
  "owner_id" uuid NOT NULL REFERENCES "identity"."identities"("id") ON DELETE CASCADE,
  -- Papel destinatário, obrigatório quando scope = 'ROLE' e nulo quando PERSONAL.
  "role_id" uuid REFERENCES "authorization"."access_roles"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  -- Superfície: `finance.payable#list`, `finance.receivable#list`, ...
  "view_key" text NOT NULL,
  "name" text NOT NULL,
  /*
   * Configuração de apresentação em JSONB. Forma esperada (validada na aplicação, que é quem
   * conhece os campos de cada read model):
   *   { filters: [...], sort: [...], columns: [...], groupBy: null|{...}, pageSize: number }
   * Os campos `columns[].width` e `columns[].pinned` vivem aqui: são apresentação, não domínio.
   */
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_default" boolean NOT NULL DEFAULT false,
  "contract_version" integer NOT NULL DEFAULT 1,
  "row_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW(),
  "created_by_identity_id" uuid NOT NULL REFERENCES "identity"."identities"("id") ON DELETE RESTRICT,
  "updated_by_identity_id" uuid NOT NULL REFERENCES "identity"."identities"("id") ON DELETE RESTRICT,

  -- Escopo fechado: um valor livre viraria uma view que nenhuma consulta encontra.
  CONSTRAINT "saved_views_scope_chk" CHECK ("scope" IN ('PERSONAL', 'ROLE')),
  -- View de perfil SEM perfil, ou pessoal COM perfil, é estado contraditório.
  CONSTRAINT "saved_views_role_scope_chk" CHECK (
    ("scope" = 'ROLE' AND "role_id" IS NOT NULL)
    OR ("scope" = 'PERSONAL' AND "role_id" IS NULL)
  ),
  CONSTRAINT "saved_views_name_chk" CHECK (length(trim("name")) BETWEEN 1 AND 60),
  CONSTRAINT "saved_views_view_key_chk" CHECK (length(trim("view_key")) BETWEEN 1 AND 120),
  CONSTRAINT "saved_views_contract_version_chk" CHECK ("contract_version" >= 1),
  CONSTRAINT "saved_views_row_version_chk" CHECK ("row_version" >= 1)
);
--> statement-breakpoint

-- Nome único por dono+superfície+escopo: o seletor mostra uma lista de nomes, e dois iguais
-- tornam impossível escolher o certo.
CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_owner_key_name_uidx"
  ON "plt"."saved_views" ("owner_id", "view_key", "scope", lower("name"));
--> statement-breakpoint

/*
 * UM default por (dono, superfície, escopo). Índice PARCIAL: só as linhas com is_default
 * participam, então views comuns não colidem entre si.
 */
CREATE UNIQUE INDEX IF NOT EXISTS "saved_views_owner_key_scope_default_uidx"
  ON "plt"."saved_views" ("owner_id", "view_key", "scope")
  WHERE "is_default" = true;
--> statement-breakpoint

-- Leitura por superfície (o caminho da lista) e por papel (o caminho de ROLE publicada).
CREATE INDEX IF NOT EXISTS "saved_views_view_key_scope_idx"
  ON "plt"."saved_views" ("view_key", "scope");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "saved_views_role_key_idx"
  ON "plt"."saved_views" ("role_id", "view_key")
  WHERE "role_id" IS NOT NULL;
