import { describe, expect, it } from 'vitest';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';
import { resolveServiceOrderAttention } from './service-order-next-action';

const NOW = new Date('2026-03-10T12:00:00.000Z');

/*
 * SESSÃO B5 — o caso "nomeia a proxima acao liberada pela maquina de estados" foi REMOVIDO.
 *
 * Ele provava `resolveServiceOrderNextAction`: um mapa status→comando mantido no frontend,
 * que duplicava a state machine do backend. A função deixou de existir; a decisão de quais
 * comandos são válidos agora vem de `GET /service-orders/:id/available-actions`, coberta
 * pelo E2E de consumo contra a API real (`e2e/meta/service-order-meta.journey.spec.ts`).
 *
 * Testar o mapa de novo aqui reintroduziria a duplicação que B5 removeu.
 */

describe('service-order-next-action (apresentação)', () => {

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
