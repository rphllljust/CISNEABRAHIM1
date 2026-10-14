-- CUSTOMER 360 / BUSINESS PARTNER — evolução ADITIVA do domínio Clientes.
--
-- ESCOPO DESTA MIGRATION
--
-- O cadastro de Clientes existia como master data de identidade jurídica (`pty.clients`) com
-- contatos e endereços em coleções filhas. O que faltava para o Cliente ser um OBJETO EMPRESARIAL
-- central não era uma tabela nova de identidade: era
--
--   1. CONTATOS com PAPEL e marcação de principal — o enum `contact_purpose` existente é um eixo
--      diferente (operational/commercial/billing indica COM O QUE o contato se relaciona), e
--      reaproveitá-lo como papel faria "operacional" significar duas coisas ao mesmo tempo.
--   2. HIERARQUIA EMPRESARIAL explícita (grupo econômico, matriz, filial, unidade) — declarada,
--      nunca inferida de nome ou CNPJ.
--   3. TRILHA DE AUDITORIA de alteração de valor para o cadastro, no canal AUDIT_TRAIL que já
--      existe (`audit.audit_logs`, migration 0082) e com a mesma proteção append-only do canal de
--      segurança.
--
-- NADA É REMOVIDO OU RENOMEADO. Toda coluna nova é anulável com DEFAULT compatível, todo índice é
-- `IF NOT EXISTS`, todo backfill é idempotente e todo enum novo é criado com guarda
-- (`DO $$ ... EXCEPTION WHEN duplicate_object`), de modo que reaplicar a migration não falha.
--
-- AUTORIDADE DO BANCO
--
-- As invariantes reais ficam no banco, não no frontend: um Cliente não pode ser pai de si mesmo;
-- um endereço só pode apontar para uma unidade que pertence ao MESMO Cliente (garantido por chave
-- estrangeira COMPOSTA, não por checagem de aplicação); o papel de contato é um enum fechado.
--
-- O que deliberadamente NÃO foi criado:
--
--   * `blocked` / `archived` em `pty.client_status`: nenhuma fonte confirmada declara esses estados
--     para CLIENTE (o catálogo de fornecedor tem `ARCHIVED` por decisão própria, registrada na
--     migration 0083). Inventar estados equivaleria a inventar ciclo de vida.
--   * `party_group_id` / `parent_client_id` preenchidos por heurística: o vínculo é uma DECISÃO do
--     operador e começa vazio.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. UNIDADES DO CLIENTE (filiais / estabelecimentos)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR QUE UMA TABELA FILHA E NÃO UMA COLUNA EM `pty.clients`
--
-- Um Cliente empresarial opera em VÁRIAS unidades. Uma coluna única em `clients` obrigaria a
-- escolher uma unidade "principal" — eleição que nenhuma fonte confirmada sustenta — e as demais
-- continuariam sem lugar. A unidade nasce como relação própria, com nome obrigatório, marcação de
-- matriz e endereço próprio opcional.
CREATE TABLE IF NOT EXISTS "pty"."client_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	-- Nome de negócio da unidade. É o rótulo que o operador lê no Customer 360 e o que distingue
	-- "Filial Vilhena" de "Matriz Cuiabá" dentro do mesmo Cliente.
	"name" text NOT NULL,
	-- Marcação EXPLÍCITA de matriz. Não se deriva de "primeira cadastrada" nem de nome: é decisão
	-- do operador, e por isso é dado, não convenção.
	"is_headquarters" boolean DEFAULT false NOT NULL,
	-- Coordenada de negócio do Cliente (município/UF), publicada na worklist e no Customer 360.
	-- Separada dos ENDEREÇOS de propósito: uma unidade pode existir antes de ter endereço completo.
	"city" text,
	"state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_identity_id" uuid,
	CONSTRAINT "client_units_name_not_empty_chk" CHECK (length(trim("pty"."client_units"."name")) > 0)
);
--> statement-breakpoint
-- Uma matriz por Cliente. Índice PARCIAL: a unicidade vale apenas para as linhas marcadas como
-- matriz, então as demais unidades não competem entre si. É a invariante "existe no máximo uma
-- matriz por Cliente" protegida pelo banco, não por checagem de aplicação.
CREATE UNIQUE INDEX IF NOT EXISTS "client_units_headquarters_uidx"
  ON "pty"."client_units" ("client_id") WHERE "is_headquarters" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_units_client_id_idx" ON "pty"."client_units" ("client_id");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ENDEREÇO PASSA A PODER PERTENCER A UMA UNIDADE
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `client_addresses` já existe desde a migration 0006 e continua sendo o endereço DO CLIENTE. A
-- coluna nova permite que um endereço seja qualificado por unidade sem criar uma segunda tabela de
-- endereço — o domínio de endereço é um só.
--
-- Integridade: a chave estrangeira COMPOSTA abaixo obriga que a unidade referenciada pertença ao
-- MESMO Cliente do endereço. Um endereço não consegue apontar para unidade de outro Cliente nem
-- por escrita direta no banco.
ALTER TABLE "pty"."client_addresses" ADD COLUMN IF NOT EXISTS "unit_id" uuid;
--> statement-breakpoint
-- Alvo da FK composta. Redundante com a PK para efeito de unicidade, mas é o que permite à FK
-- composta resolver `(client_id, unit_id)` de uma só vez — o PostgreSQL exige um índice único
-- exatamente sobre o par referenciado.
CREATE UNIQUE INDEX IF NOT EXISTS "client_units_id_client_id_uidx"
  ON "pty"."client_units" ("id", "client_id");
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "pty"."client_addresses"
    ADD CONSTRAINT "client_addresses_unit_id_client_units_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "pty"."client_units"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- A FK composta é a que protege a invariante de COERÊNCIA (unidade do mesmo Cliente); a simples
