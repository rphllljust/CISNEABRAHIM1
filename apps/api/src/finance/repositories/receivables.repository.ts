import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { classifyRowVersion } from '../../infrastructure/database/optimistic-lock';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  RECEIVABLE_LIFECYCLES,
  RECEIVABLE_ORIGIN_KINDS,
  ReceivableError,
  SETTLEMENT_STATUSES,
  assertNoOverpayment,
  assertReceivableActive,
  assertSettlementAmount,
  assertSettlementCurrency,
  assertSettlementNotReconciled,
  assertSettlementReversible,
  postedSettlementAmounts,
  remainingBalance,
} from '../domain/receivable';
import {
  RECONCILIATION_STATUSES,
  RECONCILIATION_TARGET_KINDS,
} from '../domain/bank-reconciliation';
import { CollectionsRepository } from './collections.repository';
import type {
  CancelReceivablePersistenceInput,
  OpenReceivablePersistenceInput,
  ReceivableInstallmentRow,
  ReceivableRow,
  ReverseSettlementPersistenceInput,
  ReverseSettlementPersistenceResult,
  SettleReceivablePersistenceInput,
  SettlementRow,
} from './receivables.repository.types';

const RECEIVABLE_RETURNING = `
  id, unit_id, client_id, origin_kind::text AS origin_kind,
  origin_billing_document_id, origin_billing_record_id, origin_service_order_id, origin_measurement_id,
  principal::text AS principal, currency_code, due_date::text AS due_date, payment_terms, external_reference,
  lifecycle::text AS lifecycle, cancelled_at, cancelled_by_identity_id, cancel_reason, row_version,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

const INSTALLMENT_RETURNING = `
  id, receivable_id, installment_number, principal::text AS principal, due_date::text AS due_date, created_at
`;

const SETTLEMENT_RETURNING = `
  id, receivable_id, installment_id, amount::text AS amount, currency_code, status::text AS status,
  settled_at, idempotency_key, external_reference, actor_identity_id, created_at,
  reversed_at, reversed_by_identity_id, reversal_reason, reversal_idempotency_key
