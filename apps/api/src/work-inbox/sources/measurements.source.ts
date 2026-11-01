import { HttpException, Injectable } from '@nestjs/common';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { MeasurementsCapabilityService } from '../../measurements/application/measurements-capability.service';
import type {
  MeasurementWorkbenchReadModel,
  WorkQueueItem,
} from '../../measurements/application/measurement-workbench.contracts';
import { MEASUREMENT_STATUSES } from '../../measurements/domain/measurement';
import { LEAKAGE_STAGES } from '../../measurements/domain/revenue-leakage';
import { MeasurementsAccessService } from '../../measurements/services/measurements-access.service';
import type { MeasurementDetailResponse } from '../../measurements/serializers/measurements-response.serializer';
import type { WorkItem } from '../contracts/work-item.contract';
import type { WorkItemActor, WorkItemSource } from './work-item-source';

/** PDP revalidation is deliberately bounded to avoid unbounded DB fan-out. */
export const MEASUREMENT_AUTHZ_BATCH_SIZE = 8;
export const MEASUREMENT_UNIT_BATCH_SIZE = 4;

/**
 * Project the EXISTING measurement control tower into the single ERP Inbox.
 *
 * The unit queue alone is not sufficient authorization: a grant for a unit
 * projection does not imply READ permission on every object's detail. Every
 * candidate is revalidated through getWorkbench/getById, which use the domain
 * PDP and record grants. Never expose an inaccessible candidate or its count.
 *
 * No new acceptance command, financial event, workflow, due date or SQL.
 */
@Injectable()
export class MeasurementsWorkSource implements WorkItemSource {
  readonly domain = 'OPERACOES';

  constructor(
    private readonly capability: MeasurementsCapabilityService,
    private readonly access: MeasurementsAccessService,
    private readonly scopes: ScopeContextRepository,
  ) {}

  async collect(actor: WorkItemActor): Promise<WorkItem[]> {
    const units = await this.scopes.listUnitScopeRefs();
    const seen = new Set<string>();
    const results: WorkItem[] = [];
    for (let offset = 0; offset < units.length; offset += MEASUREMENT_UNIT_BATCH_SIZE) {
      const batches = await Promise.all(
        units.slice(offset, offset + MEASUREMENT_UNIT_BATCH_SIZE)
          .map((unitId) => this.collectUnit(actor, unitId)),
      );
      for (const item of batches.flat()) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        results.push(item);
      }
    }
    return results;
  }

  private async collectUnit(actor: WorkItemActor, unitId: string): Promise<WorkItem[]> {
    let rows: WorkQueueItem[];
    try {
      // O módulo dono monta TODAS as páginas no mesmo snapshot. Nenhum KPI
      // é publicado antes da leitura integral e da revalidação PDP por objeto.
      const queue = await this.capability.getWorkQueue(actor, {
        unitId,
        exhaustive: true,
      });
      rows = queue.items;
    } catch (error) {
      if (isNotReadable(error)) return [];
      throw error;
    }

    const results: WorkItem[] = [];
    for (let offset = 0; offset < rows.length; offset += MEASUREMENT_AUTHZ_BATCH_SIZE) {
      const batch = await Promise.all(rows.slice(offset, offset + MEASUREMENT_AUTHZ_BATCH_SIZE).map(async (row) => {
        if (!row.measurementId || !isMeasurementWorkStage(row.stage)) return null;
        try {
          const [workbench, measurement] = await Promise.all([
            this.capability.getWorkbench(actor, row.serviceOrderId),
            this.access.getById(actor, row.serviceOrderId, row.measurementId),
          ]);
          return toMeasurementWorkItem(row, unitId, workbench, measurement);
        } catch (error) {
          if (isNotReadable(error)) return null;
          throw error;
        }
      }));
      results.push(...batch.filter((item): item is WorkItem => item !== null));
    }
    return results;
  }
}

/** Cross-domain read model is only a projection; commands remain in Medição 360. */
export function toMeasurementWorkItem(
  row: WorkQueueItem,
  unitId: string,
  workbench: MeasurementWorkbenchReadModel,
  measurement: MeasurementDetailResponse,
): WorkItem | null {
  if (
    !row.measurementId ||
    row.measurementId !== measurement.id ||
    row.measurementId !== workbench.identity.measurementId ||
    row.serviceOrderId !== measurement.serviceOrderId ||
    row.serviceOrderId !== workbench.identity.serviceOrderId ||
    unitId !== measurement.unitId ||
    unitId !== workbench.businessContext.unit ||
    row.statuses.measurement !== measurement.status ||
    row.statuses.measurement !== workbench.statuses.measurement
  ) {
    return null;
  }

  const approval = row.stage === LEAKAGE_STAGES.MeasuredNotApproved &&
    (measurement.status === MEASUREMENT_STATUSES.Submitted ||
      measurement.status === MEASUREMENT_STATUSES.UnderReview ||
      measurement.status === MEASUREMENT_STATUSES.Rejected);
  const acceptance = row.stage === LEAKAGE_STAGES.ApprovedNotAccepted &&
    measurement.status === MEASUREMENT_STATUSES.Approved &&
    workbench.acceptance.required &&
    workbench.acceptance.blocksBilling;

  if (!approval && !acceptance) return null;

  const at = acceptance
    ? workbench.acceptance.latest?.result === 'REJECTED'
      ? workbench.acceptance.latest.occurredAt
      : measurement.decidedAt
    : measurement.status === MEASUREMENT_STATUSES.Submitted
      ? measurement.submittedAt
      : measurement.status === MEASUREMENT_STATUSES.UnderReview
        ? measurement.reviewStartedAt
        : measurement.decidedAt;

  // The source must never fabricate an occurrence time or an acceptance SLA.
  if (!at || !Number.isFinite(Date.parse(at))) return null;

  const domain = acceptance ? 'COMERCIAL' : 'OPERACOES';
  const operation = acceptance ? 'ACCEPTANCE' : 'APPROVAL';
  const acceptanceRejected = acceptance && workbench.acceptance.state === 'REJECTED';

  return {
    id: `${domain}:MEASUREMENT:${operation}:${measurement.id}`,
    domain,
    kind: acceptanceRejected || measurement.status === MEASUREMENT_STATUSES.Rejected ? 'EXCEPTION' : 'APPROVAL',
    businessReference: workbench.identity.number ?? row.orderNumber,
    title: acceptanceRejected ? 'Aceite do cliente rejeitado requer tratamento' :
      acceptance ? 'Medição aprovada aguardando aceite do cliente' :
      measurement.status === MEASUREMENT_STATUSES.Rejected
        ? 'Medição rejeitada requer tratamento'
        : 'Medição aguardando decisão',
    // A workbench publica contractReference textual, mas não contractId;
    // sem o ID persistido não afirmar vínculo contratual autoritativo.
    contextLabel: `OS ${row.orderNumber} · Unidade ${unitId}`,
    status: acceptance ? workbench.acceptance.state : measurement.status,
    reason: row.reasonLabel,
    occurredAt: at,
    dueAt: null,
    actionLabel: 'Revisar Medição 360',
    targetRoute: `/app/service-orders/${measurement.serviceOrderId}/measurement-workbench`,
    unitId,
  };
}

function isMeasurementWorkStage(stage: string): boolean {
  return stage === LEAKAGE_STAGES.MeasuredNotApproved || stage === LEAKAGE_STAGES.ApprovedNotAccepted;
}

function isNotReadable(error: unknown): boolean {
  return error instanceof HttpException && (error.getStatus() === 403 || error.getStatus() === 404);
}
