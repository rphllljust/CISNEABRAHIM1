import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { identities } from './identity';

/**
 * Cadastro de clientes PJ (Prompt 29 — SRC-002 aprovado).
 * Schema `pty` alinhado a TBL-CAND-021 (party).
 */
export const ptySchema = pgSchema('pty');

export const clientStatusEnum = ptySchema.enum('client_status', ['ACTIVE', 'INACTIVE']);

export const purchaseOrderRequirementEnum = ptySchema.enum('purchase_order_requirement', [
  'NOT_REQUIRED',
  'BEFORE_EXECUTION',
  'BEFORE_BILLING',
]);

export const contactPurposeEnum = ptySchema.enum('contact_purpose', [
  'operational',
  'commercial',
  'billing',
]);

/**
 * PAPEL do contato dentro da empresa do Cliente (migration 0097).
 *
 * Eixo DIFERENTE de `contact_purpose`: o papel diz QUEM é a pessoa na organização do Cliente
 * (compras, financeiro, fiscal, contratos, diretoria); o propósito diz COM O QUE o contato se
 * relaciona no CISNE. Reaproveitar o enum de propósito como papel faria "operacional" significar
 * duas coisas ao mesmo tempo e impediria representar, por exemplo, um contato de COMPRAS que no
 * CISNE responde por assuntos COMERCIAIS.
 */
export const contactRoleEnum = ptySchema.enum('contact_role', [
  'operational',
  'commercial',
  'billing',
  'purchasing',
  'fiscal',
  'contracts',
  'management',
]);

export const addressPurposeEnum = ptySchema.enum('address_purpose', [
  'operational',
  'billing',
  'correspondence',
]);


/**
 * GRUPO ECONÔMICO (migration 0097).
 *
 * Tabela própria, e não uma coluna de texto em `clients`, porque o grupo tem IDENTIDADE: dois
 * Clientes do mesmo grupo precisam apontar para o MESMO registro. Como texto livre, "Grupo X"
 * digitado duas vezes viraria dois grupos e a consolidação da carteira por grupo — que é o motivo
 * de o conceito existir — ficaria impossível.
 *
 * `rootClientId` é a matriz do grupo QUANDO ela é um Cliente do CISNE. Anulável de propósito: um
 * grupo pode ser declarado antes de a matriz ser cadastrada.
 *
 * A referência é declarada com `AnyPgColumn` porque `clientGroups` e `clients` apontam um para o
 * outro (`clients.group_id` -> `client_groups.id` e `client_groups.root_client_id` -> `clients.id`).
 * Sem o tipo explícito o TypeScript não consegue inferir nenhum dos dois e o schema inteiro colapsa
 * em `any`.
 */
export const clientGroups = ptySchema.table(
  'client_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    rootClientId: uuid('root_client_id').references((): AnyPgColumn => clients.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('client_groups_name_not_empty_chk', sql`length(trim(${table.name})) > 0`),
    index('client_groups_root_client_id_idx').on(table.rootClientId),
  ],
);