`;

@Injectable()
export class ReceivablesRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly collections: CollectionsRepository,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(receivableId: string): Promise<ReceivableRow | null> {
    const result = await this.pool().query<ReceivableRow>(
      `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE id = $1`,
      [receivableId],
    );
    return result.rows[0] ?? null;
  }

  async findByOriginBillingDocumentId(billingDocumentId: string): Promise<ReceivableRow | null> {
    const result = await this.pool().query<ReceivableRow>(
      `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE origin_billing_document_id = $1`,
      [billingDocumentId],
    );
    return result.rows[0] ?? null;
  }

  async listByUnit(unitId: string): Promise<ReceivableRow[]> {
    const result = await this.pool().query<ReceivableRow>(
      `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE unit_id = $1 ORDER BY created_at DESC`,
      [unitId],
    );
    return result.rows;
  }

  async listAll(): Promise<ReceivableRow[]> {
    const result = await this.pool().query<ReceivableRow>(
      `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables ORDER BY created_at DESC`,
    );
    return result.rows;
  }

  async listInstallments(receivableId: string): Promise<ReceivableInstallmentRow[]> {
    const result = await this.pool().query<ReceivableInstallmentRow>(
      `SELECT ${INSTALLMENT_RETURNING}
       FROM fin.receivable_installments
       WHERE receivable_id = $1
       ORDER BY installment_number`,
      [receivableId],
    );
    return result.rows;
  }

  async listSettlements(receivableId: string): Promise<SettlementRow[]> {
    const result = await this.pool().query<SettlementRow>(
      `SELECT ${SETTLEMENT_RETURNING}
       FROM fin.settlements
       WHERE receivable_id = $1
       ORDER BY settled_at, created_at`,
      [receivableId],
    );
    return result.rows;
  }

  async openFromBilling(
    input: OpenReceivablePersistenceInput,
  ): Promise<{ receivable: ReceivableRow; installments: ReceivableInstallmentRow[]; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<ReceivableRow>(
        `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE origin_billing_document_id = $1`,
        [input.originBillingDocumentId],
      );
      if (existing.rows[0]) {
        const installments = await this.listInstallmentsWithClient(client, existing.rows[0].id);
        await client.query('COMMIT');
        return { receivable: existing.rows[0], installments, idempotent: true };
      }

      const receivableId = randomUUID();
      const inserted = await client.query<ReceivableRow>(
        `INSERT INTO fin.receivables (
           id, unit_id, client_id, origin_kind,
           origin_billing_document_id, origin_billing_record_id, origin_service_order_id, origin_measurement_id,
           principal, currency_code, due_date, payment_terms, external_reference,
           created_by_identity_id, updated_by_identity_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12, $13, $14, $14
         )
         RETURNING ${RECEIVABLE_RETURNING}`,
        [
          receivableId,
          input.unitId,
          input.clientId,
          RECEIVABLE_ORIGIN_KINDS.BillingDocument,
          input.originBillingDocumentId,
          input.originBillingRecordId,
          input.originServiceOrderId,
          input.originMeasurementId,
          input.principal,
          input.currencyCode,
          input.dueDate,
          input.paymentTerms,
          input.externalReference,
          input.actorIdentityId,
        ],
      );
      const receivable = inserted.rows[0]!;
      const installments: ReceivableInstallmentRow[] = [];
      for (const installment of input.installments) {
        const row = await client.query<ReceivableInstallmentRow>(
          `INSERT INTO fin.receivable_installments (receivable_id, installment_number, principal, due_date)
           VALUES ($1, $2, $3, $4::date)
           RETURNING ${INSTALLMENT_RETURNING}`,
          [receivable.id, installment.installmentNumber, installment.principal, installment.dueDate],
        );
        installments.push(row.rows[0]!);
      }
      await client.query('COMMIT');
      return { receivable, installments, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      const unique = isUniqueViolation(error);
      if (unique) {
        const raced = await this.findByOriginBillingDocumentId(input.originBillingDocumentId);
        if (raced) {
          const installments = await this.listInstallments(raced.id);
          return { receivable: raced, installments, idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async settle(
    input: SettleReceivablePersistenceInput,
  ): Promise<{ receivable: ReceivableRow; settlement: SettlementRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<ReceivableRow>(
        `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE id = $1 FOR UPDATE`,
        [input.receivableId],
      );
      const receivable = locked.rows[0];
      if (!receivable) {
        throw new ReceivableError('RECEIVABLE_NOT_FOUND');
      }

      const cached = await client.query<SettlementRow>(
        `SELECT ${SETTLEMENT_RETURNING}
         FROM fin.settlements
         WHERE receivable_id = $1 AND idempotency_key = $2`,
        [input.receivableId, input.idempotencyKey],
      );
      if (cached.rows[0]) {
        await client.query('COMMIT');
        return { receivable, settlement: cached.rows[0], idempotent: true };
      }

      assertReceivableActive(receivable.lifecycle);
      const version = classifyRowVersion(receivable, input.rowVersion);
      if (version === 'mismatch') {
        throw new ReceivableError('RECEIVABLE_VERSION_CONFLICT');
      }

      const amount = assertSettlementAmount(input.amount);
      assertSettlementCurrency(receivable.currency_code, input.currencyCode);

      if (input.installmentId) {
        const installment = await client.query(
          `SELECT id FROM fin.receivable_installments WHERE id = $1 AND receivable_id = $2`,
          [input.installmentId, receivable.id],
        );
        if ((installment.rowCount ?? 0) === 0) {
          throw new ReceivableError('RECEIVABLE_INSTALLMENT_NOT_FOUND');
        }
      }

      const posted = await client.query<SettlementRow>(
        `SELECT ${SETTLEMENT_RETURNING}
         FROM fin.settlements
         WHERE receivable_id = $1 AND status = $2
         FOR UPDATE`,
        [receivable.id, SETTLEMENT_STATUSES.Posted],
      );
      assertNoOverpayment(receivable.principal, postedSettlementAmounts(posted.rows), amount);

      const inserted = await client.query<SettlementRow>(
        `INSERT INTO fin.settlements (
           receivable_id, installment_id, amount, currency_code, status, settled_at,
           idempotency_key, external_reference, actor_identity_id
         )
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9)
         RETURNING ${SETTLEMENT_RETURNING}`,
        [
          receivable.id,
          input.installmentId ?? null,
          amount,
          receivable.currency_code,
          SETTLEMENT_STATUSES.Posted,
          input.settledAt,
          input.idempotencyKey,
          input.externalReference ?? null,
          input.actorIdentityId,
        ],
      );

      const updated = await client.query<ReceivableRow>(
        `UPDATE fin.receivables
         SET row_version = row_version + 1, updated_at = NOW(), updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${RECEIVABLE_RETURNING}`,
        [receivable.id, input.actorIdentityId],
      );

      await this.collections.applySettlementOutcome(client, {
        receivableId: receivable.id,
        remaining: remainingBalance(receivable.principal, [
          ...postedSettlementAmounts(posted.rows),
          amount,
        ]),
        settlementId: inserted.rows[0]!.id,
        actorIdentityId: input.actorIdentityId,
      });

      await client.query('COMMIT');
      return { receivable: updated.rows[0]!, settlement: inserted.rows[0]!, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        const cached = await this.pool().query<SettlementRow>(
          `SELECT ${SETTLEMENT_RETURNING}
           FROM fin.settlements
           WHERE receivable_id = $1 AND idempotency_key = $2`,
          [input.receivableId, input.idempotencyKey],
        );
        const receivable = await this.findById(input.receivableId);
        if (cached.rows[0] && receivable) {
          return { receivable, settlement: cached.rows[0], idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reversao de recebimento: o fato original permanece intacto (valor, data,
   * autor e idempotency key da criacao) e a reversao acrescenta quem reverteu,
   * quando, por que e sob qual comando. O saldo devedor volta a considerar o
   * valor porque o calculo existente soma apenas settlements POSTED.
   */
  async reverseSettlement(
    input: ReverseSettlementPersistenceInput,
  ): Promise<ReverseSettlementPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      // Ordem de lock do financeiro: receivable -> settlement.
      const locked = await client.query<ReceivableRow>(
        `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE id = $1 FOR UPDATE`,
        [input.receivableId],
      );
      const receivable = locked.rows[0];
      if (!receivable) {
        throw new ReceivableError('RECEIVABLE_NOT_FOUND');
      }

      const settlementResult = await client.query<SettlementRow>(
        `SELECT ${SETTLEMENT_RETURNING}
         FROM fin.settlements
         WHERE id = $1 AND receivable_id = $2
         FOR UPDATE`,
        [input.settlementId, receivable.id],
      );
      const settlement = settlementResult.rows[0];
      if (!settlement) {
        throw new ReceivableError('RECEIVABLE_SETTLEMENT_NOT_FOUND');
      }

      // Replay do mesmo comando de reversao: mesmo resultado logico.
      if (settlement.reversal_idempotency_key === input.idempotencyKey) {
        await client.query('COMMIT');
        return { receivable, settlement, idempotent: true };
      }
      assertSettlementReversible(settlement.status);

      const confirmed = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM fin.reconciliation_matches m
         INNER JOIN fin.reconciliations r ON r.id = m.reconciliation_id
         WHERE m.target_kind = $1::fin.reconciliation_target_kind
           AND m.target_id = $2
           AND r.status = $3::fin.reconciliation_status`,
        [
          RECONCILIATION_TARGET_KINDS.ReceivableSettlement,
          settlement.id,
          RECONCILIATION_STATUSES.Confirmed,
        ],
      );
      assertSettlementNotReconciled(Number(confirmed.rows[0]?.count ?? '0'));

      const reversed = await client.query<SettlementRow>(
        `UPDATE fin.settlements
         SET status = $3,
             reversed_at = NOW(),
             reversed_by_identity_id = $4,
             reversal_reason = $5,
             reversal_idempotency_key = $6
         WHERE id = $1 AND receivable_id = $2
         RETURNING ${SETTLEMENT_RETURNING}`,
        [
          settlement.id,
          receivable.id,
          SETTLEMENT_STATUSES.Reversed,
          input.actorIdentityId,
          input.reason,
          input.idempotencyKey,
        ],
      );

      const updated = await client.query<ReceivableRow>(
        `UPDATE fin.receivables
         SET row_version = row_version + 1, updated_at = NOW(), updated_by_identity_id = $2
         WHERE id = $1
         RETURNING ${RECEIVABLE_RETURNING}`,
        [receivable.id, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return {
        receivable: updated.rows[0]!,
        settlement: reversed.rows[0]!,
        idempotent: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        // Reversao concorrente com a mesma chave: devolve o fato ja efetivado.
        const existing = await this.pool().query<SettlementRow>(
          `SELECT ${SETTLEMENT_RETURNING}
           FROM fin.settlements
           WHERE receivable_id = $1 AND reversal_idempotency_key = $2`,
          [input.receivableId, input.idempotencyKey],
        );
        const receivable = await this.findById(input.receivableId);
        if (existing.rows[0] && receivable) {
          return { receivable, settlement: existing.rows[0], idempotent: true };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(input: CancelReceivablePersistenceInput): Promise<{ receivable: ReceivableRow; idempotent: boolean }> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = input.receivableId
        ? await client.query<ReceivableRow>(
            `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE id = $1 FOR UPDATE`,
            [input.receivableId],
          )
        : await client.query<ReceivableRow>(
            `SELECT ${RECEIVABLE_RETURNING} FROM fin.receivables WHERE origin_billing_document_id = $1 FOR UPDATE`,
            [input.originBillingDocumentId],
          );
      const receivable = locked.rows[0];
      if (!receivable) {
        throw new ReceivableError('RECEIVABLE_NOT_FOUND');
      }
      if (receivable.lifecycle === RECEIVABLE_LIFECYCLES.Cancelled) {
        await client.query('COMMIT');
        return { receivable, idempotent: true };
      }
      if (input.rowVersion !== undefined) {
        const version = classifyRowVersion(receivable, input.rowVersion);
        if (version === 'mismatch') {
          throw new ReceivableError('RECEIVABLE_VERSION_CONFLICT');
        }
      }
      const posted = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1 AND status = $2`,
        [receivable.id, SETTLEMENT_STATUSES.Posted],
      );
      if ((posted.rows[0]?.count ?? '0') !== '0') {
        throw new ReceivableError('RECEIVABLE_HAS_SETTLEMENTS');
      }
      const updated = await client.query<ReceivableRow>(
        `UPDATE fin.receivables
         SET lifecycle = $2,
             cancelled_at = NOW(),
             cancelled_by_identity_id = $3,
             cancel_reason = $4,
             row_version = row_version + 1,
             updated_at = NOW(),
             updated_by_identity_id = $3
         WHERE id = $1
         RETURNING ${RECEIVABLE_RETURNING}`,
        [receivable.id, RECEIVABLE_LIFECYCLES.Cancelled, input.actorIdentityId, input.cancelReason],
      );
      await client.query('COMMIT');
      return { receivable: updated.rows[0]!, idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async listInstallmentsWithClient(
    client: PoolClient,
    receivableId: string,
  ): Promise<ReceivableInstallmentRow[]> {
    const result = await client.query<ReceivableInstallmentRow>(
      `SELECT ${INSTALLMENT_RETURNING}
       FROM fin.receivable_installments
       WHERE receivable_id = $1
       ORDER BY installment_number`,
      [receivableId],
    );
    return result.rows;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
