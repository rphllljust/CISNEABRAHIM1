import {
  SEMANTIC_METRIC_CATALOG,
  type MetricDefinition,
} from './semantic-metric-catalog';

/**
 * METRIC VERSIONING + LINEAGE (SMC-001 evolution) — MVL-001
 *
 * EVOLVE_EXISTING: mesmo catalogo/definicao (nada de MetricDefinitionV2, catalogo novo,
 * tabela ou engine). Este modulo adiciona:
 *
 * VERSIONAMENTO SEMANTICO
 *  - Mudanca apenas de label/descricao (metadata) => NAO exige nova versao.
 *  - Mudanca em formula/numerador/denominador/grain/source/timezonePolicy/nullPolicy/
 *    availabilityPolicy/bucket|policy/interpretacao => exige nova MetricVersion
 *    (detectada por changedSemanticFields / requiresNewVersionOnSemanticChange).
 *  - Versoes publicadas sao imutaveis (freeze) e nunca sobrescritas silenciosamente.
 *  - lookup por metricId+version; sem version => resolve SOMENTE a versao atual CONFIRMED.
 *
 * LINEAGE (CONFIRMED)
 *  MetricDefinition -> engine/regra canonica (def.engine) -> read model/query contract
 *  (lineage.readModel) -> dominio proprietario (lineage.domainOwner) -> fonte transacional
 *  (lineage.source). Sem copiar SQL; referencia artefatos existentes. Dependencias entre
 *  metricas (lineage.dependsOn) sao declarativas e checadas contra ciclos.
 *
 * REPRODUCAO HISTORICA
 *  SEMANTIC VERSIONING != DATA SNAPSHOT VERSIONING. Sem data-snapshot versioning
 *  (nenhum historico congelado preservado), nunca afirmar que dado historico foi
 *  calculado com versao antiga: canReproduceHistoricalValue() => false.
 *
 * BLOCKED nunca resolve como versao atual nem como metrica utilizavel.
 */

export type MetricLineage = {
  /** Read model / query contract que materializa a metrica (artefato existente). */
  readModel: string;
  /** Dominio proprietario dos dados. */
  domainOwner: string;
  /** Fonte transacional de origem (sem copiar SQL - ponteiro). */
  source: string;
  /** Dependencia declarativa de outra metrica CONFIRMED (sem duplicar formula). */
  dependsOn?: string[];
};

/** Campos cuja mudanca e SEMANTICA (exige nova versao). */
export const SEMANTIC_CHANGE_FIELDS = [
  'source',
  'engine',
  'numerator',
  'denominator',
  'grain',
  'unit',
  'valueType',
  'timezonePolicy',
  'nullPolicy',
  'availabilityPolicy',
  'allowedFilters',
  'requiredCapability',
  'scopePolicy',
] as const;

export function changedSemanticFields(previous: MetricDefinition, next: MetricDefinition): string[] {
  const changed: string[] = [];
  for (const field of SEMANTIC_CHANGE_FIELDS) {
    const left = previous[field];
    const right = next[field];
    if (JSON.stringify(left ?? null) !== JSON.stringify(right ?? null)) {
      changed.push(field);
    }
  }
  return changed;
}

/** true se ha qualquer mudanca semantica (metadata-only nao dispara). */
export function requiresNewVersionOnSemanticChange(previous: MetricDefinition, next: MetricDefinition): boolean {
  return changedSemanticFields(previous, next).length > 0;
}

