import { describe, expect, it } from 'vitest';
import { SEMANTIC_METRIC_CATALOG, type MetricDefinition } from './semantic-metric-catalog';

/**
 * CATALOG AUTHZ DRIFT (BI gate) — SMC-001 CONFIRMED x comportamento real das APIs.
 * Mapeamento esperado (auditado de aging/executive/reports/authz desta sessao):
 *   service-orders -> service-orders:service-order:list (UNIT_SCOPED)
 *   measurements   -> measurements:measurement:read    (UNIT_SCOPED)
 *   billing/finance-> billing:billing-record:read      (UNIT_SCOPED)
 *   productivity.completed/on_time/avg_cycle -> service-orders:service-order:list
 *   productivity.rework_rate -> measurements:measurement:read
 */

const EXPECTED: Record<string, { requiredCapability: string; scopePolicy: 'GLOBAL' | 'UNIT_SCOPED' }> = {
  'service_orders.overdue_count': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'service_orders.approaching_due_count': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'service_orders.awaiting_billing_count': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'measurements.aging_count': { requiredCapability: 'measurements:measurement:read', scopePolicy: 'UNIT_SCOPED' },
  'billing.awaiting_preparation_count': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'billing.prepared_count': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'billing.prepared_amount': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'receivables.awaiting_payment_count': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'receivables.awaiting_payment_amount': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'receivables.overdue_count': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'receivables.overdue_amount': { requiredCapability: 'billing:billing-record:read', scopePolicy: 'UNIT_SCOPED' },
  'productivity.completed_count': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'productivity.on_time_rate': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'productivity.avg_cycle_hours': { requiredCapability: 'service-orders:service-order:list', scopePolicy: 'UNIT_SCOPED' },
  'productivity.rework_rate': { requiredCapability: 'measurements:measurement:read', scopePolicy: 'UNIT_SCOPED' },
};

function driftFor(metric: MetricDefinition): string | null {
  const expected = EXPECTED[metric.id];
  if (!expected) {
    return null; // metricas nao mapeadas (ex.: BLOCKED) nao participam da checagem
  }
  if (metric.requiredCapability !== expected.requiredCapability || metric.scopePolicy !== expected.scopePolicy) {
    return `${metric.id}: capability=${metric.requiredCapability}/${metric.scopePolicy} esperado=${expected.requiredCapability}/${expected.scopePolicy}`;
  }
  return null;
}

describe('BI GATE — drift catalogo (SMC-001) x autorizacao real das APIs', () => {
  it('nenhuma metrica CONFIRMED possui capability/scope divergente da API real', () => {
    const confirmed = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CONFIRMED');
    const drifts = confirmed.map(driftFor).filter((value): value is string => value !== null);
    expect(drifts).toEqual([]);
    expect(confirmed.length).toBe(15);
    expect(Object.keys(EXPECTED).length).toBe(15);
  });

  it('BLOCKED nao participa (nao e metrica utilizavel/exposta)', () => {
    const blocked = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'BLOCKED');
    expect(blocked).toHaveLength(1);
    expect(driftFor(blocked[0]!)).toBeNull();
  });
});
