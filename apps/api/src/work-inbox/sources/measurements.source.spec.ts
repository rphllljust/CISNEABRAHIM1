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
  MEASUREMENT_AUTHZ_BATCH_SIZE,
  MeasurementsWorkSource,
  toMeasurementWorkItem,
  toUnmeasuredWorkItem,
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

function unmeasuredWorkbench(overrides: Partial<MeasurementWorkbenchReadModel> = {}): MeasurementWorkbenchReadModel {
  return workbench({
    identity: { ...workbench().identity, measurementId: null, number: null, rowVersion: null },
    statuses: { ...workbench().statuses, execution: 'CLOSED', measurement: 'NOT_CREATED' },
    processContext: {
      milestones: [{ stage: 'ACTUALS', label: 'Realizado', state: 'COMPLETED', reachedAt: AT }],
    } as never,
    ...overrides,
  });
}

function unmeasuredQueue(overrides: Partial<WorkQueueItem> = {}): WorkQueueItem {
  return queue({
    measurementId: null,
    statuses: { measurement: 'NOT_CREATED', acceptance: 'NOT_REQUIRED', billingEligibility: 'NOT_EVALUATED' },
    stage: LEAKAGE_STAGES.ExecutedNotMeasured,
    reasonCode: 'MEASUREMENT_MISSING',
    reasonLabel: 'Gerar a medição da execução fechada',
    nextAction: { code: 'CREATE_MEASUREMENT', label: 'Gerar a medição da execução fechada' },
    ...overrides,
  });
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
  it('projeta somente execução FECHADA sem medição, com timestamp real e rota 360', () => {
    const item = toUnmeasuredWorkItem(unmeasuredQueue(), UNIT, unmeasuredWorkbench());
    expect(item).toMatchObject({
      id: `OPERACOES:MEASUREMENT:CREATE:${ORDER_ID}`,
      domain: 'OPERACOES',
      kind: 'CONTINUITY',
      status: 'NOT_CREATED',
      occurredAt: AT,
      dueAt: null,
      businessReference: 'OS-2026-100',
      targetRoute: `/app/service-orders/${ORDER_ID}/measurement-workbench`,
    });
    expect(item?.reason).toContain('medição da execução fechada');
  });

  it('não infere medição pendente de status de OS nem vaza objeto divergente ou sem fechamento', () => {
    const row = unmeasuredQueue();
    const wb = unmeasuredWorkbench();
    expect(toUnmeasuredWorkItem(row, UNIT, unmeasuredWorkbench({
      identity: { ...wb.identity, measurementId: MEASUREMENT_ID },
    }))).toBeNull();
    expect(toUnmeasuredWorkItem(row, UNIT, unmeasuredWorkbench({
      businessContext: { ...wb.businessContext, unit: 'UN-B' },
    }))).toBeNull();
    expect(toUnmeasuredWorkItem(row, UNIT, unmeasuredWorkbench({
      statuses: { ...wb.statuses, execution: 'COMPLETED' },
    }))).toBeNull();
    expect(toUnmeasuredWorkItem(row, UNIT, unmeasuredWorkbench({
      processContext: { milestones: [] } as never,
    }))).toBeNull();
    expect(toUnmeasuredWorkItem(unmeasuredQueue({
      statuses: { ...row.statuses, measurement: 'APPROVED' },
    }), UNIT, wb)).toBeNull();
  });

  it('inclui ausência autoritativa de medição no KPI/drill, sem consultar detalhe inexistente', async () => {
    const getWorkQueue = vi.fn()
      .mockResolvedValueOnce({ items: [unmeasuredQueue()] })
      .mockResolvedValueOnce({ items: [unmeasuredQueue()] })
      .mockResolvedValueOnce({ items: [] });
    const { source, getWorkbench, getById } = withMocks({
      getWorkQueue,
      getWorkbench: vi.fn().mockResolvedValue(unmeasuredWorkbench()),
    });
    const inbox = new WorkInboxService([source]);
    const kpi = await inbox.list(ACTOR, { limit: '0' });
    const drill = await inbox.list(ACTOR, { domain: 'OPERACOES' });
    const after = await inbox.list(ACTOR, { domain: 'OPERACOES' });
    expect(kpi.byDomain.OPERACOES).toBe(1);
    expect(drill.total).toBe(1);
    expect(drill.items[0]?.status).toBe('NOT_CREATED');
    expect(after.total).toBe(0);
    expect(getWorkbench).toHaveBeenCalledTimes(2);
    expect(getById).not.toHaveBeenCalled();
  });

  it('oculta medição inexistente sem permissão e não publica KPI por amostra', async () => {
    const { source, getById } = withMocks({
      rows: [unmeasuredQueue()],
      getWorkbench: vi.fn().mockRejectedValue(new HttpException('Denied', 403)),
    });
    const page = await new WorkInboxService([source]).list(ACTOR, { domain: 'OPERACOES' });
    expect(page.total).toBe(0);
    expect(page.byDomain.OPERACOES).toBe(0);
    expect(getById).not.toHaveBeenCalled();
  });

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
    expect(item?.contextLabel).toBe('OS OS-2026-100 · Unidade UN-A');
    expect(item?.contextLabel).not.toContain('CT-1');
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

  it('classifica recusa de aceite do cliente como exceção, sem promover status da medição', () => {
    const row = queue({
      stage: LEAKAGE_STAGES.ApprovedNotAccepted,
      statuses: { measurement: 'APPROVED', acceptance: 'REJECTED', billingEligibility: 'BLOCKED' },
    });
    const wb = workbench({
      statuses: { measurement: 'APPROVED' } as never,
      acceptance: {
        required: true,
        blocksBilling: true,
        state: 'REJECTED',
        latest: { result: 'REJECTED', occurredAt: AT },
      } as never,
    });
    const m = measurement({ status: 'APPROVED', submittedAt: AT, decidedAt: AT });
    expect(toMeasurementWorkItem(row, UNIT, wb, m)).toMatchObject({
      kind: 'EXCEPTION',
      title: 'Aceite do cliente rejeitado requer tratamento',
      occurredAt: AT,
      status: 'REJECTED',
    });
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


  it.each([0, 499, 500, 501, 1500])(
    'reconcilia KPI/drill para %i ordens no snapshot completo com READ por registro',
    async (count) => {
      const rows = Array.from({ length: count }, (_, index) => queue({
        measurementId: `m-${index}`,
        serviceOrderId: `o-${index}`,
        orderNumber: `OS-${index}`,
      }));
      let active = 0;
      let peak = 0;
      const getWorkbench = vi.fn(async (_actor: unknown, serviceOrderId: string) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        const index = serviceOrderId.slice(2);
        return workbench({
          identity: {
            ...workbench().identity,
            serviceOrderId,
            measurementId: `m-${index}`,
            orderNumber: `OS-${index}`,
          },
        });
      });
      const getById = vi.fn(async (_actor: unknown, serviceOrderId: string, measurementId: string) =>
        measurement({ id: measurementId, serviceOrderId }));
      const { source, getWorkQueue } = withMocks({ rows, getWorkbench, getById });
      const inbox = new WorkInboxService([source]);
      const page = await inbox.list(ACTOR, { domain: 'OPERACOES', limit: '100' });
      expect(getWorkQueue).toHaveBeenCalledWith(ACTOR, { unitId: UNIT, exhaustive: true });
      expect(page.unavailableDomains).toEqual([]);
      expect(page.total).toBe(count);
      expect(page.byDomain.OPERACOES).toBe(count);
      expect(page.items).toHaveLength(Math.min(count, 100));
      expect(new Set(page.items.map((item) => item.id)).size).toBe(page.items.length);
      expect(getWorkbench).toHaveBeenCalledTimes(count);
      expect(getById).toHaveBeenCalledTimes(count);
      expect(peak).toBeLessThanOrEqual(MEASUREMENT_AUTHZ_BATCH_SIZE);
    },
  );

  it('mantém deduplicação e exclui objetos negados em qualquer página', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => queue({
      measurementId: `m-${index}`,
      serviceOrderId: `o-${index}`,
      orderNumber: `OS-${index}`,
    }));
    rows.push(rows[500]!);
    const getWorkbench = vi.fn(async (_actor: unknown, serviceOrderId: string) => {
      if (serviceOrderId === 'o-500') throw new HttpException('Denied', 403);
      const index = serviceOrderId.slice(2);
      return workbench({ identity: {
        ...workbench().identity,
        serviceOrderId,
        measurementId: `m-${index}`,
        orderNumber: `OS-${index}`,
      } });
    });
    const getById = vi.fn(async (_actor: unknown, serviceOrderId: string, measurementId: string) =>
      measurement({ id: measurementId, serviceOrderId }));
    const { source } = withMocks({ rows, getWorkbench, getById });
    const page = await new WorkInboxService([source]).list(ACTOR, { domain: 'OPERACOES' });
    expect(page.total).toBe(500);
    expect(page.byDomain.OPERACOES).toBe(500);
    expect(page.items.every((item) => !item.id.includes('m-500'))).toBe(true);
  });

  it('falha fechado quando o snapshot do módulo dono está indisponível, sem KPI parcial', async () => {
    const { source } = withMocks({
      getWorkQueue: vi.fn().mockRejectedValue(new Error('MEASUREMENT_LEAKAGE_SNAPSHOT_CAP_REACHED')),
    });
    const page = await new WorkInboxService([source]).list(ACTOR);
    expect(page.unavailableDomains).toContain('OPERACOES');
    expect(page.total).toBe(0);
    expect(page.byDomain.OPERACOES).toBe(0);
  });

  it('não disfarça falha do banco como fila vazia', async () => {
    const { source } = withMocks({ getWorkQueue: vi.fn().mockRejectedValue(new Error('DB_DOWN')) });
    await expect(source.collect(ACTOR)).rejects.toThrow('DB_DOWN');
  });
});
