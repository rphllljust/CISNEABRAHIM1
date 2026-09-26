/**
 * SEMANTIC METRIC CATALOG (CISNE BI) — SMC-001
 *
 * Catalogo semantico oficial das metricas do BI interno. DESCREVE a metrica
 * (conceito, fonte, engine, policies); NAO vira segundo motor de calculo e
 * NAO copia SQL. Cada definition aponta para a fonte canonica existente:
 *   deadline/overdue de OS   -> so.deadline_for(uuid) (migration 0076)
 *   aging financeiro          -> FIN-SEM-001 (receivable-aging-sql.ts)
 *   aging operacional         -> AgingReadModelRepository
 *   productivity              -> ProductivityReadModelRepository / productivity-summary
 *
 * Status:
 *   CONFIRMED - fonte + engine comprovados (testes com PostgreSQL real e/ou unit).
 *   CANDIDATE - semantica presente, fonte/linhagem pendente de prova.
 *   BLOCKED   - definicao rejeitada/legada (registrada para nao ressurgir).
 *
 * Regras:
 *   - Frontend nunca define formula/numerador/denominador/bucket/threshold/timezone.
 *   - Taxas declaram numerador/denominador resolvidos no backend.
 *   - NO_DATA != 0; available=false != value=0.
 *   - requiredCapability/scopePolicy correspondem ao dominio real do dado.
 */

export const METRIC_STATUSES = ['CONFIRMED', 'CANDIDATE', 'BLOCKED'] as const;
export type MetricStatus = (typeof METRIC_STATUSES)[number];

/** Capacidades oficiais (contrato Reports/AuthZ) usadas pelo catalogo. */
export const CATALOG_CAPABILITIES = [
  'service-orders:service-order:list',
  'billing:billing-record:read',
  'measurements:measurement:read',
  'resources:asset:list',
  'fiscal:document:read',
  'accounting:journal:read',
] as const;
export type CatalogCapability = (typeof CATALOG_CAPABILITIES)[number];

export const SCOPE_POLICIES = ['GLOBAL', 'UNIT_SCOPED'] as const;
export type ScopePolicy = (typeof SCOPE_POLICIES)[number];

export const NULL_POLICIES = [
  'NO_DATA_NULL', // sem populacao elegivel => totalAmount null (nunca '0' fabricado)
  'ZERO_REAL', // zero e valor legitimo de contagem apos query bem-sucedida
] as const;
export type NullPolicy = (typeof NULL_POLICIES)[number];

export type MetricDomain =
  | 'service-orders'
  | 'measurements'
  | 'billing'
  | 'finance-receivables'
  | 'productivity'
  | 'fiscal'
  | 'accounting';

export type MetricValueType = 'integer' | 'decimal(18,4)' | 'rate' | 'hours';

export type MetricDefinition = {
  id: string;
  version: string;
  /** Quando nova versao semantica e publicada, versoes anteriores apontam para ela (imutaveis). */
  supersededByVersion?: string;
  concept: string;
  domain: MetricDomain;
  grain: string;
  unit: string;
  valueType: MetricValueType;
  /** Fonte canonica (ponteiro). Ex.: 'so.deadline_for(uuid)'; 'FIN-SEM-001 receivable-aging-sql.ts'. */
  source: string;
  /** Engine/read model que calcula (ponteiro, sem copiar SQL). */
  engine: string;
  /** Numerador/denominador SOMENTE para taxas (definidos no backend). */
  numerator?: string;
  denominator?: string;
  dimensions: string[];
  allowedFilters: string[];
  timezonePolicy: string;
  nullPolicy: NullPolicy;
  availabilityPolicy: string;
  freshnessPolicy: string;
  requiredCapability: CatalogCapability;
  scopePolicy: ScopePolicy;
  status: MetricStatus;
  /** Obrigatorio quando status = BLOCKED (motivo do bloqueio). */
  blockedReason?: string;
};

