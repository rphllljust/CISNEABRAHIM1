import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { queryIsUnitRegistered } from '../../infrastructure/database/reference-lookups';
import { orderByCreatedAtDesc } from '../../infrastructure/database/sql';
import {
  assertContractTransition,
  CONTRACT_HISTORY_EVENTS,
  CONTRACT_STATUSES,
} from '../domain/contract';
import type {
  ActivateContractPersistenceInput,
  ClientSnapshotSource,
  CloseContractPersistenceInput,
  ContractDocumentLinkRow,
  ContractHistoryEventRow,
  ContractItemRow,
  ContractRow,
  CreateContractPersistenceInput,
  ExpireContractPersistenceInput,
  ServiceSnapshotSource,
  UpdateContractDraftPersistenceInput,
} from './contracts.repository.types';
import { insertContractHistoryEvent, replaceContractItems } from './contracts-child-rows';

const CONTRACT_SELECT = `
  SELECT
    id,
    internal_code,
    client_id,
    unit_id,
    contract_number,
    title,
    scope_description,
    valid_from::text AS valid_from,
    valid_to::text AS valid_to,
    currency_code,
    payment_terms,
    payment_method,
    commercial_terms,
    client_snapshot,
    status::text AS status,
    activated_at,
    activated_by_identity_id,
    closed_at,
    closed_by_identity_id,
    closure_reason,
    row_version,
    created_at,
    updated_at,
    created_by_identity_id,
    updated_by_identity_id
  FROM com.contracts
`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ContractsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async isUnitRegistered(unitId: string): Promise<boolean> {
    return queryIsUnitRegistered(this.pool(), unitId);
  }

  async findClientById(clientId: string): Promise<ClientSnapshotSource | null> {
    const result = await this.pool().query<ClientSnapshotSource>(
      `SELECT id, legal_name, trade_name, normalized_tax_id, status::text AS status
       FROM pty.clients WHERE id = $1`,
      [clientId],
    );
    return result.rows[0] ?? null;
  }

  async findDocumentById(documentId: string): Promise<{ id: string; unit_id: string } | null> {
    const result = await this.pool().query<{ id: string; unit_id: string }>(
      `SELECT id, unit_id FROM rpt.read_documents WHERE id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }

  async findServiceSnapshot(
    serviceDefinitionId: string,
    serviceDefinitionVersionId?: string,
  ): Promise<ServiceSnapshotSource | null> {
    const result = await this.pool().query<ServiceSnapshotSource>(
      `SELECT
         sd.id AS service_definition_id,
         sdv.id AS service_definition_version_id,
         sd.code,
         sdv.name,
         sdv.version,
         sdv.status::text AS version_status
       FROM rpt.read_service_definitions sd
       INNER JOIN rpt.read_service_definition_versions sdv ON sdv.service_definition_id = sd.id
       WHERE sd.id = $1
         AND ($2::uuid IS NULL OR sdv.id = $2::uuid)
       ORDER BY sdv.version DESC
       LIMIT 1`,
      [serviceDefinitionId, serviceDefinitionVersionId ?? null],
    );
    return result.rows[0] ?? null;
  }

  async findById(contractId: string): Promise<ContractRow | null> {
    const result = await this.pool().query<ContractRow>(
      `${CONTRACT_SELECT} WHERE id = $1`,
      [contractId],
    );
    return result.rows[0] ?? null;
  }

  async findByContractNumber(clientId: string, contractNumber: string): Promise<ContractRow | null> {
    const result = await this.pool().query<ContractRow>(
      `${CONTRACT_SELECT}
       WHERE client_id = $1
         AND lower(trim(contract_number)) = lower(trim($2))`,
      [clientId, contractNumber],
    );
    return result.rows[0] ?? null;
  }

  async findByReference(clientId: string, reference: string): Promise<ContractRow | null> {
    const trimmed = reference.trim();
    if (UUID_PATTERN.test(trimmed)) {
      const result = await this.pool().query<ContractRow>(
        `${CONTRACT_SELECT} WHERE id = $1::uuid AND client_id = $2`,
        [trimmed.toLowerCase(), clientId],
      );
      return result.rows[0] ?? null;
    }
    return this.findByContractNumber(clientId, trimmed);
  }

  /**
   * Listagem paginada.
   *
   * `orderBy` vem do allow-list de `contract-list-sql` — nunca de texto do cliente. Quando ausente
   * mantém a ordenação histórica (`created_at DESC`), de modo que nenhum chamador existente muda de
   * comportamento.
   */
  async listContracts(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
    orderBy?: string,
  ): Promise<ContractRow[]> {
    const result = await this.pool().query<ContractRow>(
      `${CONTRACT_SELECT}
       WHERE ${whereClause}
       ORDER BY ${orderBy ?? orderByCreatedAtDesc()}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async listItems(contractId: string): Promise<ContractItemRow[]> {
    const result = await this.pool().query<ContractItemRow>(
      `SELECT
         id,
         contract_id,
         line_number,
         description,
         service_definition_id,
         service_definition_version_id,
         service_snapshot,
         quantity::text AS quantity,
         unit_code,
         unit_price_amount::text AS unit_price_amount,
         line_total_amount::text AS line_total_amount
       FROM com.contract_items
       WHERE contract_id = $1
       ORDER BY line_number ASC`,
      [contractId],
    );
    return result.rows;
  }

  async listDocumentLinks(contractId: string): Promise<ContractDocumentLinkRow[]> {
    const result = await this.pool().query<ContractDocumentLinkRow>(
      `SELECT id, contract_id, document_id, link_purpose, created_at
       FROM com.contract_document_links
       WHERE contract_id = $1
       ORDER BY created_at ASC`,
      [contractId],
    );
    return result.rows;
  }

  async listHistoryEvents(contractId: string): Promise<ContractHistoryEventRow[]> {
    const result = await this.pool().query<ContractHistoryEventRow>(
      `SELECT id, contract_id, event_type, occurred_at, actor_identity_id, payload
       FROM com.contract_history_events
       WHERE contract_id = $1
       ORDER BY occurred_at ASC`,
      [contractId],
    );
    return result.rows;
  }

  async createContract(input: CreateContractPersistenceInput): Promise<{
    contract: ContractRow;
    items: ContractItemRow[];
  }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const contractResult = await client.query<ContractRow>(
        `INSERT INTO com.contracts (
           internal_code, client_id, unit_id, contract_number, title, scope_description,
           valid_from, valid_to, currency_code, payment_terms, payment_method, commercial_terms,
           created_by_identity_id, updated_by_identity_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           $7::date, $8::date, $9, $10, $11, $12::jsonb,
           $13, $13
         )
         RETURNING
           id, internal_code, client_id, unit_id, contract_number, title, scope_description,
           valid_from::text AS valid_from, valid_to::text AS valid_to, currency_code,
           payment_terms, payment_method, commercial_terms, client_snapshot,
           status::text AS status, activated_at, activated_by_identity_id,
           closed_at, closed_by_identity_id, closure_reason, row_version,
           created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [
          input.internalCode,
          input.clientId,
          input.unitId,
          input.contractNumber,
          input.title,
          input.scopeDescription ?? null,
          input.validFrom,
          input.validTo ?? null,
          input.currencyCode,
          input.paymentTerms ?? null,
          input.paymentMethod ?? null,
          JSON.stringify(input.commercialTerms ?? {}),
          input.actorIdentityId,
        ],
      );
      const contract = contractResult.rows[0];
      if (!contract) {
        throw new Error('CONTRACT_CREATE_FAILED');
      }

      const items = await replaceContractItems(client, contract.id, input.items);
      await insertContractHistoryEvent(client, {
        contractId: contract.id,
        eventType: CONTRACT_HISTORY_EVENTS.Created,
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return { contract, items };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateDraft(
    input: UpdateContractDraftPersistenceInput,
  ): Promise<
    { contract: ContractRow; items: ContractItemRow[] } | 'VERSION_CONFLICT' | 'INVALID_STATE'
  > {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<ContractRow>(
        `${CONTRACT_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.contractId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (current.status !== CONTRACT_STATUSES.Draft) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      await client.query(
        `UPDATE com.contracts
         SET
           contract_number = COALESCE($3, contract_number),
           title = COALESCE($4, title),
           scope_description = CASE WHEN $5::text = '__UNSET__' THEN scope_description WHEN $5 IS NULL THEN NULL ELSE $5 END,
           valid_from = COALESCE($6::date, valid_from),
           valid_to = CASE WHEN $7::text = '__UNSET__' THEN valid_to WHEN $7 IS NULL THEN NULL ELSE $7::date END,
           currency_code = COALESCE($8, currency_code),
           payment_terms = CASE WHEN $9::text = '__UNSET__' THEN payment_terms WHEN $9 IS NULL THEN NULL ELSE $9 END,
           payment_method = CASE WHEN $10::text = '__UNSET__' THEN payment_method WHEN $10 IS NULL THEN NULL ELSE $10 END,
           commercial_terms = COALESCE($11::jsonb, commercial_terms),
           updated_by_identity_id = $12,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2`,
        [
          input.contractId,
          input.rowVersion,
          input.contractNumber ?? null,
          input.title ?? null,
          input.scopeDescription === undefined ? '__UNSET__' : input.scopeDescription,
          input.validFrom ?? null,
          input.validTo === undefined ? '__UNSET__' : input.validTo,
          input.currencyCode ?? null,
          input.paymentTerms === undefined ? '__UNSET__' : input.paymentTerms,
          input.paymentMethod === undefined ? '__UNSET__' : input.paymentMethod,
          input.commercialTerms ? JSON.stringify(input.commercialTerms) : null,
          input.actorIdentityId,
        ],
      );

      let items: ContractItemRow[];
      if (input.items) {
        items = await replaceContractItems(client, input.contractId, input.items);
      } else {
        const itemResult = await client.query<ContractItemRow>(
          `SELECT
             id, contract_id, line_number, description,
             service_definition_id, service_definition_version_id, service_snapshot,
             quantity::text AS quantity, unit_code,
             unit_price_amount::text AS unit_price_amount,
             line_total_amount::text AS line_total_amount
           FROM com.contract_items
           WHERE contract_id = $1
           ORDER BY line_number ASC`,
          [input.contractId],
        );
        items = itemResult.rows;
      }

      await insertContractHistoryEvent(client, {
        contractId: input.contractId,
        eventType: CONTRACT_HISTORY_EVENTS.Updated,
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');

      const contract = await this.findById(input.contractId);
      if (!contract) {
        throw new Error('CONTRACT_LOAD_FAILED');
      }
      return { contract, items };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async activate(
    input: ActivateContractPersistenceInput,
  ): Promise<ContractRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<ContractRow>(
        `${CONTRACT_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.contractId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (
        current.status !== CONTRACT_STATUSES.Draft ||
        !assertContractTransition(CONTRACT_STATUSES.Draft, CONTRACT_STATUSES.Active)
      ) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      for (const snapshot of input.itemSnapshots) {
        if (!snapshot.serviceSnapshot) {
          continue;
        }
        await client.query(
          `UPDATE com.contract_items
           SET service_snapshot = $3::jsonb
           WHERE contract_id = $1 AND line_number = $2`,
          [input.contractId, snapshot.lineNumber, JSON.stringify(snapshot.serviceSnapshot)],
        );
      }

      const result = await client.query<ContractRow>(
        `UPDATE com.contracts
         SET
           status = 'ACTIVE'::com.contract_status,
           client_snapshot = $3::jsonb,
           activated_at = NOW(),
           activated_by_identity_id = $4,
           updated_by_identity_id = $4,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, internal_code, client_id, unit_id, contract_number, title, scope_description,
           valid_from::text AS valid_from, valid_to::text AS valid_to, currency_code,
           payment_terms, payment_method, commercial_terms, client_snapshot,
           status::text AS status, activated_at, activated_by_identity_id,
           closed_at, closed_by_identity_id, closure_reason, row_version,
           created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [
          input.contractId,
          input.rowVersion,
          JSON.stringify(input.clientSnapshot),
          input.actorIdentityId,
        ],
      );

      await insertContractHistoryEvent(client, {
        contractId: input.contractId,
        eventType: CONTRACT_HISTORY_EVENTS.Activated,
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return result.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close(
    input: CloseContractPersistenceInput,
  ): Promise<ContractRow | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<ContractRow>(
        `${CONTRACT_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.contractId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (
        current.status !== CONTRACT_STATUSES.Active ||
        !assertContractTransition(CONTRACT_STATUSES.Active, CONTRACT_STATUSES.Closed)
      ) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }

      const result = await client.query<ContractRow>(
        `UPDATE com.contracts
         SET
           status = 'CLOSED'::com.contract_status,
           closed_at = NOW(),
           closed_by_identity_id = $3,
           closure_reason = $4,
           updated_by_identity_id = $3,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1 AND row_version = $2
         RETURNING
           id, internal_code, client_id, unit_id, contract_number, title, scope_description,
           valid_from::text AS valid_from, valid_to::text AS valid_to, currency_code,
           payment_terms, payment_method, commercial_terms, client_snapshot,
           status::text AS status, activated_at, activated_by_identity_id,
           closed_at, closed_by_identity_id, closure_reason, row_version,
           created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [input.contractId, input.rowVersion, input.actorIdentityId, input.closureReason ?? null],
      );

      await insertContractHistoryEvent(client, {
        contractId: input.contractId,
        eventType: CONTRACT_HISTORY_EVENTS.Closed,
        payload: input.closureReason ? { closureReason: input.closureReason } : {},
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return result.rows[0] ?? 'VERSION_CONFLICT';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Expira contratos ACTIVE vencidos (valid_to < expiredAsOf). Transição
   * ACTIVE -> EXPIRED persistida com evento de histórico append-only; nunca
   * reescreve registros históricos nem permite nova transição a partir de
   * estados terminais.
   */
  async markExpired(
    input: ExpireContractPersistenceInput,
  ): Promise<ContractRow | 'INVALID_STATE'> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const lock = await client.query<ContractRow>(
        `${CONTRACT_SELECT} WHERE id = $1 FOR UPDATE`,
        [input.contractId],
      );
      const current = lock.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      if (current.status === CONTRACT_STATUSES.Expired) {
        // Já expirado: idempotente para o runner de expiração.
        await client.query('ROLLBACK');
        return current;
      }
      if (
        current.status !== CONTRACT_STATUSES.Active ||
        !assertContractTransition(CONTRACT_STATUSES.Active, CONTRACT_STATUSES.Expired)
      ) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }
      const expiredAsOf = input.expiredAsOf ?? new Date().toISOString().slice(0, 10);
      if (!current.valid_to || current.valid_to >= expiredAsOf) {
        await client.query('ROLLBACK');
        return 'INVALID_STATE';
      }

      const result = await client.query<ContractRow>(
        `UPDATE com.contracts
         SET
           status = 'EXPIRED'::com.contract_status,
           updated_by_identity_id = $2,
           updated_at = NOW(),
           row_version = row_version + 1
         WHERE id = $1
         RETURNING
           id, internal_code, client_id, unit_id, contract_number, title, scope_description,
           valid_from::text AS valid_from, valid_to::text AS valid_to, currency_code,
           payment_terms, payment_method, commercial_terms, client_snapshot,
           status::text AS status, activated_at, activated_by_identity_id,
           closed_at, closed_by_identity_id, closure_reason, row_version,
           created_at, updated_at, created_by_identity_id, updated_by_identity_id`,
        [input.contractId, input.actorIdentityId],
      );

      await insertContractHistoryEvent(client, {
        contractId: input.contractId,
        eventType: CONTRACT_HISTORY_EVENTS.Expired,
        payload: { expiredAsOf, validTo: current.valid_to },
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return result.rows[0] ?? 'INVALID_STATE';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async linkDocument(
    contractId: string,
    documentId: string,
    linkPurpose: string,
    actorIdentityId: string,
  ): Promise<ContractDocumentLinkRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      const result = await client.query<ContractDocumentLinkRow>(
        `INSERT INTO com.contract_document_links (
           contract_id, document_id, link_purpose, created_by_identity_id
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (contract_id, document_id, link_purpose) DO UPDATE
           SET created_at = com.contract_document_links.created_at
         RETURNING id, contract_id, document_id, link_purpose, created_at`,
        [contractId, documentId, linkPurpose, actorIdentityId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error('DOCUMENT_LINK_FAILED');
      }

      await insertContractHistoryEvent(client, {
        contractId,
        eventType: CONTRACT_HISTORY_EVENTS.DocumentLinked,
        payload: { documentId, linkPurpose },
        actorIdentityId,
      });

      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
