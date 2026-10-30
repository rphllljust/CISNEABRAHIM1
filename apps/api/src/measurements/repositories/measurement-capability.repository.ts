import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { rollbackKeepingPrimaryCause } from '../../infrastructure/database/rollback';
import type {
  BillingEligibilityRow,
  CommercialContextRow,
  CustomerAcceptanceRow,
  ExecutionClosureReadRow,
  LeakageOrderFactsRow,
  MeasurementBasisReadRow,
  MeasurementProcessFactsRow,
  MeasurementItemVarianceSourceRow,
  MeasurementVarianceRow,
  RecordAcceptancePersistenceInput,
  RecordAcceptancePersistenceResult,
  RecordEligibilityInput,
  RefreshLeakageInput,
  ReplaceVariancesInput,
  RevenueLeakagePositionRow,
} from './measurement-capability.repository.types';

/**
 * REPOSITÓRIO DA CAPABILITY MEDIÇÃO → ACEITE → FATURAMENTO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * AS DUAS FRONTEIRAS QUE ESTE ARQUIVO PROTEGE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * 1. LEITURA CROSS-CONTEXT PASSA PELA VIEW PUBLICADA.
 *
 *    A base de medição pertence ao contexto de ORDENS DE SERVIÇO. A medição a
 *    lê por `rpt.read_measurement_basis`, nunca por `so.measurement_basis`. As
 *    duas consultas devolvem a mesma coisa HOJE; a diferença aparece no dia em
 *    que alguém mudar a tabela sem avisar quem a consome por contrato.
 *
 * 2. ESCRITA SÓ NA TABELA PRÓPRIA.
 *
 *    Este repositório escreve `msr.*` e NADA MAIS. Ele não toca `so.*`, `bil.*`
 *    nem `evt.*` — os fatos atravessam a fronteira pela outbox, dentro da mesma
 *    transação do comando (ver o serviço de aplicação).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRANSAÇÕES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Toda escrita que compõe várias instruções usa UM `BEGIN`/`COMMIT`. O ROLLBACK
 * de erro passa por `rollbackKeepingPrimaryCause` e a conexão é liberada com
 * `release(evictWith)`: um cliente que falhou no ROLLBACK está em estado
 * indefinido e reutilizá-lo propagaria a transação abortada.
 */
