import { describe, expect, it } from 'vitest';
import {
  BLOCKED_METRIC_COUNT,
  CANDIDATE_METRIC_COUNT,
  CATALOG_CAPABILITIES,
  CONFIRMED_METRIC_COUNT,
  SEMANTIC_METRIC_CATALOG,
  assertSemanticMetricCatalogValid,
  lookupSemanticMetric,
  validateMetricDefinitions,
  type MetricDefinition,
} from './semantic-metric-catalog';

function baseMetric(overrides: Partial<MetricDefinition>): MetricDefinition {
  return {
    id: 'test.metric',
    version: '1.0.0',
    concept: 'Metrica de teste',
    domain: 'service-orders',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'fonte-de-teste',
    engine: 'engine-de-teste',
    dimensions: ['unit'],
    allowedFilters: [],
    timezonePolicy: 'businessTimezone',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
    ...overrides,
  };
}

describe('SEMANTIC METRIC CATALOG (SMC-001)', () => {
  it('catalogo oficial valido: ids unicos, versao unica por id, CONFIRMED com fonte/engine, capability/scope validos', () => {
    expect(() => assertSemanticMetricCatalogValid()).not.toThrow();
    const ids = SEMANTIC_METRIC_CATALOG.map((metric) => metric.id);
    expect(new Set(ids).size).toBe(ids.length);
    const idVersion = SEMANTIC_METRIC_CATALOG.map((metric) => `${metric.id}@${metric.version}`);
    expect(new Set(idVersion).size).toBe(idVersion.length);
    const confirmed = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CONFIRMED');
    for (const metric of confirmed) {
      expect(metric.source.trim().length).toBeGreaterThan(0);
      expect(metric.engine.trim().length).toBeGreaterThan(0);
      expect(CATALOG_CAPABILITIES).toContain(metric.requiredCapability);
    }
    expect(CONFIRMED_METRIC_COUNT).toBe(21);
    expect(CANDIDATE_METRIC_COUNT).toBe(0);
    expect(BLOCKED_METRIC_COUNT).toBe(1);
  });

  it('metricId duplicado => invalido', () => {
    const dup = [...SEMANTIC_METRIC_CATALOG, SEMANTIC_METRIC_CATALOG[0]!];
    expect(validateMetricDefinitions(dup)).toContain(`DUPLICATE_METRIC_VERSION ${SEMANTIC_METRIC_CATALOG[0]!.id}@${SEMANTIC_METRIC_CATALOG[0]!.version}`);
  });

  it('versao duplicada por metrica => invalido', () => {
    const a = baseMetric({ id: 'x.metric', version: '1.0.0' });
    const b = baseMetric({ id: 'x.metric', version: '1.0.0', concept: 'outra' });
    expect(validateMetricDefinitions([a, b])).toContain('DUPLICATE_METRIC_VERSION x.metric@1.0.0');
  });

  it('CONFIRMED sem fonte ou engine ausente => invalido', () => {
    expect(validateMetricDefinitions([baseMetric({ source: '' })])).toContain('SOURCE_MISSING test.metric');
    expect(validateMetricDefinitions([baseMetric({ engine: '' })])).toContain('ENGINE_MISSING test.metric');
  });

  it('capability invalida ou scope invalido => invalido', () => {
    const rawCap = { ...baseMetric({}), requiredCapability: 'invented:capability' } as unknown as MetricDefinition;
    expect(validateMetricDefinitions([rawCap])).toContain('INVALID_CAPABILITY test.metric');
    const rawScope = { ...baseMetric({}), scopePolicy: 'WRONG' } as unknown as MetricDefinition;
    expect(validateMetricDefinitions([rawScope])).toContain('INVALID_SCOPE test.metric');
  });

  it('CANDIDATE aceito estruturalmente e BLOCKED exige motivo', () => {
    const candidate = baseMetric({ id: 'cand.metric', status: 'CANDIDATE', concept: 'Candidata' });
    expect(validateMetricDefinitions([candidate])).toEqual([]);
    const blockedWithoutReason = baseMetric({ id: 'blocked.metric', status: 'BLOCKED', concept: 'Bloqueada' });
    expect(validateMetricDefinitions([blockedWithoutReason])).toContain('BLOCKED_REASON_REQUIRED blocked.metric');
  });

  it('taxas declaram numerador/denominador (backend); demais nao exigem', () => {
    for (const metric of SEMANTIC_METRIC_CATALOG) {
      if (metric.valueType === 'rate') {
        expect(metric.numerator?.trim().length).toBeGreaterThan(0);
        expect(metric.denominator?.trim().length).toBeGreaterThan(0);
      }
    }
    expect(SEMANTIC_METRIC_CATALOG.filter((metric) => metric.valueType === 'rate')).toHaveLength(2);
  });

  it('NO_DATA != 0: valores financeiros declaram NO_DATA_NULL e contagens ZERO_REAL', () => {
    const amounts = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.id.startsWith('receivables.') && metric.id.endsWith('_amount'));
    for (const metric of amounts) {
      expect(metric.nullPolicy).toBe('NO_DATA_NULL');
    }
    expect(amounts.length).toBe(2);
    const counts = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.id.startsWith('receivables.') && metric.id.endsWith('_count') && metric.status === 'CONFIRMED');
    for (const metric of counts) {
      expect(metric.nullPolicy).toBe('ZERO_REAL');
    }
  });

  it('lookup encontra metrica e retorna undefined para ausente', () => {
    expect(lookupSemanticMetric('receivables.overdue_amount')?.status).toBe('CONFIRMED');
    expect(lookupSemanticMetric('receivables.overdue_count_by_finalized_billing_documents')?.status).toBe('BLOCKED');
    expect(lookupSemanticMetric('nao.existe')).toBeUndefined();
  });

  it('catalogo serializavel (JSON round-trip preserva conteudo, sem funcoes)', () => {
    const roundTripped = JSON.parse(JSON.stringify(SEMANTIC_METRIC_CATALOG)) as MetricDefinition[];
    expect(roundTripped).toEqual(SEMANTIC_METRIC_CATALOG);
    expect(roundTripped.length).toBe(SEMANTIC_METRIC_CATALOG.length);
  });

  it('authz por dominio real: finance/billing usam billing read, measurement usa measurement read (sem capability generica de ServiceOrder)', () => {
    const financeOrBilling = SEMANTIC_METRIC_CATALOG.filter(
      (metric) => metric.domain === 'finance-receivables' || metric.id.startsWith('billing.'),
    );
    for (const metric of financeOrBilling) {
      expect(metric.requiredCapability).toBe('billing:billing-record:read');
      expect(metric.requiredCapability).not.toBe('service-orders:service-order:list');
    }
    const measurementMetric = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.id === 'measurements.aging_count');
    expect(measurementMetric[0]?.requiredCapability).toBe('measurements:measurement:read');
  });
});