export class SemanticMetricCatalogError extends Error {
  constructor(readonly reason: string, readonly issues: string[]) {
    super(reason);
    this.name = 'SemanticMetricCatalogError';
  }
}

/** Valida o catalogo (estrutura interna): ids unicos, versao unica por id, fontes etc. */
export function validateMetricDefinitions(definitions: readonly MetricDefinition[]): string[] {
  const issues: string[] = [];
  const seenIds = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const id = definition.id;
    if (!id || id.trim().length === 0) {
      issues.push('METRIC_ID_REQUIRED');
      continue;
    }
    if (!definition.version || definition.version.trim().length === 0) {
      issues.push(`SOURCE_OR_VERSION_MISSING ${id}`);
    }
    if (!definition.source || definition.source.trim().length === 0) {
      issues.push(`SOURCE_MISSING ${id}`);
    }
    if (!definition.engine || definition.engine.trim().length === 0) {
      issues.push(`ENGINE_MISSING ${id}`);
    }
    if (!(CATALOG_CAPABILITIES as readonly string[]).includes(definition.requiredCapability)) {
      issues.push(`INVALID_CAPABILITY ${id}`);
    }
    if (!(SCOPE_POLICIES as readonly string[]).includes(definition.scopePolicy)) {
      issues.push(`INVALID_SCOPE ${id}`);
    }
    if (definition.valueType === 'rate' && (!definition.numerator || !definition.denominator)) {
      issues.push(`RATE_NUMERATOR_DENOMINATOR_REQUIRED ${id}`);
    }
    if (definition.status === 'BLOCKED' && !definition.blockedReason) {
      issues.push(`BLOCKED_REASON_REQUIRED ${id}`);
    }
    if (definition.status === 'CONFIRMED' && !definition.source) {
      issues.push(`CONFIRMED_WITHOUT_SOURCE ${id}`);
    }
    if (!seenIds.has(id)) {
      seenIds.set(id, new Set());
    }
    if (seenIds.get(id)!.has(definition.version)) {
      issues.push(`DUPLICATE_METRIC_VERSION ${id}@${definition.version}`);
    }
    seenIds.get(id)!.add(definition.version);
  }
  return issues;
}

