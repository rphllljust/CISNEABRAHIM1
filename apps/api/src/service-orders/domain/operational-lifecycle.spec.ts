import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_STAGES,
  currentOperationalStage,
  deriveOperationalLifecycle,
  isExecutionClosed,
  isMeasurementReady,
  operationalStageLabel,
  type OperationalLifecycleFacts,
} from './operational-lifecycle';
import { SERVICE_ORDER_STATUSES } from './service-order';

/**
 * OPERATIONAL LIFECYCLE — o ciclo é DERIVADO de fatos, não de status inventado.
 *
 * A regra que estes testes protegem: nenhum estágio é "verdadeiro por posição".
 * Um estágio só está DONE quando o FATO que o encerra existe persistido.
 */

function baseFacts(overrides: Partial<OperationalLifecycleFacts> = {}): OperationalLifecycleFacts {
  return {
    serviceOrderId: 'so-1',
    status: SERVICE_ORDER_STATUSES.Released,
    plannedResourceCount: 2,
    activeAllocationCount: 2,
    dispatchedAt: null,
    checkedInAt: null,
    startedAt: null,
    pausedAt: null,
    completedAt: null,
    actualCount: 0,
    executionClosedAt: null,
    measurementBasisPreparedAt: null,
    hasBlockingSituation: false,
    ...overrides,
  };
}

function stage(steps: ReturnType<typeof deriveOperationalLifecycle>, code: string) {
  return steps.find((item) => item.stage === code);
}

describe('deriveOperationalLifecycle', () => {
  it('cobre todos os estágios declarados, na ordem', () => {
    const steps = deriveOperationalLifecycle(baseFacts());
    expect(steps.map((item) => item.stage)).toEqual([...OPERATIONAL_STAGES]);
  });

  it('ordem recém-liberada sem planejamento está no primeiro estágio pendente', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({ plannedResourceCount: 0, activeAllocationCount: 0 }),
    );
    expect(stage(steps, 'PLANNED')?.state).toBe('PENDING');
  });

  it('planejada e reservada está PRONTA para despacho (CURRENT)', () => {
    const steps = deriveOperationalLifecycle(baseFacts());
    expect(stage(steps, 'PLANNED')?.state).toBe('DONE');
    expect(stage(steps, 'READY_FOR_DISPATCH')?.state).toBe('CURRENT');
    expect(stage(steps, 'DISPATCHED')?.state).toBe('CURRENT');
  });

  it('planejada mas SEM reserva não está pronta — o motivo é declarado', () => {
    const steps = deriveOperationalLifecycle(baseFacts({ activeAllocationCount: 0 }));
    expect(stage(steps, 'READY_FOR_DISPATCH')?.state).toBe('PENDING');
    expect(stage(steps, 'READY_FOR_DISPATCH')?.detail).toContain('Sem reserva');
  });

  it('despachada marca DISPATCHED como DONE com o instante do fato', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({ dispatchedAt: '2026-10-24T08:00:00.000Z' }),
    );
    expect(stage(steps, 'DISPATCHED')?.state).toBe('DONE');
    expect(stage(steps, 'DISPATCHED')?.at).toBe('2026-10-24T08:00:00.000Z');
    expect(stage(steps, 'CHECKED_IN')?.state).toBe('CURRENT');
  });

  it('check-in não realizado permanece pendente mesmo após o início (etapa saltada é visível)', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        checkedInAt: null,
        startedAt: '2026-10-24T08:14:00.000Z',
        status: SERVICE_ORDER_STATUSES.InExecution,
      }),
    );
    // A execução começou, mas a chegada nunca foi registrada: a leitura mostra isso.
    expect(stage(steps, 'CHECKED_IN')?.state).toBe('CURRENT');
    expect(stage(steps, 'CHECKED_IN')?.detail).toContain('Check-in não realizado');
    expect(stage(steps, 'IN_EXECUTION')?.state).toBe('DONE');
  });

  it('execução pausada é marcada com ATENÇÃO, não como DONE silencioso', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Paused,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        checkedInAt: '2026-10-24T08:10:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        pausedAt: '2026-10-24T12:00:00.000Z',
      }),
    );
    expect(stage(steps, 'IN_EXECUTION')?.state).toBe('ATTENTION');
    expect(stage(steps, 'IN_EXECUTION')?.detail).toBe('Pausada');
  });

  it('execução iniciada sem nenhum realizado é marcada com ATENÇÃO', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.InExecution,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        actualCount: 0,
      }),
    );
    expect(stage(steps, 'ACTUALS_RECORDING')?.state).toBe('ATTENTION');
    expect(stage(steps, 'ACTUALS_RECORDING')?.detail).toContain('Nenhum realizado');
  });

  it('com realizado registrado, o estágio de realizado fica CORRENTE', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.InExecution,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        actualCount: 3,
      }),
    );
    expect(stage(steps, 'ACTUALS_RECORDING')?.state).toBe('CURRENT');
    expect(stage(steps, 'ACTUALS_RECORDING')?.detail).toContain('3');
  });

  it('concluída sem fechamento expõe a pendência real', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Completed,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        completedAt: '2026-10-24T17:30:00.000Z',
        actualCount: 4,
      }),
    );
    expect(stage(steps, 'COMPLETION_PENDING')?.state).toBe('ATTENTION');
    expect(stage(steps, 'COMPLETION_PENDING')?.detail).toContain('não fechada');
    expect(stage(steps, 'EXECUTION_CLOSED')?.state).toBe('CURRENT');
  });

  it('fechada com base publicada chega em MEASUREMENT_READY', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Completed,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        completedAt: '2026-10-24T17:30:00.000Z',
        actualCount: 4,
        executionClosedAt: '2026-10-24T17:31:00.000Z',
        measurementBasisPreparedAt: '2026-10-24T17:31:00.000Z',
      }),
    );
    expect(stage(steps, 'EXECUTION_CLOSED')?.state).toBe('DONE');
    expect(stage(steps, 'MEASUREMENT_READY')?.state).toBe('DONE');
  });

  it('fechada sem base publicada deixa MEASUREMENT_READY CORRENTE (pendente)', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Completed,
        completedAt: '2026-10-24T17:30:00.000Z',
        executionClosedAt: '2026-10-24T17:31:00.000Z',
      }),
    );
    expect(stage(steps, 'MEASUREMENT_READY')?.state).toBe('CURRENT');
    expect(stage(steps, 'MEASUREMENT_READY')?.detail).toContain('pendente');
  });
});

