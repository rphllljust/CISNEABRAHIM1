import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { EXECUTION_ENTRY_HISTORY_EVENTS } from '../domain/service-order-execution';
import type {
  ExecutionCommandIdempotencyRow,
  ExecutionEntryRow,
  ExecutionEvidenceRow,
  ExecutionOccurrenceRow,
  ExecutionTransitionPersistenceInput,
  ExecutionTransitionResult,
  RecordEvidencePersistenceResult,
  RecordExecutionEntryInput,
  RecordExecutionEvidenceInput,
  RecordExecutionOccurrenceInput,
  RecordExecutionPersistenceResult,
  RecordOccurrencePersistenceResult,
} from './service-order-execution.repository.types';
import {
  EXECUTION_ENTRY_RETURNING,
  executionTransitionSql,
  historyEventForExecutionTransition,
  isExecutionIdempotencyViolation,
} from './service-order-execution-persistence-rows';

type PlannedResourceCoverageRow = {
  requirement_kind: string;
  resource_type_code: string | null;
  labor_type_code: string | null;
  planned_quantity: string;
  status: string;
};

@Injectable()
export class ServiceOrderExecutionRepository {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly outboxWriter: OutboxDomainEventWriter,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findIdempotency(
    serviceOrderId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<ExecutionCommandIdempotencyRow | null> {
    const result = await this.pool().query<ExecutionCommandIdempotencyRow>(
      `SELECT id, service_order_id, command_name, idempotency_key, response_payload, created_at
       FROM so.execution_command_idempotency
       WHERE service_order_id = $1 AND command_name = $2 AND idempotency_key = $3`,
      [serviceOrderId, commandName, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async listEntries(serviceOrderId: string): Promise<ExecutionEntryRow[]> {
    const result = await this.pool().query<ExecutionEntryRow>(
      `SELECT ${EXECUTION_ENTRY_RETURNING}
       FROM so.execution_entries
       WHERE service_order_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async listEvidence(serviceOrderId: string): Promise<ExecutionEvidenceRow[]> {
    const result = await this.pool().query<ExecutionEvidenceRow>(
      `SELECT id, service_order_id, evidence_kind, payload, actor_identity_id, recorded_at, idempotency_key
       FROM so.execution_evidence
       WHERE service_order_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async listOccurrences(serviceOrderId: string): Promise<ExecutionOccurrenceRow[]> {
    const result = await this.pool().query<ExecutionOccurrenceRow>(
      `SELECT id, service_order_id, occurrence_code, description, payload, actor_identity_id, recorded_at, idempotency_key
       FROM so.execution_occurrences
       WHERE service_order_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async listPlannedResourceCoverage(serviceOrderId: string): Promise<PlannedResourceCoverageRow[]> {
    const result = await this.pool().query<PlannedResourceCoverageRow>(
      `SELECT requirement_kind::text AS requirement_kind,
              resource_type_code, labor_type_code,
              planned_quantity::text AS planned_quantity,
              status::text AS status
       FROM so.planned_resources
       WHERE service_order_id = $1`,
      [serviceOrderId],
    );
    return result.rows;
  }

  async transitionExecution(
    input: ExecutionTransitionPersistenceInput,
  ): Promise<ExecutionTransitionResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await this.findIdempotencyInClient(
          client,
          input.serviceOrderId,
          input.commandName,
          input.idempotencyKey,
        );
        if (existing) {
          await client.query('COMMIT');
          return { outcome: 'success', rowVersion: existing.response_payload.rowVersion as number };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM so.service_orders
         WHERE id = $1
         FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (current.status !== input.currentStatus) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const transitionSql = executionTransitionSql(input.transition);
      const updated = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET status = $3::so.service_order_status,
             ${transitionSql},
             updated_by_identity_id = $4,
             updated_at = NOW(),
             row_version = row_version + 1
         WHERE id = $1
           AND row_version = $2
           AND status = $5::so.service_order_status
         RETURNING row_version`,
        [
          input.serviceOrderId,
          input.rowVersion,
          input.nextStatus,
          input.actorIdentityId,
          input.currentStatus,
        ],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      if (input.transition === 'complete') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ExecutionCompleteAfterMutationBeforeHistory);
      }
      await client.query(
        `INSERT INTO so.service_order_history_events
           (service_order_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [
          input.serviceOrderId,
          historyEventForExecutionTransition(input.transition),
          JSON.stringify({ fromStatus: input.currentStatus, toStatus: input.nextStatus }),
          input.actorIdentityId,
        ],
      );

      if (input.transition === 'complete') {
        await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ExecutionCompleteAfterHistoryBeforeOutbox);
      }

      if (input.idempotencyKey) {
        await client.query(
          `INSERT INTO so.execution_command_idempotency
             (service_order_id, command_name, idempotency_key, response_payload)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [
            input.serviceOrderId,
            input.commandName,
            input.idempotencyKey,
            JSON.stringify({ ...input.responsePayload, rowVersion: updated.rows[0].row_version }),
          ],
        );
      }

      if (input.transition === 'complete') {
        const order = await client.query<{
          id: string;
          unit_id: string;
          client_id: string | null;
          order_number: string;
          completed_at: string | null;
        }>(
          `SELECT id, unit_id, client_id, order_number, completed_at
           FROM so.service_orders
           WHERE id = $1`,
          [input.serviceOrderId],
        );
        const completed = order.rows[0];
        if (completed?.completed_at) {
          await this.outboxWriter.appendServiceOrderCompleted(client, {
            serviceOrderId: completed.id,
            unitId: completed.unit_id,
            clientId: completed.client_id,
            orderNumber: completed.order_number,
            completedAt: completed.completed_at,
          });
        }
      }

      /**
       * FECHAMENTO DA EXECUÇÃO + BASE DE MEDIÇÃO — no MESMO COMMIT da conclusão.
       *
       * Aqui está a fronteira que a capability anterior não tinha: `COMPLETED` é o
       * estado do AGREGADO, e `EXECUTION_CLOSED` é o FATO de que os realizados foram
       * congelados e a base de medição foi publicada. Produzir um sem o outro é como
       * o sistema passava a permitir medição sobre dados ainda mutáveis.
       *
       * Os dois fatos de outbox (`EXECUTION_COMPLETED` e `MEASUREMENT_BASIS_READY`)
       * nascem dentro de `closeExecution`, também nesta transação.
       */
      if (input.transition === 'complete' && input.closure) {
        const closure = await this.closeExecutionInTransaction(client, input);
        await client.query(
          `INSERT INTO so.execution_events
             (service_order_id, event_kind, from_status, to_status, detail,
              is_blocking, actor_identity_id, occurred_at, idempotency_key)
           VALUES ($1, 'EXECUTION_CLOSED', $2, $3, $4::jsonb, false, $5, NOW(), $6)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            input.serviceOrderId,
            input.currentStatus,
            input.nextStatus,
            JSON.stringify(closure),
            input.actorIdentityId,
            input.idempotencyKey
              ? `${input.idempotencyKey}:closed`
              : `closed:${String(closure['closureId'])}`,
          ],
        );
      }

      await client.query('COMMIT');
      return { outcome: 'success', rowVersion: updated.rows[0].row_version };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordEntry(input: RecordExecutionEntryInput): Promise<RecordExecutionPersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await client.query<ExecutionEntryRow>(
          `SELECT ${EXECUTION_ENTRY_RETURNING}
           FROM so.execution_entries
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          await client.query('COMMIT');
          return { outcome: 'idempotent', payload: { entry: existing.rows[0] } };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status
         FROM so.service_orders
         WHERE id = $1
         FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (!['IN_EXECUTION', 'PAUSED'].includes(current.status)) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const inserted = await client.query<ExecutionEntryRow>(
        `INSERT INTO so.execution_entries (
           service_order_id, entry_type, evidence_kind, quantity_value, quantity_unit_code,
           text_value, context, actor_identity_id, idempotency_key
         ) VALUES (
           $1, $2::so.execution_entry_type, $3, $4::numeric, $5, $6, $7::jsonb, $8, $9
         )
         RETURNING ${EXECUTION_ENTRY_RETURNING}`,
        [
          input.serviceOrderId,
          input.entryType,
          input.evidenceKind,
          input.quantityValue,
          input.quantityUnitCode,
          input.textValue,
          JSON.stringify(input.context),
          input.actorIdentityId,
          input.idempotencyKey ?? null,
        ],
      );
      const entry = inserted.rows[0];
      if (!entry) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      await client.query(
        `INSERT INTO so.execution_entry_history_events
           (execution_entry_id, event_type, payload, actor_identity_id)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [entry.id, EXECUTION_ENTRY_HISTORY_EVENTS.Recorded, JSON.stringify({ entryType: input.entryType }), input.actorIdentityId],
      );

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        entry,
        rowVersion: bumped.rows[0]?.row_version ?? input.rowVersion + 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isExecutionIdempotencyViolation(error) && input.idempotencyKey) {
        // Replay only when the key belongs to THIS service order; a key used
        // by another order must surface as a conflict, never as a silent
        // read-back of the other order's entry (idempotency-key IDOR).
        const existing = await this.pool().query<ExecutionEntryRow>(
          `SELECT ${EXECUTION_ENTRY_RETURNING}
           FROM so.execution_entries
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          return { outcome: 'idempotent', payload: { entry: existing.rows[0] } };
        }
        return { outcome: 'idempotency_conflict' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordEvidence(
    input: RecordExecutionEvidenceInput,
  ): Promise<RecordEvidencePersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await client.query<ExecutionEvidenceRow>(
          `SELECT id, service_order_id, evidence_kind, payload, actor_identity_id, recorded_at, idempotency_key
           FROM so.execution_evidence
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          await client.query('COMMIT');
          return { outcome: 'idempotent', payload: { evidence: existing.rows[0] } };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status FROM so.service_orders WHERE id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (!['IN_EXECUTION', 'PAUSED'].includes(current.status)) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const inserted = await client.query<ExecutionEvidenceRow>(
        `INSERT INTO so.execution_evidence
           (service_order_id, evidence_kind, payload, actor_identity_id, idempotency_key)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING id, service_order_id, evidence_kind, payload, actor_identity_id, recorded_at, idempotency_key`,
        [
          input.serviceOrderId,
          input.evidenceKind,
          JSON.stringify(input.payload),
          input.actorIdentityId,
          input.idempotencyKey ?? null,
        ],
      );
      const evidence = inserted.rows[0];
      if (!evidence) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        evidence,
        rowVersion: bumped.rows[0]?.row_version ?? input.rowVersion + 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isExecutionIdempotencyViolation(error) && input.idempotencyKey) {
        const existing = await this.pool().query<ExecutionEvidenceRow>(
          `SELECT id, service_order_id, evidence_kind, payload, actor_identity_id, recorded_at, idempotency_key
           FROM so.execution_evidence
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          return { outcome: 'idempotent', payload: { evidence: existing.rows[0] } };
        }
        return { outcome: 'idempotency_conflict' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async recordOccurrence(
    input: RecordExecutionOccurrenceInput,
  ): Promise<RecordOccurrencePersistenceResult> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');

      if (input.idempotencyKey) {
        const existing = await client.query<ExecutionOccurrenceRow>(
          `SELECT id, service_order_id, occurrence_code, description, payload, actor_identity_id, recorded_at, idempotency_key
           FROM so.execution_occurrences
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          await client.query('COMMIT');
          return { outcome: 'idempotent', payload: { occurrence: existing.rows[0] } };
        }
      }

      const locked = await client.query<{ row_version: number; status: string }>(
        `SELECT row_version, status::text AS status FROM so.service_orders WHERE id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      const current = locked.rows[0];
      if (!current || current.row_version !== input.rowVersion) {
        await client.query('ROLLBACK');
        return { outcome: 'version_conflict' };
      }
      if (!['IN_EXECUTION', 'PAUSED'].includes(current.status)) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const inserted = await client.query<ExecutionOccurrenceRow>(
        `INSERT INTO so.execution_occurrences
           (service_order_id, occurrence_code, description, payload, actor_identity_id, idempotency_key)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         RETURNING id, service_order_id, occurrence_code, description, payload, actor_identity_id, recorded_at, idempotency_key`,
        [
          input.serviceOrderId,
          input.occurrenceCode,
          input.description,
          JSON.stringify(input.payload),
          input.actorIdentityId,
          input.idempotencyKey ?? null,
        ],
      );
      const occurrence = inserted.rows[0];
      if (!occurrence) {
        await client.query('ROLLBACK');
        return { outcome: 'invalid_state' };
      }

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId],
      );

      await client.query('COMMIT');
      return {
        outcome: 'success',
        occurrence,
        rowVersion: bumped.rows[0]?.row_version ?? input.rowVersion + 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isExecutionIdempotencyViolation(error) && input.idempotencyKey) {
        const existing = await this.pool().query<ExecutionOccurrenceRow>(
          `SELECT id, service_order_id, occurrence_code, description, payload, actor_identity_id, recorded_at, idempotency_key
           FROM so.execution_occurrences
           WHERE idempotency_key = $1 AND service_order_id = $2`,
          [input.idempotencyKey, input.serviceOrderId],
        );
        if (existing.rows[0]) {
          return { outcome: 'idempotent', payload: { occurrence: existing.rows[0] } };
        }
        return { outcome: 'idempotency_conflict' };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Cria o FECHAMENTO e publica a BASE DE MEDIÇÃO, dentro da transação do chamador.
   *
   * A lógica vive aqui (e não no `OperationsRepository`) porque a transação em curso
   * já é a deste repositório: abrir uma segunda conexão quebraria a atomicidade que
   * é o ponto inteiro da operação.
   */
  private async closeExecutionInTransaction(
    client: PoolClient,
    input: ExecutionTransitionPersistenceInput,
  ): Promise<Record<string, unknown>> {
    const closure = input.closure!;

    const nextNumber = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(closure_number), 0) + 1 AS next
       FROM so.execution_closures WHERE service_order_id = $1`,
      [input.serviceOrderId],
    );
    const closureNumber = nextNumber.rows[0]?.next ?? 1;

    const created = await client.query<{ id: string; closed_at: string }>(
      `INSERT INTO so.execution_closures (
         service_order_id, unit_id, closure_number, actuals_snapshot, plan_vs_actual,
         evidence_summary, resolved_situations, closed_by_identity_id, completion_command_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING id, closed_at`,
      [
        input.serviceOrderId,
        closure.unitId,
        closureNumber,
        JSON.stringify(closure.actualsSnapshot),
        JSON.stringify(closure.planVsActual),
        JSON.stringify(closure.evidenceSummary),
        JSON.stringify(closure.resolvedSituations),
        input.actorIdentityId,
        input.idempotencyKey ?? null,
      ],
    );
    const closureRow = created.rows[0]!;

    // A base anterior deixa de ser READY antes da nova entrar (índice parcial).
    await client.query(
      `UPDATE so.measurement_basis
       SET status = 'SUPERSEDED', superseded_at = NOW(),
           superseded_by_identity_id = $2, row_version = row_version + 1
       WHERE service_order_id = $1 AND status = 'READY'`,
      [input.serviceOrderId, input.actorIdentityId],
    );

    const basis = await client.query<{ id: string; prepared_at: string }>(
      `INSERT INTO so.measurement_basis (
         service_order_id, closure_id, unit_id, status, lines, actuals, evidence,
         prepared_by_identity_id
       ) VALUES ($1, $2, $3, 'READY', $4::jsonb, $5::jsonb, $6::jsonb, $7)
       RETURNING id, prepared_at`,
      [
        input.serviceOrderId,
        closureRow.id,
        closure.unitId,
        JSON.stringify(closure.measurementLines),
        JSON.stringify(closure.measurementActuals),
        JSON.stringify(closure.measurementEvidence),
        input.actorIdentityId,
      ],
    );
    const basisRow = basis.rows[0]!;

    const actualCount = Number(
      (closure.actualsSnapshot['recordCount'] as number | undefined) ?? 0,
    );

    await this.outboxWriter.appendExecutionCompleted(client, {
      serviceOrderId: input.serviceOrderId,
      unitId: closure.unitId,
      clientId: closure.clientId,
      orderNumber: closure.orderNumber,
      executionClosureId: closureRow.id,
      actualCount,
      completedAt: closureRow.closed_at,
    });

    await this.outboxWriter.appendMeasurementBasisReady(client, {
      serviceOrderId: input.serviceOrderId,
      unitId: closure.unitId,
      clientId: closure.clientId,
      orderNumber: closure.orderNumber,
      measurementBasisId: basisRow.id,
      executionClosureId: closureRow.id,
      lineCount: closure.measurementLines.length,
      preparedAt: basisRow.prepared_at,
    });

    return {
      closureId: closureRow.id,
      closureNumber,
      measurementBasisId: basisRow.id,
      lineCount: closure.measurementLines.length,
      actualCount,
    };
  }

  private async findIdempotencyInClient(
    client: PoolClient,
    serviceOrderId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<ExecutionCommandIdempotencyRow | null> {
    const result = await client.query<ExecutionCommandIdempotencyRow>(
      `SELECT id, service_order_id, command_name, idempotency_key, response_payload, created_at
       FROM so.execution_command_idempotency
       WHERE service_order_id = $1 AND command_name = $2 AND idempotency_key = $3`,
      [serviceOrderId, commandName, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }
}
