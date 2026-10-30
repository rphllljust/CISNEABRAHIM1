import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type {
  MeasurementWorkbenchReadModel,
  WorkQueueItem,
} from '../../measurements/application/measurement-workbench.contracts';
import { MEASUREMENT_STATUSES } from '../../measurements/domain/measurement';
import { LEAKAGE_STAGES } from '../../measurements/domain/revenue-leakage';
import type { MeasurementDetailResponse } from '../../measurements/serializers/measurements-response.serializer';
import { WorkInboxService } from '../services/work-inbox.service';
import {
  MEASUREMENT_QUEUE_LIMIT,
  MeasurementsWorkSource,
  toMeasurementWorkItem,
} from './measurements.source';

const ACTOR = { identityId: 'actor-1', sessionId: 's1' };
const MEASUREMENT_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '88888888-8888-4888-8888-888888888888';
const UNIT = 'UN-A';
const AT = '2026-10-01T10:00:00.000Z';

function queue(overrides: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return {
    measurementId: MEASUREMENT_ID,
    serviceOrderId: ORDER_ID,
    orderNumber: 'OS-2026-100',
    customerLabel: 'Cliente Real',
    statuses: { measurement: MEASUREMENT_STATUSES.Submitted, acceptance: 'PENDING', billingEligibility: 'BLOCKED' },
    stage: LEAKAGE_STAGES.MeasuredNotApproved,
    stageLabel: 'Medido, não aprovado',
    reasonCode: 'MEASURED_NOT_APPROVED',
    reasonLabel: 'A medição necessita análise',
    severity: 'ATTENTION',
    amount: '100.00',
    currencyCode: 'BRL',
    ageSeconds: 120,
    ownerRole: 'OPERACOES',
    nextAction: { code: 'APPROVE_MEASUREMENT', label: 'Concluir a aprovação da medição' },
    ...overrides,
  };
}

function workbench(overrides: Partial<MeasurementWorkbenchReadModel> = {}): MeasurementWorkbenchReadModel {
  return {
    identity: { measurementId: MEASUREMENT_ID, serviceOrderId: ORDER_ID, orderNumber: 'OS-2026-100', number: 'MED-100', rowVersion: 2 },
    businessContext: { unit: UNIT, contract: 'CT-1' },
    statuses: { measurement: MEASUREMENT_STATUSES.Submitted },
    acceptance: { required: false, blocksBilling: false, state: 'NOT_REQUIRED', latest: null },
    ...overrides,
  } as MeasurementWorkbenchReadModel;
}

function measurement(overrides: Partial<MeasurementDetailResponse> = {}): MeasurementDetailResponse {
  return {
    id: MEASUREMENT_ID,
    serviceOrderId: ORDER_ID,
    unitId: UNIT,
    status: MEASUREMENT_STATUSES.Submitted,
    submittedAt: AT,
    reviewStartedAt: null,
    decidedAt: null,
    updatedAt: AT,
    ...overrides,
  } as MeasurementDetailResponse;
}

function withMocks(input: {
  rows?: WorkQueueItem[];
  units?: string[];
  getWorkQueue?: ReturnType<typeof vi.fn>;
  getWorkbench?: ReturnType<typeof vi.fn>;
  getById?: ReturnType<typeof vi.fn>;
} = {}) {
  const getWorkQueue = input.getWorkQueue ?? vi.fn().mockResolvedValue({ items: input.rows ?? [queue()] });
  const getWorkbench = input.getWorkbench ?? vi.fn().mockResolvedValue(workbench());
  const getById = input.getById ?? vi.fn().mockResolvedValue(measurement());
  const listUnitScopeRefs = vi.fn().mockResolvedValue(input.units ?? [UNIT]);
  return {
    source: new MeasurementsWorkSource(
      { getWorkQueue, getWorkbench } as never,
      { getById } as never,
      { listUnitScopeRefs } as never,
    ),
    getWorkQueue,
    getWorkbench,
    getById,
    listUnitScopeRefs,
  };
}