describe('ordem cancelada', () => {
  it('estágios não cumpridos viram NÃO APLICÁVEL, não "pendente para sempre"', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Cancelled,
        plannedResourceCount: 1,
      }),
    );
    expect(stage(steps, 'PLANNED')?.state).toBe('DONE');
    expect(stage(steps, 'DISPATCHED')?.state).toBe('NOT_APPLICABLE');
    expect(stage(steps, 'MEASUREMENT_READY')?.state).toBe('NOT_APPLICABLE');
  });
});

describe('situação de bloqueio', () => {
  it('o estágio corrente vira ATENÇÃO sem reescrever o histórico', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.InExecution,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        actualCount: 1,
        hasBlockingSituation: true,
      }),
    );
    // O que já aconteceu continua acontecido.
    expect(stage(steps, 'DISPATCHED')?.state).toBe('DONE');
    // O ponto atual aparece como exceção.
    expect(steps.filter((item) => item.state === 'ATTENTION').length).toBeGreaterThanOrEqual(1);
  });
});

describe('currentOperationalStage', () => {
  it('devolve o primeiro estágio corrente', () => {
    const steps = deriveOperationalLifecycle(baseFacts());
    expect(currentOperationalStage(steps)).toBe('READY_FOR_DISPATCH');
  });

  it('devolve o último DONE quando nada está corrente', () => {
    const steps = deriveOperationalLifecycle(
      baseFacts({
        status: SERVICE_ORDER_STATUSES.Completed,
        dispatchedAt: '2026-10-24T08:00:00.000Z',
        checkedInAt: '2026-10-24T08:10:00.000Z',
        startedAt: '2026-10-24T08:14:00.000Z',
        completedAt: '2026-10-24T17:30:00.000Z',
        actualCount: 3,
        executionClosedAt: '2026-10-24T17:31:00.000Z',
        measurementBasisPreparedAt: '2026-10-24T17:31:00.000Z',
      }),
    );
    expect(currentOperationalStage(steps)).toBe('MEASUREMENT_READY');
  });
});

describe('fechamento e prontidão de medição', () => {
  it('EXECUÇÃO FECHADA é distinta de OS concluída', () => {
    const concluded = baseFacts({
      status: SERVICE_ORDER_STATUSES.Completed,
      completedAt: '2026-10-24T17:30:00.000Z',
    });
    expect(concluded.status).toBe(SERVICE_ORDER_STATUSES.Completed);
    expect(isExecutionClosed(concluded)).toBe(false);
    expect(isMeasurementReady(concluded)).toBe(false);
  });

  it('fechada ainda não é pronta para medir', () => {
    const closed = baseFacts({ executionClosedAt: '2026-10-24T17:31:00.000Z' });
    expect(isExecutionClosed(closed)).toBe(true);
    expect(isMeasurementReady(closed)).toBe(false);
  });

  it('base publicada é pronta para medir', () => {
    const ready = baseFacts({ measurementBasisPreparedAt: '2026-10-24T17:31:00.000Z' });
    expect(isMeasurementReady(ready)).toBe(true);
  });
});

describe('contrato de saída', () => {
  it('todo estágio tem rótulo humano e href navegável', () => {
    const steps = deriveOperationalLifecycle(baseFacts());
    for (const step of steps) {
      expect(step.label.length).toBeGreaterThan(3);
      expect(step.label).not.toBe(step.stage);
      expect(step.href).toContain('/app/service-orders/so-1');
    }
  });

  it('o rótulo do estágio é estável', () => {
    for (const stageCode of OPERATIONAL_STAGES) {
      expect(operationalStageLabel(stageCode)).toBeTruthy();
    }
  });

  it('não muta os fatos recebidos', () => {
    const facts = baseFacts();
    const snapshot = JSON.stringify(facts);
    deriveOperationalLifecycle(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });

  it('a saída é determinística', () => {
    expect(JSON.stringify(deriveOperationalLifecycle(baseFacts()))).toBe(
      JSON.stringify(deriveOperationalLifecycle(baseFacts())),
    );
  });
});
