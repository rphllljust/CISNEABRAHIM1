export const REPORT_TYPES = {
  ServiceOrdersByPeriod: 'SERVICE_ORDERS_BY_PERIOD',
  ServiceOrdersByClient: 'SERVICE_ORDERS_BY_CLIENT',
  ServiceOrdersByService: 'SERVICE_ORDERS_BY_SERVICE',
  ServiceOrdersOverdue: 'SERVICE_ORDERS_OVERDUE',
  OperationalProductivity: 'OPERATIONAL_PRODUCTIVITY',
  AssetUtilization: 'ASSET_UTILIZATION',
  Measurements: 'MEASUREMENTS',
  FinancialAging: 'FINANCIAL_AGING',
  Billing: 'BILLING',
  Receipts: 'RECEIPTS',
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

const REPORT_TYPE_SET = new Set<string>(Object.values(REPORT_TYPES));

export function isReportType(value: string): value is ReportType {
  return REPORT_TYPE_SET.has(value);
}

export const REPORT_FORMATS = {
  Csv: 'CSV',
  Xlsx: 'XLSX',
  Pdf: 'PDF',
} as const;

export type ReportFormat = (typeof REPORT_FORMATS)[keyof typeof REPORT_FORMATS];

export type ReportFilters = {
  period?: string;
  from?: string;
  to?: string;
  unitId?: string;
  clientId?: string;
  serviceDefinitionId?: string;
  status?: string;
};

export type ReportFilterKey = keyof ReportFilters;

export const REPORT_FILTER_KEYS: ReportFilterKey[] = [
  'period',
  'from',
  'to',
  'unitId',
  'clientId',
  'serviceDefinitionId',
  'status',
];

export type ReportContract = {
  name: string;
  filters: ReportFilters;
  columns: string[];
  sort: { field: string; direction: 'ASC' | 'DESC' };
  timezone: string;
  generatedAt: string | null;
  actor: { identityId: string; sessionId: string };
  scope: { summary: string };
};

export type ReportColumnDef = {
  key: string;
  header: string;
};

export const REPORT_DEFINITIONS: Record<
  ReportType,
  {
    label: string;
    columns: ReportColumnDef[];
    defaultSort: { field: string; direction: 'ASC' | 'DESC' };
    sensitive: boolean;
  }
> = {
  [REPORT_TYPES.ServiceOrdersByPeriod]: {
    label: 'OS por período',
    columns: [
      { key: 'orderNumber', header: 'Número OS' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'clientName', header: 'Cliente' },
      { key: 'status', header: 'Status' },
      { key: 'createdAt', header: 'Criada em' },
      { key: 'completedAt', header: 'Concluída em' },
    ],
    defaultSort: { field: 'createdAt', direction: 'DESC' },
    sensitive: false,
  },
  [REPORT_TYPES.ServiceOrdersByClient]: {
    label: 'OS por cliente',
    columns: [
      { key: 'clientName', header: 'Cliente' },
      { key: 'orderNumber', header: 'Número OS' },
      { key: 'status', header: 'Status' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'createdAt', header: 'Criada em' },
    ],
    defaultSort: { field: 'clientName', direction: 'ASC' },
    sensitive: false,
  },
  [REPORT_TYPES.ServiceOrdersByService]: {
    label: 'OS por serviço',
    columns: [
      { key: 'serviceCode', header: 'Serviço' },
      { key: 'orderNumber', header: 'Número OS' },
      { key: 'status', header: 'Status' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'createdAt', header: 'Criada em' },
    ],
    defaultSort: { field: 'serviceCode', direction: 'ASC' },
    sensitive: false,
  },
  [REPORT_TYPES.ServiceOrdersOverdue]: {
    label: 'OS vencidas',
    columns: [
      { key: 'orderNumber', header: 'Número OS' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'status', header: 'Status' },
      { key: 'deadline', header: 'Prazo' },
      { key: 'delayDays', header: 'Dias atraso' },
    ],
    defaultSort: { field: 'delayDays', direction: 'DESC' },
    sensitive: false,
  },
  [REPORT_TYPES.OperationalProductivity]: {
    label: 'Produtividade operacional',
    columns: [
      { key: 'metric', header: 'Métrica' },
      { key: 'value', header: 'Valor' },
      { key: 'denominator', header: 'Denominador' },
    ],
    defaultSort: { field: 'metric', direction: 'ASC' },
    sensitive: false,
  },
  [REPORT_TYPES.AssetUtilization]: {
    label: 'Utilização de ativos',
    columns: [
      { key: 'assetCode', header: 'Código ativo' },
      { key: 'assetName', header: 'Nome' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'allocationStatus', header: 'Alocação' },
      { key: 'serviceOrderNumber', header: 'OS' },
    ],
    defaultSort: { field: 'assetCode', direction: 'ASC' },
    sensitive: false,
  },
  [REPORT_TYPES.Measurements]: {
    label: 'Medições',
    columns: [
      { key: 'measurementId', header: 'ID medição' },
      { key: 'orderNumber', header: 'OS' },
      { key: 'status', header: 'Status' },
      { key: 'unitId', header: 'Unidade' },
      { key: 'submittedAt', header: 'Enviada em' },
    ],
    defaultSort: { field: 'submittedAt', direction: 'DESC' },
    sensitive: false,
  },
  [REPORT_TYPES.FinancialAging]: {
    label: 'Aging financeiro',
    columns: [
      { key: 'bucket', header: 'Faixa' },
      { key: 'count', header: 'Quantidade' },
      { key: 'amount', header: 'Valor' },
    ],
    defaultSort: { field: 'bucket', direction: 'ASC' },
    sensitive: true,
  },
  [REPORT_TYPES.Billing]: {
    label: 'Faturamentos',
    columns: [
      { key: 'billingRecordId', header: 'ID faturamento' },
      { key: 'orderNumber', header: 'OS' },
      { key: 'clientName', header: 'Cliente' },
      { key: 'status', header: 'Status' },
      { key: 'preparedAt', header: 'Preparado em' },
    ],
    defaultSort: { field: 'preparedAt', direction: 'DESC' },
    sensitive: true,
  },
  [REPORT_TYPES.Receipts]: {
    label: 'Recebimentos',
    columns: [
      { key: 'documentNumber', header: 'Documento' },
      { key: 'clientName', header: 'Cliente' },
      { key: 'status', header: 'Status' },
      { key: 'dueDate', header: 'Vencimento' },
      { key: 'amount', header: 'Valor' },
    ],
    defaultSort: { field: 'dueDate', direction: 'ASC' },
    sensitive: true,
  },
};

export const REPORT_POLICY = {
  previewLimit: 20,
  syncRowThreshold: 500,
  batchSize: 250,
  maxRows: 50_000,
} as const;

/**
 * REPORT FILTER CONTRACT (REPORT-FILTER-001):
 * por tipo, os filtros permitidos e a capability/resource exigida.
 * Permite rejeitar filtro inválido ANTES do SQL, alinhar grant por domínio
 * (Measurement -> measurement:measurement:read; Billing/Receipts/FinancialAging
 * -> billing:billing-record:read; recebíveis -> finance) e dar semântica ao
 * periodo (resolvido para from/to quando o tipo e temporal).
 */
export type ReportFilterPolicy = {
  allowedFilters: ReportFilterKey[];
  requiredCapability: string;
  scopeResource: string;
  temporal: boolean;
};

const REPORT_FILTER_POLICY: Record<ReportType, ReportFilterPolicy> = {
  SERVICE_ORDERS_BY_PERIOD: {
    allowedFilters: ['period', 'from', 'to', 'unitId', 'clientId', 'status'],
    requiredCapability: 'service-orders:service-order:list',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  SERVICE_ORDERS_BY_CLIENT: {
    allowedFilters: ['period', 'from', 'to', 'unitId', 'clientId', 'status'],
    requiredCapability: 'service-orders:service-order:list',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  SERVICE_ORDERS_BY_SERVICE: {
    allowedFilters: ['period', 'from', 'to', 'unitId', 'clientId', 'status'],
    requiredCapability: 'service-orders:service-order:list',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  SERVICE_ORDERS_OVERDUE: {
    allowedFilters: ['unitId', 'clientId', 'status'],
    requiredCapability: 'service-orders:service-order:list',
    scopeResource: 'service-orders:service-order',
    temporal: false,
  },
  OPERATIONAL_PRODUCTIVITY: {
    allowedFilters: ['period', 'from', 'to', 'unitId'],
    requiredCapability: 'service-orders:service-order:list',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  ASSET_UTILIZATION: {
    allowedFilters: ['unitId'],
    requiredCapability: 'resources:asset:list',
    scopeResource: 'resources:asset',
    temporal: false,
  },
  MEASUREMENTS: {
    allowedFilters: ['period', 'from', 'to', 'unitId', 'status'],
    requiredCapability: 'measurements:measurement:read',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  FINANCIAL_AGING: {
    allowedFilters: [],
    requiredCapability: 'billing:billing-record:read',
    scopeResource: 'service-orders:service-order',
    temporal: false,
  },
  BILLING: {
    allowedFilters: ['period', 'from', 'to', 'unitId', 'status'],
    requiredCapability: 'billing:billing-record:read',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
  RECEIPTS: {
    allowedFilters: ['period', 'from', 'to', 'unitId'],
    requiredCapability: 'billing:billing-record:read',
    scopeResource: 'service-orders:service-order',
    temporal: true,
  },
};

export function reportFilterPolicy(type: ReportType): ReportFilterPolicy {
  return REPORT_FILTER_POLICY[type];
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_PRESETS = new Set(['today', 'week', 'month', 'quarter', 'year']);

export class ReportFilterValidationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ReportFilterValidationError';
  }
}

function rangeForPeriod(preset: string): { from: string; to: string } {
  const now = new Date();
  const dayMs = 86_400_000;
  let fromMs = now.getTime();
  const toMs = now.getTime();
  if (preset === 'today') {
    fromMs = toMs;
  } else if (preset === 'week') {
    const start = new Date(now);
    const dow = (start.getUTCDay() + 6) % 7; // segunda = 0
    start.setUTCHours(0, 0, 0, 0);
    fromMs = start.getTime() - dow * dayMs;
  } else if (preset === 'month') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    fromMs = start.getTime();
  } else if (preset === 'quarter') {
    const q = Math.floor(now.getUTCMonth() / 3);
    fromMs = Date.UTC(now.getUTCFullYear(), q * 3, 1);
  } else if (preset === 'year') {
    fromMs = Date.UTC(now.getUTCFullYear(), 0, 1);
  }
  const from = new Date(fromMs);
  return {
    from: from.toISOString().slice(0, 10),
    to: new Date(Math.max(toMs, fromMs) + dayMs).toISOString().slice(0, 10),
  };
}

/**
 * Valida e normaliza os filtros ANTES do SQL (REPORT-FILTER-001):
 * - chave fora da allowlist do tipo => erro (ex.: FinancialAging rejeita tudo);
 * - from/to obrigatoriamente em par, ordem valida e formato ISO (YYYY-MM-DD) —
 *   valores com SQL/injecao sao rejeitados;
 * - periodo permitido em tipo temporal sem from/to => resolvido para from/to.
 */
export function validateAndResolveReportFilters(type: ReportType, raw: ReportFilters): ReportFilters {
  const policy = reportFilterPolicy(type);
  const allowed = new Set<string>(policy.allowedFilters);
  const out: ReportFilters = {};

  for (const key of REPORT_FILTER_KEYS) {
    const value = raw?.[key];
    if (value === undefined || value === '') {
      continue;
    }
    if (!allowed.has(key)) {
      throw new ReportFilterValidationError(`filter_not_allowed:${key}`);
    }
    out[key] = value;
  }

  if ((out.from !== undefined || out.to !== undefined) && (out.from === undefined || out.to === undefined)) {
    throw new ReportFilterValidationError('from_to_pair_required');
  }
  if (out.from !== undefined && out.to !== undefined) {
    if (!DATE_ONLY_RE.test(out.from) || !DATE_ONLY_RE.test(out.to)) {
      throw new ReportFilterValidationError('invalid_date_format');
    }
    if (out.from > out.to) {
      throw new ReportFilterValidationError('from_after_to');
    }
  }

  if (out.period !== undefined) {
    if (!policy.temporal) {
      throw new ReportFilterValidationError('filter_not_allowed:period');
    }
    if (out.from !== undefined) {
      delete out.period;
    } else if (PERIOD_PRESETS.has(out.period)) {
      const range = rangeForPeriod(out.period);
      out.from = range.from;
      out.to = range.to;
      delete out.period;
    } else {
      throw new ReportFilterValidationError('invalid_period');
    }
  }

  return out;
}