describe('MASTER 001 / Incremento 02 — fonte de medição da Inbox única', () => {
  it('projeta medição SUBMITTED autorizada, sem prazo, e navega para a página 360 real', () => {
    const item = toMeasurementWorkItem(queue(), UNIT, workbench(), measurement());
    expect(item).toMatchObject({
      id: `OPERACOES:MEASUREMENT:APPROVAL:${MEASUREMENT_ID}`,
      domain: 'OPERACOES',
      kind: 'APPROVAL',
      businessReference: 'MED-100',
      status: MEASUREMENT_STATUSES.Submitted,
      occurredAt: AT,
      dueAt: null,
      targetRoute: `/app/service-orders/${ORDER_ID}/measurement-workbench`,
    });
    expect(item?.contextLabel).toContain('Contrato CT-1');
  });

  it('não confunde aprovação interna com aceite do cliente', () => {
    const q = queue({ stage: LEAKAGE_STAGES.ApprovedNotAccepted, statuses: { measurement: 'APPROVED', acceptance: 'PENDING', billingEligibility: 'BLOCKED' } });
    const wb = workbench({
      statuses: { measurement: 'APPROVED' } as never,
      acceptance: { required: true, blocksBilling: true, state: 'PENDING', latest: null } as never,
    });
    const m = measurement({ status: 'APPROVED', submittedAt: AT, decidedAt: AT });
    expect(toMeasurementWorkItem(q, UNIT, wb, m)).toMatchObject({
      id: `COMERCIAL:MEASUREMENT:ACCEPTANCE:${MEASUREMENT_ID}`,
      domain: 'COMERCIAL',
      status: 'PENDING',
    });
    expect(toMeasurementWorkItem(q, UNIT, workbench({ ...wb, acceptance: { ...wb.acceptance, blocksBilling: false } }), m)).toBeNull();
    expect(toMeasurementWorkItem(q, UNIT, workbench({ ...wb, acceptance: { ...wb.acceptance, required: false } }), m)).toBeNull();
  });

  it('não publica rejeição como aprovação nem permite objetos obsoletos ou cross-unit', () => {
    const rejected = measurement({ status: MEASUREMENT_STATUSES.Rejected, submittedAt: AT, decidedAt: AT });
    const row = queue({ statuses: { measurement: MEASUREMENT_STATUSES.Rejected, acceptance: 'PENDING', billingEligibility: 'BLOCKED' } });
    const wb = workbench({ statuses: { measurement: MEASUREMENT_STATUSES.Rejected } as never });
    expect(toMeasurementWorkItem(row, UNIT, wb, rejected)?.kind).toBe('EXCEPTION');
    expect(toMeasurementWorkItem(row, UNIT, wb, measurement({ ...rejected, unitId: 'UN-B' }))).toBeNull();
    expect(toMeasurementWorkItem(row, UNIT, wb, measurement({ ...rejected, status: 'APPROVED' }))).toBeNull();
    expect(toMeasurementWorkItem(row, UNIT, workbench({ ...wb, identity: { ...wb.identity, measurementId: 'changed' } }), rejected)).toBeNull();
    expect(toMeasurementWorkItem(row, UNIT, wb, measurement({ ...rejected, decidedAt: null }))).toBeNull();
  });

  it('revalida READ individual, sem expor item nem KPI quando PDP recusa o objeto', async () => {
    const { source, getWorkbench } = withMocks({ getWorkbench: vi.fn().mockRejectedValue(new HttpException('Denied', 403)) });
    const inbox = new WorkInboxService([source]);
    const page = await inbox.list(ACTOR, { domain: 'OPERACOES' });
    expect(getWorkbench).toHaveBeenCalledWith(ACTOR, ORDER_ID);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.byDomain.OPERACOES).toBe(0);
    expect(page.unavailableDomains).toEqual([]);
  });

  it('exclui unidade negada e mantém as demais autorizadas', async () => {
    const getWorkQueue = vi.fn().mockRejectedValueOnce(new HttpException('Denied', 403))
      .mockResolvedValueOnce({ items: [queue()] });
    const { source, getById } = withMocks({ units: ['UN-B', UNIT], getWorkQueue });
    const items = await source.collect(ACTOR);
    expect(getWorkQueue).toHaveBeenCalledTimes(2);
    expect(getById).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
  });

  it('reconcilia KPI e drill com a mesma fonte; mudança persistida remove a pendência', async () => {
    const getWorkQueue = vi.fn()
      .mockResolvedValueOnce({ items: [queue()] })
      .mockResolvedValueOnce({ items: [queue()] })
      .mockResolvedValueOnce({ items: [] });
    const { source } = withMocks({ getWorkQueue });
    const inbox = new WorkInboxService([source]);
    const kpi = await inbox.list(ACTOR, { limit: '0' });
    const drill = await inbox.list(ACTOR, { domain: 'OPERACOES' });
    const after = await inbox.list(ACTOR, { domain: 'OPERACOES' });
    expect(kpi.byDomain.OPERACOES).toBe(1);
    expect(drill.total).toBe(kpi.byDomain.OPERACOES);
    expect(drill.items[0]?.targetRoute).toBe(`/app/service-orders/${ORDER_ID}/measurement-workbench`);
    expect(after.byDomain.OPERACOES).toBe(0);
    expect(after.total).toBe(0);
  });

  it('nunca exibe contagem truncada quando o limite da fila proprietária é atingido', async () => {
    const { source } = withMocks({ rows: Array.from({ length: MEASUREMENT_QUEUE_LIMIT }, () => queue()) });
    await expect(source.collect(ACTOR)).rejects.toThrow('MEASUREMENT_WORK_QUEUE_CAP_REACHED');
    const page = await new WorkInboxService([source]).list(ACTOR);
    expect(page.unavailableDomains).toContain('OPERACOES');
    expect(page.total).toBe(0);
  });

  it('não disfarça falha do banco como fila vazia', async () => {
    const { source } = withMocks({ getWorkQueue: vi.fn().mockRejectedValue(new Error('DB_DOWN')) });
    await expect(source.collect(ACTOR)).rejects.toThrow('DB_DOWN');
  });
});
