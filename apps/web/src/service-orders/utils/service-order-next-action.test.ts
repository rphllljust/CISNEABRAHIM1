import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';
import {
  resolveServiceOrderAttention,
  resolveServiceOrderNextAction,
} from './service-order-next-action';

const NOW = new Date('2026-03-10T12:00:00.000Z');

describe('service-order-next-action', () => {
  it('nomeia a proxima acao liberada pela maquina de estados', () => {
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.Draft)).toEqual({
      kind: 'lifecycle',
      intent: 'prepare',
      label: 'Preparar OS',
    });
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.Prepared)).toEqual({
      kind: 'lifecycle',
      intent: 'release',
      label: 'Liberar OS',
    });
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.Released)).toEqual({
      kind: 'stage',
      stage: 'planning',
      label: 'Alocar recursos',
    });
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.InExecution)).toEqual({
      kind: 'stage',
      stage: 'execution',
      label: 'Registrar execução',
    });
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.Completed)).toEqual({
      kind: 'stage',
      stage: 'measurement',
      label: 'Registrar medição',
    });
    expect(resolveServiceOrderNextAction(SERVICE_ORDER_STATUSES.Cancelled)).toEqual({
      kind: 'lifecycle',
      intent: 'reopen',
      label: 'Reabrir OS',
    });
  });

  it('explicita prazo vencido, prazo proximo e ausencia de responsavel', () => {
    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.Released,
          deadlineAt: '2026-03-07T09:00:00.000Z',
          assignedWorkforceMember: { memberCode: 'EMP-1', displayName: 'Ana' },
        },
        NOW,
      ),
    ).toEqual({ tone: 'critical', label: 'Vencida há 3 dias' });

    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.Released,
          deadlineAt: '2026-03-10T18:00:00.000Z',
          assignedWorkforceMember: { memberCode: 'EMP-1', displayName: 'Ana' },
        },
        NOW,
      ),
    ).toEqual({ tone: 'critical', label: 'Vence hoje' });

    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.InExecution,
          deadlineAt: '2026-03-12T09:00:00.000Z',
          assignedWorkforceMember: { memberCode: 'EMP-1', displayName: 'Ana' },
        },
        NOW,
      ),
    ).toEqual({ tone: 'warning', label: 'Vence em 2 dias' });

    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.Prepared,
          deadlineAt: null,
          assignedWorkforceMember: null,
        },
        NOW,
      ),
    ).toEqual({ tone: 'warning', label: 'Sem responsável alocado' });
  });

  it('nao inventa excecao para OS encerrada nem quando nao ha dado faltando', () => {
    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.Completed,
          deadlineAt: '2026-01-01T09:00:00.000Z',
          assignedWorkforceMember: null,
        },
        NOW,
      ),
    ).toBeNull();

    expect(
      resolveServiceOrderAttention(
        {
          status: SERVICE_ORDER_STATUSES.Released,
          deadlineAt: '2026-04-01T09:00:00.000Z',
          assignedWorkforceMember: { memberCode: 'EMP-1', displayName: 'Ana' },
        },
        NOW,
      ),
    ).toBeNull();
  });
});