export const clients = ptySchema.table(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    normalizedTaxId: text('normalized_tax_id').notNull(),
    externalErpId: text('external_erp_id'),
    status: clientStatusEnum('status').notNull().default('ACTIVE'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'string' }),
    deactivatedByIdentityId: uuid('deactivated_by_identity_id').references(() => identities.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    deactivationReason: text('deactivation_reason'),
    purchaseOrderRequirement: purchaseOrderRequirementEnum('purchase_order_requirement')
      .notNull()
      .default('NOT_REQUIRED'),
    /**
     * HIERARQUIA EMPRESARIAL — vínculo DECLARADO, nunca inferido (migration 0097).
     *
     * Não há heurística por nome ou CNPJ em lugar nenhum do sistema: `parentClientId` e `groupId`
     * só têm valor quando um operador os atribuiu por comando. A auto-referência é barrada pelo
     * banco (`clients_parent_client_id_not_self_chk`); ciclos mais longos são barrados no serviço,
     * que já precisa percorrer a cadeia para publicar a hierarquia.
     */
    groupId: uuid('group_id').references(() => clientGroups.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    parentClientId: uuid('parent_client_id').references((): AnyPgColumn => clients.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
  },
  (table) => [
    check('clients_legal_name_not_empty_chk', sql`length(trim(${table.legalName})) > 0`),
    check(
      'clients_normalized_tax_id_digits_chk',
      sql`${table.normalizedTaxId} ~ '^[0-9]{14}$'`,
    ),
    check('clients_version_positive_chk', sql`${table.version} >= 1`),
    check(
      'clients_parent_client_id_not_self_chk',
      sql`${table.parentClientId} IS NULL OR ${table.parentClientId} <> ${table.id}`,
    ),
    uniqueIndex('clients_normalized_tax_id_uidx').on(table.normalizedTaxId),
    index('clients_status_created_at_idx').on(table.status, table.createdAt),
    // Índices de listagem do master data (migration 0079). A ordem padrão da listagem é razão
    // social ascendente; sem estes índices a listagem padrão fazia varredura completa + ordenação
    // de toda a tabela. Cada um foi autorizado por EXPLAIN contra 50 mil Clientes reais em banco
    // descartável — o índice `(status, legal_name, id)` foi medido e REJEITADO por ser mais lento
    // que `(legal_name, id)` sozinho.
    index('clients_legal_name_id_idx').on(table.legalName, table.id),
    index('clients_updated_at_id_idx').on(table.updatedAt, table.id),
    // `text_pattern_ops` porque a colação do banco é `en_US.utf8`: sob colação linguística o btree
    // padrão não serve `LIKE 'prefixo%'`, que é como se busca CNPJ parcial.
    index('clients_normalized_tax_id_pattern_idx').using(
      'btree',
      table.normalizedTaxId.op('text_pattern_ops'),
    ),
    index('clients_group_id_idx').on(table.groupId),
    index('clients_parent_client_id_idx').on(table.parentClientId),
  ],
);


export const clientContacts = ptySchema.table(
  'client_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    purpose: contactPurposeEnum('purpose').notNull(),
    email: text('email'),
    phone: text('phone'),
    /**
     * PAPEL na organização do Cliente (migration 0097). NULO significa NÃO DECLARADO — e o
     * backfill não atribuiu nenhum: preencher `operational` em todo contato histórico inventaria
     * organização que ninguém declarou.
     */
    role: contactRoleEnum('role'),
    /** Contato PRINCIPAL do Cliente. Um por Cliente, garantido por índice parcial no banco. */
    isPrimary: boolean('is_primary').notNull().default(false),
    /**
     * Contato INATIVO permanece na base (migration 0097). O relacionamento não é apagado porque a
     * pessoa saiu da empresa: `deactivatedAt` registra até quando ele valia.
     */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true, mode: 'string' }),
    deactivatedByIdentityId: uuid('deactivated_by_identity_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('client_contacts_name_not_empty_chk', sql`length(trim(${table.name})) > 0`),
    index('client_contacts_client_id_idx').on(table.clientId),
    index('client_contacts_role_idx').on(table.role),
    // No máximo UM contato principal por Cliente. Índice parcial: a unicidade vale só para as
    // linhas marcadas, então os demais contatos não competem entre si.
    uniqueIndex('client_contacts_primary_uidx')
      .on(table.clientId)
      .where(sql`${table.isPrimary} = true`),
  ],
);

/**
 * UNIDADES DO CLIENTE — filiais e estabelecimentos (migration 0097).
 *
 * Coleção filha, e não coluna em `clients`, porque um Cliente empresarial opera em VÁRIAS unidades.
 * Uma coluna única obrigaria a eleger uma unidade "principal" — eleição que nenhuma fonte
 * confirmada sustenta — e as demais continuariam sem lugar.
 *
 * `city`/`state` são a coordenada de negócio da unidade, deliberadamente SEPARADA dos ENDEREÇOS:
 * uma unidade pode existir antes de ter endereço completo, e `client_addresses` já tem a sua
 * própria finalidade (`operational`/`billing`/`correspondence`).
 */
export const clientUnits = ptySchema.table(
  'client_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    name: text('name').notNull(),
    /** Marcação EXPLÍCITA de matriz — decisão do operador, nunca derivada de nome ou ordem. */
    isHeadquarters: boolean('is_headquarters').notNull().default(false),
    city: text('city'),
    state: text('state'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    createdByIdentityId: uuid('created_by_identity_id'),
  },
  (table) => [
    check('client_units_name_not_empty_chk', sql`length(trim(${table.name})) > 0`),
    index('client_units_client_id_idx').on(table.clientId),
    // Invariante "existe no máximo uma matriz por Cliente", protegida pelo banco.
    uniqueIndex('client_units_headquarters_uidx')
      .on(table.clientId)
      .where(sql`${table.isHeadquarters} = true`),
    // Alvo da chave estrangeira COMPOSTA de `client_addresses`: é o que permite ao banco garantir
    // que um endereço só aponta para unidade do MESMO Cliente.
    uniqueIndex('client_units_id_client_id_uidx').on(table.id, table.clientId),
  ],
);

export const clientAddresses = ptySchema.table(
  'client_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    purpose: addressPurposeEnum('purpose').notNull(),
    /**
     * Unidade a que este endereço pertence (migration 0097). NULO = endereço do Cliente, não de
     * uma unidade específica.
     *
     * A coerência "unidade do mesmo Cliente" é garantida no banco pela FK COMPOSTA
     * `client_addresses_unit_same_client_fk`, declarada na migration — o Drizzle não expressa FK
     * composta com `ON UPDATE` sobre par de colunas neste formato, então ela vive só no SQL. Esta
     * referência simples existe para o mapeamento de coluna e para o `ON DELETE SET NULL`.
     */
    unitId: uuid('unit_id').references(() => clientUnits.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    street: text('street'),
    number: text('number'),
    complement: text('complement'),
    district: text('district'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('client_addresses_client_id_idx').on(table.clientId),
    index('client_addresses_unit_id_idx').on(table.unitId),
  ],
);
