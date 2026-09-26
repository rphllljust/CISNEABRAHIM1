import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import type { AddressPurpose, ContactPurpose, PurchaseOrderRequirement } from '../domain/client-status';
import type { ClientListSqlParts } from '../domain/client-list.query';
import type {
  ClientAddressRow,
  ClientContactRow,
  ClientDetail,
  ClientRow,
  ClientSummaryRow,
} from '../serializers/client-response.serializer';

export type CreateClientPersistenceInput = {
  legalName: string;
  tradeName?: string;
  normalizedTaxId: string;
  externalErpId?: string;
  contacts: Array<{
    name: string;
    purpose: ContactPurpose;
    email?: string;
    phone?: string;
  }>;
  addresses?: Array<{
    purpose: AddressPurpose;
    street?: string;
    number?: string;
    complement?: string;
    district?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  purchaseOrderRequirement?: PurchaseOrderRequirement;
};

export type UpdateClientPersistenceInput = {
  clientId: string;
  expectedVersion: number;
  legalName?: string;
  tradeName?: string | null;
  externalErpId?: string | null;
  contacts?: CreateClientPersistenceInput['contacts'];
  addresses?: CreateClientPersistenceInput['addresses'];
  purchaseOrderRequirement?: PurchaseOrderRequirement;
};

const CLIENT_COLUMNS = `id,
              legal_name,
              trade_name,
              normalized_tax_id,
              external_erp_id,
              status,
              version,
              created_at,
              updated_at,
              deactivated_at,
              deactivation_reason,
              COALESCE(purchase_order_requirement::text, 'NOT_REQUIRED') AS purchase_order_requirement`;

/**
 * Projeção de listagem: apenas a tabela de Clientes.
 *
 * Sem junção de endereços. `pty.client_addresses` permite várias linhas por Cliente com finalidades
 * distintas (`operational`/`billing`/`correspondence`) e não existe regra empresarial confirmada
 * que eleja um endereço como "a" localidade do Cliente — eleger um seria inventar semântica de
 * negócio. Contatos e endereços permanecem disponíveis no detalhe (`GET /api/v1/clients/:id`).
 */
const CLIENT_SUMMARY_COLUMNS = `c.id,
              c.legal_name,
              c.trade_name,
              c.normalized_tax_id,
              c.status,
              c.created_at,
              c.updated_at`;

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
    const client = await this.pool().query<ClientRow>(
      `SELECT ${CLIENT_COLUMNS}
       FROM pty.clients
       WHERE id = $1`,
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
       FROM pty.clients c
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
      `SELECT COUNT(*)::text AS total
       FROM pty.clients c
       WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async create(
    input: CreateClientPersistenceInput,
    scopeRefInserter: (client: PoolClient, clientId: string) => Promise<void>,
  ): Promise<ClientDetail> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<ClientRow>(
        `INSERT INTO pty.clients (
           legal_name,
           trade_name,
           normalized_tax_id,
           external_erp_id,
           purchase_order_requirement
         )
         VALUES ($1, $2, $3, $4, COALESCE($5::pty.purchase_order_requirement, 'NOT_REQUIRED'::pty.purchase_order_requirement))
         RETURNING ${CLIENT_COLUMNS}`,
        [
          input.legalName.trim(),
          input.tradeName?.trim() ?? null,
          input.normalizedTaxId,
          input.externalErpId?.trim() ?? null,
          input.purchaseOrderRequirement ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error('CLIENT_INSERT_FAILED');
      }

      await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ClientAfterInsertBeforeContacts);
      await scopeRefInserter(client, row.id);
      await this.replaceContacts(client, row.id, input.contacts);
      if (input.addresses) {
        await this.replaceAddresses(client, row.id, input.addresses);
      }

      await client.query('COMMIT');
      return (await this.findById(row.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: UpdateClientPersistenceInput): Promise<ClientDetail | 'VERSION_CONFLICT' | null> {
    const pool = this.pool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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

      const updated = await client.query<ClientRow>(
        `UPDATE pty.clients
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING ${CLIENT_COLUMNS}`,
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

      if (input.contacts) {
        await this.replaceContacts(client, input.clientId, input.contacts);
      }
      if (input.addresses) {
        await this.replaceAddresses(client, input.clientId, input.addresses);
      }

      await client.query('COMMIT');
      return (await this.findById(input.clientId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setStatus(
    clientId: string,
    expectedVersion: number,
    status: 'ACTIVE' | 'INACTIVE',
    actorIdentityId: string,
    reason?: string,
  ): Promise<ClientDetail | 'VERSION_CONFLICT' | 'INVALID_STATE' | null> {
    const pool = this.pool();
    const current = await pool.query<{ status: 'ACTIVE' | 'INACTIVE'; version: number }>(
      `SELECT status, version FROM pty.clients WHERE id = $1`,
      [clientId],
    );
    const currentRow = current.rows[0];
    if (!currentRow) {
      return null;
    }
    if (currentRow.version !== expectedVersion) {
      return 'VERSION_CONFLICT';
    }
    if (currentRow.status === status) {
      return 'INVALID_STATE';
    }

    const result = await pool.query<ClientRow>(
      `UPDATE pty.clients
       SET status = $3::"pty"."client_status",
           version = version + 1,
           updated_at = NOW(),
           deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN NOW() ELSE deactivated_at END,
           deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE deactivated_by_identity_id END,
           deactivation_reason = CASE WHEN $3::text = 'INACTIVE' THEN $5 ELSE deactivation_reason END
       WHERE id = $1 AND version = $2
       RETURNING ${CLIENT_COLUMNS}`,
      [clientId, expectedVersion, status, actorIdentityId, reason ?? null],
    );

    if (result.rowCount === 0) {
      const exists = await pool.query(`SELECT 1 FROM pty.clients WHERE id = $1`, [clientId]);
      if (exists.rowCount === 0) {
        return null;
      }
      return 'VERSION_CONFLICT';
    }

    return (await this.findById(clientId))!;
  }

  private async loadChildren(row: ClientRow): Promise<ClientDetail> {
    const contacts = await this.pool().query<ClientContactRow>(
      `SELECT id, name, purpose, email, phone
       FROM pty.client_contacts
       WHERE client_id = $1
       ORDER BY created_at ASC`,
      [row.id],
    );
    const addresses = await this.pool().query<ClientAddressRow>(
      `SELECT id, purpose, street, number, complement, district, city, state, postal_code, country
       FROM pty.client_addresses
       WHERE client_id = $1
       ORDER BY created_at ASC`,
      [row.id],
    );
    return {
      ...row,
      contacts: contacts.rows,
      addresses: addresses.rows,
    };
  }

  private async replaceContacts(
    client: PoolClient,
    clientId: string,
    contacts: CreateClientPersistenceInput['contacts'],
  ): Promise<void> {
    await client.query(`DELETE FROM pty.client_contacts WHERE client_id = $1`, [clientId]);
    for (const contact of contacts) {
      await client.query(
        `INSERT INTO pty.client_contacts (client_id, name, purpose, email, phone)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          clientId,
          contact.name.trim(),
          contact.purpose,
          contact.email?.trim() ?? null,
          contact.phone?.trim() ?? null,
        ],
      );
    }
  }

  private async replaceAddresses(
    client: PoolClient,
    clientId: string,
    addresses: NonNullable<CreateClientPersistenceInput['addresses']>,
  ): Promise<void> {
    await client.query(`DELETE FROM pty.client_addresses WHERE client_id = $1`, [clientId]);
    for (const address of addresses) {
      await client.query(
        `INSERT INTO pty.client_addresses (
           client_id, purpose, street, number, complement, district, city, state, postal_code, country
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          clientId,
          address.purpose,
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
