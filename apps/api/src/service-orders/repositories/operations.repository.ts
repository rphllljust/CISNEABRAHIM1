/**
 * OPERATIONS REPOSITORY — leitura de fatos e comandos transacionais.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A DISCIPLINA QUE ESTE REPOSITÓRIO IMPÕE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * TODO comando mutável executa, dentro de UMA transação:
 *
 *   1. checagem de idempotência (a chave manda; se já existe, devolve o anterior)
 *   2. lock do agregado (`SELECT ... FOR UPDATE` em `so.service_orders`)
 *   3. validação de versão (`row_version`) e de estado
 *   4. INSERT/UPDATE do fato
 *   5. INSERT do evento operacional em `so.execution_events`
 *   6. INSERT do fato de domínio na outbox (`evt.outbox_events`)
 *   7. INSERT da chave de idempotência
 *   8. COMMIT
 *
 * Se qualquer passo falha, `ROLLBACK` — não existe caminho em que o estado muda e
 * o evento não nasce, ou em que o evento nasce sem o estado. Esse é o defeito que
 * o projeto já pagou caro para descobrir (F1.1/F1.2) e não é repetido aqui.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE REPOSITÓRIO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não decide regra de negócio (isso é do domínio), não decide autorização (isso é
 * do serviço de acesso). Ele executa o que o domínio já decidiu.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import {
  FAULT_INJECTION_PORT,
  type FaultInjectionPort,
} from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import { OutboxDomainEventWriter } from '../../platform/outbox/services/outbox-domain-event.writer';
import { isIdempotencyKeyViolation } from '../../infrastructure/database/pg-unique-violation';
import {
  collectSatisfiedEvidenceKinds,
  EXECUTION_ENTRY_TYPES,
} from '../domain/service-order-execution';
import type {
  DispatchPersistenceResult,
  ExecutionActualRow,
  ExecutionEventRow,
  ExecutionFuelRow,
  ExecutionMeterRow,
  ExecutionOperationsFacts,
  ExecutionSignatureRow,
  RecordDispatchInput,
  RecordExecutionActualInput,
  RecordExecutionFuelInput,
  RecordExecutionMeterInput,
  RecordExecutionSignatureInput,
} from './operations.repository.types';

@Injectable()
export class OperationsRepository {
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

  // ═════════════════════════════════════════════════════════════════════════════
  // LEITURA — uma consulta por bloco, nunca N+1
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Fatos de operação de UMA ordem, em consultas agregadas.
   *
   * A leitura é feita em paralelo porque as consultas são independentes entre si;
   * cada uma devolve EXATAMENTE o que o domínio precisa para decidir prontidão,
   * conclusão e situação. Nenhuma consulta por linha.
   */
  async loadFacts(serviceOrderId: string): Promise<ExecutionOperationsFacts | null> {
    const pool = this.pool();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * POR QUE A LEITURA É SEQUENCIAL E NÃO `Promise.all`
     * ─────────────────────────────────────────────────────────────────────────────
     *
     * O pool é dimensionado por `DATABASE_POOL_MAX`, e no ambiente de integração ele
     * vale **1** (`src/test/integration-test-db-serializer.ts`). Lançar 15 consultas
     * concorrentes contra um pool de uma conexão não paraleliza nada: elas entram na
     * fila do `pg.Pool` e a última só começa quando as anteriores terminam. O ganho é
     * zero e o custo é real — a fila estrela, o tempo de parede sobe, e um comando que
     * precise de `connect()` exclusivo (transação) pode esperar por slots que estão
     * todos enfileirados.
     *
     * Medido: com `Promise.all` a suíte de ordens de serviço levava ~26 min e falhava
     * de forma intermitente com `decision_audits` referenciando identidade já recriada
     * — sintoma de operação externa intercalada no meio da leitura, não de dado errado.
     *
     * Sequencial em um pool de 1 é a MESMA latência, sem a fila e sem o entrelaçamento.
     * Em produção (`DATABASE_POOL_MAX` > 1) o custo é uma ida a mais ao banco por bloco;
     * a alternativa — trocar a concorrência por uma única consulta gigante — acoplaria
     * a leitura de dez tabelas num SQL só, o que é pior de manter e de indexar.
     */
    const order = await this.loadOrder(pool, serviceOrderId);
    if (!order) {
      return null;
    }

    const dispatch = await this.loadDispatch(pool, serviceOrderId);
    const allocations = await this.loadAllocations(pool, serviceOrderId);
    const planned = await this.loadPlannedResources(pool, serviceOrderId);
    const actuals = await this.loadActuals(pool, serviceOrderId);
    const meters = await this.loadMeters(pool, serviceOrderId);
    const fuel = await this.loadFuel(pool, serviceOrderId);
    const evidence = await this.loadEvidence(pool, serviceOrderId);
    const signatures = await this.loadSignatures(pool, serviceOrderId);
    const situations = await this.loadSituations(pool, serviceOrderId);
    const events = await this.loadEvents(pool, serviceOrderId);
    const closure = await this.loadClosure(pool, serviceOrderId);
    const basis = await this.loadMeasurementBasis(pool, serviceOrderId);
    const measuredQuantityCount = await this.countMeasuredQuantity(pool, serviceOrderId);
    const progressEntryCount = await this.countProgressEntries(pool, serviceOrderId);

    return {
      order,
      dispatch,
      allocations,
      plannedResources: planned,
      actuals,
      meters,
      fuel,
      evidence,
      signatures,
      situations,
      events,
      closure,
      measurementBasis: basis,
      vehicleTypeCodes: await this.loadVehicleTypeCodes(pool),
      /**
       * QUANTIDADE MEDIDA — vem de `so.execution_entries`, NÃO de `execution_actuals`.
       *
       * `so.execution_entries` é a ENTRADA OPERACIONAL (quantidade medida, odômetro,
       * horímetro, observação) e é a base de MEDIÇÃO, já consumida por
       * `msr.measurement_items`. `so.execution_actuals` é o REALIZADO de custo.
       *
       * Confundir as duas fontes produzia um bloqueio falso: a conclusão exigia
       * "quantidade medida" olhando apenas o realizado de custo, e uma ordem com a
       * quantidade corretamente registrada na entrada operacional era recusada.
       */
      measuredQuantityCount,
      progressEntryCount,
      satisfiedEvidenceKinds: await this.loadSatisfiedEvidenceKinds(pool, serviceOrderId),
    };
  }

  /**
   * Evidências satisfeitas por ENTRADA OPERACIONAL.
   *
   * Usa `collectSatisfiedEvidenceKinds`, o mesmo helper que o domínio de execução
   * aplica hoje na conclusão. Ter DUAS leituras diferentes do mesmo fato (uma aqui,
   * outra no `ServiceOrderExecutionAccessService`) é como o gate e o comando
   * passariam a discordar sobre a mesma ordem.
   */
  private async loadSatisfiedEvidenceKinds(pool: Pool, serviceOrderId: string): Promise<string[]> {
    const entries = await pool.query<{
      entry_type: string;
      evidence_kind: string | null;
    }>(
      `SELECT entry_type::text AS entry_type, evidence_kind
       FROM so.execution_entries WHERE service_order_id = $1`,
      [serviceOrderId],
    );
    const evidence = await pool.query<{ evidence_kind: string }>(
      `SELECT evidence_kind FROM so.execution_evidence
       WHERE service_order_id = $1 AND status <> 'REJECTED'::so.execution_evidence_status`,
      [serviceOrderId],
    );

    const satisfied = collectSatisfiedEvidenceKinds({
      evidenceKinds: evidence.rows.map((row) => row.evidence_kind),
      entryEvidenceKinds: entries.rows.map((row) => row.evidence_kind ?? ''),
      entryTypes: entries.rows.map(
        (row) =>
          row.entry_type as (typeof EXECUTION_ENTRY_TYPES)[keyof typeof EXECUTION_ENTRY_TYPES],
      ),
    });
    return [...satisfied];
  }

  /**
   * Quantas entradas de QUANTIDADE existem na ordem.
   *
   * É a fonte correta de "quantidade medida": a execução registra quantidade em
   * `so.execution_entries`, que é o contrato consumido pela medição.
   */
  private async countMeasuredQuantity(pool: Pool, serviceOrderId: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM so.execution_entries
       WHERE service_order_id = $1 AND entry_type = 'QUANTITY'::so.execution_entry_type`,
      [serviceOrderId],
    );
    return result.rows[0]?.n ?? 0;
  }

  /** Quantas entradas operacionais existem (progresso, medição, observação). */
  private async countProgressEntries(pool: Pool, serviceOrderId: string): Promise<number> {
    const result = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM so.execution_entries WHERE service_order_id = $1`,
      [serviceOrderId],
    );
    return result.rows[0]?.n ?? 0;
  }

  /**
   * Tipos de recurso físico classificados como `VEHICLE`.
   *
   * Consulta pequena e estável (o catálogo de tipos muda raramente), lida por
   * leitura em vez de cacheada para que uma alteração no catálogo tenha efeito
   * imediato — uma prontidão baseada em cache velho aprovaria a saída errada.
   */
  private async loadVehicleTypeCodes(pool: Pool): Promise<string[]> {
    const result = await pool.query<{ code: string }>(
      `SELECT code FROM cat.physical_resource_types
       WHERE classification = 'VEHICLE' AND status = 'ACTIVE'`,
    );
    return result.rows.map((row) => row.code);
  }

  private async loadOrder(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      order_number: string;
      unit_id: string;
      status: string;
      client_id: string | null;
      client_snapshot: Record<string, unknown> | null;
      service_snapshot: Record<string, unknown>;
      description: string | null;
      priority: string | null;
      row_version: number;
      started_at: string | null;
      paused_at: string | null;
      completed_at: string | null;
      cancelled_at: string | null;
      released_at: string | null;
      contract_id: string | null;
      contract_snapshot: Record<string, unknown> | null;
      operational_notes: string | null;
    }>(
      `SELECT id, order_number, unit_id, status::text AS status, client_id, client_snapshot,
              service_snapshot, description, priority, row_version,
              started_at, paused_at, completed_at, cancelled_at, released_at,
              contract_id, contract_snapshot, operational_notes
       FROM so.service_orders
       WHERE id = $1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  private async loadDispatch(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      window_start: string;
      window_end: string;
      confirmed_resources: Record<string, unknown>;
      readiness_snapshot: Record<string, unknown>;
      dispatched_at: string;
      checked_in_at: string | null;
      row_version: number;
    }>(
      `SELECT id, window_start, window_end, confirmed_resources, readiness_snapshot,
              dispatched_at, checked_in_at, row_version
       FROM so.service_order_dispatches
       WHERE service_order_id = $1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Alocações ATIVAS, já enriquecidas com o estado real do recurso.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * LIMITE DE FONTE DECLARADO — NÃO INVENTAR DADO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `cat.physical_resource_types` NÃO possui coluna que declare "este tipo de
   * recurso exige condutor", e o schema NÃO possui tabela de qualificação de mão
   * de obra nem de ordem de manutenção. Verificado contra o banco real:
   *
   *   mnt.maintenance_orders                    → NÃO EXISTE
   *   wrk.workforce_member_qualifications       → NÃO EXISTE
   *   cat.physical_resource_types.requires_driver → NÃO EXISTE
   *
   * A consequência é declarada, não contornada:
   *
   *   - `requiresDriver` é derivado da CLASSIFICAÇÃO do recurso (`VEHICLE`), que é
   *     o único fato que o catálogo oferece. É interpretação de engenharia, não
   *     regra confirmada — e por isso o campo expõe `driverRequirementDerived`.
   *   - `asset_under_maintenance` é `null` (desconhecido), e a dimensão
   *     MAINTENANCE do domínio trata `null` como NÃO APLICÁVEL, não como "sem
   *     manutenção". Afirmar que não há manutenção sem tabela de manutenção seria
   *     inventar um fato.
   *   - `driver_qualifications` é `[]`. A dimensão QUALIFICATION fica NÃO
   *     APLICÁVEL enquanto o catálogo não declarar a exigência. Isso significa:
   *     o sistema NÃO bloqueia por habilitação vencida hoje, e a lacuna está
   *     visível em vez de silenciosamente "aprovada".
   *
   * Quando a fonte existir, estas consultas passam a devolver o dado real e as
   * dimensões correspondentes começam a decidir SEM nenhuma mudança no domínio.
   */
  private async loadAllocations(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      resource_type_code: string;
      operational_start: string;
      operational_end: string;
      status: string;
      physical_asset_id: string | null;
      workforce_member_id: string | null;
      asset_code: string | null;
      asset_name: string | null;
      asset_active: boolean | null;
      asset_under_maintenance: boolean | null;
      member_code: string | null;
      member_name: string | null;
      member_active: boolean | null;
      requires_driver: boolean | null;
      driver_qualifications: Array<{ code: string; expiresAt: string | null }> | null;
    }>(
      `SELECT
         ra.id,
         ra.resource_type_code,
         ra.operational_start,
         ra.operational_end,
         ra.status::text AS status,
         ra.physical_asset_id,
         ra.workforce_member_id,
         pa.asset_code,
         pa.name AS asset_name,
         CASE WHEN pa.id IS NULL THEN NULL
              ELSE (pa.lifecycle_status = 'ACTIVE') END AS asset_active,
         NULL::boolean AS asset_under_maintenance,
         wm.member_code,
         COALESCE(wm.preferred_name, wm.legal_name) AS member_name,
         CASE WHEN wm.id IS NULL THEN NULL ELSE (wm.status = 'ACTIVE') END AS member_active,
         CASE WHEN pa.id IS NULL THEN NULL
              ELSE (prt.classification = 'VEHICLE') END AS requires_driver,
         '[]'::json AS driver_qualifications
       FROM res.resource_allocations ra
       LEFT JOIN ast.physical_assets pa ON pa.id = ra.physical_asset_id
       LEFT JOIN cat.physical_resource_types prt ON prt.id = pa.physical_resource_type_id
       LEFT JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
       WHERE ra.service_order_id = $1
       ORDER BY ra.operational_start ASC, ra.id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadPlannedResources(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      requirement_kind: string;
      resource_type_code: string | null;
      labor_type_code: string | null;
      planned_quantity: string;
      operational_start: string | null;
      operational_end: string | null;
      status: string;
    }>(
      `SELECT id, requirement_kind::text AS requirement_kind, resource_type_code, labor_type_code,
              planned_quantity::text AS planned_quantity, operational_start, operational_end,
              status::text AS status
       FROM so.planned_resources
       WHERE service_order_id = $1
       ORDER BY id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadActuals(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<ExecutionActualRow>(
      `SELECT id, actual_kind::text AS actual_kind, physical_asset_id, workforce_member_id,
              resource_label, actual_value::text AS actual_value, unit_of_measure,
              planned_value::text AS planned_value, planned_unit_of_measure,
              source::text AS source, occurred_at, notes
       FROM so.execution_actuals
       WHERE service_order_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadMeters(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<ExecutionMeterRow>(
      `SELECT id, physical_asset_id, meter_kind::text AS meter_kind,
              reading_value::text AS reading_value, unit_of_measure,
              is_initial, is_final, read_at
       FROM so.execution_meter_readings
       WHERE service_order_id = $1
       ORDER BY read_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadFuel(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<ExecutionFuelRow>(
      `SELECT id, physical_asset_id, volume_liters::text AS volume_liters,
              amount::text AS amount, unit_price::text AS unit_price,
              odometer_reading::text AS odometer_reading, fueled_at
       FROM so.execution_fuel_records
       WHERE service_order_id = $1
       ORDER BY fueled_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadEvidence(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      evidence_kind: string;
      status: string;
      recorded_at: string;
    }>(
      `SELECT id, evidence_kind, status::text AS status, recorded_at
       FROM so.execution_evidence
       WHERE service_order_id = $1
       ORDER BY recorded_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadSignatures(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<ExecutionSignatureRow>(
      `SELECT id, signer_name, signer_document, signer_role, signature_kind, signed_at
       FROM so.execution_signatures
       WHERE service_order_id = $1
       ORDER BY signed_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadSituations(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      situation_code: string;
      detected_key: string;
      severity: string;
      status: string;
      title: string;
      detail: string | null;
      impact: Record<string, unknown>;
      owner_role: string | null;
      next_best_action: string | null;
      detected_at: string;
    }>(
      `SELECT id, situation_code, detected_key, severity, status, title, detail,
              impact, owner_role, next_best_action, detected_at
       FROM so.execution_situations
       WHERE service_order_id = $1
       ORDER BY detected_at DESC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadEvents(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<ExecutionEventRow>(
      `SELECT id, event_kind::text AS event_kind, from_status, to_status, detail,
              is_blocking, actor_identity_id, occurred_at
       FROM so.execution_events
       WHERE service_order_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [serviceOrderId],
    );
    return result.rows;
  }

  private async loadClosure(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      closure_number: number;
      actuals_snapshot: Record<string, unknown>;
      plan_vs_actual: Record<string, unknown>;
      evidence_summary: Record<string, unknown>;
      closed_at: string;
    }>(
      `SELECT id, closure_number, actuals_snapshot, plan_vs_actual, evidence_summary, closed_at
       FROM so.execution_closures
       WHERE service_order_id = $1
       ORDER BY closure_number DESC
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  private async loadMeasurementBasis(pool: Pool, serviceOrderId: string) {
    const result = await pool.query<{
      id: string;
      closure_id: string;
      status: string;
      lines: unknown;
      actuals: Record<string, unknown>;
      evidence: Record<string, unknown>;
      prepared_at: string;
    }>(
      `SELECT id, closure_id, status::text AS status, lines, actuals, evidence, prepared_at
       FROM so.measurement_basis
       WHERE service_order_id = $1 AND status = 'READY'::so.measurement_basis_status
       LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ESCRITA — DISPATCH
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Despacha a ordem: um único COMMIT produz estado, fato, evento, auditoria do
   * histórico e outbox.
   *
   * O despacho NÃO muda `status` para um valor novo — mantém `RELEASED` e grava o
   * FATO. É o que permite reverter o despacho (liberando recursos) sem inventar
   * transição de agregado que o catálogo e o RBAC não conhecem.
   */
  async recordDispatch(input: RecordDispatchInput): Promise<DispatchPersistenceResult> {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const existing = await this.findIdempotency(
        client,
        input.serviceOrderId,
        'DISPATCH',
        input.idempotencyKey,
      );
      if (existing) {
        await client.query('COMMIT');
        return { outcome: 'idempotent', payload: existing };
      }

      const order = await this.lockOrder(client, input.serviceOrderId);
      if (!order) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_found' };
      }
      if (order.row_version !== input.rowVersion) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' };
      }
      if (order.status !== 'RELEASED') {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'invalid_state' };
      }

      /**
       * SEGUNDO DESPACHO DA MESMA ORDEM.
       *
       * A UNIQUE no banco já recusaria o INSERT, mas cair aqui primeiro permite
       * devolver um desfecho SEMÂNTICO em vez de deixar estourar uma violação de
       * constraint que o operador não saberia interpretar.
       */
      const alreadyDispatched = await client.query<{ id: string }>(
        `SELECT id FROM so.service_order_dispatches WHERE service_order_id = $1`,
        [input.serviceOrderId],
      );
      if (alreadyDispatched.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'already_dispatched', dispatchId: alreadyDispatched.rows[0].id };
      }

      const inserted = await client.query<{ id: string; dispatched_at: string }>(
        `INSERT INTO so.service_order_dispatches (
           service_order_id, unit_id, window_start, window_end,
           confirmed_resources, readiness_snapshot, dispatched_by_identity_id
         ) VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::jsonb, $6::jsonb, $7)
         RETURNING id, dispatched_at`,
        [
          input.serviceOrderId,
          input.unitId,
          input.windowStart,
          input.windowEnd,
          JSON.stringify(input.confirmedResources),
          JSON.stringify(input.readinessSnapshot),
          input.actorIdentityId,
        ],
      );
      const dispatch = inserted.rows[0]!;

      await maybeInjectFault(
        this.faultInjection,
        FAULT_HOOKS.ExecutionCompleteAfterMutationBeforeHistory,
      );

      await this.appendEvent(client, {
        serviceOrderId: input.serviceOrderId,
        eventKind: 'DISPATCHED',
        fromStatus: order.status,
        toStatus: order.status,
        detail: {
          dispatchId: dispatch.id,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          confirmedResourceCount: input.confirmedResources.length ?? 0,
        },
        actorIdentityId: input.actorIdentityId,
        at: dispatch.dispatched_at,
        idempotencyKey: input.idempotencyKey,
      });

      await client.query(
        `INSERT INTO so.service_order_history_events
           (service_order_id, event_type, payload, actor_identity_id)
         VALUES ($1, 'DISPATCHED', $2::jsonb, $3)`,
        [
          input.serviceOrderId,
          JSON.stringify({
            dispatchId: dispatch.id,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
          }),
          input.actorIdentityId,
        ],
      );

      // Incrementa a versão do agregado: o despacho É uma mudança de estado da OS.
      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1 AND row_version = $3
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
      );
      if (!bumped.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' };
      }

      await this.outboxWriter.appendServiceOrderDispatched(client, {
        serviceOrderId: input.serviceOrderId,
        unitId: input.unitId,
        clientId: input.clientId,
        orderNumber: input.orderNumber,
        dispatchId: dispatch.id,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        confirmedResourceCount: input.confirmedResources.length,
        dispatchedAt: dispatch.dispatched_at,
      });

      await this.saveIdempotency(client, {
        serviceOrderId: input.serviceOrderId,
        commandName: 'DISPATCH',
        idempotencyKey: input.idempotencyKey,
        responsePayload: { dispatchId: dispatch.id, rowVersion: bumped.rows[0].row_version },
      });

      await client.query('COMMIT');
      return {
        outcome: 'success',
        dispatchId: dispatch.id,
        dispatchedAt: dispatch.dispatched_at,
        rowVersion: bumped.rows[0].row_version,
      };
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        const replay = await this.findIdempotency(
          this.pool() as unknown as PoolClient,
          input.serviceOrderId,
          'DISPATCH',
          input.idempotencyKey,
        );
        if (replay) {
          return { outcome: 'idempotent', payload: replay };
        }
        return { outcome: 'idempotency_conflict' };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  /** Registra a chegada ao local. Idempotente por natureza: só grava uma vez. */
  async recordCheckIn(input: {
    serviceOrderId: string;
    rowVersion: number;
    actorIdentityId: string;
    idempotencyKey: string;
  }): Promise<DispatchPersistenceResult> {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const existing = await this.findIdempotency(
        client,
        input.serviceOrderId,
        'CHECK_IN',
        input.idempotencyKey,
      );
      if (existing) {
        await client.query('COMMIT');
        return { outcome: 'idempotent', payload: existing };
      }

      const dispatch = await client.query<{ id: string; checked_in_at: string | null }>(
        `SELECT id, checked_in_at FROM so.service_order_dispatches
         WHERE service_order_id = $1 FOR UPDATE`,
        [input.serviceOrderId],
      );
      const row = dispatch.rows[0];
      if (!row) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_dispatched' };
      }
      if (row.checked_in_at) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'already_checked_in' };
      }

      const updated = await client.query<{ checked_in_at: string }>(
        `UPDATE so.service_order_dispatches
         SET checked_in_at = NOW(), checked_in_by_identity_id = $2,
             updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1
         RETURNING checked_in_at`,
        [row.id, input.actorIdentityId],
      );

      await this.appendEvent(client, {
        serviceOrderId: input.serviceOrderId,
        eventKind: 'CHECKED_IN',
        fromStatus: null,
        toStatus: null,
        detail: { dispatchId: row.id },
        actorIdentityId: input.actorIdentityId,
        at: updated.rows[0]!.checked_in_at,
        idempotencyKey: input.idempotencyKey,
      });

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1 AND row_version = $3
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
      );
      if (!bumped.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' };
      }

      await this.saveIdempotency(client, {
        serviceOrderId: input.serviceOrderId,
        commandName: 'CHECK_IN',
        idempotencyKey: input.idempotencyKey,
        responsePayload: { rowVersion: bumped.rows[0].row_version },
      });

      await client.query('COMMIT');
      return {
        outcome: 'success',
        dispatchId: row.id,
        dispatchedAt: updated.rows[0]!.checked_in_at,
        rowVersion: bumped.rows[0].row_version,
      };
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        return { outcome: 'idempotency_conflict' };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ESCRITA — ACTUALS
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Registra um REALIZADO dimensionado.
   *
   * Diferente de `so.execution_entries` (entrada de medição), esta linha é o valor
   * real do consumo de um recurso, com valor PLANEJADO de referência preservado —
   * e é ela que o custeio consome.
   */
  async recordActual(input: RecordExecutionActualInput) {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const existing = await this.findActualByIdempotency(
        client,
        input.serviceOrderId,
        input.idempotencyKey,
      );
      if (existing) {
        await client.query('COMMIT');
        return { outcome: 'idempotent' as const, payload: { actual: existing } };
      }

      const order = await this.lockOrder(client, input.serviceOrderId);
      if (!order) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_found' as const };
      }
      if (order.row_version !== input.rowVersion) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }
      if (order.status !== 'IN_EXECUTION' && order.status !== 'PAUSED') {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'invalid_state' as const };
      }

      const inserted = await client.query<ExecutionActualRow>(
        `INSERT INTO so.execution_actuals (
           service_order_id, actual_kind, physical_asset_id, workforce_member_id,
           resource_label, actual_value, unit_of_measure, planned_value,
           planned_unit_of_measure, source, evidence_id, occurred_at,
           actor_identity_id, notes, correlation_id, idempotency_key
         ) VALUES (
           $1, $2::so.execution_actual_kind, $3, $4, $5, $6::numeric, $7, $8::numeric,
           $9, $10::so.execution_actual_source, $11, $12::timestamptz,
           $13, $14, $15, $16
         )
         RETURNING id, actual_kind::text AS actual_kind, physical_asset_id, workforce_member_id,
                   resource_label, actual_value::text AS actual_value, unit_of_measure,
                   planned_value::text AS planned_value, planned_unit_of_measure,
                   source::text AS source, occurred_at, notes`,
        [
          input.serviceOrderId,
          input.actualKind,
          input.physicalAssetId,
          input.workforceMemberId,
          input.resourceLabel,
          input.actualValue,
          input.unitOfMeasure,
          input.plannedValue,
          input.plannedUnitOfMeasure,
          input.source,
          input.evidenceId,
          input.occurredAt,
          input.actorIdentityId,
          input.notes,
          input.correlationId,
          input.idempotencyKey,
        ],
      );
      const actual = inserted.rows[0]!;

      await this.appendEvent(client, {
        serviceOrderId: input.serviceOrderId,
        eventKind: mapActualKindToEventKind(input.actualKind),
        fromStatus: order.status,
        toStatus: order.status,
        detail: {
          actualId: actual.id,
          actualKind: actual.actual_kind,
          actualValue: actual.actual_value,
          unitOfMeasure: actual.unit_of_measure,
        },
        actorIdentityId: input.actorIdentityId,
        at: actual.occurred_at,
        idempotencyKey: `${input.idempotencyKey}:event`,
      });

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1 AND row_version = $3
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
      );
      if (!bumped.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }

      // O FATO que o custeio consome nasce no MESMO commit do realizado.
      await this.outboxWriter.appendResourceUsageRecorded(client, {
        serviceOrderId: input.serviceOrderId,
        unitId: order.unit_id,
        actualId: actual.id,
        actualKind: actual.actual_kind,
        actualValue: actual.actual_value,
        unitOfMeasure: actual.unit_of_measure,
        physicalAssetId: actual.physical_asset_id,
        workforceMemberId: actual.workforce_member_id,
        occurredAt: actual.occurred_at,
      });

      await this.saveIdempotency(client, {
        serviceOrderId: input.serviceOrderId,
        commandName: `REGISTER_ACTUAL:${input.actualKind}`,
        idempotencyKey: input.idempotencyKey,
        responsePayload: { actualId: actual.id, rowVersion: bumped.rows[0].row_version },
      });

      await client.query('COMMIT');
      return {
        outcome: 'success' as const,
        actual,
        rowVersion: bumped.rows[0].row_version,
      };
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        return { outcome: 'idempotency_conflict' as const };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  /** Registra leitura de medidor. A monotonicidade é garantida por TRIGGER. */
  async recordMeterReading(input: RecordExecutionMeterInput) {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const order = await this.lockOrder(client, input.serviceOrderId);
      if (!order) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_found' as const };
      }
      if (order.row_version !== input.rowVersion) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }
      if (order.status !== 'IN_EXECUTION' && order.status !== 'PAUSED') {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'invalid_state' as const };
      }

      try {
        const inserted = await client.query<ExecutionMeterRow>(
          `INSERT INTO so.execution_meter_readings (
             service_order_id, physical_asset_id, meter_kind, reading_value,
             unit_of_measure, is_initial, is_final, read_at, actor_identity_id,
             evidence_id, notes, idempotency_key
           ) VALUES (
             $1, $2, $3::so.meter_kind, $4::numeric, $5, $6, $7, $8::timestamptz,
             $9, $10, $11, $12
           )
           RETURNING id, physical_asset_id, meter_kind::text AS meter_kind,
                     reading_value::text AS reading_value, unit_of_measure,
                     is_initial, is_final, read_at`,
          [
            input.serviceOrderId,
            input.physicalAssetId,
            input.meterKind,
            input.readingValue,
            input.unitOfMeasure,
            input.isInitial,
            input.isFinal,
            input.readAt,
            input.actorIdentityId,
            input.evidenceId,
            input.notes,
            input.idempotencyKey,
          ],
        );
        const reading = inserted.rows[0]!;

        await this.appendEvent(client, {
          serviceOrderId: input.serviceOrderId,
          eventKind: 'METER_RECORDED',
          fromStatus: order.status,
          toStatus: order.status,
          detail: {
            meterReadingId: reading.id,
            meterKind: reading.meter_kind,
            readingValue: reading.reading_value,
            isFinal: reading.is_final,
          },
          actorIdentityId: input.actorIdentityId,
          at: reading.read_at,
          idempotencyKey: `${input.idempotencyKey}:event`,
        });

        const bumped = await client.query<{ row_version: number }>(
          `UPDATE so.service_orders
           SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
           WHERE id = $1 AND row_version = $3
           RETURNING row_version`,
          [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
        );
        if (!bumped.rows[0]) {
          await rollbackKeepingPrimaryCause(client);
          return { outcome: 'version_conflict' as const };
        }

        await this.saveIdempotency(client, {
          serviceOrderId: input.serviceOrderId,
          commandName: 'REGISTER_METER',
          idempotencyKey: input.idempotencyKey,
          responsePayload: { meterReadingId: reading.id, rowVersion: bumped.rows[0].row_version },
        });

        await client.query('COMMIT');
        return { outcome: 'success' as const, reading, rowVersion: bumped.rows[0].row_version };
      } catch (error) {
        /**
         * MONOTONICIDADE — o banco recusa leitura regressiva.
         *
         * O TRIGGER levanta `check_violation` com a mensagem
         * `METER_READING_NOT_MONOTONIC`. Converter em desfecho de domínio é o que
         * permite ao operador ver o motivo real em vez de um 500.
         */
        if (isCheckViolation(error, 'METER_READING_NOT_MONOTONIC')) {
          await rollbackKeepingPrimaryCause(client);
          return { outcome: 'meter_not_monotonic' as const };
        }
        if (isUniqueViolation(error)) {
          await rollbackKeepingPrimaryCause(client);
          return { outcome: 'duplicate_final_reading' as const };
        }
        throw error;
      }
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        return { outcome: 'idempotency_conflict' as const };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  /** Registra abastecimento com procedência. */
  async recordFuel(input: RecordExecutionFuelInput) {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const order = await this.lockOrder(client, input.serviceOrderId);
      if (!order) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_found' as const };
      }
      if (order.row_version !== input.rowVersion) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }
      if (order.status !== 'IN_EXECUTION' && order.status !== 'PAUSED') {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'invalid_state' as const };
      }

      const inserted = await client.query<ExecutionFuelRow>(
        `INSERT INTO so.execution_fuel_records (
           service_order_id, physical_asset_id, volume_liters, unit_price, amount,
           odometer_reading, fueled_at, actor_identity_id, evidence_id,
           supplier_reference, notes, idempotency_key
         ) VALUES (
           $1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric,
           $7::timestamptz, $8, $9, $10, $11, $12
         )
         RETURNING id, physical_asset_id, volume_liters::text AS volume_liters,
                   amount::text AS amount, unit_price::text AS unit_price,
                   odometer_reading::text AS odometer_reading, fueled_at`,
        [
          input.serviceOrderId,
          input.physicalAssetId,
          input.volumeLiters,
          input.unitPrice,
          input.amount,
          input.odometerReading,
          input.fueledAt,
          input.actorIdentityId,
          input.evidenceId,
          input.supplierReference,
          input.notes,
          input.idempotencyKey,
        ],
      );
      const record = inserted.rows[0]!;

      await this.appendEvent(client, {
        serviceOrderId: input.serviceOrderId,
        eventKind: 'FUEL_RECORDED',
        fromStatus: order.status,
        toStatus: order.status,
        detail: {
          fuelRecordId: record.id,
          volumeLiters: record.volume_liters,
          unitPrice: record.unit_price,
        },
        actorIdentityId: input.actorIdentityId,
        at: record.fueled_at,
        idempotencyKey: `${input.idempotencyKey}:event`,
      });

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1 AND row_version = $3
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
      );
      if (!bumped.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }

      // Combustível TAMBÉM é uso de recurso: o custeio consome o mesmo fato.
      await this.outboxWriter.appendResourceUsageRecorded(client, {
        serviceOrderId: input.serviceOrderId,
        unitId: order.unit_id,
        actualId: record.id,
        actualKind: 'FUEL_VOLUME',
        actualValue: record.volume_liters,
        unitOfMeasure: 'L',
        physicalAssetId: record.physical_asset_id,
        workforceMemberId: null,
        occurredAt: record.fueled_at,
      });

      await this.saveIdempotency(client, {
        serviceOrderId: input.serviceOrderId,
        commandName: 'REGISTER_FUEL',
        idempotencyKey: input.idempotencyKey,
        responsePayload: { fuelRecordId: record.id, rowVersion: bumped.rows[0].row_version },
      });

      await client.query('COMMIT');
      return { outcome: 'success' as const, record, rowVersion: bumped.rows[0].row_version };
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        return { outcome: 'idempotency_conflict' as const };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  /** Registra a assinatura do cliente. */
  async recordSignature(input: RecordExecutionSignatureInput) {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      const order = await this.lockOrder(client, input.serviceOrderId);
      if (!order) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'not_found' as const };
      }
      if (order.row_version !== input.rowVersion) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }
      if (order.status === 'CANCELLED' || order.status === 'DRAFT' || order.status === 'PREPARED') {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'invalid_state' as const };
      }

      const inserted = await client.query<ExecutionSignatureRow>(
        `INSERT INTO so.execution_signatures (
           service_order_id, signer_name, signer_document, signer_role, signature_kind,
           evidence_id, signed_at, actor_identity_id, notes, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10)
         RETURNING id, signer_name, signer_document, signer_role, signature_kind, signed_at`,
        [
          input.serviceOrderId,
          input.signerName,
          input.signerDocument,
          input.signerRole,
          input.signatureKind,
          input.evidenceId,
          input.signedAt,
          input.actorIdentityId,
          input.notes,
          input.idempotencyKey,
        ],
      );
      const signature = inserted.rows[0]!;

      await this.appendEvent(client, {
        serviceOrderId: input.serviceOrderId,
        eventKind: 'SIGNATURE_REGISTERED',
        fromStatus: order.status,
        toStatus: order.status,
        detail: {
          signatureId: signature.id,
          signerName: signature.signer_name,
          signatureKind: signature.signature_kind,
        },
        actorIdentityId: input.actorIdentityId,
        at: signature.signed_at,
        idempotencyKey: `${input.idempotencyKey}:event`,
      });

      const bumped = await client.query<{ row_version: number }>(
        `UPDATE so.service_orders
         SET updated_by_identity_id = $2, updated_at = NOW(), row_version = row_version + 1
         WHERE id = $1 AND row_version = $3
         RETURNING row_version`,
        [input.serviceOrderId, input.actorIdentityId, input.rowVersion],
      );
      if (!bumped.rows[0]) {
        await rollbackKeepingPrimaryCause(client);
        return { outcome: 'version_conflict' as const };
      }

      await this.saveIdempotency(client, {
        serviceOrderId: input.serviceOrderId,
        commandName: 'REGISTER_SIGNATURE',
        idempotencyKey: input.idempotencyKey,
        responsePayload: { signatureId: signature.id, rowVersion: bumped.rows[0].row_version },
      });

      await client.query('COMMIT');
      return { outcome: 'success' as const, signature, rowVersion: bumped.rows[0].row_version };
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      if (isIdempotencyKeyViolation(error)) {
        return { outcome: 'idempotency_conflict' as const };
      }
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // SITUAÇÕES — detecção idempotente
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Persiste a detecção de situações.
   *
   * Idempotente por (ordem, código, chave lógica) com `ON CONFLICT DO NOTHING`
   * sobre o índice parcial de abertas: detectar duas vezes a mesma exceção não cria
   * duas linhas, e uma situação resolvida pode ser reaberta se reaparecer.
   */
  async syncSituations(input: {
    serviceOrderId: string;
    unitId: string;
    situations: Array<{
      code: string;
      detectedKey: string;
      severity: string;
      title: string;
      detail: string;
      impact: string;
      ownerRole: string;
      nextBestAction: string;
      occurredAt: string;
      blocking: boolean;
    }>;
    resolvableSituationIds: string[];
  }): Promise<void> {
    const client = await this.pool().connect();
    // Falha do ROLLBACK quando houver; decide a eviction no finally.
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      for (const situation of input.situations) {
        await client.query(
          `INSERT INTO so.execution_situations (
             service_order_id, unit_id, situation_code, detected_key, severity,
             status, title, detail, impact, owner_role, next_best_action, detected_at
           ) VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8::jsonb, $9, $10, $11::timestamptz)
           ON CONFLICT (service_order_id, situation_code, detected_key)
             WHERE status = 'OPEN'
           DO UPDATE SET
             severity = EXCLUDED.severity,
             title = EXCLUDED.title,
             detail = EXCLUDED.detail,
             impact = EXCLUDED.impact,
             owner_role = EXCLUDED.owner_role,
             next_best_action = EXCLUDED.next_best_action,
             updated_at = NOW(),
             row_version = so.execution_situations.row_version + 1`,
          [
            input.serviceOrderId,
            input.unitId,
            situation.code,
            situation.detectedKey,
            situation.severity,
            situation.title,
            situation.detail,
            JSON.stringify({ blocking: situation.blocking, text: situation.impact }),
            situation.ownerRole,
            situation.nextBestAction,
            situation.occurredAt,
          ],
        );
      }

      /** Situações que deixaram de ser detectadas são resolvidas pelo próprio sistema. */
      for (const id of input.resolvableSituationIds) {
        await client.query(
          `UPDATE so.execution_situations
           SET status = 'RESOLVED', resolved_at = NOW(),
               resolution_notes = 'Resolvida automaticamente: a condição deixou de ser detectada.',
               updated_at = NOW(), row_version = row_version + 1
           WHERE id = $1 AND status = 'OPEN'`,
          [id],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      /**
       * PRESERVAR A CAUSA PRIMÁRIA E EVICTAR A CONEXÃO.
       *
       * Executar o ROLLBACK e relançar o erro no mesmo bloco engole a falha do
       * ROLLBACK: quando ele também falha (conexão terminada, transação já abortada
       * pelo servidor), a rejeição do rollback SOBRESCREVE a causa original e o
       * operador lê "Connection terminated unexpectedly" quando a causa era uma
       * constraint.
       *
       * `rollbackKeepingPrimaryCause` executa o ROLLBACK devolvendo a falha dele sem
       * substituir o erro primário. `release(evictWith)` remove a conexão do pool
       * quando o ROLLBACK falhou: um cliente nesse estado está indefinido e
       * reutilizá-lo propagaria a transação abortada para o próximo comando.
       */
      evictWith = await rollbackKeepingPrimaryCause(client);
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // FECHAMENTO DA EXECUÇÃO
  // ═════════════════════════════════════════════════════════════════════════════

  /**
   * Fecha a execução: congela o realizado e publica a base de medição.
   *
   * Executado DENTRO da transação do comando de conclusão — o mesmo COMMIT que põe
   * a OS em `COMPLETED` cria o fechamento e a base. Não existe estado em que a OS
   * esteja concluída e os realizados ainda possam ser alterados.
   */
  async closeExecution(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      unitId: string;
      actorIdentityId: string;
      clientId: string | null;
      orderNumber: string;
      actualsSnapshot: Record<string, unknown>;
      planVsActual: Record<string, unknown>;
      evidenceSummary: Record<string, unknown>;
      resolvedSituations: unknown[];
      measurementLines: unknown[];
      measurementActuals: Record<string, unknown>;
      measurementEvidence: Record<string, unknown>;
      completionCommandId: string | null;
    },
  ): Promise<{
    closureId: string;
    closureNumber: number;
    basisId: string;
    closedAt: string;
    preparedAt: string;
    lineCount: number;
    actualCount: number;
  }> {
    const nextNumber = await client.query<{ next: number }>(
      `SELECT COALESCE(MAX(closure_number), 0) + 1 AS next
       FROM so.execution_closures WHERE service_order_id = $1`,
      [input.serviceOrderId],
    );
    const closureNumber = nextNumber.rows[0]?.next ?? 1;

    const closure = await client.query<{ id: string; closed_at: string }>(
      `INSERT INTO so.execution_closures (
         service_order_id, unit_id, closure_number, actuals_snapshot, plan_vs_actual,
         evidence_summary, resolved_situations, closed_by_identity_id, completion_command_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
       RETURNING id, closed_at`,
      [
        input.serviceOrderId,
        input.unitId,
        closureNumber,
        JSON.stringify(input.actualsSnapshot),
        JSON.stringify(input.planVsActual),
        JSON.stringify(input.evidenceSummary),
        JSON.stringify(input.resolvedSituations),
        input.actorIdentityId,
        input.completionCommandId,
      ],
    );
    const closureRow = closure.rows[0]!;

    /**
     * A base anterior deixa de ser READY antes da nova entrar.
     *
     * O índice parcial garante UMA base READY por ordem; sem esta transição o
     * INSERT da nova violaria a constraint numa reabertura.
     */
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
        input.unitId,
        JSON.stringify(input.measurementLines),
        JSON.stringify(input.measurementActuals),
        JSON.stringify(input.measurementEvidence),
        input.actorIdentityId,
      ],
    );
    const basisRow = basis.rows[0]!;

    const actualCount = Number((input.actualsSnapshot['recordCount'] as number | undefined) ?? 0);

    // Os DOIS fatos que a capability seguinte consome.
    await this.outboxWriter.appendExecutionCompleted(client, {
      serviceOrderId: input.serviceOrderId,
      unitId: input.unitId,
      clientId: input.clientId,
      orderNumber: input.orderNumber,
      executionClosureId: closureRow.id,
      actualCount,
      completedAt: closureRow.closed_at,
    });

    await this.outboxWriter.appendMeasurementBasisReady(client, {
      serviceOrderId: input.serviceOrderId,
      unitId: input.unitId,
      clientId: input.clientId,
      orderNumber: input.orderNumber,
      measurementBasisId: basisRow.id,
      executionClosureId: closureRow.id,
      lineCount: input.measurementLines.length,
      preparedAt: basisRow.prepared_at,
    });

    return {
      closureId: closureRow.id,
      closureNumber,
      basisId: basisRow.id,
      closedAt: closureRow.closed_at,
      preparedAt: basisRow.prepared_at,
      lineCount: input.measurementLines.length,
      actualCount,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // APOIO
  // ═════════════════════════════════════════════════════════════════════════════

  /** Conecta um cliente para comandos que precisam compor várias operações. */
  async connect(): Promise<PoolClient> {
    return this.pool().connect();
  }

  private async lockOrder(
    client: PoolClient,
    serviceOrderId: string,
  ): Promise<{
    row_version: number;
    status: string;
    unit_id: string;
    order_number: string;
  } | null> {
    const result = await client.query<{
      row_version: number;
      status: string;
      unit_id: string;
      order_number: string;
    }>(
      `SELECT row_version, status::text AS status, unit_id, order_number
       FROM so.service_orders
       WHERE id = $1
       FOR UPDATE`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  private async appendEvent(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      eventKind: string;
      fromStatus: string | null;
      toStatus: string | null;
      detail: Record<string, unknown>;
      actorIdentityId: string;
      at: string;
      idempotencyKey: string;
      isBlocking?: boolean;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO so.execution_events (
         service_order_id, event_kind, from_status, to_status, detail,
         is_blocking, actor_identity_id, occurred_at, idempotency_key
       ) VALUES ($1, $2::so.execution_event_kind, $3, $4, $5::jsonb, $6, $7, $8::timestamptz, $9)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.serviceOrderId,
        input.eventKind,
        input.fromStatus,
        input.toStatus,
        JSON.stringify(input.detail),
        input.isBlocking ?? false,
        input.actorIdentityId,
        input.at,
        input.idempotencyKey,
      ],
    );
  }

  private async findIdempotency(
    client: PoolClient,
    serviceOrderId: string,
    commandName: string,
    idempotencyKey: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await client.query<{ response_payload: Record<string, unknown> }>(
      `SELECT response_payload FROM so.execution_command_idempotency
       WHERE service_order_id = $1 AND command_name = $2 AND idempotency_key = $3`,
      [serviceOrderId, commandName, idempotencyKey],
    );
    return result.rows[0]?.response_payload ?? null;
  }

  private async findActualByIdempotency(
    client: PoolClient,
    serviceOrderId: string,
    idempotencyKey: string,
  ): Promise<ExecutionActualRow | null> {
    const result = await client.query<ExecutionActualRow>(
      `SELECT id, actual_kind::text AS actual_kind, physical_asset_id, workforce_member_id,
              resource_label, actual_value::text AS actual_value, unit_of_measure,
              planned_value::text AS planned_value, planned_unit_of_measure,
              source::text AS source, occurred_at, notes
       FROM so.execution_actuals
       WHERE service_order_id = $1 AND idempotency_key = $2`,
      [serviceOrderId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  private async saveIdempotency(
    client: PoolClient,
    input: {
      serviceOrderId: string;
      commandName: string;
      idempotencyKey: string;
      responsePayload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO so.execution_command_idempotency
         (service_order_id, command_name, idempotency_key, response_payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (service_order_id, command_name, idempotency_key) DO NOTHING`,
      [
        input.serviceOrderId,
        input.commandName,
        input.idempotencyKey,
        JSON.stringify(input.responsePayload),
      ],
    );
  }

  /** Leitura do `row_version` corrente — para a resposta de comandos. */
  async currentRowVersion(serviceOrderId: string): Promise<number | null> {
    const result = await this.pool().query<{ row_version: number }>(
      `SELECT row_version FROM so.service_orders WHERE id = $1`,
      [serviceOrderId],
    );
    return result.rows[0]?.row_version ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO PURO
// ═══════════════════════════════════════════════════════════════════════════════

/** Mapeia o tipo de realizado para o tipo de EVENTO operacional correspondente. */
export function mapActualKindToEventKind(actualKind: string): string {
  switch (actualKind) {
    case 'METER_READING':
      return 'METER_RECORDED';
    case 'FUEL_VOLUME':
      return 'FUEL_RECORDED';
    default:
      return 'ACTUAL_RECORDED';
  }
}

function isCheckViolation(error: unknown, pattern: string): boolean {
  const code = (error as { code?: string })?.code;
  if (code !== '23514') {
    return false;
  }
  const message = String((error as { message?: string })?.message ?? '');
  return message.includes(pattern);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}

/**
 * Executa ROLLBACK sem mascarar o erro primário.
 *
 * O anti-padrão `evictWith = await rollbackKeepingPrimaryCause(client); throw error;` parece correto e não
 * é: se o próprio ROLLBACK falha (conexão terminada, transação já abortada pelo
 * servidor), a promessa rejeitada SOBRESCREVE a causa original. O operador então lê
 * "Connection terminated unexpectedly" quando a causa era uma violação de constraint.
 *
 * Devolve a falha do ROLLBACK (ou `undefined` quando ele funcionou). O chamador
 * decide o que fazer com a conexão; a causa primária é dele, sempre.
 *
 * Mesmo contrato do helper homônimo em `establishment-registry.repository.ts` — o
 * padrão já existe no repositório e é reutilizado aqui em vez de reinventado.
 */
async function rollbackKeepingPrimaryCause(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (rollbackFailure) {
    return rollbackFailure instanceof Error
      ? rollbackFailure
      : new Error(String(rollbackFailure));
  }
}
