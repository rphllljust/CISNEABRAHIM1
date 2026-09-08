import { describe, expect, it } from 'vitest';
import {
  DRILL_AUTHORIZATION_NOTE,
  DRILL_DESTINATIONS,
  DRILLABLE_METRICS_WITH_PROVEN_EQUALITY,
  buildDrillHref,
  drillDestinationByAttentionId,
  drillDestinationByMetricId,
  drillHrefForMetric,
} from './filter-drill-contract';

describe('FILTER + DRILL CONTRACT (FDC-001)', () => {
  it('registry: metricId drillable possui rota + query contract; href unico derivado do registry', () => {
    const destination = drillDestinationByMetricId('service_orders.overdue_count');
    expect(destination).toBeDefined();
    expect(destination!.route).toBe('/app/service-orders');
    expect(destination!.filterParam).toBe('overdue');
    expect(destination!.capability).toBe('service-orders:service-order:list');
    expect(destination!.semantics).toContain('so.deadline_for');
    expect(buildDrillHref(destination!)).toBe('/app/service-orders?filter=overdue');
    expect(drillHrefForMetric('service_orders.overdue_count')).toBe('/app/service-orders?filter=overdue');
  });

  it('metricId sem drill => undefined; metricId inexistente => undefined', () => {
    expect(drillDestinationByMetricId('receivables.overdue_amount')).toBeUndefined();
    expect(drillHrefForMetric('nao.existe')).toBeNull();
    expect(drillDestinationByAttentionId('nao.existe')).toBeUndefined();
  });

  it('overdue NUNCA e status literal: filtro derivado resolvido pelo kernel de deadline', () => {
    const destination = drillDestinationByMetricId('service_orders.overdue_count')!;
    expect(destination.filterParam).toBe('overdue');
    expect(destination.semantics).toContain('nao-terminal');
    expect(destination.semantics).toContain('<=');
  });

  it('contagem de metricas com paridade comprovada (COUNT_EQUALITY_PROVEN)', () => {
    const proven = DRILLABLE_METRICS_WITH_PROVEN_EQUALITY;
    expect(proven).toEqual(['service_orders.overdue_count']);
    expect(DRILL_DESTINATIONS.filter((entry) => entry.equality === 'COUNT_EQUALITY_PROVEN')).toHaveLength(1);
    // BROWSE_ONLY nao promete paridade (documentado)
    const browse = drillDestinationByMetricId('receivables.overdue_count')!;
    expect(browse.equality).toBe('BROWSE_ONLY_NO_COUNT_EQUALITY');
  });

  it('URL nunca e boundary de seguranca (lista de destino revalida)', () => {
    expect(DRILL_AUTHORIZATION_NOTE).toContain('revalidates capability, scope, unit and filters');
  });

  it('dests unicos por attentionId e por metricId (sem duplicacao)', () => {
    const attentionIds = DRILL_DESTINATIONS.map((entry) => entry.attentionId);
    const metricIds = DRILL_DESTINATIONS.map((entry) => entry.metricId);
    expect(new Set(attentionIds).size).toBe(attentionIds.length);
    expect(new Set(metricIds).size).toBe(metricIds.length);
  });
});
