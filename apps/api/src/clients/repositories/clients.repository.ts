import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { escapeLikeWildcards } from '../../search/domain/search-query-normalizer';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import type { AddressPurpose, ContactPurpose, ContactRole, PurchaseOrderRequirement } from '../domain/client-status';
import type { ClientListSqlParts } from '../domain/client-list.query';
import type {
  ClientAddressRow,
  ClientContactRow,
  ClientDetail,
  ClientDetailRow,
  ClientRow,
  ClientSummaryRow,
  ClientUnitRow,
} from '../serializers/client-response.serializer';

/** Nó da árvore de hierarquia, com a posição relativa ao Cliente consultado já resolvida. */
export type ClientHierarchyNode = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  status: string;
  parent_client_id: string | null;
  group_id: string | null;
  group_name: string | null;
  child_count: number;
  /** Distância em saltos até o Cliente consultado. 0 = ele mesmo. */
  depth: number;
  /** Como o nó se liga ao Cliente consultado: é ele, é seu pai, ou é seu descendente. */
  relation: 'self' | 'parent' | 'child';
};

export type ClientHierarchyRow = Omit<ClientHierarchyNode, 'depth' | 'relation'>;

export type ClientDuplicateCandidateRow = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  normalized_tax_id: string;
  external_erp_id: string | null;
  status: string;
};

export type ClientQualityFactsRow = {
  status: string;
  has_external_reference: boolean;
  contact_purposes: string[];
  usable_contact_purposes: string[];
  active_contact_count: number;
  primary_contact_count: number;
  address_purposes: string[];
  unit_count: number;
};

/**
 * 23505 = unique_violation. Identificar a CONSTRAINT, e não apenas o código, é o que permite
 * distinguir "o contato principal já existe" de "o CNPJ já existe": as duas violam unicidade, e
 * tratá-las igual daria a mensagem errada ao operador.
 */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === '23505' && pgError.constraint === constraint;
}

/**
 * COMANDOS SEMÂNTICOS DE CONTATO.
 *
 * Cada variante é uma INTENÇÃO, e o payload carrega apenas o que ela precisa. Um comando que
 * recebesse a coleção inteira de contatos seria um PATCH com outro nome — e faria cada ação
 * competir com qualquer edição concorrente do cadastro.
 */
export type ClientContactCommand =
  | {
      kind: 'add';
      version: number;
      name: string;
      purpose: ContactPurpose;
      role?: ContactRole;
      email?: string;
      phone?: string;
    }
  | { kind: 'setRole'; version: number; contactId: string; role: ContactRole | null }
  | { kind: 'setPrimary'; version: number; contactId: string }
  | { kind: 'deactivate'; version: number; contactId: string }
  | { kind: 'reactivate'; version: number; contactId: string }
  | { kind: 'remove'; version: number; contactId: string };

export type ClientUnitCommand =
  | {
      kind: 'add';
      version: number;
      name: string;
      isHeadquarters?: boolean;
      city?: string;
      state?: string;
    }
  | { kind: 'setHeadquarters'; version: number; unitId: string }
  | { kind: 'remove'; version: number; unitId: string };

export type ClientContactCommandOutcome =
  | ClientDetail
  | 'VERSION_CONFLICT'
  | 'CONTACT_NOT_FOUND'
  | 'PRIMARY_CONFLICT'
  | null;

export type ClientUnitCommandOutcome =
  | ClientDetail
  | 'VERSION_CONFLICT'
  | 'UNIT_NOT_FOUND'
  | 'HEADQUARTERS_CONFLICT'
  | null;

export type ClientContactPersistenceInput = {
  name: string;
  purpose: ContactPurpose;
  role?: ContactRole;
  isPrimary?: boolean;
  deactivated?: boolean;
  email?: string;
  phone?: string;
};

