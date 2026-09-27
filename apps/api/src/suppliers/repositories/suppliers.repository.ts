import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { SUPPLIER_HISTORY_KINDS } from '../domain/supplier';
import type {
  SupplierAddressRow,
  SupplierContactRow,
  SupplierRow,
} from '../serializers/supplier-response.serializer';

const SUPPLIER_RETURNING = `
  id, legal_name, trade_name, normalized_tax_id, external_erp_id, payment_terms, currency_code,
  status::text AS status, version, created_at, updated_at, deactivated_at, deactivation_reason
`;

@Injectable()
export class SuppliersRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findRowById(supplierId: string): Promise<SupplierRow | null> {
    const result = await this.pool().query<SupplierRow>(
      `SELECT ${SUPPLIER_RETURNING} FROM pty.suppliers WHERE id = $1`,
      [supplierId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Página de fornecedores sob o MESMO predicado da contagem. A consulta de lista não junta
   * contatos/endereços: a linha de lista é um resumo, e o detalhe continua sendo a fonte
   * completa.
   */
  async listPage(input: {
    whereClause: string;
    params: unknown[];
    limit: number;
    offset: number;
  }): Promise<SupplierRow[]> {
    const result = await this.pool().query<SupplierRow>(
      `SELECT ${SUPPLIER_RETURNING}
       FROM pty.suppliers
       WHERE ${input.whereClause}
       ORDER BY legal_name ASC, id ASC
       LIMIT $${input.params.length + 1}
       OFFSET $${input.params.length + 2}`,
      [...input.params, input.limit, input.offset],
    );
    return result.rows;
  }

  /**
   * Referências humanas para o port Comercial (leitura por outro contexto). Uma única consulta
   * para o conjunto de ids pedido — nunca uma por linha.
   */
  async listReferencesByIds(
    supplierIds: string[],
  ): Promise<Array<{ id: string; legal_name: string; trade_name: string | null; normalized_tax_id: string }>> {
    if (supplierIds.length === 0) {
      return [];
    }
    const result = await this.pool().query<{
      id: string;
      legal_name: string;
      trade_name: string | null;
      normalized_tax_id: string;
    }>(
      `SELECT id, legal_name, trade_name, normalized_tax_id
       FROM pty.suppliers WHERE id = ANY($1::uuid[])`,
      [supplierIds],
    );
    return result.rows;
  }

  /** Ids que casam com o termo livre, para o consumidor filtrar o próprio dado. */
  async searchIdsByTerm(term: string, limit: number): Promise<string[]> {
    const result = await this.pool().query<{ id: string }>(
      `SELECT id FROM pty.suppliers
       WHERE legal_name ILIKE $1 OR trade_name ILIKE $1 OR normalized_tax_id ILIKE $1
       ORDER BY legal_name ASC, id ASC
       LIMIT $2`,
      [`%${term}%`, limit],
    );
    return result.rows.map((row) => row.id);
  }

  async countList(whereClause: string, params: unknown[]): Promise<number> {
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM pty.suppliers WHERE ${whereClause}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async findPublishedById(supplierId: string): Promise<SupplierRow | null> {
    const result = await this.pool().query<SupplierRow>(
      `SELECT ${SUPPLIER_RETURNING} FROM rpt.read_suppliers WHERE id = $1`,
      [supplierId],
    );
    return result.rows[0] ?? null;
  }

  async listContacts(supplierId: string): Promise<SupplierContactRow[]> {
    const result = await this.pool().query<SupplierContactRow>(
      `SELECT id, name, purpose::text AS purpose, email, phone
       FROM pty.supplier_contacts WHERE supplier_id = $1 ORDER BY created_at`,
      [supplierId],
    );
    return result.rows;
  }

  async listAddresses(supplierId: string): Promise<SupplierAddressRow[]> {
    const result = await this.pool().query<SupplierAddressRow>(
      `SELECT id, purpose::text AS purpose, street, number, complement, district, city, state,
              postal_code, country
       FROM pty.supplier_addresses WHERE supplier_id = $1 ORDER BY created_at`,
      [supplierId],
    );
    return result.rows;
  }

  async listHistory(supplierId: string): Promise<
    Array<{ id: string; event_kind: string; actor_identity_id: string; occurred_at: Date | string }>
  > {
    const result = await this.pool().query<{
      id: string;
      event_kind: string;
      actor_identity_id: string;
      occurred_at: Date | string;
    }>(
      `SELECT id, event_kind, actor_identity_id, occurred_at
       FROM pty.supplier_history_events
       WHERE supplier_id = $1
       ORDER BY occurred_at ASC`,
      [supplierId],
    );
    return result.rows;
  }

  async create(input: {
    legalName: string;
    tradeName?: string | null;
    normalizedTaxId: string;
    externalErpId?: string | null;
    paymentTerms?: string | null;
    currencyCode: string;
    contacts: Array<{ name: string; purpose: string; email?: string; phone?: string }>;
    addresses?: Array<{
      purpose: string;
      street?: string;
      number?: string;
      complement?: string;
      district?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    }>;
    actorIdentityId: string;
  }): Promise<SupplierRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<SupplierRow>(
        `INSERT INTO pty.suppliers (
           legal_name, trade_name, normalized_tax_id, external_erp_id, payment_terms, currency_code
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${SUPPLIER_RETURNING}`,
        [
          input.legalName.trim(),
          input.tradeName?.trim() || null,
          input.normalizedTaxId,
          input.externalErpId?.trim() || null,
          input.paymentTerms?.trim() || null,
          input.currencyCode,
        ],
      );
      const supplier = created.rows[0]!;
      for (const contact of input.contacts) {
        await client.query(
          `INSERT INTO pty.supplier_contacts (supplier_id, name, purpose, email, phone)
           VALUES ($1, $2, $3, $4, $5)`,
          [supplier.id, contact.name.trim(), contact.purpose, contact.email ?? null, contact.phone ?? null],
        );
      }
      for (const address of input.addresses ?? []) {
        await client.query(
          `INSERT INTO pty.supplier_addresses (
             supplier_id, purpose, street, number, complement, district, city, state, postal_code, country
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            supplier.id,
            address.purpose,
            address.street ?? null,
            address.number ?? null,
            address.complement ?? null,
            address.district ?? null,
            address.city ?? null,
            address.state ?? null,
            address.postalCode ?? null,
            address.country ?? null,
          ],
        );
      }
      await client.query(
        `INSERT INTO pty.supplier_history_events (supplier_id, event_kind, actor_identity_id)
         VALUES ($1, $2, $3)`,
        [supplier.id, SUPPLIER_HISTORY_KINDS.Created, input.actorIdentityId],
      );
      await client.query('COMMIT');
      return supplier;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(input: {
    supplierId: string;
    expectedVersion: number;
    legalName?: string;
    tradeName?: string | null;
    externalErpId?: string | null;
    paymentTerms?: string | null;
    currencyCode?: string;
    actorIdentityId: string;
  }): Promise<SupplierRow | 'VERSION_CONFLICT' | null> {
    const sets = ['updated_at = NOW()', 'version = version + 1'];
    const params: unknown[] = [input.supplierId, input.expectedVersion];
    let index = 3;
    if (input.legalName !== undefined) {
      sets.push(`legal_name = $${index++}`);
      params.push(input.legalName.trim());
    }
    if (input.tradeName !== undefined) {
      sets.push(`trade_name = $${index++}`);
      params.push(input.tradeName);
    }
    if (input.externalErpId !== undefined) {
      sets.push(`external_erp_id = $${index++}`);
      params.push(input.externalErpId);
    }
    if (input.paymentTerms !== undefined) {
      sets.push(`payment_terms = $${index++}`);
      params.push(input.paymentTerms);
    }
    if (input.currencyCode !== undefined) {
      sets.push(`currency_code = $${index++}`);
      params.push(input.currencyCode);
    }
    const updated = await this.pool().query<SupplierRow>(
      `UPDATE pty.suppliers SET ${sets.join(', ')}
       WHERE id = $1 AND version = $2
       RETURNING ${SUPPLIER_RETURNING}`,
      params,
    );
    if (!updated.rows[0]) {
      const exists = await this.findRowById(input.supplierId);
      return exists ? 'VERSION_CONFLICT' : null;
    }
    await this.pool().query(
      `INSERT INTO pty.supplier_history_events (supplier_id, event_kind, actor_identity_id)
       VALUES ($1, $2, $3)`,
      [input.supplierId, SUPPLIER_HISTORY_KINDS.Updated, input.actorIdentityId],
    );
    return updated.rows[0];
  }

  async setStatus(input: {
    supplierId: string;
    expectedVersion: number;
    status: 'ACTIVE' | 'INACTIVE';
    actorIdentityId: string;
    reason?: string;
  }): Promise<SupplierRow | 'VERSION_CONFLICT' | 'INVALID_STATE' | null> {
    const current = await this.findRowById(input.supplierId);
    if (!current) {
      return null;
    }
    if (current.version !== input.expectedVersion) {
      return 'VERSION_CONFLICT';
    }
    if (current.status === input.status) {
      return 'INVALID_STATE';
    }
    const updated = await this.pool().query<SupplierRow>(
      `UPDATE pty.suppliers
       SET status = $3::pty.supplier_status,
           version = version + 1,
           updated_at = NOW(),
           deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN NOW() ELSE deactivated_at END,
           deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE deactivated_by_identity_id END,
           deactivation_reason = CASE WHEN $3::text = 'INACTIVE' THEN $5 ELSE deactivation_reason END
       WHERE id = $1 AND version = $2
       RETURNING ${SUPPLIER_RETURNING}`,
      [input.supplierId, input.expectedVersion, input.status, input.actorIdentityId, input.reason ?? null],
    );
    if (!updated.rows[0]) {
      return 'VERSION_CONFLICT';
    }
    await this.pool().query(
      `INSERT INTO pty.supplier_history_events (supplier_id, event_kind, actor_identity_id)
       VALUES ($1, $2, $3)`,
      [
        input.supplierId,
        input.status === 'INACTIVE' ? SUPPLIER_HISTORY_KINDS.Deactivated : SUPPLIER_HISTORY_KINDS.Activated,
        input.actorIdentityId,
      ],
    );
    return updated.rows[0];
  }
}