/** Metricas do catalogo oficial (somente com fonte/semantica comprovadas). */
export const SEMANTIC_METRIC_CATALOG: readonly MetricDefinition[] = [
  // ---------- service-orders (deadline kernel so.deadline_for) ----------
  {
    id: 'service_orders.overdue_count',
    version: '1.0.0',
    concept: 'Ordens de servico vencidas (deadline <= agora, status nao-terminal)',
    domain: 'service-orders',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'so.deadline_for(uuid) (migration 0076)',
    engine: 'AgingReadModelRepository / executive-dashboard / alerts / reports / observability (deadline-semantics.ts)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'clientId', 'status'],
    timezonePolicy: 'businessTimezone (America/Porto_Velho default); deadline e instante absoluto',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'service_orders.approaching_due_count',
    version: '1.0.0',
    concept: 'Ordens de servico com vencimento proximo (deadline em AGING_APPROACHING_DUE_DAYS)',
    domain: 'service-orders',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'so.deadline_for(uuid) + AGING_APPROACHING_DUE_DAYS (env)',
    engine: 'AgingReadModelRepository / executive-dashboard (deadline-semantics.ts)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'businessTimezone; threshold configuravel por env, nunca hardcoded',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'service_orders.awaiting_billing_count',
    version: '1.0.0',
    concept: 'Ordens concluidas sem billing record PREPARED',
    domain: 'service-orders',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_service_orders + rpt.read_billing_records (aging operacional)',
    engine: 'AgingReadModelRepository.countAwaitingBilling',
    dimensions: ['unit'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'n/a (idade em dias por completed_at)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- measurements ----------
  {
    id: 'measurements.aging_count',
    version: '1.0.0',
    concept: 'Medicoes em aging operacional (SUBMITTED/UNDER_REVIEW)',
    domain: 'measurements',
    grain: 'measurement',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_measurements (status + submitted/review timestamps)',
    engine: 'AgingReadModelRepository.countAgingMeasurements',
    dimensions: ['unit'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'n/a (idade por timestamp)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_MEASUREMENT_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'measurements:measurement:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- billing (aging operacional do pipeline) ----------
  {
    id: 'billing.awaiting_preparation_count',
    version: '1.0.0',
    concept: 'OS concluidas sem billing record PREPARED (a preparar)',
    domain: 'billing',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_service_orders + rpt.read_billing_records',
    engine: 'AgingReadModelRepository.countFinancialAwaitingPreparation',
    dimensions: ['unit'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'n/a',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'billing.prepared_count',
    version: '1.0.0',
    concept: 'Billing records PREPARED sem documento FINALIZED',
    domain: 'billing',
    grain: 'billing record',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_billing_records + rpt.read_billing_documents',
    engine: 'AgingReadModelRepository.countFinancialPrepared',
    dimensions: ['unit'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'n/a',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'billing.prepared_amount',
    version: '1.0.0',
    concept: 'Valor total de billing records PREPARED sem documento FINALIZED',
    domain: 'billing',
    grain: 'billing record',
    unit: 'BRL',
    valueType: 'decimal(18,4)',
    source: 'rpt.read_billing_records.total_amount',
    engine: 'AgingReadModelRepository.countFinancialPrepared',
    dimensions: ['unit'],
    allowedFilters: ['unitId'],
    timezonePolicy: 'n/a',
    nullPolicy: 'NO_DATA_NULL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- aging financeiro (FIN-SEM-001) ----------
  {
    id: 'receivables.awaiting_payment_count',
    version: '1.0.0',
    concept: 'Recebiveis a vencer com saldo residual (OPEN/PARTIALLY_PAID)',
    domain: 'finance-receivables',
    grain: 'receivable',
    unit: 'count',
    valueType: 'integer',
    source: 'FIN-SEM-001 (fin.receivables + fin.settlements POSTED)',
    engine: 'buildReceivablePositionsSql / buildAwaitingReceivableAggregateSql (receivable-aging-sql.ts)',
    dimensions: ['unit', 'client'],
    allowedFilters: [],
    timezonePolicy: 'due_date civil; businessTimezone p/ data de referencia',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'receivables.awaiting_payment_amount',
    version: '1.0.0',
    concept: 'Saldo residual total de recebiveis a vencer (principal - settlements POSTED)',
    domain: 'finance-receivables',
    grain: 'receivable',
    unit: 'BRL',
    valueType: 'decimal(18,4)',
    source: 'FIN-SEM-001 (fin.receivables + fin.settlements POSTED)',
    engine: 'buildAwaitingReceivableAggregateSql (receivable-aging-sql.ts)',
    dimensions: ['unit', 'client'],
    allowedFilters: [],
    timezonePolicy: 'due_date civil; businessTimezone p/ data de referencia',
    nullPolicy: 'NO_DATA_NULL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'receivables.overdue_count',
    version: '1.0.0',
    concept: 'Recebiveis vencidos com saldo residual (due_date anterior a referencia)',
    domain: 'finance-receivables',
    grain: 'receivable',
    unit: 'count',
    valueType: 'integer',
    source: 'FIN-SEM-001 (fin.receivables + fin.settlements POSTED)',
    engine: 'buildOverdueReceivableAggregateSql / buckets (receivable-aging-sql.ts)',
    dimensions: ['unit', 'client', 'daysOverdue'],
    allowedFilters: [],
    timezonePolicy: 'due_date civil; businessTimezone; buckets so via AGING_BUCKET_BANDS (DDP-024)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'receivables.overdue_amount',
    version: '1.0.0',
    concept: 'Saldo residual total de recebiveis vencidos',
    domain: 'finance-receivables',
    grain: 'receivable',
    unit: 'BRL',
    valueType: 'decimal(18,4)',
    source: 'FIN-SEM-001 (fin.receivables + fin.settlements POSTED)',
    engine: 'buildOverdueReceivableAggregateSql (receivable-aging-sql.ts)',
    dimensions: ['unit', 'client'],
    allowedFilters: [],
    timezonePolicy: 'due_date civil; businessTimezone',
    nullPolicy: 'NO_DATA_NULL',
    availabilityPolicy: 'AVAILABLE_WITH_BILLING_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- productivity ----------
  {
    id: 'productivity.completed_count',
    version: '1.0.0',
    concept: 'Ordens de servico concluidas no periodo',
    domain: 'productivity',
    grain: 'service order',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_service_orders (status COMPLETED + completed_at no periodo)',
    engine: 'ProductivityReadModelRepository (productivity-summary.ts)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'from', 'to', 'period'],
    timezonePolicy: 'businessTimezone (resolucao de periodo)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'productivity.on_time_rate',
    version: '1.0.0',
    concept: 'Taxa de conclusao dentro do prazo (numerador/denominador no backend)',
    domain: 'productivity',
    grain: 'service order',
    unit: 'rate',
    valueType: 'rate',
    source: 'so.deadline_for(uuid) x completed_at',
    engine: 'ProductivityReadModelRepository (productivity-summary.ts, RateMetric)',
    numerator: 'OS concluidas antes/ate o deadline',
    denominator: 'OS concluidas elegiveis no periodo',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'from', 'to', 'period'],
    timezonePolicy: 'businessTimezone',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'productivity.avg_cycle_hours',
    version: '1.0.0',
    concept: 'Tempo medio de ciclo por OS concluida',
    domain: 'productivity',
    grain: 'service order',
    unit: 'hours',
    valueType: 'hours',
    source: 'rpt.read_service_orders (created_at x completed_at)',
    engine: 'ProductivityReadModelRepository (productivity-summary.ts, DurationMetric)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'from', 'to', 'period'],
    timezonePolicy: 'businessTimezone',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_SERVICE_ORDER_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'service-orders:service-order:list',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'productivity.rework_rate',
    version: '1.0.0',
    concept: 'Taxa de retrabalho por rejeicao de medicao (numerador/denominador no backend)',
    domain: 'productivity',
    grain: 'measurement',
    unit: 'rate',
    valueType: 'rate',
    source: 'rpt.read_measurements (REJECTED x submetidas)',
    engine: 'ProductivityReadModelRepository (productivity-summary.ts, RateMetric)',
    numerator: 'medicoes REJECTED',
    denominator: 'medicoes elegiveis no periodo',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'from', 'to', 'period'],
    timezonePolicy: 'businessTimezone',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_MEASUREMENT_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'measurements:measurement:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- fiscal (conformidade fiscal) ----------
  {
    id: 'fiscal.documents_pending_transmission_count',
    version: '1.0.0',
    concept: 'Documentos fiscais emitidos no periodo ainda sem autorizacao (nem cancelados)',
    domain: 'fiscal',
    grain: 'fiscal document',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_fiscal_documents (status NOT IN AUTHORIZED/CANCELLED por issued_on)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'businessTimezone (resolucao de periodo); issued_on e data civil',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_FISCAL_DOCUMENT_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'fiscal:document:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'fiscal.tax_obligations_open_count',
    version: '1.0.0',
    concept: 'Obrigacoes tributarias abertas com competencia dentro do periodo',
    domain: 'fiscal',
    grain: 'tax obligation',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_tax_obligations (status OPEN por period_key)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit', 'time', 'taxComponent'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'competencia e chave civil AAAA-MM (sem conversao de instante)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_FISCAL_DOCUMENT_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'fiscal:document:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'fiscal.tax_obligations_open_amount',
    version: '1.0.0',
    concept: 'Valor total das obrigacoes tributarias abertas no periodo',
    domain: 'fiscal',
    grain: 'tax obligation',
    unit: 'BRL',
    valueType: 'decimal(18,4)',
    source: 'rpt.read_tax_obligations.amount (status OPEN por period_key)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit', 'time', 'taxComponent'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'competencia e chave civil AAAA-MM',
    nullPolicy: 'NO_DATA_NULL',
    availabilityPolicy: 'AVAILABLE_WITH_FISCAL_DOCUMENT_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'fiscal:document:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  // ---------- accounting (conformidade contabil) ----------
  {
    id: 'accounting.periods_open_count',
    version: '1.0.0',
    concept: 'Periodos contabeis abertos na unidade',
    domain: 'accounting',
    grain: 'accounting period',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_accounting_periods (status OPEN)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'n/a (contagem por estado persistido)',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_ACCOUNTING_JOURNAL_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'accounting:journal:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  {
    id: 'accounting.journal_entries_posted_count',
    version: '1.0.0',
    concept: 'Lancamentos contabeis efetivados (POSTED) no periodo',
    domain: 'accounting',
    grain: 'journal entry',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_journal_entries (status POSTED por occurred_on)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'businessTimezone (resolucao de periodo); occurred_on e data civil',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_ACCOUNTING_JOURNAL_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'accounting:journal:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },

  {
    id: 'accounting.journal_entries_draft_count',
    version: '1.0.0',
    concept: 'Lancamentos contabeis ainda em rascunho no periodo (nao efetivados)',
    domain: 'accounting',
    grain: 'journal entry',
    unit: 'count',
    valueType: 'integer',
    source: 'rpt.read_journal_entries (status DRAFT por occurred_on)',
    engine: 'ComplianceReadModelRepository.summarize (analytics/compliance)',
    dimensions: ['unit', 'time'],
    allowedFilters: ['unitId', 'period', 'from', 'to'],
    timezonePolicy: 'businessTimezone (resolucao de periodo); occurred_on e data civil',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'AVAILABLE_WITH_ACCOUNTING_JOURNAL_GRANT',
    freshnessPolicy: 'request_time',
    requiredCapability: 'accounting:journal:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'CONFIRMED',
  },
  // ---------- legada/bloqueada ----------
  {
    id: 'receivables.overdue_count_by_finalized_billing_documents',
    version: '0.0.1',
    concept: '(LEGADO REJEITADO) recebiveis vencidos contados por billing_documents FINALIZED ignorando settlements',
    domain: 'finance-receivables',
    grain: 'billing document',
    unit: 'count',
    valueType: 'integer',
    source: 'bil.billing_documents FINALIZED (incorreto para aging de recebiveis)',
    engine: '(nenhum - definicao removida; superseded por FIN-SEM-001)',
    dimensions: ['unit'],
    allowedFilters: [],
    timezonePolicy: 'n/a',
    nullPolicy: 'ZERO_REAL',
    availabilityPolicy: 'NEVER_AVAILABLE',
    freshnessPolicy: 'n/a',
    requiredCapability: 'billing:billing-record:read',
    scopePolicy: 'UNIT_SCOPED',
    status: 'BLOCKED',
    blockedReason: 'Contagem de billing_documents FINALIZED nao representa saldo de recebivel (BI audit); FIN-SEM-001 e a fonte unica.',
  },
];

/** Lookup por id (retorna a versao mais recente declarada). */
export function lookupSemanticMetric(id: string): MetricDefinition | undefined {
  return SEMANTIC_METRIC_CATALOG.find((metric) => metric.id === id);
}

/** Catalogo valido (sem issues estruturais). Lanca erro com a lista completa se invalido. */
export function assertSemanticMetricCatalogValid(catalog: readonly MetricDefinition[] = SEMANTIC_METRIC_CATALOG): void {
  const issues = validateMetricDefinitions(catalog);
  if (issues.length > 0) {
    throw new SemanticMetricCatalogError('SEMANTIC_METRIC_CATALOG_INVALID', issues);
  }
}

export const CONFIRMED_METRIC_COUNT = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CONFIRMED').length;
export const CANDIDATE_METRIC_COUNT = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'CANDIDATE').length;
export const BLOCKED_METRIC_COUNT = SEMANTIC_METRIC_CATALOG.filter((metric) => metric.status === 'BLOCKED').length;