export type ClientAddressPersistenceInput = {
  purpose: AddressPurpose;
  /** Unidade por NOME no contrato; o repositório resolve para id DENTRO da transação. */
  unitName?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type ClientUnitPersistenceInput = {
  name: string;
  isHeadquarters?: boolean;
  city?: string;
  state?: string;
};

export type CreateClientPersistenceInput = {
  legalName: string;
  tradeName?: string;
  normalizedTaxId: string;
  externalErpId?: string;
  contacts: ClientContactPersistenceInput[];
  addresses?: ClientAddressPersistenceInput[];
  units?: ClientUnitPersistenceInput[];
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  groupName?: string;
  parentClientId?: string;
};

export type UpdateClientPersistenceInput = {
  clientId: string;
  expectedVersion: number;
  legalName?: string;
  tradeName?: string | null;
  externalErpId?: string | null;
  contacts?: ClientContactPersistenceInput[];
  addresses?: ClientAddressPersistenceInput[];
  units?: ClientUnitPersistenceInput[];
  purchaseOrderRequirement?: PurchaseOrderRequirement;
  groupName?: string | null;
  parentClientId?: string | null;
};

/**
 * Colunas do Cliente, com os DOIS vínculos de hierarquia resolvidos para leitura humana.
 *
 * `group_name` e `parent_client_name` vêm por LEFT JOIN, não por segunda consulta: a object page
 * sempre mostra os dois, e buscar o nome do pai em requisição separada seria um N+1 disfarçado. O
 * LEFT JOIN preserva a semântica de ausência — Cliente sem grupo e Cliente com grupo inexistente
 * são ambos `NULL`, e nenhum dos dois vira string vazia ou rótulo fabricado.
 */
const CLIENT_COLUMNS = `c.id,
              c.legal_name,
              c.trade_name,
              c.normalized_tax_id,
              c.external_erp_id,
              c.status,
              c.version,
              c.created_at,
              c.updated_at,
              c.deactivated_at,
              c.deactivation_reason,
              COALESCE(c.purchase_order_requirement::text, 'NOT_REQUIRED') AS purchase_order_requirement,
              c.group_id,
              g.name AS group_name,
              c.parent_client_id,
              p.legal_name AS parent_client_name,
              (SELECT count(*)::int FROM pty.clients ch WHERE ch.parent_client_id = c.id) AS child_count`;

const CLIENT_FROM = `pty.clients c
       LEFT JOIN pty.client_groups g ON g.id = c.group_id
       LEFT JOIN pty.clients p ON p.id = c.parent_client_id`;

/**
 * Projeção de listagem: Cliente + os DOIS vínculos de estrutura, resolvidos por LEFT JOIN.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE GRUPO E MATRIZ ENTRARAM NA LISTAGEM
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A worklist passou a ter colunas de DECISÃO, e uma delas é a estrutura empresarial: o operador
 * precisa raciocinar por CONTA ("esta compra é do Grupo X"), não só por linha solta. Sem publicar
 * o nome resolvido aqui, a coluna existiria sem fonte — exatamente o defeito que a regra "não
 * adicione colunas sem origem" existe para impedir.
 *
 * O custo é um LEFT JOIN por índice (`group_id` e `parent_client_id` têm índice desde a migration
 * 0097) e um `count` correlacionado sobre `clients_parent_client_id_idx`. A alternativa seria uma
 * requisição por linha para descobrir a estrutura, que é N+1 no caminho de leitura mais usado do
 * módulo.
 *
 * Continua SEM junção de endereços: `pty.client_addresses` permite várias linhas por Cliente com
 * finalidades distintas e não existe regra confirmada que eleja um endereço como "a" localidade.
 */
const CLIENT_SUMMARY_COLUMNS = `c.id,
              c.legal_name,
              c.trade_name,
              c.normalized_tax_id,
              c.status,
              c.version,
              c.created_at,
              c.updated_at,
              c.group_id,
              g.name AS group_name,
              c.parent_client_id,
              p.legal_name AS parent_client_name,
              (SELECT count(*)::int FROM pty.clients ch WHERE ch.parent_client_id = c.id) AS child_count`;

/** FROM da listagem — os mesmos LEFT JOINs do detalhe, sem tocar nas coleções filhas. */
const CLIENT_SUMMARY_FROM = `pty.clients c
       LEFT JOIN pty.client_groups g ON g.id = c.group_id
       LEFT JOIN pty.clients p ON p.id = c.parent_client_id`;


@Injectable()
export class ClientsRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findPublishedById(clientId: string): Promise<{
    id: string;
    status: ClientRow['status'];
    purchase_order_requirement: ClientRow['purchase_order_requirement'];
  } | null> {
    const result = await this.pool().query<{
      id: string;
      status: ClientRow['status'];
      purchase_order_requirement: ClientRow['purchase_order_requirement'];
    }>(
      `SELECT id,
              status,
              COALESCE(purchase_order_requirement::text, 'NOT_REQUIRED') AS purchase_order_requirement
       FROM pty.clients
       WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async findById(clientId: string): Promise<ClientDetail | null> {
    const client = await this.pool().query<ClientDetailRow>(
      `SELECT ${CLIENT_COLUMNS}
       FROM ${CLIENT_FROM}
       WHERE c.id = $1`,
      [clientId],
    );
    const row = client.rows[0];
    if (!row) {
      return null;
    }
    return this.loadChildren(row);
  }

  async listSummaries(
    sqlParts: ClientListSqlParts,
    limit: number,
    offset: number,
  ): Promise<ClientSummaryRow[]> {
    const result = await this.pool().query<ClientSummaryRow>(
      `SELECT ${CLIENT_SUMMARY_COLUMNS}
       FROM ${CLIENT_SUMMARY_FROM}
       WHERE ${sqlParts.whereClause}
       ORDER BY ${sqlParts.orderBy}
       LIMIT $${sqlParts.params.length + 1}
       OFFSET $${sqlParts.params.length + 2}`,
      [...sqlParts.params, limit, offset],
    );
    return result.rows;
  }

  /**
   * Total de Clientes sob o MESMO predicado da página — nunca uma contagem aproximada nem uma
   * consulta com junções.
   */
  async countClientList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      /*
       * O MESMO FROM DA PÁGINA — e isso é uma correção, não uma conveniência.
       *
       * O predicado de escopo qualifica `c.id` (a mesma qualificação usada na listagem). Com
       * `FROM pty.clients c` puro a contagem até funcionaria, mas contaria sobre um conjunto
       * definido por um FROM DIFERENTE do da página: qualquer JOIN acrescentado à listagem que
       * pudesse multiplicar linhas faria o total divergir da página em silêncio. Reusar a
       * constante mantém as duas consultas sobre o MESMO conjunto por construção.
       */
      `SELECT COUNT(*)::text AS total
       FROM ${CLIENT_SUMMARY_FROM}
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async create(
    input: CreateClientPersistenceInput,
    scopeRefInserter: (client: PoolClient, clientId: string) => Promise<void>,
    /**
     * TRILHA DE AUDITORIA — executada DENTRO da transação, junto com a inserção.
     *
     * Recebe o `PoolClient` do chamador e o detalhe JÁ montado, porque a trilha precisa do par
     * (valor anterior, valor novo) e, para uma criação, o valor novo só existe depois do INSERT.
     * Rodar fora da transação deixaria a possibilidade de uma trilha afirmar uma criação que
     * sofreu rollback.
     */
    auditRecorder?: (client: PoolClient, created: ClientDetail) => Promise<void>,
  ): Promise<ClientDetail> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /*
       * HIERARQUIA — resolvida DENTRO da transação, antes do INSERT do Cliente.
       *
       * `groupName` é o contrato de entrada; `group_id` é a chave. O grupo é criado sob demanda
       * pelo nome quando ainda não existe, e é por isso que ele é entidade (e não texto): dois
       * Clientes que declaram "Grupo X" passam a apontar para o MESMO registro, que é o que torna
       * a consolidação por grupo possível.
       */
      const groupId = input.groupName
        ? await this.resolveGroupId(client, input.groupName)
        : null;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pty.clients (
           legal_name,
           trade_name,
           normalized_tax_id,
           external_erp_id,
           purchase_order_requirement,
           group_id,
           parent_client_id
         )
         VALUES ($1, $2, $3, $4,
                 COALESCE($5::pty.purchase_order_requirement, 'NOT_REQUIRED'::pty.purchase_order_requirement),
                 $6, $7)
         RETURNING id`,
        [
          input.legalName.trim(),
          input.tradeName?.trim() ?? null,
          input.normalizedTaxId,
          input.externalErpId?.trim() ?? null,
          input.purchaseOrderRequirement ?? null,
          groupId,
          input.parentClientId ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error('CLIENT_INSERT_FAILED');
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ClientAfterInsertBeforeContacts);
      await scopeRefInserter(client, row.id);
      // Unidades ANTES dos contatos e endereços: um endereço pode declarar a que unidade
      // pertence, então a unidade precisa existir para o nome ser resolvido.
      if (input.units) {
        await this.replaceUnits(client, row.id, input.units);
      }
      await this.replaceContacts(client, row.id, input.contacts);
      if (input.addresses) {
        await this.replaceAddresses(client, row.id, input.addresses);
      }

      const created = await this.loadDetailWithin(client, row.id);
      if (auditRecorder) {
        await auditRecorder(client, created);
      }

      await client.query('COMMIT');
      return created;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    input: UpdateClientPersistenceInput,
    auditRecorder?: (
      client: PoolClient,
      before: ClientDetailRow | null,
      after: ClientDetailRow,
    ) => Promise<void>,
  ): Promise<ClientDetail | 'VERSION_CONFLICT' | null> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /*
       * VALOR ANTERIOR LIDO DENTRO DA TRANSAÇÃO, E ANTES DO UPDATE.
       *
       * A trilha de auditoria precisa do par (antes, depois). Ler o "antes" pelo pool fora da
       * transação abriria uma janela em que outro operador altera o cadastro no meio — e a trilha
       * registraria uma transição que nunca existiu.
       */
      const before = await client.query<ClientDetailRow>(
        `SELECT ${CLIENT_COLUMNS}
         FROM ${CLIENT_FROM}
         WHERE c.id = $1`,
        [input.clientId],
      );
      const beforeRow = before.rows[0] ?? null;

      const sets: string[] = ['updated_at = NOW()', 'version = version + 1'];
      const params: unknown[] = [input.clientId, input.expectedVersion];
      let paramIndex = 3;

      if (input.legalName !== undefined) {
        sets.push(`legal_name = $${paramIndex++}`);
        params.push(input.legalName.trim());
      }
      if (input.tradeName !== undefined) {
        sets.push(`trade_name = $${paramIndex++}`);
        params.push(input.tradeName);
      }
      if (input.externalErpId !== undefined) {
        sets.push(`external_erp_id = $${paramIndex++}`);
        params.push(input.externalErpId);
      }
      if (input.purchaseOrderRequirement !== undefined) {
        sets.push(`purchase_order_requirement = $${paramIndex++}::pty.purchase_order_requirement`);
        params.push(input.purchaseOrderRequirement);
      }
      // `groupName === null` remove o vínculo; string cria/reaproveita o grupo pelo nome.
      if (input.groupName !== undefined) {
        const groupId = input.groupName
          ? await this.resolveGroupId(client, input.groupName)
          : null;
        sets.push(`group_id = $${paramIndex++}`);
        params.push(groupId);
      }
      if (input.parentClientId !== undefined) {
        sets.push(`parent_client_id = $${paramIndex++}`);
        params.push(input.parentClientId);
      }

      const updated = await client.query<{ id: string }>(
        `UPDATE pty.clients
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING id`,
        params,
      );

      if (updated.rowCount === 0) {
        const exists = await client.query<{ version: number }>(
          `SELECT version FROM pty.clients WHERE id = $1`,
          [input.clientId],
        );
        await client.query('ROLLBACK');
        if (exists.rowCount === 0) {
          return null;
        }
        return 'VERSION_CONFLICT';
      }

      if (input.units) {
        await this.replaceUnits(client, input.clientId, input.units);
      }
      if (input.contacts) {
        await this.replaceContacts(client, input.clientId, input.contacts);
      }
      if (input.addresses) {
        await this.replaceAddresses(client, input.clientId, input.addresses);
      }

      const after = await this.loadDetailWithin(client, input.clientId);
      if (auditRecorder) {
        await auditRecorder(client, beforeRow, after);
      }

      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * HIERARQUIA EMPRESARIAL — a árvore declarada a partir de um Cliente.
   *
   * Percorre PAI e FILHOS em largura, com limite de profundidade e de nós. Os dois limites existem
   * porque o dado é declarado pelo operador e um ciclo entre Clientes (A pai de B, B pai de A) é
   * representável no banco: a checagem de auto-referência barra só o caso de uma linha. Sem limite,
   * um ciclo travaria a requisição; com limite, a resposta é uma árvore PARCIAL e diz isso pelo
   * campo `truncated`, em vez de mentir que a estrutura acabou.
   */
  async loadHierarchy(
    clientId: string,
    maxDepth: number,
    maxNodes: number,
  ): Promise<{ nodes: ClientHierarchyNode[]; rootId: string; truncated: boolean }> {
    const pool = this.pool();

    const seed = await pool.query<{ id: string }>(`SELECT id FROM pty.clients WHERE id = $1`, [
      clientId,
    ]);
    if (seed.rowCount === 0) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const visited = new Set<string>();
    const nodes: ClientHierarchyNode[] = [];
    let truncated = false;

    const load = async (id: string): Promise<ClientHierarchyRow | null> => {
      const result = await pool.query<ClientHierarchyRow>(
        `SELECT c.id, c.legal_name, c.trade_name, c.status, c.parent_client_id,
                c.group_id, g.name AS group_name,
                (SELECT count(*)::int FROM pty.clients ch WHERE ch.parent_client_id = c.id) AS child_count
         FROM pty.clients c
         LEFT JOIN pty.client_groups g ON g.id = c.group_id
         WHERE c.id = $1`,
        [id],
      );
      return result.rows[0] ?? null;
    };

    const push = async (row: ClientHierarchyRow, depth: number, relation: 'self' | 'parent' | 'child') => {
      if (visited.has(row.id)) {
        // Nó já visitado: o ciclo está fechado. Não é erro de dados necessariamente — pode ser
        // apenas uma árvore declarada de forma redundante —, mas a travessia PARA aqui.
        return;
      }
      if (nodes.length >= maxNodes) {
        truncated = true;
        return;
      }
      visited.add(row.id);
      nodes.push({ ...row, depth, relation });
    };

    const root = await load(clientId);
    if (!root) {
      throw new Error('CLIENT_NOT_FOUND');
    }
    await push(root, 0, 'self');

    // ASCENDENTES: do pai imediato até a raiz declarada.
    let cursor: ClientHierarchyRow | null = root;
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const parentId: string | null = cursor?.parent_client_id ?? null;
      if (!parentId) {
        break;
      }
      const parent: ClientHierarchyRow | null = await load(parentId);
      if (!parent) {
        break;
      }
      await push(parent, depth, 'parent');
      cursor = parent;
    }

    // DESCENDENTES: busca em largura a partir do Cliente consultado.
    let frontier: string[] = [root.id];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const children = await pool.query<ClientHierarchyRow>(
        `SELECT c.id, c.legal_name, c.trade_name, c.status, c.parent_client_id,
                c.group_id, g.name AS group_name,
                (SELECT count(*)::int FROM pty.clients ch WHERE ch.parent_client_id = c.id) AS child_count
         FROM pty.clients c
         LEFT JOIN pty.client_groups g ON g.id = c.group_id
         WHERE c.parent_client_id = ANY($1::uuid[])
         ORDER BY c.legal_name ASC`,
        [frontier],
      );
      const next: string[] = [];
      for (const child of children.rows) {
        const before = nodes.length;
        await push(child, depth, 'child');
        if (nodes.length > before) {
          next.push(child.id);
        }
      }
      frontier = next;
    }

    return { nodes, rootId: clientId, truncated };
  }

  /**
   * Fecha a árvore de ascendentes a partir de um Cliente e devolve a cadeia.
   *
   * Usado para impedir CICLO antes de gravar um vínculo: se o novo pai já está ABAIXO do Cliente
   * na árvore, atribuí-lo criaria um laço. Devolve os ids visitados subindo, com um teto de saltos
   * — a mesma proteção contra dado declarado de forma circular.
   */
  async loadAncestorChain(clientId: string, maxDepth = 64): Promise<string[]> {
    const result = await this.pool().query<{ id: string }>(
      /*
       * `WITH RECURSIVE` com `UNION` (e não `UNION ALL`) já descarta revisitas, e o teto de
       * profundidade é explícito. É exatamente o caso em que a consulta recursiva é mais segura
       * que a travessia em aplicação: o banco não materializa o ciclo, apenas o para.
       */
      `WITH RECURSIVE chain AS (
         SELECT id, parent_client_id, 1 AS depth
         FROM pty.clients WHERE id = $1
         UNION
         SELECT c.id, c.parent_client_id, chain.depth + 1
         FROM pty.clients c
         INNER JOIN chain ON c.id = chain.parent_client_id
         WHERE chain.depth < $2
       )
       SELECT id FROM chain`,
      [clientId, maxDepth],
    );
    return result.rows.map((row) => row.id);
  }

  /** Grava SOMENTE o vínculo de hierarquia, sob concorrência otimista. */
  async setHierarchy(input: {
    clientId: string;
    expectedVersion: number;
    parentClientId?: string | null;
    groupId?: string | null;
    /**
     * TRILHA DE AUDITORIA — declarar grupo econômico ou matriz altera o CADASTRO, então precisa
     * do par (antes, depois) na trilha de valor. A leitura do "antes" acontece dentro da transação
     * e antes do UPDATE, pelo mesmo motivo dos demais comandos: ler por fora abriria uma janela em
     * que outro operador altera o registro e a trilha afirmaria uma transição inexistente.
     */
    auditRecorder?: (
      client: PoolClient,
      before: ClientDetailRow | null,
      after: ClientDetailRow,
    ) => Promise<void>;
  }): Promise<ClientDetail | 'VERSION_CONFLICT' | null> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const beforeResult = await client.query<ClientDetailRow>(
        `SELECT ${CLIENT_COLUMNS}
         FROM ${CLIENT_FROM}
         WHERE c.id = $1`,
        [input.clientId],
      );
      const beforeRow = beforeResult.rows[0] ?? null;

      const sets: string[] = ['updated_at = NOW()', 'version = version + 1'];
      const params: unknown[] = [input.clientId, input.expectedVersion];
      let paramIndex = 3;

      if (input.parentClientId !== undefined) {
        sets.push(`parent_client_id = $${paramIndex++}`);
        params.push(input.parentClientId);
      }
      if (input.groupId !== undefined) {
        sets.push(`group_id = $${paramIndex++}`);
        params.push(input.groupId);
      }

      const updated = await client.query(
        `UPDATE pty.clients SET ${sets.join(', ')} WHERE id = $1 AND version = $2`,
        params,
      );

      if (updated.rowCount === 0) {
        const exists = await client.query(`SELECT 1 FROM pty.clients WHERE id = $1`, [
          input.clientId,
        ]);
        await client.query('ROLLBACK');
        return exists.rowCount === 0 ? null : 'VERSION_CONFLICT';
      }

      const after = await this.loadDetailWithin(client, input.clientId);
      if (input.auditRecorder) {
        await input.auditRecorder(client, beforeRow, after);
      }

      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * CANDIDATOS PARA A DETECÇÃO DE DUPLICIDADE.
   *
   * A consulta traz um CONJUNTO LIMITADO ordenado por relevância, e não a tabela inteira: comparar
   * contra 50 mil Clientes em memória a cada digitação seria indefensável. Os candidatos são os que
   * têm alguma chance real de coincidir — mesmo prefixo de razão social, mesmo nome fantasia ou
   * mesma referência externa — e a comparação fina (normalização, sinais, força da evidência)
   * acontece no domínio, onde a regra é uma só.
   *
   * O CNPJ não entra na triagem SQL porque o caso de documento idêntico é resolvido ANTES, por
   * consulta exata: deixá-lo aqui só custaria linhas do limite.
   */
  async findDuplicateCandidates(input: {
    taxId?: string | null;
    externalErpId?: string | null;
    legalName?: string | null;
    tradeName?: string | null;
    excludeClientId?: string | null;
    limit: number;
  }): Promise<ClientDuplicateCandidateRow[]> {
    const likeTerms = [input.legalName, input.tradeName]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value && value.length >= 3))
      .map((value) => `${escapeLikeWildcards(value.slice(0, 24))}%`);

    const result = await this.pool().query<ClientDuplicateCandidateRow>(
      `SELECT id, legal_name, trade_name, normalized_tax_id, external_erp_id, status
       FROM pty.clients
       WHERE ($1::uuid IS NULL OR id <> $1)
         AND (
           ($2::text IS NOT NULL AND normalized_tax_id = $2)
           OR ($3::text IS NOT NULL AND lower(external_erp_id) = lower($3))
           OR ($4::text[] IS NOT NULL AND (
                 legal_name ILIKE ANY($4) OR trade_name ILIKE ANY($4)
               ))
         )
       ORDER BY legal_name ASC
       LIMIT $5`,
      [
        input.excludeClientId ?? null,
        input.taxId ?? null,
        input.externalErpId ?? null,
        likeTerms.length > 0 ? likeTerms : null,
        input.limit,
      ],
    );
    return result.rows;
  }

  /**
   * FATOS PERSISTIDOS para a avaliação de qualidade do cadastro.
   *
   * Uma consulta agregada, e não quatro. Os arrays de finalidade são montados por `array_agg` com
   * `FILTER`, então a avaliação recebe exatamente os fatos que examina — sem carregar contatos e
   * endereços completos para contá-los.
   */
  async loadQualityFacts(clientId: string): Promise<ClientQualityFactsRow | null> {
    const result = await this.pool().query<ClientQualityFactsRow>(
      `SELECT
         c.status,
         (c.external_erp_id IS NOT NULL AND length(trim(c.external_erp_id)) > 0) AS has_external_reference,
         COALESCE(
           (SELECT array_agg(DISTINCT ct.purpose::text)
              FROM pty.client_contacts ct WHERE ct.client_id = c.id),
           ARRAY[]::text[]
         ) AS contact_purposes,
         COALESCE(
           (SELECT array_agg(DISTINCT ct.purpose::text)
              FROM pty.client_contacts ct
             WHERE ct.client_id = c.id
               AND ct.deactivated_at IS NULL
               AND length(trim(ct.name)) > 0
               AND (ct.email IS NOT NULL OR ct.phone IS NOT NULL)),
           ARRAY[]::text[]
         ) AS usable_contact_purposes,
         (SELECT count(*)::int FROM pty.client_contacts ct
           WHERE ct.client_id = c.id AND ct.deactivated_at IS NULL) AS active_contact_count,
         (SELECT count(*)::int FROM pty.client_contacts ct
           WHERE ct.client_id = c.id AND ct.is_primary = true) AS primary_contact_count,
         COALESCE(
           (SELECT array_agg(DISTINCT a.purpose::text)
              FROM pty.client_addresses a WHERE a.client_id = c.id),
           ARRAY[]::text[]
         ) AS address_purposes,
         (SELECT count(*)::int FROM pty.client_units u WHERE u.client_id = c.id) AS unit_count
       FROM pty.clients c
       WHERE c.id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * TRANSIÇÃO DE SITUAÇÃO — a única mutação de estado do ciclo de vida do Cliente.
   *
   * Roda em transação PRÓPRIA (o `setStatus` anterior era uma sequência de consultas soltas) porque
   * a trilha de auditoria precisa do par (antes, depois) e as duas leituras têm de enxergar a mesma
   * versão do registro. Sem transação, um operador concorrente poderia alterar o cadastro entre a
   * leitura do "antes", o UPDATE e a montagem do "depois" — e a trilha afirmaria uma transição que
   * nunca aconteceu.
   */
  async setStatus(
    clientId: string,
    expectedVersion: number,
    status: 'ACTIVE' | 'INACTIVE',
    actorIdentityId: string,
    reason?: string,
    auditRecorder?: (
      client: PoolClient,
      before: ClientDetailRow | null,
      after: ClientDetailRow,
    ) => Promise<void>,
  ): Promise<ClientDetail | 'VERSION_CONFLICT' | 'INVALID_STATE' | null> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const before = await client.query<ClientDetailRow>(
        `SELECT ${CLIENT_COLUMNS}
         FROM ${CLIENT_FROM}
         WHERE c.id = $1`,
        [clientId],
      );
      const beforeRow = before.rows[0] ?? null;
      if (!beforeRow) {
        await client.query('ROLLBACK');
        return null;
      }
      if (beforeRow.version !== expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (beforeRow.status === status) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const result = await client.query(
        `UPDATE pty.clients
         SET status = $3::"pty"."client_status",
             version = version + 1,
             updated_at = NOW(),
             deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN NOW() ELSE deactivated_at END,
             deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE deactivated_by_identity_id END,
             deactivation_reason = CASE WHEN $3::text = 'INACTIVE' THEN $5 ELSE deactivation_reason END
         WHERE id = $1 AND version = $2`,
        [clientId, expectedVersion, status, actorIdentityId, reason ?? null],
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const after = await this.loadDetailWithin(client, clientId);
      if (auditRecorder) {
        await auditRecorder(client, beforeRow, after);
      }

      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadChildren(row: ClientDetailRow): Promise<ClientDetail> {
    const pool = this.pool();
    return this.loadChildrenWithin(pool, row);
  }

  /**
   * Monta o detalhe usando uma conexão QUALQUER — a do pool ou a de uma transação em curso.
   *
   * Existe porque a trilha de auditoria precisa do valor FINAL dentro da MESMA transação que o
   * gravou: ler pelo pool enquanto a transação está aberta devolveria o estado anterior (o pool não
   * enxerga escrita não confirmada), e a trilha registraria "de X para X".
   *
   * ─────────────────────────────────────────────────────────────────────────────────────────
   * UM `PoolClient` NÃO ACEITA CONSULTAS CONCORRENTES.
   * ─────────────────────────────────────────────────────────────────────────────────────────
   *
   * A primeira versão desta função disparava as três consultas em `Promise.all` para qualquer
   * runner. Com o `Pool` isso é correto (cada consulta pega uma conexão). Com o `PoolClient` de uma
   * transação NÃO é: é UMA conexão, e o `pg` serializa com aviso de depreciação
   * ("Calling client.query() when the client is already executing a query"). O aviso apareceu na
   * suíte de integração e é o sintoma de um defeito real — a intenção de paralelismo não pode ser
   * cumprida ali, e o comportamento passa a depender de um detalhe interno da fila do driver.
   *
   * A distinção NÃO pode ser feita por duck typing de `connect`: o `PoolClient` do `pg` estende
   * `Client`, então AMBOS expõem `connect` — e a checagem por essa capacidade classificava a conexão
   * de transação como pool, que foi exatamente o defeito da primeira correção (confirmado por
   * `--trace-deprecation` apontando para `loadUnits` dentro de `ClientsRepository.create`).
   *
   * O discriminante correto é `release`, que existe SOMENTE no `PoolClient` — é o método que devolve
   * a conexão ao pool. Medido no driver instalado: `Pool.prototype.release` e
   * `Client.prototype.release` são ambos `undefined`.
   */
  private async loadChildrenWithin(
    runner: Pool | PoolClient,
    row: ClientDetailRow,
  ): Promise<ClientDetail> {
    const isTransactionClient = typeof (runner as PoolClient).release === 'function';

    const loadContacts = () =>
      runner.query<ClientContactRow>(
        // PRINCIPAL primeiro, depois os ativos, depois os inativos: a ordem da coleção é a ordem
        // de leitura do operador, e o contato principal é o que ele procura primeiro.
        `SELECT id, name, purpose, role, is_primary, deactivated_at, email, phone
         FROM pty.client_contacts
         WHERE client_id = $1
         ORDER BY is_primary DESC, (deactivated_at IS NOT NULL) ASC, created_at ASC`,
        [row.id],
      );
    const loadAddresses = () =>
      runner.query<ClientAddressRow>(
        // O nome da unidade vem por LEFT JOIN para o endereço poder ser lido como "Endereço da
        // Filial Vilhena" sem uma segunda consulta por linha.
        `SELECT a.id, a.purpose, a.unit_id, u.name AS unit_name,
                a.street, a.number, a.complement, a.district, a.city, a.state,
                a.postal_code, a.country
         FROM pty.client_addresses a
         LEFT JOIN pty.client_units u ON u.id = a.unit_id
         WHERE a.client_id = $1
         ORDER BY a.created_at ASC`,
        [row.id],
      );
    const loadUnits = () =>
      runner.query<ClientUnitRow>(
        // Contagem REAL de endereços por unidade, calculada aqui — o frontend não soma coleções
        // para produzir um número.
        `SELECT u.id, u.name, u.is_headquarters, u.city, u.state,
                (SELECT count(*)::int FROM pty.client_addresses a WHERE a.unit_id = u.id) AS address_count
         FROM pty.client_units u
         WHERE u.client_id = $1
         ORDER BY u.is_headquarters DESC, u.created_at ASC`,
        [row.id],
      );

    if (!isTransactionClient) {
      const [contacts, addresses, units] = await Promise.all([
        loadContacts(),
        loadAddresses(),
        loadUnits(),
      ]);
      return {
        ...row,
        contacts: contacts.rows,
        addresses: addresses.rows,
        units: units.rows,
      };
    }

    // Conexão única (transação em curso): série explícita, sem concorrência na mesma conexão.
    const contacts = await loadContacts();
    const addresses = await loadAddresses();
    const units = await loadUnits();
    return {
      ...row,
      contacts: contacts.rows,
      addresses: addresses.rows,
      units: units.rows,
    };
  }

  /** Detalhe lido DENTRO de uma transação aberta, pelo seu `PoolClient`. */
  private async loadDetailWithin(
    client: PoolClient,
    clientId: string,
  ): Promise<ClientDetail> {
    const result = await client.query<ClientDetailRow>(
      `SELECT ${CLIENT_COLUMNS}
       FROM ${CLIENT_FROM}
       WHERE c.id = $1`,
      [clientId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('CLIENT_NOT_FOUND');
    }
    return this.loadChildrenWithin(client, row);
  }
  /**
   * Resolve (criando quando necessário) o id do grupo econômico pelo NOME.
   *
   * `ON CONFLICT (name)` não é usado porque não há índice único em `name` — e não deve haver:
   * dois grupos podem legitimamente ter o mesmo nome em contextos diferentes, e impor unicidade
   * global seria inventar uma regra de negócio. A resolução é primeiro-que-casa, dentro da
   * transação do chamador, de modo que a leitura e a escrita do grupo são atômicas com o Cliente.
   */
  private async resolveGroupId(client: PoolClient, groupName: string): Promise<string> {
    const trimmed = groupName.trim();
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM pty.client_groups WHERE name = $1 ORDER BY created_at ASC LIMIT 1`,
      [trimmed],
    );
    const found = existing.rows[0];
    if (found) {
      return found.id;
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO pty.client_groups (name) VALUES ($1) RETURNING id`,
      [trimmed],
    );
    const row = created.rows[0];
    if (!row) {
      throw new Error('CLIENT_GROUP_INSERT_FAILED');
    }
    return row.id;
  }

  /**
   * Resolve (criando quando necessário) o grupo pelo nome, em transação PRÓPRIA.
   *
   * Existe porque o comando de hierarquia grava por um caminho que não abre transação de cadastro:
   * aqui a resolução do grupo e a gravação do vínculo precisam ser atômicas entre si, e não com
   * uma edição de cadastro que não está em curso.
   */
  async resolveGroupIdByName(groupName: string): Promise<string> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const id = await this.resolveGroupId(client, groupName);
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * APLICA UM COMANDO SEMÂNTICO DE CONTATO em transação única.
   *
   * A `version` é conferida no `UPDATE` do Cliente, e não em leitura separada: a checagem e a
   * gravação acontecem na mesma instrução, de modo que dois comandos concorrentes não possam ambos
   * achar que a versão confere. Toda variante INCREMENTA a versão do Cliente, inclusive as que
   * tocam só a coleção filha — a versão é a do AGREGADO, e um contato principal novo é uma mudança
   * no Cliente.
   */
  async applyContactCommand(input: {
    clientId: string;
    expectedVersion: number;
    command: ClientContactCommand;
    auditRecorder?: (
      client: PoolClient,
      before: ClientDetailRow | null,
      after: ClientDetailRow,
    ) => Promise<void>;
  }): Promise<ClientContactCommandOutcome> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const beforeResult = await client.query<ClientDetailRow>(
        `SELECT ${CLIENT_COLUMNS}
         FROM ${CLIENT_FROM}
         WHERE c.id = $1`,
        [input.clientId],
      );
      const beforeRow = beforeResult.rows[0] ?? null;

      const bumped = await client.query(
        `UPDATE pty.clients SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [input.clientId, input.expectedVersion],
      );
      if (bumped.rowCount === 0) {
        const exists = await client.query(`SELECT 1 FROM pty.clients WHERE id = $1`, [
          input.clientId,
        ]);
        await client.query('ROLLBACK');
        return exists.rowCount === 0 ? null : 'VERSION_CONFLICT';
      }

      const command = input.command;

      if (command.kind === 'add') {
        /*
         * O PRIMEIRO CONTATO VIRA PRINCIPAL AUTOMATICAMENTE? NÃO.
         *
         * Seria conveniente, e é justamente por isso que não é feito: "principal" é uma AFIRMAÇÃO
         * do operador sobre quem a empresa deve procurar primeiro. Deduzi-la da ordem de cadastro
         * inventaria organização. O apontamento de qualidade avisa que não há principal declarado,
         * e o operador decide.
         */
        await client.query(
          `INSERT INTO pty.client_contacts (client_id, name, purpose, role, email, phone)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.clientId,
            command.name.trim(),
            command.purpose,
            command.role ?? null,
            command.email?.trim() ?? null,
            command.phone?.trim() ?? null,
          ],
        );
      } else if (command.kind === 'setRole') {
        const updated = await client.query(
          `UPDATE pty.client_contacts
             SET role = $3::pty.contact_role, updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId, command.role],
        );
        if (updated.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'CONTACT_NOT_FOUND';
        }
      } else if (command.kind === 'setPrimary') {
        /*
         * O índice parcial do banco só admite UM principal por Cliente. Desmarcar o anterior e
         * marcar o novo na MESMA transação é o que torna a troca possível sem violar a invariante:
         * atualizar direto seria recusado pelo banco quando já existisse outro principal.
         */
        const target = await client.query(
          `SELECT id FROM pty.client_contacts WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId],
        );
        if (target.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'CONTACT_NOT_FOUND';
        }
        await client.query(
          `UPDATE pty.client_contacts SET is_primary = false, updated_at = NOW()
           WHERE client_id = $1 AND is_primary = true AND id <> $2`,
          [input.clientId, command.contactId],
        );
        await client.query(
          `UPDATE pty.client_contacts SET is_primary = true, updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId],
        );
      } else if (command.kind === 'deactivate') {
        const updated = await client.query(
          // Marcar como principal e inativar na mesma ação seria contraditório: o contato deixa de
          // ser o destinatário padrão ao sair de operação.
          `UPDATE pty.client_contacts
             SET deactivated_at = NOW(), is_primary = false, updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId],
        );
        if (updated.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'CONTACT_NOT_FOUND';
        }
      } else if (command.kind === 'reactivate') {
        const updated = await client.query(
          `UPDATE pty.client_contacts
             SET deactivated_at = NULL, updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId],
        );
        if (updated.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'CONTACT_NOT_FOUND';
        }
      } else {
        // `remove` é a única variante que APAGA, e existe porque um contato cadastrado por engano
        // não deve ficar para sempre na ficha. A inativação é o caminho normal; esta é a exceção
        // deliberada do operador.
        const removed = await client.query(
          `DELETE FROM pty.client_contacts WHERE id = $1 AND client_id = $2`,
          [command.contactId, input.clientId],
        );
        if (removed.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'CONTACT_NOT_FOUND';
        }
      }

      await client.query('COMMIT');
      const after = await this.loadDetailWithin(client, input.clientId);
      if (input.auditRecorder) {
        await input.auditRecorder(client, beforeRow, after);
      }

      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      // Violação do índice parcial de principal: a corrida entre dois comandos que marcam
      // principais diferentes é traduzida para o resultado de domínio, não vazada como erro cru.
      if (isUniqueViolation(error, 'client_contacts_primary_uidx')) {
        return 'PRIMARY_CONFLICT';
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** APLICA UM COMANDO SEMÂNTICO DE UNIDADE. Mesmas garantias de concorrência dos contatos. */
  async applyUnitCommand(input: {
    clientId: string;
    expectedVersion: number;
    command: ClientUnitCommand;
    auditRecorder?: (
      client: PoolClient,
      before: ClientDetailRow | null,
      after: ClientDetailRow,
    ) => Promise<void>;
  }): Promise<ClientUnitCommandOutcome> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const beforeUnitResult = await client.query<ClientDetailRow>(
        `SELECT ${CLIENT_COLUMNS}
         FROM ${CLIENT_FROM}
         WHERE c.id = $1`,
        [input.clientId],
      );
      const beforeUnitRow = beforeUnitResult.rows[0] ?? null;

      const bumped = await client.query(
        `UPDATE pty.clients SET version = version + 1, updated_at = NOW()
         WHERE id = $1 AND version = $2`,
        [input.clientId, input.expectedVersion],
      );
      if (bumped.rowCount === 0) {
        const exists = await client.query(`SELECT 1 FROM pty.clients WHERE id = $1`, [
          input.clientId,
        ]);
        await client.query('ROLLBACK');
        return exists.rowCount === 0 ? null : 'VERSION_CONFLICT';
      }

      const command = input.command;

      if (command.kind === 'add') {
        await client.query(
          `INSERT INTO pty.client_units (client_id, name, is_headquarters, city, state)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.clientId,
            command.name.trim(),
            command.isHeadquarters === true,
            command.city?.trim() ?? null,
            command.state?.trim() ?? null,
          ],
        );
      } else if (command.kind === 'setHeadquarters') {
        const target = await client.query(
          `SELECT id FROM pty.client_units WHERE id = $1 AND client_id = $2`,
          [command.unitId, input.clientId],
        );
        if (target.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'UNIT_NOT_FOUND';
        }
        // Mesma troca atômica do contato principal: desmarca antes de marcar, porque o banco
        // admite no máximo uma matriz por Cliente.
        await client.query(
          `UPDATE pty.client_units SET is_headquarters = false, updated_at = NOW()
           WHERE client_id = $1 AND is_headquarters = true AND id <> $2`,
          [input.clientId, command.unitId],
        );
        await client.query(
          `UPDATE pty.client_units SET is_headquarters = true, updated_at = NOW()
           WHERE id = $1 AND client_id = $2`,
          [command.unitId, input.clientId],
        );
      } else {
        // Endereços da unidade são DESVINCULADOS, não apagados: o endereço pertence ao Cliente e
        // continua válido sem unidade. Apagá-lo junto destruiria dado que ninguém pediu para
        // remover.
        await client.query(
          `UPDATE pty.client_addresses SET unit_id = NULL WHERE unit_id = $1 AND client_id = $2`,
          [command.unitId, input.clientId],
        );
        const removed = await client.query(
          `DELETE FROM pty.client_units WHERE id = $1 AND client_id = $2`,
          [command.unitId, input.clientId],
        );
        if (removed.rowCount === 0) {
          await client.query('ROLLBACK');
          return 'UNIT_NOT_FOUND';
        }
      }

      const after = await this.loadDetailWithin(client, input.clientId);
      if (input.auditRecorder) {
        await input.auditRecorder(client, beforeUnitRow, after);
      }

      await client.query('COMMIT');
      return after;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error, 'client_units_headquarters_uidx')) {
        return 'HEADQUARTERS_CONFLICT';
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async replaceContacts(
    client: PoolClient,
    clientId: string,
    contacts: ClientContactPersistenceInput[],
  ): Promise<void> {
    await client.query(`DELETE FROM pty.client_contacts WHERE client_id = $1`, [clientId]);
    for (const contact of contacts) {
      await client.query(
        /*
         * CONTATO INATIVO NÃO É APAGADO — é marcado.
         *
         * `deactivated_at` registra quando o contato deixou de valer; o nome, o e-mail e o papel
         * permanecem para o histórico de relacionamento. Apagar a linha faria a organização do
         * Cliente perder memória a cada troca de pessoa.
         */
        `INSERT INTO pty.client_contacts
           (client_id, name, purpose, role, is_primary, email, phone, deactivated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN NOW() ELSE NULL END)`,
        [
          clientId,
          contact.name.trim(),
          contact.purpose,
          contact.role ?? null,
          contact.isPrimary === true,
          contact.email?.trim() ?? null,
          contact.phone?.trim() ?? null,
          contact.deactivated === true,
        ],
      );
    }
  }

  /**
   * Substitui as unidades do Cliente e RESOLVE os nomes usados pelos endereços.
   *
   * Devolve o mapa `nome -> id` porque `replaceAddresses` roda logo depois e recebe o endereço
   * qualificado por NOME de unidade no contrato. Resolver aqui, dentro da mesma transação, é o que
   * garante que a FK composta de coerência (`unit_id` pertence ao mesmo Cliente) nunca seja
   * violada por uma corrida entre a leitura e a escrita.
   */
  private async replaceUnits(
    client: PoolClient,
    clientId: string,
    units: ClientUnitPersistenceInput[],
  ): Promise<Map<string, string>> {
    // Endereços apontam para unidades por FK: desvincular ANTES de remover evita que a remoção
    // leve o endereço junto (o `ON DELETE SET NULL` cuidaria disso, mas deixar explícito mantém a
    // intenção legível e independente do comportamento da FK).
    await client.query(`UPDATE pty.client_addresses SET unit_id = NULL WHERE client_id = $1`, [
      clientId,
    ]);
    await client.query(`DELETE FROM pty.client_units WHERE client_id = $1`, [clientId]);

    const byName = new Map<string, string>();
    for (const unit of units) {
      const name = unit.name.trim();
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pty.client_units (client_id, name, is_headquarters, city, state)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          clientId,
          name,
          unit.isHeadquarters === true,
          unit.city?.trim() ?? null,
          unit.state?.trim() ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (row) {
        byName.set(name, row.id);
      }
    }
    return byName;
  }

  private async replaceAddresses(
    client: PoolClient,
    clientId: string,
    addresses: ClientAddressPersistenceInput[],
  ): Promise<void> {
    // O mapa de unidades é lido do banco, e não recebido por parâmetro, porque `replaceAddresses`
    // também é chamado em caminhos que não tocaram em unidades (ex.: PATCH só de endereços). Ler
    // aqui mantém a resolução correta em ambos os caminhos.
    const unitRows = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM pty.client_units WHERE client_id = $1`,
      [clientId],
    );
    const unitByName = new Map(unitRows.rows.map((row) => [row.name, row.id]));

    await client.query(`DELETE FROM pty.client_addresses WHERE client_id = $1`, [clientId]);
    for (const address of addresses) {
      /*
       * Unidade INEXISTENTE não é silenciosamente ignorada: o endereço é gravado sem unidade e o
       * vínculo não é inventado. Criar a unidade aqui às escondidas faria um erro de digitação no
       * nome virar uma filial fantasma no cadastro.
       */
      const unitId = address.unitName ? (unitByName.get(address.unitName.trim()) ?? null) : null;
      await client.query(
        `INSERT INTO pty.client_addresses (
           client_id, purpose, unit_id, street, number, complement, district, city, state, postal_code, country
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          clientId,
          address.purpose,
          unitId,
          address.street?.trim() ?? null,
          address.number?.trim() ?? null,
          address.complement?.trim() ?? null,
          address.district?.trim() ?? null,
          address.city?.trim() ?? null,
          address.state?.trim() ?? null,
          address.postalCode?.trim() ?? null,
          address.country?.trim() ?? null,
        ],
      );
    }
  }
}