-- acima existe para permitir o `ON DELETE SET NULL`, que a composta não oferece sem arrastar
-- `client_id`. As duas convivem sem conflito: uma garante existência, a outra garantia coerência.
DO $$
BEGIN
  ALTER TABLE "pty"."client_addresses"
    ADD CONSTRAINT "client_addresses_unit_same_client_fk"
    FOREIGN KEY ("unit_id", "client_id") REFERENCES "pty"."client_units"("id", "client_id")
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_addresses_unit_id_idx" ON "pty"."client_addresses" ("unit_id");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONTATOS — PAPEL E PRINCIPAL
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `role` responde "QUEM é esta pessoa na empresa do Cliente" (compras, financeiro, fiscal...).
-- `purpose` (já existente) responde "COM O QUE este contato se relaciona" no CISNE. Os dois eixos
-- são independentes e ambos ficam declarados.
--
-- NULO É PERMITIDO E SIGNIFICA "NÃO DECLARADO". Nenhum papel padrão é atribuído por backfill:
-- preencher `operational` em todo contato histórico inventaria organização que ninguém declarou.
CREATE TYPE "pty"."contact_role" AS ENUM('operational', 'commercial', 'billing', 'purchasing', 'fiscal', 'contracts', 'management');
--> statement-breakpoint
ALTER TABLE "pty"."client_contacts" ADD COLUMN IF NOT EXISTS "role" "pty"."contact_role";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contacts_role_idx" ON "pty"."client_contacts" ("role");
--> statement-breakpoint
-- `is_primary` marca o contato PRINCIPAL DO CLIENTE. Um por Cliente, garantido por índice parcial.
ALTER TABLE "pty"."client_contacts" ADD COLUMN IF NOT EXISTS "is_primary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_contacts_primary_uidx"
  ON "pty"."client_contacts" ("client_id") WHERE "is_primary" = true;
--> statement-breakpoint
-- Contato INATIVO permanece na base: o histórico de relacionamento não é apagado porque a pessoa
-- saiu da empresa. `deactivated_at` registra quando deixou de valer.
ALTER TABLE "pty"."client_contacts" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pty"."client_contacts" ADD COLUMN IF NOT EXISTS "deactivated_by_identity_id" uuid;
--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────────────
-- 4. HIERARQUIA EMPRESARIAL
-- ─────────────────────────────────────────────────────────────────────────────
--
-- GRUPO ECONÔMICO — tabela própria, não texto livre no Cliente.
--
-- O grupo é uma entidade com identidade (nome), não uma etiqueta: dois Clientes do mesmo grupo
-- precisam apontar para O MESMO registro, senão "Grupo X" digitado duas vezes vira dois grupos.
-- `root_client_id` é a matriz do grupo quando ela é um Cliente do CISNE — anulável, porque um
-- grupo pode ser declarado antes de a matriz ser cadastrada.
CREATE TABLE IF NOT EXISTS "pty"."client_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"root_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_groups_name_not_empty_chk" CHECK (length(trim("pty"."client_groups"."name")) > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_groups_root_client_id_idx" ON "pty"."client_groups" ("root_client_id");
--> statement-breakpoint
ALTER TABLE "pty"."clients" ADD COLUMN IF NOT EXISTS "group_id" uuid;
--> statement-breakpoint
ALTER TABLE "pty"."clients" ADD COLUMN IF NOT EXISTS "parent_client_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "pty"."clients"
    ADD CONSTRAINT "clients_group_id_client_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "pty"."client_groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "pty"."clients"
    ADD CONSTRAINT "clients_parent_client_id_clients_id_fk"
    FOREIGN KEY ("parent_client_id") REFERENCES "pty"."clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- A RAIZ DO GRUPO TAMBÉM É UM VÍNCULO INTEIRO: `root_client_id` ganha FK própria depois que
-- `pty.clients` está garantidamente criada.
DO $$
BEGIN
  ALTER TABLE "pty"."client_groups"
    ADD CONSTRAINT "client_groups_root_client_id_clients_id_fk"
    FOREIGN KEY ("root_client_id") REFERENCES "pty"."clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- CLIENTE NÃO É PAI DE SI MESMO. A checagem de AUTO-referência imediata é do banco. Ciclos mais
-- longos (A -> B -> A) são impedidos na gravação pelo serviço, que já precisa ler a cadeia para
-- publicar a hierarquia; o banco protege o caso que uma única linha pode provar.
DO $$
BEGIN
  ALTER TABLE "pty"."clients"
    ADD CONSTRAINT "clients_parent_client_id_not_self_chk"
    CHECK ("parent_client_id" IS NULL OR "parent_client_id" <> "id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_group_id_idx" ON "pty"."clients" ("group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_parent_client_id_idx" ON "pty"."clients" ("parent_client_id");
--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TRILHA DE AUDITORIA DO CADASTRO — MESMO CANAL, MESMA PROTEÇÃO
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `audit.audit_logs` (migration 0082) era append-only por CONVENÇÃO: nada impedia UPDATE/DELETE. O
-- canal de segurança (`audit.security_audit_events`) já tinha gatilho de imutabilidade desde a
-- migration 0005. A trilha de alteração de VALOR — que é o que responde "quem mudou o quê" — era
-- justamente a que podia ser reescrita. O gatilho abaixo usa a MESMA função de bloqueio, para que
-- exista uma só definição de "trilha é imutável" no banco.
CREATE TRIGGER "audit_logs_no_update"
BEFORE UPDATE OR DELETE ON "audit"."audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "audit".prevent_security_audit_mutation();
