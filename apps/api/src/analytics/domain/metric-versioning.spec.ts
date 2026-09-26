import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_METRIC_CATALOG,
  type MetricDefinition,
} from './semantic-metric-catalog';
import {
  compareSemanticVersions,
  countCurrentConfirmedMetrics,
  currentConfirmedIds,
  lookupMetricVersion,
  requiresNewVersionOnSemanticChange,
  resolveCurrentMetric,
  validateVersionedCatalog,
  lineageFor,
  canReproduceHistoricalValue,
} from './metric-versioning';

function clone(metric: MetricDefinition, overrides: Partial<MetricDefinition> = {}): MetricDefinition {
  return { ...metric, ...overrides };
}

describe('METRIC VERSIONING + LINEAGE (MVL-001)', () => {
  it('regressao: 21 metricas CONFIRMED atuais + 1 BLOCKED (nao current)', () => {
    expect(countCurrentConfirmedMetrics()).toBe(21);
    expect(currentConfirmedIds()).toHaveLength(21);
    const blocked = SEMANTIC_METRIC_CATALOG.find((metric) => metric.status === 'BLOCKED');
    expect(blocked).toBeDefined();
    expect(resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, blocked!.id)).toBeUndefined();
  });

  it('lookup por id resolve versao atual CONFIRMED; versao explicita funciona; id/versao inexistentes => undefined', () => {
    const current = resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, 'receivables.overdue_amount');
    expect(current?.version).toBe('1.0.0');
    expect(lookupMetricVersion(SEMANTIC_METRIC_CATALOG, 'receivables.overdue_amount', '1.0.0')?.status).toBe('CONFIRMED');
    expect(lookupMetricVersion(SEMANTIC_METRIC_CATALOG, 'receivables.overdue_amount', '9.9.9')).toBeUndefined();
    expect(resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, 'nao.existe')).toBeUndefined();
  });

  it('duas versoes validas: resolve a maior como current; versao antiga imutavel e superseded', () => {
    const base = SEMANTIC_METRIC_CATALOG.find((metric) => metric.id === 'productivity.completed_count')!;
    const v1 = clone(base, { version: '1.0.0', supersededByVersion: '1.1.0' });
    const v2 = clone(base, { version: '1.1.0', source: 'so.service_orders (COMPLETED) + janela revisada' });
    const defs = [v1, v2];
    expect(resolveCurrentMetric(defs, base.id)?.version).toBe('1.1.0');
    expect(lookupMetricVersion(defs, base.id, '1.0.0')?.supersededByVersion).toBe('1.1.0');
    expect(Object.isFrozen(SEMANTIC_METRIC_CATALOG.find((metric) => metric.id === base.id))).toBe(true);
  });

  it('metadata-only (concept/label) nao exige nova versao; mudanca semantica exige', () => {
    const base = SEMANTIC_METRIC_CATALOG.find((metric) => metric.id === 'productivity.completed_count')!;
    const metadataOnly = clone(base, { concept: 'Nova descricao textual (label)' });
    expect(requiresNewVersionOnSemanticChange(base, metadataOnly)).toBe(false);
    const semantic = clone(base, { source: 'fonte-transacional-diferente' });
    expect(requiresNewVersionOnSemanticChange(base, semantic)).toBe(true);
    const numeratorChange = clone(base, { valueType: 'rate', numerator: 'x', denominator: 'y' });
    expect(requiresNewVersionOnSemanticChange(base, numeratorChange)).toBe(true);
  });

  it('BLOCKED nunca resolve como versao atual', () => {
    const blocked = SEMANTIC_METRIC_CATALOG.find((metric) => metric.status === 'BLOCKED')!;
    expect(resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, blocked.id)).toBeUndefined();
    expect(lookupMetricVersion(SEMANTIC_METRIC_CATALOG, blocked.id, blocked.version)?.status).toBe('BLOCKED');
  });

  it('lineage completo para todas as CONFIRMED atuais (sem SQL copiado)', () => {
    for (const id of currentConfirmedIds()) {
      const metric = resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, id)!;
      const lineage = lineageFor(metric);
      expect(lineage).toBeDefined();
      expect(lineage!.readModel.trim().length).toBeGreaterThan(0);
      expect(lineage!.domainOwner.trim().length).toBeGreaterThan(0);
      expect(lineage!.source.trim().length).toBeGreaterThan(0);
    }
    const issues = validateVersionedCatalog();
    expect(issues).toEqual([]);
  });

  it('source inexistente => CONFIRMED_WITHOUT_LINEAGE; dependencia circular detectada', () => {
    const x = clone(SEMANTIC_METRIC_CATALOG[0]!, { id: 'x.metric' });
    const y = clone(SEMANTIC_METRIC_CATALOG[1]!, { id: 'y.metric' });
    const defs = [x, y];
    // lineage ausente p/ ambas
    expect(validateVersionedCatalog(defs, {})).toEqual(expect.arrayContaining(['CONFIRMED_WITHOUT_LINEAGE x.metric', 'CONFIRMED_WITHOUT_LINEAGE y.metric']));

    const lineage = {
      'x.metric': { readModel: 'r', domainOwner: 'd', source: 's', dependsOn: ['y.metric'] },
      'y.metric': { readModel: 'r', domainOwner: 'd', source: 's', dependsOn: ['x.metric'] },
    };
    expect(validateVersionedCatalog(defs, lineage)).toEqual(expect.arrayContaining([expect.stringContaining('LINEAGE_CIRCULAR_DEPENDENCY')]));
  });

  it('BLOCKED nao selecionavel como current nem exposto como utilizavel', () => {
    const blocked = SEMANTIC_METRIC_CATALOG.find((metric) => metric.status === 'BLOCKED')!;
    expect(currentConfirmedIds()).not.toContain(blocked.id);
    expect(resolveCurrentMetric(SEMANTIC_METRIC_CATALOG, blocked.id)).toBeUndefined();
  });

  it('SEMANTIC VERSIONING != DATA SNAPSHOT VERSIONING: sem historico congelado inventado', () => {
    expect(canReproduceHistoricalValue('receivables.overdue_amount', '1.0.0')).toBe(false);
  });

  it('compareSemanticVersions ordena corretamente', () => {
    expect(compareSemanticVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemanticVersions('1.1.0', '1.0.0')).toBe(1);
    expect(compareSemanticVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
