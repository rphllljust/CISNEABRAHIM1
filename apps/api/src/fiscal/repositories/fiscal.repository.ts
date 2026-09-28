import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { classifyRowVersion } from '../../infrastructure/database/optimistic-lock';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  FISCAL_EVENT_TYPES,
  FISCAL_STATUSES,
  FiscalError,
  assertPayloadMutable,
  assertTransition,
} from '../domain/fiscal-document';
import type {
  CreateFiscalPersistenceInput,
  FiscalAggregate,
  FiscalAuthorizationRow,
  FiscalDocumentListRow,
  FiscalDocumentRow,
  FiscalEventRow,
  FiscalItemRow,
  FiscalPartyRow,
  FiscalTaxDetailRow,
  ReplaceFiscalSnapshotsInput,
} from './fiscal.repository.types';

const DOCUMENT_RETURNING = `
  id, unit_id, status::text AS status, source_kind::text AS source_kind, source_id,
  billing_document_id, establishment_id, description, currency_code, issued_on::text AS issued_on,
  certificate_ref, idempotency_key, row_version, submitted_at, authorized_at, rejected_at,
  cancelled_at, cancel_reason, created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

@Injectable()
export class FiscalRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(id: string): Promise<FiscalAggregate | null> {
    const document = await this.pool().query<FiscalDocumentRow>(
      `SELECT ${DOCUMENT_RETURNING} FROM fis.fiscal_documents WHERE id = $1`,
      [id],
    );
    if (!document.rows[0]) {
      return null;
    }
    return this.hydrate(document.rows[0]);
  }

  async findByIdempotency(input: {
    unitId: string;
    idempotencyKey: string;
    sourceKind?: string;
    sourceId?: string;
  }): Promise<FiscalAggregate | null> {
    const result = await this.pool().query<FiscalDocumentRow>(
      `SELECT ${DOCUMENT_RETURNING}
       FROM fis.fiscal_documents
       WHERE (unit_id = $1 AND idempotency_key = $2)
          OR ($3::text IS NOT NULL AND $4::uuid IS NOT NULL
              AND source_kind = $3::fis.fiscal_source_kind
              AND source_id = $4::uuid AND idempotency_key = $2)
       LIMIT 1`,
      [input.unitId, input.idempotencyKey, input.sourceKind ?? null, input.sourceId ?? null],
    );
    if (!result.rows[0]) {
      return null;
    }
    return this.hydrate(result.rows[0]);
  }

  /**
   * Lista paginada de documentos fiscais da unidade. Leitura pura (sem escrita) para a
   * superficie de consulta: situacao, periodo de emissao e origem. O ultimo protocolo e a
   * ultima tentativa de autorizacao vem por LATERAL (uma consulta, sem N+1).
   */
  async listDocumentPage(input: {
    unitId: string;
    status?: string | string[];
    sourceKind?: string;
    billingDocumentId?: string;
    issuedFrom?: string;
    issuedTo?: string;
    page: number;
    pageSize: number;
  }): Promise<{ total: number; items: FiscalDocumentListRow[] }> {
    const conditions: string[] = ['d.unit_id = $1'];
    const params: unknown[] = [input.unitId];
    const push = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('?', `$${params.length}`));
    };

    if (input.status) {
      const statuses = Array.isArray(input.status) ? input.status : [input.status];
      push('d.status = ANY(?::fis.fiscal_document_status[])', statuses);
    }
    if (input.sourceKind) {
      push('d.source_kind = ?::fis.fiscal_source_kind', input.sourceKind);
    }
    if (input.billingDocumentId) {
      push('d.billing_document_id = ?', input.billingDocumentId);
    }
    if (input.issuedFrom) {
      push('d.issued_on >= ?::date', input.issuedFrom);
    }
    if (input.issuedTo) {
      push('d.issued_on <= ?::date', input.issuedTo);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const totalResult = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fis.fiscal_documents d ${where}`,
      params,
    );
    const total = Number(totalResult.rows[0]?.count ?? '0');

    const pageParams = [...params, input.pageSize, input.page * input.pageSize];
    const rows = await this.pool().query<FiscalDocumentListRow>(
      `SELECT
         d.id, d.unit_id, d.status::text AS status, d.source_kind::text AS source_kind,
         d.source_id, d.billing_document_id, d.establishment_id, d.description,
         d.currency_code, d.issued_on::text AS issued_on, d.certificate_ref, d.idempotency_key,
         d.row_version, d.submitted_at, d.authorized_at, d.rejected_at, d.cancelled_at,
         d.cancel_reason, d.created_at, d.updated_at, d.created_by_identity_id,
         d.updated_by_identity_id,
         latest.protocol_code AS last_protocol_code,
         latest.outcome::text AS last_authorization_outcome
       FROM fis.fiscal_documents d
       LEFT JOIN LATERAL (
         SELECT a.protocol_code, a.outcome
         FROM fis.fiscal_authorizations a
         WHERE a.fiscal_document_id = d.id
         ORDER BY a.attempt_number DESC
         LIMIT 1
       ) latest ON TRUE
       ${where}
       ORDER BY d.issued_on DESC, d.created_at DESC, d.id DESC
       LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
      pageParams,
    );

    return { total, items: rows.rows };
  }

  async listEvents(fiscalDocumentId: string): Promise<FiscalEventRow[]> {
    const result = await this.pool().query<FiscalEventRow>(
      `SELECT id, fiscal_document_id, event_type, payload, occurred_at, actor_identity_id
       FROM fis.fiscal_events
       WHERE fiscal_document_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [fiscalDocumentId],
    );
    return result.rows;
  }

  async countDocumentsByStatus(unitId: string): Promise<Array<{ status: string; count: number }>> {
    const result = await this.pool().query<{ status: string; count: string }>(
      `SELECT status::text AS status, COUNT(*)::text AS count
       FROM fis.fiscal_documents
       WHERE unit_id = $1
       GROUP BY status`,
      [unitId],
    );
    return result.rows.map((row) => ({ status: row.status, count: Number(row.count) }));
  }

  /**
   * Fatos fiscais da competencia, agrupados pelo que interessa ao FECHAMENTO CONTABIL.
   *
   * Uma consulta agregada na unidade+janela — sem N+1 e sem trazer documento para a memoria.
   * Vive aqui porque `fis` e schema deste contexto; quem precisa do numero consome o port.
   */
  async countDocumentsInWindow(input: {
    unitId: string;
    startsOn: string;
    endsOn: string;
  }): Promise<{ unauthorized: number; rejected: number; pendingAuthorization: number; draft: number }> {
    const result = await this.pool().query<{
      unauthorized: string;
      rejected: string;
      pending_authorization: string;
      draft: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status NOT IN ('AUTHORIZED', 'CANCELLED'))::text AS unauthorized,
         COUNT(*) FILTER (WHERE status = 'REJECTED')::text AS rejected,
         COUNT(*) FILTER (WHERE status IN ('READY', 'SUBMITTED'))::text AS pending_authorization,
         COUNT(*) FILTER (WHERE status = 'DRAFT')::text AS draft
       FROM fis.fiscal_documents
       WHERE unit_id = $1 AND issued_on BETWEEN $2::date AND $3::date`,
      [input.unitId, input.startsOn, input.endsOn],
    );
    const row = result.rows[0];
    return {
      unauthorized: Number(row?.unauthorized ?? '0'),
      rejected: Number(row?.rejected ?? '0'),
      pendingAuthorization: Number(row?.pending_authorization ?? '0'),
      draft: Number(row?.draft ?? '0'),
    };
  }

  async createDraft(input: CreateFiscalPersistenceInput): Promise<FiscalAggregate> {
    const existing = await this.findByIdempotency(input);
    if (existing) {
      return existing;
    }
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<FiscalDocumentRow>(
        `INSERT INTO fis.fiscal_documents (
           unit_id, source_kind, source_id, billing_document_id, description, currency_code,
           issued_on, certificate_ref, idempotency_key, created_by_identity_id, updated_by_identity_id,
           establishment_id
         ) VALUES (
           $1, $2::fis.fiscal_source_kind, $3, $4, $5, $6, $7::date, $8, $9, $10, $10, $11
         )
         RETURNING ${DOCUMENT_RETURNING}`,
        [
          input.unitId,
          input.sourceKind,
          input.sourceId ?? null,
          input.billingDocumentId ?? null,
          input.description,
          input.currencyCode,
          input.issuedOn,
          input.certificateRef ?? null,
          input.idempotencyKey,
          input.actorIdentityId,
          input.establishmentId ?? null,
        ],
      );
      const document = created.rows[0]!;
      await this.writeSnapshots(client, document.id, input);
      await this.appendEvent(client, document.id, FISCAL_EVENT_TYPES.Drafted, input.actorIdentityId, {
        sourceKind: input.sourceKind,
        billingDocumentId: input.billingDocumentId ?? null,
      });
      await client.query('COMMIT');
      return (await this.findById(document.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const duplicate = await this.findByIdempotency(input);
        if (duplicate) {
          return duplicate;
        }
        throw new FiscalError('FISCAL_DUPLICATE_SUBMISSION');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceSnapshots(input: ReplaceFiscalSnapshotsInput): Promise<FiscalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockDocument(client, input.fiscalDocumentId);
      assertPayloadMutable(locked.status);
      if (classifyRowVersion(locked, input.rowVersion) !== 'match') {
        throw new FiscalError('FISCAL_VERSION_CONFLICT');
      }
      await this.writeSnapshots(client, locked.id, input);
      await this.touch(client, locked.id, input.actorIdentityId);
      await this.appendEvent(client, locked.id, FISCAL_EVENT_TYPES.Revised, input.actorIdentityId, {
        replaced: true,
      });
      await client.query('COMMIT');
      return (await this.findById(locked.id))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async transition(input: {
    fiscalDocumentId: string;
    rowVersion: number;
    actorIdentityId: string;
    nextStatus: string;
    eventType: string;
    cancelReason?: string;
    extra?: Record<string, unknown>;
  }): Promise<FiscalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockDocument(client, input.fiscalDocumentId);
      if (classifyRowVersion(locked, input.rowVersion) !== 'match') {
        throw new FiscalError('FISCAL_VERSION_CONFLICT');
      }
      assertTransition(locked.status, input.nextStatus);
      const timestamps = statusTimestamps(input.nextStatus);
      const result = await client.query<FiscalDocumentRow>(
        `UPDATE fis.fiscal_documents
         SET status = $2::fis.fiscal_document_status,
             submitted_at = COALESCE($3::timestamptz, submitted_at),
             authorized_at = COALESCE($4::timestamptz, authorized_at),
             rejected_at = COALESCE($5::timestamptz, rejected_at),
             cancelled_at = COALESCE($6::timestamptz, cancelled_at),
             cancel_reason = COALESCE($7, cancel_reason),
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $8
         WHERE id = $1
         RETURNING ${DOCUMENT_RETURNING}`,
        [
          locked.id,
          input.nextStatus,
          timestamps.submittedAt,
          timestamps.authorizedAt,
          timestamps.rejectedAt,
          timestamps.cancelledAt,
          input.cancelReason ?? null,
          input.actorIdentityId,
        ],
      );
      await this.appendEvent(
        client,
        locked.id,
        input.eventType,
        input.actorIdentityId,
        input.extra ?? {},
      );
      await client.query('COMMIT');
      return { ...(await this.hydrate(result.rows[0]!)) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAuthorizationAttempt(input: {
    fiscalDocumentId: string;
    rowVersion: number;
    actorIdentityId: string;
    gatewayId: string;
    outcome: string;
    nextStatus: string;
    eventType: string;
    protocolCode?: string | null;
    message?: string | null;
    requestSnapshot: Record<string, unknown>;
    responseSnapshot: Record<string, unknown>;
  }): Promise<FiscalAggregate> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockDocument(client, input.fiscalDocumentId);
      if (classifyRowVersion(locked, input.rowVersion) !== 'match') {
        throw new FiscalError('FISCAL_VERSION_CONFLICT');
      }
      assertTransition(locked.status, input.nextStatus);
      const attempt = await client.query<{ attempt_number: number }>(
        `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
         FROM fis.fiscal_authorizations
         WHERE fiscal_document_id = $1`,
        [locked.id],
      );
      await client.query(
        `INSERT INTO fis.fiscal_authorizations (
           fiscal_document_id, attempt_number, gateway_id, outcome, protocol_code, message,
           request_snapshot, response_snapshot, completed_at
         ) VALUES (
           $1, $2, $3, $4::fis.fiscal_authorization_outcome, $5, $6, $7::jsonb, $8::jsonb,
           CASE WHEN $4 = 'TIMEOUT' THEN NULL ELSE NOW() END
         )`,
        [
          locked.id,
          attempt.rows[0]!.attempt_number,
          input.gatewayId,
          input.outcome,
          input.protocolCode ?? null,
          input.message ?? null,
          JSON.stringify(input.requestSnapshot),
          JSON.stringify(input.responseSnapshot),
        ],
      );
      const timestamps = statusTimestamps(input.nextStatus);
      const result = await client.query<FiscalDocumentRow>(
        `UPDATE fis.fiscal_documents
         SET status = $2::fis.fiscal_document_status,
             submitted_at = COALESCE(submitted_at, NOW()),
             authorized_at = COALESCE($3::timestamptz, authorized_at),
             rejected_at = COALESCE($4::timestamptz, rejected_at),
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $5
         WHERE id = $1
         RETURNING ${DOCUMENT_RETURNING}`,
        [
          locked.id,
          input.nextStatus,
          timestamps.authorizedAt,
          timestamps.rejectedAt,
          input.actorIdentityId,
        ],
      );
      await this.appendEvent(client, locked.id, input.eventType, input.actorIdentityId, {
        outcome: input.outcome,
        gatewayId: input.gatewayId,
      });
      await client.query('COMMIT');
      return this.hydrate(result.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async countAuthorizedPayloadMutations(): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM fis.fiscal_documents
       WHERE status IN ('AUTHORIZED', 'CANCELLED')
         AND updated_at < authorized_at`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  private async hydrate(document: FiscalDocumentRow): Promise<FiscalAggregate> {
    const [items, parties, taxDetails, events, authorizations] = await Promise.all([
      this.pool().query<FiscalItemRow>(
        `SELECT id, fiscal_document_id, line_number, description, quantity::text AS quantity,
                unit_amount::text AS unit_amount, line_amount::text AS line_amount, item_snapshot
         FROM fis.fiscal_document_items
         WHERE fiscal_document_id = $1
         ORDER BY line_number`,
        [document.id],
      ),
      this.pool().query<FiscalPartyRow>(
        `SELECT id, fiscal_document_id, role::text AS role, legal_name, tax_identifier, party_snapshot
         FROM fis.fiscal_party_snapshots
         WHERE fiscal_document_id = $1
         ORDER BY role`,
        [document.id],
      ),
      this.pool().query<FiscalTaxDetailRow>(
        `SELECT id, fiscal_document_id, line_number, component_label, amount::text AS amount, detail_snapshot
         FROM fis.fiscal_tax_details
         WHERE fiscal_document_id = $1
         ORDER BY line_number`,
        [document.id],
      ),
      this.pool().query<FiscalEventRow>(
        `SELECT id, fiscal_document_id, event_type::text AS event_type, payload, occurred_at, actor_identity_id
         FROM fis.fiscal_events
         WHERE fiscal_document_id = $1
         ORDER BY occurred_at, id`,
        [document.id],
      ),
      this.pool().query<FiscalAuthorizationRow>(
        `SELECT id, fiscal_document_id, attempt_number, gateway_id, outcome::text AS outcome,
                protocol_code, message, request_snapshot, response_snapshot, submitted_at, completed_at
         FROM fis.fiscal_authorizations
         WHERE fiscal_document_id = $1
         ORDER BY attempt_number`,
        [document.id],
      ),
    ]);
    return {
      document,
      items: items.rows,
      parties: parties.rows,
      taxDetails: taxDetails.rows,
      events: events.rows,
      authorizations: authorizations.rows,
    };
  }

  private async lockDocument(client: PoolClient, id: string): Promise<FiscalDocumentRow> {
    const result = await client.query<FiscalDocumentRow>(
      `SELECT ${DOCUMENT_RETURNING} FROM fis.fiscal_documents WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!result.rows[0]) {
      throw new FiscalError('FISCAL_NOT_FOUND');
    }
    return result.rows[0];
  }

  private async writeSnapshots(
    client: PoolClient,
    fiscalDocumentId: string,
    input: Pick<CreateFiscalPersistenceInput, 'parties' | 'items' | 'taxDetails'>,
  ): Promise<void> {
    await client.query(`DELETE FROM fis.fiscal_tax_details WHERE fiscal_document_id = $1`, [
      fiscalDocumentId,
    ]);
    await client.query(`DELETE FROM fis.fiscal_document_items WHERE fiscal_document_id = $1`, [
      fiscalDocumentId,
    ]);
    await client.query(`DELETE FROM fis.fiscal_party_snapshots WHERE fiscal_document_id = $1`, [
      fiscalDocumentId,
    ]);
    for (const party of input.parties) {
      await client.query(
        `INSERT INTO fis.fiscal_party_snapshots (
           fiscal_document_id, role, legal_name, tax_identifier, party_snapshot
         ) VALUES ($1, $2::fis.fiscal_party_role, $3, $4, $5::jsonb)`,
        [
          fiscalDocumentId,
          party.role,
          party.legalName,
          party.taxIdentifier,
          JSON.stringify(party.partySnapshot ?? {}),
        ],
      );
    }
    for (const item of input.items) {
      await client.query(
        `INSERT INTO fis.fiscal_document_items (
           fiscal_document_id, line_number, description, quantity, unit_amount, line_amount, item_snapshot
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          fiscalDocumentId,
          item.lineNumber,
          item.description,
          item.quantity,
          item.unitAmount,
          item.lineAmount,
          JSON.stringify(item.itemSnapshot ?? {}),
        ],
      );
    }
    for (const detail of input.taxDetails) {
      await client.query(
        `INSERT INTO fis.fiscal_tax_details (
           fiscal_document_id, line_number, component_label, amount, detail_snapshot
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          fiscalDocumentId,
          detail.lineNumber,
          detail.componentLabel,
          detail.amount,
          JSON.stringify(detail.detailSnapshot ?? {}),
        ],
      );
    }
  }

  private async appendEvent(
    client: PoolClient,
    fiscalDocumentId: string,
    eventType: string,
    actorIdentityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO fis.fiscal_events (fiscal_document_id, event_type, payload, actor_identity_id)
       VALUES ($1, $2::fis.fiscal_event_type, $3::jsonb, $4)`,
      [fiscalDocumentId, eventType, JSON.stringify(payload), actorIdentityId],
    );
  }

  private async touch(client: PoolClient, id: string, actorIdentityId: string): Promise<void> {
    await client.query(
      `UPDATE fis.fiscal_documents
       SET row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $2
       WHERE id = $1`,
      [id, actorIdentityId],
    );
  }
}

function statusTimestamps(status: string): {
  submittedAt: string | null;
  authorizedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
} {
  const now = new Date().toISOString();
  return {
    submittedAt: status === FISCAL_STATUSES.Submitted ? now : null,
    authorizedAt: status === FISCAL_STATUSES.Authorized ? now : null,
    rejectedAt: status === FISCAL_STATUSES.Rejected ? now : null,
    cancelledAt: status === FISCAL_STATUSES.Cancelled ? now : null,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
