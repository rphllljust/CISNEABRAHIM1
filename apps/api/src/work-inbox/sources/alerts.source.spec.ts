import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  BUSINESS_ALERT_SEVERITIES,
  BUSINESS_ALERT_STATUSES,
  BUSINESS_ALERT_TYPES,
  type BusinessAlertListItem,
  type BusinessAlertType,
} from '../../alerts/domain/business-alert';
import { ALERT_READ_LIMIT, AlertsWorkSource, toAlertWorkItem } from './alerts.source';

/**
 * FONTE DE ALERTAS — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - o roteamento REAL de cada tipo de alerta para dominio + natureza da fila;
 * - a chave logica `DOMINIO:ALERT:<alertId>` (deduplicacao estavel);
 * - nenhuma referencia uuid no item e nenhum prazo inventado (`dueAt` sempre `null`);
 * - sem autorizacao (403 do dominio dono) a fonte devolve lista VAZIA — nunca contagem, nunca item.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const ALERT_UUID = '550e8400-e29b-41d4-a716-446655440000';

function alert(overrides: Partial<BusinessAlertListItem> = {}): BusinessAlertListItem {
  return {
    id: ALERT_UUID,
    alertType: BUSINESS_ALERT_TYPES.ServiceOrderOverdue,
    severity: BUSINESS_ALERT_SEVERITIES.Critical,
    status: BUSINESS_ALERT_STATUSES.Active,
    title: 'OS vencida — escalonamento crítico',
    message: 'Ordem de serviço vencida há 12 dia(s) — nível crítico.',
    entityHref: `/app/service-orders/${ALERT_UUID}/planning?filter=overdue`,
    unitId: 'UN-A',
    triggeredAt: '2026-09-01T10:00:00.000Z',
    resolvedAt: null,
    lastSeenAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function sourceWith(listAlerts: ReturnType<typeof vi.fn>): AlertsWorkSource {
  return new AlertsWorkSource({ listAlerts } as never);
}

describe('alerts source — roteamento de dominio e natureza', () => {
  const routing: Array<[BusinessAlertType, string, string]> = [
    [BUSINESS_ALERT_TYPES.ServiceOrderOverdue, 'OPERACOES', 'OVERDUE'],
    [BUSINESS_ALERT_TYPES.ServiceOrderDueSoon, 'OPERACOES', 'OVERDUE'],
    [BUSINESS_ALERT_TYPES.ServiceOrderStalled, 'OPERACOES', 'CONTINUITY'],
    [BUSINESS_ALERT_TYPES.MeasurementAging, 'OPERACOES', 'OVERDUE'],
    [BUSINESS_ALERT_TYPES.BillingAging, 'OPERACOES', 'OVERDUE'],
    [BUSINESS_ALERT_TYPES.PaymentOverdue, 'FINANCEIRO', 'OVERDUE'],
  ];

  it.each(routing)('%s -> %s / %s', (alertType, domain, kind) => {
    const item = toAlertWorkItem(alert({ alertType }));

    expect(item).not.toBeNull();
    expect(item?.domain).toBe(domain);
    expect(item?.kind).toBe(kind);
    expect(item?.id).toBe(`${domain}:ALERT:${ALERT_UUID}`);
  });

  it('nao inventa prazo e nao usa uuid como referencia humana', () => {
    const item = toAlertWorkItem(alert());

    expect(item?.dueAt).toBeNull();
    expect(item?.occurredAt).toBe('2026-09-01T10:00:00.000Z');
    expect(item?.businessReference).toBe('OS vencida — escalonamento crítico');
    expect(item?.businessReference).not.toContain(ALERT_UUID);
    expect(item?.targetRoute).toBe(`/app/service-orders/${ALERT_UUID}/planning?filter=overdue`);
    expect(item?.unitId).toBe('UN-A');
  });

  it('alerta sem rota persistida nao gera item (sem deep link nao existe trabalho navegavel)', () => {
    expect(toAlertWorkItem(alert({ entityHref: '' }))).toBeNull();
  });
});

describe('alerts source — leitura e autorizacao', () => {
  it('le apenas alertas ATIVOS no teto de pagina do proprio modulo dono', async () => {
    const listAlerts = vi.fn().mockResolvedValue([alert()]);

    await sourceWith(listAlerts).collect(ACTOR);

    expect(listAlerts).toHaveBeenCalledTimes(1);
    expect(listAlerts).toHaveBeenCalledWith(ACTOR, {
      status: BUSINESS_ALERT_STATUSES.Active,
      limit: String(ALERT_READ_LIMIT),
    });
  });

  it('sem autorizacao devolve lista vazia — nunca contagem e nunca item anonimizado', async () => {
    const listAlerts = vi.fn().mockRejectedValue(new HttpException('Access denied.', 403));

    await expect(sourceWith(listAlerts).collect(ACTOR)).resolves.toEqual([]);
  });

  it('falha que nao e recusa de leitura nao vira fila vazia: a degradacao e declarada', async () => {
    const listAlerts = vi.fn().mockRejectedValue(new Error('DATABASE_NOT_CONFIGURED'));

    await expect(sourceWith(listAlerts).collect(ACTOR)).rejects.toThrow('DATABASE_NOT_CONFIGURED');
  });
});
