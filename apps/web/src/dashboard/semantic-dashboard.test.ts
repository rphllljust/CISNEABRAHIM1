import { describe, expect, it } from 'vitest';
import {
  COMPOSITE_METRIC_CARDS,
  CONFIRMED_METRICS_RENDERED,
  SMC001_CONFIRMED_FRONT,
  assertRenderableCard,
  isConfirmedMetric,
} from './semantic-dashboard';

describe('COMPOSITE DASHBOARDS — camada semantica (SMC-001/FDC-001)', () => {
  it('espelho SMC-001: 15 CONFIRMED, versoes unicas 1.0.0 (sem BLOCKED/CANDIDATE)', () => {
    expect(SMC001_CONFIRMED_FRONT).toHaveLength(15);
    const versions = SMC001_CONFIRMED_FRONT.map((metric) => `${metric.id}@${metric.version}`);
    expect(new Set(versions).size).toBe(versions.length);
    for (const metric of SMC001_CONFIRMED_FRONT) {
      expect(metric.version).toBe('1.0.0');
    }
  });

  it('todos os cards do painel composto referenciam metricas CONFIRMED (renderizaveis)', () => {
    expect(COMPOSITE_METRIC_CARDS.length).toBeGreaterThan(0);
    for (const card of COMPOSITE_METRIC_CARDS) {
      expect(isConfirmedMetric(card.metricId, card.metricVersion)).toBe(true);
      expect(() => assertRenderableCard(card)).not.toThrow();
    }
  });

  it('CONFIRMED METRICS RENDERED = 8; BLOCKED nunca vira card', () => {
    expect(CONFIRMED_METRICS_RENDERED).toBe(8);
    expect(() =>
      assertRenderableCard({
        metricId: 'receivables.overdue_count_by_finalized_billing_documents',
        metricVersion: '0.0.1',
        visualization: 'Kpi',
        filters: [],
        drill: null,
        href: null,
      }),
    ).toThrow(/BLOCKED_OR_UNKNOWN_METRIC/);
  });

  it('drill somente via FDC-001: certificado apenas p/ OS overdue; browse nao promete igualdade', () => {
    const overdue = COMPOSITE_METRIC_CARDS.find((card) => card.metricId === 'service_orders.overdue_count')!;
    expect(overdue.drill).toBe('certified-count');
    expect(overdue.href).toBe('/app/service-orders?filter=overdue');
    const browse = COMPOSITE_METRIC_CARDS.filter((card) => card.drill === 'browse');
    for (const card of browse) {
      expect(card.metricId).not.toBe('service_orders.overdue_count');
      expect(card.href).not.toBeNull();
    }
    // certificado indevido em outra metrica => guard rejeita
    expect(() =>
      assertRenderableCard({
        metricId: 'receivables.overdue_count',
        metricVersion: '1.0.0',
        visualization: 'Bar',
        filters: [],
        drill: 'certified-count',
        href: '/app/billing?filter=overdue',
      }),
    ).toThrow(/UNPROVEN_DRILL_EQUALITY/);
  });
});