export function compareSemanticVersions(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

export function isUsableMetric(definition: MetricDefinition): boolean {
  return definition.status === 'CONFIRMED' && !definition.supersededByVersion;
}

/**
 * Versao atual de uma metrica: somente CONFIRMED nao superseded (nunca CANDIDATE/BLOCKED).
 * Resolve a MAIOR versao publicada.
 */
export function resolveCurrentMetric(
  definitions: readonly MetricDefinition[],
  id: string,
): MetricDefinition | undefined {
  const candidates = definitions.filter((definition) => definition.id === id && isUsableMetric(definition));
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.reduce((current, candidate) =>
    compareSemanticVersions(candidate.version, current.version) > 0 ? candidate : current,
  );
}

/** Lookup explicito por metricId + version (qualquer status, para inspecao de lineage). */
export function lookupMetricVersion(
  definitions: readonly MetricDefinition[],
  id: string,
  version: string,
): MetricDefinition | undefined {
  return definitions.find((definition) => definition.id === id && definition.version === version);
}

export const DATA_SNAPSHOT_VERSIONING = 'NOT_ENABLED' as const;

/** Sem preservacao de data-snapshot por versao, nunca afirmar reproducao historica. */
export function canReproduceHistoricalValue(_metricId: string, _version: string): boolean {
  return false;
}

// ---------------------------------------------------------------- lineage

const LINEAGE_BY_ID: Record<string, MetricLineage> = {
  'service_orders.overdue_count': {
    readModel: 'AgingReadModelRepository / ServiceOrderListQuery / executive / alerts / observability (deadline-semantics)',
    domainOwner: 'Service Orders',
    source: 'so.service_orders + so.deadline_for(uuid) (janelas PLANNED/ACTIVE; status nao-terminal)',
  },
  'service_orders.approaching_due_count': {
    readModel: 'AgingReadModelRepository / executive-dashboard (deadline-semantics)',
    domainOwner: 'Service Orders',
    source: 'so.service_orders + so.deadline_for(uuid) + AGING_APPROACHING_DUE_DAYS',
  },
  'service_orders.awaiting_billing_count': {
    readModel: 'AgingReadModelRepository.countAwaitingBilling',
    domainOwner: 'Service Orders',
    source: 'so.service_orders x bil.billing_records (ausencia de PREPARED)',
  },
  'measurements.aging_count': {
    readModel: 'AgingReadModelRepository.countAgingMeasurements',
    domainOwner: 'Measurements',
    source: 'msr.measurements (SUBMITTED/UNDER_REVIEW + timestamps)',
  },
  'billing.awaiting_preparation_count': {
    readModel: 'AgingReadModelRepository.countFinancialAwaitingPreparation',
    domainOwner: 'Billing',
    source: 'so.service_orders x bil.billing_records (ausencia de PREPARED)',
  },
  'billing.prepared_count': {
    readModel: 'AgingReadModelRepository.countFinancialPrepared',
    domainOwner: 'Billing',
    source: 'bil.billing_records (PREPARED) x bil.billing_documents (sem FINALIZED)',
  },
  'billing.prepared_amount': {
    readModel: 'AgingReadModelRepository.countFinancialPrepared',
    domainOwner: 'Billing',
    source: 'bil.billing_records.total_amount (PREPARED, sem FINALIZED)',
  },
  'receivables.awaiting_payment_count': {
    readModel: 'buildReceivablePositionsSql / buildAwaitingReceivableAggregateSql (FIN-SEM-001)',
    domainOwner: 'Finance',
    source: 'fin.receivables (ACTIVE) + fin.settlements (POSTED)',
  },
  'receivables.awaiting_payment_amount': {
    readModel: 'buildAwaitingReceivableAggregateSql (FIN-SEM-001)',
    domainOwner: 'Finance',
    source: 'fin.receivables (ACTIVE) + fin.settlements (POSTED)',
  },
  'receivables.overdue_count': {
    readModel: 'buildOverdueReceivableAggregateSql / buckets (FIN-SEM-001)',
    domainOwner: 'Finance',
    source: 'fin.receivables (ACTIVE) + fin.settlements (POSTED)',
  },
  'receivables.overdue_amount': {
    readModel: 'buildOverdueReceivableAggregateSql (FIN-SEM-001)',
    domainOwner: 'Finance',
    source: 'fin.receivables (ACTIVE) + fin.settlements (POSTED)',
  },
  'productivity.completed_count': {
    readModel: 'ProductivityReadModelRepository (productivity-summary.ts)',
    domainOwner: 'Service Orders / Productivity',
    source: 'so.service_orders (COMPLETED + completed_at no periodo)',
  },
  'productivity.on_time_rate': {
    readModel: 'ProductivityReadModelRepository (productivity-summary.ts, RateMetric)',
    domainOwner: 'Service Orders / Productivity',
    source: 'so.service_orders (completed_at) x so.deadline_for(uuid)',
  },
  'productivity.avg_cycle_hours': {
    readModel: 'ProductivityReadModelRepository (productivity-summary.ts, DurationMetric)',
    domainOwner: 'Service Orders / Productivity',
    source: 'so.service_orders (created_at x completed_at)',
  },
  'productivity.rework_rate': {
    readModel: 'ProductivityReadModelRepository (productivity-summary.ts, RateMetric)',
    domainOwner: 'Measurements / Productivity',
    source: 'msr.measurements (REJECTED x submetidas no periodo)',
  },
};

export function lineageFor(definition: MetricDefinition): MetricLineage | undefined {
  return LINEAGE_BY_ID[definition.id];
}

/** Valida versoes + lineage do catalogo. */
export function validateVersionedCatalog(
  definitions: readonly MetricDefinition[] = SEMANTIC_METRIC_CATALOG,
  lineage: Record<string, MetricLineage> = LINEAGE_BY_ID,
): string[] {
  const issues: string[] = [];
  const byIdVersion = new Set<string>();
  const currentConfirmed = definitions.filter(isUsableMetric);

  for (const definition of definitions) {
    const key = `${definition.id}@${definition.version}`;
    if (byIdVersion.has(key)) {
      issues.push(`DUPLICATE_METRIC_VERSION ${key}`);
    }
    byIdVersion.add(key);
    if (!/^\d+(\.\d+){1,2}$/.test(definition.version)) {
      issues.push(`INVALID_VERSION_FORMAT ${key}`);
    }
  }

  for (const metric of currentConfirmed) {
    const entry = lineage[metric.id];
    if (!entry || !entry.readModel || !entry.domainOwner || !entry.source) {
      issues.push(`CONFIRMED_WITHOUT_LINEAGE ${metric.id}`);
      continue;
    }
    for (const dependency of entry.dependsOn ?? []) {
      if (!resolveCurrentMetric(definitions, dependency)) {
        issues.push(`LINEAGE_DEPENDENCY_MISSING ${metric.id}->${dependency}`);
      }
    }
  }

  // ciclos em dependsOn entre metricas CONFIRMED atuais
  const graph = new Map<string, string[]>();
  for (const metric of currentConfirmed) {
    const entry = lineage[metric.id];
    graph.set(metric.id, (entry?.dependsOn ?? []).filter((dependency) => resolveCurrentMetric(definitions, dependency)));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      issues.push(`LINEAGE_CIRCULAR_DEPENDENCY ${cycle.join(' -> ')}`);
      return;
    }
    if (visited.has(id)) {
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      visit(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) {
    visit(id);
  }

  return issues;
}

export function assertVersionedCatalogValid(definitions: readonly MetricDefinition[] = SEMANTIC_METRIC_CATALOG): void {
  const issues = validateVersionedCatalog(definitions);
  if (issues.length > 0) {
    throw new Error(`METRIC_VERSIONING_INVALID: ${issues.join('; ')}`);
  }
}

export function countCurrentConfirmedMetrics(definitions: readonly MetricDefinition[] = SEMANTIC_METRIC_CATALOG): number {
  return new Set(currentConfirmedIds(definitions)).size;
}

export function currentConfirmedIds(definitions: readonly MetricDefinition[] = SEMANTIC_METRIC_CATALOG): string[] {
  const current = new Map<string, MetricDefinition>();
  for (const definition of definitions) {
    if (!isUsableMetric(definition)) {
      continue;
    }
    const existing = current.get(definition.id);
    if (!existing || compareSemanticVersions(definition.version, existing.version) > 0) {
      current.set(definition.id, definition);
    }
  }
  return Array.from(current.keys());
}

// ---------------------------------------------------------------- imutabilidade publicada

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

// Versoes publicadas imutaveis: freeze das definicoes do catalogo oficial.
for (const definition of SEMANTIC_METRIC_CATALOG) {
  deepFreeze(definition);
}
for (const lineage of Object.values(LINEAGE_BY_ID)) {
  deepFreeze(lineage);
}