@Injectable()
export class MeasurementCapabilityRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEITURA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Base de medição publicada pela execução, via CONTRATO PUBLICADO.
   *
   * Só a base `READY` interessa: uma base `SUPERSEDED` é passado, e `VOIDED` foi
   * anulada. Filtrar no SQL evita que a aplicação receba uma base inválida e
   * tenha de recusá-la — a recusa acontece onde a regra vive, no domínio, mas a
   * leitura já não oferece o que não serve.
   */
  async findReadyBasis(serviceOrderId: string): Promise<MeasurementBasisReadRow | null> {
    const result = await this.pool().query<MeasurementBasisReadRow>(
      `SELECT id, service_order_id, closure_id, unit_id, status::text AS status,
              lines, actuals, evidence, prepared_at
         FROM rpt.read_measurement_basis
        WHERE service_order_id = $1
          AND status = 'READY'
        LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  /** Qualquer base da ordem, inclusive substituída — para relatar a lacuna. */
  async findLatestBasis(serviceOrderId: string): Promise<MeasurementBasisReadRow | null> {
    const result = await this.pool().query<MeasurementBasisReadRow>(
      `SELECT id, service_order_id, closure_id, unit_id, status::text AS status,
              lines, actuals, evidence, prepared_at
         FROM rpt.read_measurement_basis
        WHERE service_order_id = $1
        ORDER BY prepared_at DESC
        LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  async findClosure(serviceOrderId: string): Promise<ExecutionClosureReadRow | null> {
    const result = await this.pool().query<ExecutionClosureReadRow>(
      `SELECT id, closure_number, closed_at
         FROM rpt.read_execution_closures
        WHERE service_order_id = $1
        ORDER BY closure_number DESC
        LIMIT 1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Contexto comercial da OS.
   *
   * As três decisões desta capability (política de aceite, tolerância de
   * variação, política de entitlement) dependem das MESMAS fontes. Uma leitura só
   * garante que elas vejam o mesmo snapshot — três consultas independentes
   * poderiam ler a OS em instantes diferentes e discordar.
   */
  async loadCommercialContext(serviceOrderId: string): Promise<CommercialContextRow | null> {
    const result = await this.pool().query<CommercialContextRow>(
      `SELECT so.id AS service_order_id,
              so.order_number,
              so.unit_id,
              so.status::text AS status,
              so.client_id,
              so.client_snapshot,
              so.service_snapshot,
              so.contract_snapshot,
              so.contract_reference,
              so.proposal_id,
              so.purchase_order_id,
              so.purchase_order_snapshot,
              c.purchase_order_requirement AS client_purchase_order_requirement,
              so.completed_at
         FROM so.service_orders so
         LEFT JOIN rpt.read_clients c ON c.id = so.client_id
        WHERE so.id = $1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  /** Itens da medição, na forma que o motor de variação consome. */
  async listItemsForVariance(
    measurementId: string,
  ): Promise<MeasurementItemVarianceSourceRow[]> {
    const result = await this.pool().query<MeasurementItemVarianceSourceRow>(
      `SELECT id, line_number, unit_code,
              planned_quantity::text AS planned_quantity,
              actual_quantity::text AS actual_quantity,
              measured_quantity::text AS measured_quantity,
              unit_price::text AS unit_price,
              line_amount::text AS line_amount,
              pricing_line_snapshot
         FROM msr.measurement_items
        WHERE measurement_id = $1
        ORDER BY line_number ASC`,
      [measurementId],
    );
    return result.rows;
  }

  async listVariances(measurementId: string): Promise<MeasurementVarianceRow[]> {
    const result = await this.pool().query<MeasurementVarianceRow>(
      `SELECT id, measurement_id, measurement_item_id, service_order_id, unit_id,
              dimension::text AS dimension, dimension_key,
              planned_value::text AS planned_value,
              actual_value::text AS actual_value,
              measured_value::text AS measured_value,
              absolute_delta::text AS absolute_delta,
              percentage_delta::text AS percentage_delta,
              tolerance_percentage::text AS tolerance_percentage,
              tolerance_source,
              severity::text AS severity,
              financial_impact::text AS financial_impact,
              currency_code,
              requires_decision, decision_kind::text AS decision_kind,
              blocking_reason, recommended_resolution, explanation,
              detected_at, row_version
         FROM msr.measurement_variances
        WHERE measurement_id = $1
        ORDER BY severity, dimension, dimension_key`,
      [measurementId],
    );
    return result.rows;
  }

  /**
   * Decisão de aceite VIGENTE.
   *
   * `ORDER BY cycle_number DESC` com `LIMIT 1`: a decisão do ciclo mais alto é a
   * que governa. Uma rejeição seguida de correção e novo aceite tem o segundo
   * aceite como verdade — a rejeição permanece na história, como causa da
   * correção.
   */
  async findLatestAcceptance(measurementId: string): Promise<CustomerAcceptanceRow | null> {
    const result = await this.pool().query<CustomerAcceptanceRow>(
      `SELECT id, measurement_id, service_order_id, client_id, unit_id, cycle_number,
              policy::text AS policy, result::text AS result, observation,
              rejection_reason, evidence_id, signature_id, customer_signer_name,
              accepted_by_identity_id, occurred_at, correlation_id, idempotency_key,
              row_version, created_at
         FROM msr.customer_acceptances
        WHERE measurement_id = $1
        ORDER BY cycle_number DESC
        LIMIT 1`,
      [measurementId],
    );
    return result.rows[0] ?? null;
  }

  async listAcceptances(measurementId: string): Promise<CustomerAcceptanceRow[]> {
    const result = await this.pool().query<CustomerAcceptanceRow>(
      `SELECT id, measurement_id, service_order_id, client_id, unit_id, cycle_number,
              policy::text AS policy, result::text AS result, observation,
              rejection_reason, evidence_id, signature_id, customer_signer_name,
              accepted_by_identity_id, occurred_at, correlation_id, idempotency_key,
              row_version, created_at
         FROM msr.customer_acceptances
        WHERE measurement_id = $1
        ORDER BY cycle_number ASC`,
      [measurementId],
    );
    return result.rows;
  }

  /** Última avaliação de elegibilidade — a VIGENTE. */
  async findLatestEligibility(measurementId: string): Promise<BillingEligibilityRow | null> {
    const result = await this.pool().query<BillingEligibilityRow>(
      `SELECT id, measurement_id, service_order_id, unit_id, measurement_row_version,
              policy, result, dimensions, blocking_reasons,
              total_amount::text AS total_amount, currency_code, granted_at,
              evaluated_at, evaluated_by_identity_id, row_version
         FROM msr.billing_eligibility_evaluations
        WHERE measurement_id = $1
        ORDER BY evaluated_at DESC, id DESC
        LIMIT 1`,
      [measurementId],
    );
    return result.rows[0] ?? null;
  }

  /** Já existe registro de faturamento PREPARED para a medição? */
  async hasPreparedBillingRecord(serviceOrderId: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM rpt.read_billing_records
          WHERE service_order_id = $1 AND status = 'PREPARED'
       ) AS exists`,
      [serviceOrderId],
    );
    return result.rows[0]?.exists === true;
  }

  /**
   * Ordens concluídas de uma unidade, com os fatos que a projeção de lacuna usa.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * POR QUE UMA CONSULTA SÓ
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A projeção precisa dos MESMOS fatos para todas as ordens, no MESMO instante.
   * Consultar por ordem produziria um retrato costurado: a primeira ordem lida em
   * T1, a última em T2, e o total somaria estados que nunca coexistiram.
   */
  async listCompletedOrdersForLeakage(
    unitId: string,
    limit: number,
  ): Promise<LeakageOrderFactsRow[]> {
    const result = await this.pool().query<LeakageOrderFactsRow>(
      `WITH latest_measurement AS (
         SELECT DISTINCT ON (m.service_order_id)
                m.service_order_id, m.id, m.status::text AS status, m.updated_at,
                m.commercial_reference_snapshot
           FROM msr.measurements m
          ORDER BY m.service_order_id, m.updated_at DESC, m.id DESC
       ), item_totals AS (
         SELECT mi.measurement_id,
                COUNT(*)::int AS item_count,
                COUNT(mi.line_amount)::int AS priced_count,
                SUM(mi.line_amount)::text AS amount
           FROM msr.measurement_items mi
          GROUP BY mi.measurement_id
       ), latest_acceptance AS (
         SELECT DISTINCT ON (a.measurement_id)
                a.measurement_id, a.result::text AS result, a.policy::text AS policy,
                a.evidence_id
           FROM msr.customer_acceptances a
          ORDER BY a.measurement_id, a.cycle_number DESC
       ), latest_eligibility AS (
         SELECT DISTINCT ON (e.measurement_id)
                e.measurement_id, e.result, e.blocking_reasons
           FROM msr.billing_eligibility_evaluations e
          ORDER BY e.measurement_id, e.evaluated_at DESC, e.id DESC
       )
       SELECT so.id AS service_order_id,
              so.order_number,
              so.unit_id,
              so.client_id,
              so.client_snapshot,
              lm.id AS measurement_id,
              lm.status AS measurement_status,
              lm.updated_at AS measurement_updated_at,
              CASE WHEN lm.status = 'APPROVED' AND it.item_count > 0
                    AND it.priced_count = it.item_count THEN it.amount
                   ELSE NULL END AS measurement_amount,
              CASE WHEN lm.id IS NULL THEN NULL
                   ELSE COALESCE(NULLIF(lm.commercial_reference_snapshot->>'currencyCode', ''), 'BRL')
              END AS measurement_currency,
              ec.closed_at AS execution_closed_at,
              so.completed_at,
              COALESCE(
                (so.contract_snapshot->>'acceptanceRequired')::boolean,
                (so.service_snapshot->>'acceptancePolicy') IN (
                  'REQUIRED_BEFORE_BILLING', 'REQUIRED_WITH_EVIDENCE'
                ),
                false
              ) AS acceptance_required,
              CASE
                WHEN COALESCE((so.contract_snapshot->>'acceptanceRequired')::boolean,
                              (so.service_snapshot->>'acceptancePolicy') IN (
                                'REQUIRED_BEFORE_BILLING', 'REQUIRED_WITH_EVIDENCE'), false) = false
                  THEN false
                WHEN la.result IS NULL THEN true
                WHEN la.result = 'REJECTED' THEN true
                WHEN la.policy = 'REQUIRED_WITH_EVIDENCE' AND la.evidence_id IS NULL THEN true
                ELSE false
              END AS acceptance_blocked,
              le.result AS eligibility_result,
              le.blocking_reasons->>0 AS eligibility_blocking_reason,
              EXISTS (
                SELECT 1 FROM rpt.read_billing_records br
                 WHERE br.service_order_id = so.id AND br.status = 'PREPARED'
              ) AS billing_prepared
         FROM so.service_orders so
         LEFT JOIN latest_measurement lm ON lm.service_order_id = so.id
         LEFT JOIN item_totals it ON it.measurement_id = lm.id
         LEFT JOIN latest_acceptance la ON la.measurement_id = lm.id
         LEFT JOIN latest_eligibility le ON le.measurement_id = lm.id
         LEFT JOIN LATERAL (
           SELECT c.closed_at FROM rpt.read_execution_closures c
            WHERE c.service_order_id = so.id
            ORDER BY c.closure_number DESC LIMIT 1
         ) ec ON TRUE
        WHERE so.status = 'COMPLETED'
          AND so.unit_id = $1
        ORDER BY so.completed_at ASC NULLS LAST, so.order_number ASC
        LIMIT $2`,
      [unitId, limit],
    );
    return result.rows;
  }

  /** Contexto de processo de UMA ordem: contrato, marcos e faturamento. */
  async loadProcessFacts(serviceOrderId: string): Promise<MeasurementProcessFactsRow | null> {
    /**
     * O GENÉRICO É OBRIGATÓRIO.
     *
     * Sem `query<MeasurementProcessFactsRow>`, `result.rows` é `any[]` e o
     * retorno vira `any` — o consumidor perde toda a verificação de tipo
     * justamente na leitura que alimenta a projeção de processo. O tipo vai no
     * contrato, não num cast no consumidor.
     */
    const result = await this.pool().query<MeasurementProcessFactsRow>(
      `SELECT so.contract_reference,
              so.contract_snapshot->>'dueAt' AS contract_due_at,
              (SELECT MIN(pr.created_at)::text FROM so.planned_resources pr
                WHERE pr.service_order_id = so.id AND pr.status = 'PLANNED') AS planning_confirmed_at,
              (SELECT MIN(ra.created_at)::text FROM res.resource_allocations ra
                WHERE ra.service_order_id = so.id AND ra.status = 'ACTIVE') AS reservation_confirmed_at,
              (SELECT d.dispatched_at FROM rpt.read_service_order_dispatches d
                WHERE d.service_order_id = so.id ORDER BY d.dispatched_at DESC LIMIT 1) AS dispatched_at,
              so.started_at,
              so.completed_at,
              (SELECT c.closed_at FROM rpt.read_execution_closures c
                WHERE c.service_order_id = so.id ORDER BY c.closure_number DESC LIMIT 1) AS execution_closed_at,
              (SELECT m.created_at FROM msr.measurements m
                WHERE m.service_order_id = so.id ORDER BY m.created_at ASC LIMIT 1) AS measurement_created_at,
              (SELECT m.decided_at FROM msr.measurements m
                WHERE m.service_order_id = so.id AND m.status = 'APPROVED'
                ORDER BY m.decided_at DESC LIMIT 1) AS measurement_approved_at,
              COALESCE(
                (so.contract_snapshot->>'acceptanceRequired')::boolean,
                (so.service_snapshot->>'acceptancePolicy') IN (
                  'REQUIRED_BEFORE_BILLING', 'REQUIRED_WITH_EVIDENCE'
                ),
                false
              ) AS acceptance_required,
              (SELECT a.occurred_at FROM msr.customer_acceptances a
                INNER JOIN msr.measurements m2 ON m2.id = a.measurement_id
                WHERE m2.service_order_id = so.id AND a.result = 'ACCEPTED'
                ORDER BY a.cycle_number DESC, a.occurred_at DESC LIMIT 1) AS acceptance_satisfied_at,
              (SELECT br.prepared_at FROM rpt.read_billing_records br
                WHERE br.service_order_id = so.id AND br.status = 'PREPARED'
                ORDER BY br.prepared_at DESC LIMIT 1) AS billing_prepared_at,
              (SELECT r.created_at FROM rpt.read_receivables r
                WHERE r.origin_service_order_id = so.id
                ORDER BY r.created_at DESC LIMIT 1) AS receivable_opened_at,
              (SELECT s.settled_at FROM rpt.read_settlements s
                INNER JOIN rpt.read_receivables r2 ON r2.id = s.receivable_id
                WHERE r2.origin_service_order_id = so.id
                  AND s.reversed_at IS NULL
                ORDER BY s.settled_at DESC LIMIT 1) AS settled_at
         FROM so.service_orders so
        WHERE so.id = $1`,
      [serviceOrderId],
    );
    return result.rows[0] ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCRITA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Substitui a PROJEÇÃO de variações da medição.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * POR QUE DELETE + INSERT E NÃO UPSERT
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A variação é uma projeção das três verdades, não um fato acumulativo. Quando
   * o operador corrige um item, a variação correspondente pode DEIXAR de existir —
   * e um upsert nunca a removeria. O DELETE dentro da mesma transação garante que
   * a projeção reflita exatamente as três colunas no instante do recálculo.
   *
   * A perda é segura porque a variação NUNCA é a verdade: ela é derivada de
   * `measurement_items`, que é. O histórico do que aconteceu está na trilha da
   * medição e nos fatos da outbox.
   */
  async replaceVariances(
    client: PoolClient,
    input: ReplaceVariancesInput,
  ): Promise<void> {
    await client.query(`DELETE FROM msr.measurement_variances WHERE measurement_id = $1`, [
      input.measurementId,
    ]);

    for (const item of input.variances) {
      await client.query(
        `INSERT INTO msr.measurement_variances (
           measurement_id, measurement_item_id, service_order_id, unit_id,
           dimension, dimension_key, planned_value, actual_value, measured_value,
           absolute_delta, percentage_delta, tolerance_percentage, tolerance_source,
           severity, financial_impact, currency_code, requires_decision, decision_kind,
           blocking_reason, recommended_resolution, explanation
         ) VALUES (
           $1, $2, $3, $4, $5::msr.measurement_variance_dimension, $6, $7, $8, $9,
           $10, $11, $12, $13,
           $14::msr.measurement_variance_severity, $15, $16, $17,
           $18::msr.measurement_variance_decision,
           $19, $20, $21
         )`,
        [
          input.measurementId,
          item.measurementItemId,
          input.serviceOrderId,
          input.unitId,
          item.dimension,
          item.dimensionKey,
          item.plannedValue,
          item.actualValue,
          item.measuredValue,
          item.absoluteDelta,
          item.percentageDelta,
          item.tolerancePercentage,
          item.toleranceSource,
          item.severity,
          item.financialImpact,
          item.currencyCode,
          item.requiresDecision,
          item.decisionKind,
          item.blockingReason,
          item.recommendedResolution,
          item.explanation,
        ],
      );
    }
  }

  /**
   * Registra a decisão de aceite DENTRO de uma transação já aberta.
   *
   * O chamador é o serviço de aplicação, que já validou política, execução e
   * duplicidade. Aqui a garantia final é do BANCO: a UNIQUE (measurement_id,
   * cycle_number) transforma a segunda decisão do mesmo ciclo em conflito, mesmo
   * que dois requests concorrentes passem pela validação ao mesmo tempo.
   */
  async recordAcceptance(
    client: PoolClient,
    input: RecordAcceptancePersistenceInput,
  ): Promise<RecordAcceptancePersistenceResult> {
    if (input.idempotencyKey) {
      const cached = await client.query<CustomerAcceptanceRow>(
        `SELECT id, measurement_id, service_order_id, client_id, unit_id, cycle_number,
                policy::text AS policy, result::text AS result, observation,
                rejection_reason, evidence_id, signature_id, customer_signer_name,
                accepted_by_identity_id, occurred_at, correlation_id, idempotency_key,
                row_version, created_at
           FROM msr.customer_acceptances
          WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (cached.rows[0]) {
        return { outcome: 'already_recorded', acceptance: cached.rows[0] };
      }
    }

    const inserted = await client.query<CustomerAcceptanceRow>(
      `INSERT INTO msr.customer_acceptances (
         measurement_id, service_order_id, client_id, unit_id, cycle_number, policy,
         result, observation, rejection_reason, evidence_id, signature_id,
         customer_signer_name, accepted_by_identity_id, occurred_at, correlation_id,
         idempotency_key
       ) VALUES (
         $1, $2, $3, $4, $5, $6::msr.acceptance_policy,
         $7::msr.acceptance_result, $8, $9, $10, $11,
         $12, $13, $14::timestamptz, $15,
         $16
       )
       ON CONFLICT DO NOTHING
       RETURNING id, measurement_id, service_order_id, client_id, unit_id, cycle_number,
                 policy::text AS policy, result::text AS result, observation,
                 rejection_reason, evidence_id, signature_id, customer_signer_name,
                 accepted_by_identity_id, occurred_at, correlation_id, idempotency_key,
                 row_version, created_at`,
      [
        input.measurementId,
        input.serviceOrderId,
        input.clientId,
        input.unitId,
        input.cycleNumber,
        input.policy,
        input.result,
        input.observation,
        input.rejectionReason,
        input.evidenceId,
        input.signatureId,
        input.customerSignerName,
        input.actorIdentityId,
        input.occurredAt,
        input.correlationId,
        input.idempotencyKey,
      ],
    );

    if (!inserted.rows[0]) {
      // READ COMMITTED: após o ON CONFLICT aguardar a transação vencedora,
      // esta consulta enxerga o commit da mesma chave. Uma chave distinta no
      // mesmo ciclo continua sendo conflito, não replay.
      if (input.idempotencyKey) {
        const replay = await client.query<CustomerAcceptanceRow>(
          `SELECT id, measurement_id, service_order_id, client_id, unit_id, cycle_number,
                  policy::text AS policy, result::text AS result, observation,
                  rejection_reason, evidence_id, signature_id, customer_signer_name,
                  accepted_by_identity_id, occurred_at, correlation_id, idempotency_key,
                  row_version, created_at
             FROM msr.customer_acceptances
            WHERE idempotency_key = $1`,
          [input.idempotencyKey],
        );
        if (replay.rows[0]) {
          return { outcome: 'already_recorded', acceptance: replay.rows[0] };
        }
      }
      return { outcome: 'version_conflict' };
    }
    return { outcome: 'success', acceptance: inserted.rows[0] };
  }

  /** Grava a avaliação de elegibilidade (história + vigente). */
  async recordEligibility(
    client: PoolClient,
    input: RecordEligibilityInput,
  ): Promise<BillingEligibilityRow> {
    const inserted = await client.query<BillingEligibilityRow>(
      `INSERT INTO msr.billing_eligibility_evaluations (
         measurement_id, service_order_id, unit_id, measurement_row_version, policy,
         result, dimensions, blocking_reasons, total_amount, currency_code, granted_at,
         evaluated_by_identity_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11::timestamptz, $12
       )
       ON CONFLICT (measurement_id, measurement_row_version, result) DO UPDATE
         SET dimensions = EXCLUDED.dimensions,
             blocking_reasons = EXCLUDED.blocking_reasons,
             total_amount = EXCLUDED.total_amount,
             currency_code = EXCLUDED.currency_code,
             granted_at = COALESCE(msr.billing_eligibility_evaluations.granted_at, EXCLUDED.granted_at),
             evaluated_at = NOW(),
             evaluated_by_identity_id = EXCLUDED.evaluated_by_identity_id,
             row_version = msr.billing_eligibility_evaluations.row_version + 1
       RETURNING id, measurement_id, service_order_id, unit_id, measurement_row_version,
                 policy, result, dimensions, blocking_reasons,
                 total_amount::text AS total_amount, currency_code, granted_at,
                 evaluated_at, evaluated_by_identity_id, row_version`,
      [
        input.measurementId,
        input.serviceOrderId,
        input.unitId,
        input.measurementRowVersion,
        input.policy,
        input.result,
        JSON.stringify(input.dimensions),
        JSON.stringify(input.blockingReasons),
        input.totalAmount,
        input.currencyCode,
        input.grantedAt,
        input.actorIdentityId,
      ],
    );
    return inserted.rows[0]!;
  }

  /**
   * Substitui a projeção de lacuna de receita de uma unidade.
   *
   * Escopo por UNIDADE porque a projeção é operacional: o control tower de uma
   * unidade não precisa somar as outras, e uma projeção global reescreveria dados
   * de unidades que ninguém está olhando.
   */
  async refreshLeakage(unitId: string, input: RefreshLeakageInput): Promise<number> {
    const client = await this.pool().connect();
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');

      await client.query(`DELETE FROM msr.revenue_leakage_positions WHERE unit_id = $1`, [unitId]);

      for (const position of input.positions) {
        await client.query(
          `INSERT INTO msr.revenue_leakage_positions (
             service_order_id, unit_id, client_id, measurement_id, stage, order_number,
             client_label, amount, currency_code, age_seconds, owner_role, blocker_code,
             next_action_code, next_action_label, computed_at
           ) VALUES (
             $1, $2, $3, $4, $5::msr.revenue_leakage_stage, $6,
             $7, $8, $9, $10, $11, $12,
             $13, $14, NOW()
           )
           ON CONFLICT (service_order_id) DO UPDATE
             SET unit_id = EXCLUDED.unit_id,
                 client_id = EXCLUDED.client_id,
                 measurement_id = EXCLUDED.measurement_id,
                 stage = EXCLUDED.stage,
                 order_number = EXCLUDED.order_number,
                 client_label = EXCLUDED.client_label,
                 amount = EXCLUDED.amount,
                 currency_code = EXCLUDED.currency_code,
                 age_seconds = EXCLUDED.age_seconds,
                 owner_role = EXCLUDED.owner_role,
                 blocker_code = EXCLUDED.blocker_code,
                 next_action_code = EXCLUDED.next_action_code,
                 next_action_label = EXCLUDED.next_action_label,
                 computed_at = NOW(),
                 row_version = msr.revenue_leakage_positions.row_version + 1`,
          [
            position.serviceOrderId,
            unitId,
            position.clientId,
            position.measurementId,
            position.stage,
            position.orderNumber,
            position.clientLabel,
            position.amount,
            position.currencyCode,
            position.ageSeconds,
            position.ownerRole,
            position.blockerCode,
            position.nextActionCode,
            position.nextActionLabel,
          ],
        );
      }

      await client.query('COMMIT');
      return input.positions.length;
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  /** Lê a projeção persistida — o drill-down reconstrói o total a partir daqui. */
  async listLeakagePositions(unitId: string, limit: number): Promise<RevenueLeakagePositionRow[]> {
    const result = await this.pool().query<RevenueLeakagePositionRow>(
      `SELECT id, service_order_id, unit_id, client_id, measurement_id,
              stage::text AS stage, order_number, client_label,
              amount::text AS amount, currency_code, age_seconds::text AS age_seconds,
              owner_role, blocker_code, next_action_code, next_action_label, computed_at
         FROM msr.revenue_leakage_positions
        WHERE unit_id = $1
        ORDER BY stage DESC, age_seconds DESC NULLS LAST, amount DESC NULLS LAST, order_number ASC
        LIMIT $2`,
      [unitId, limit],
    );
    return result.rows;
  }

  /**
   * Expõe um cliente de transação ao serviço de aplicação.
   *
   * Necessário porque o comando compõe: estado da medição + variações + aceite +
   * elegibilidade + outbox, TODOS no mesmo COMMIT. Abrir uma transação por
   * repositório quebraria a atomicidade — e o sistema passaria a ter estado
   * commitado com evento ausente.
   */
  async withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool().connect();
    let evictWith: Error | undefined;
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      throw error;
    } finally {
      client.release(evictWith);
    }
  }
}
