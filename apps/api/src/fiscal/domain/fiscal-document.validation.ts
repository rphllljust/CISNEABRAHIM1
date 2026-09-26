import { assertCurrencyCode } from '../../platform/kernel/money-math';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  FISCAL_SOURCE_KINDS,
  FISCAL_STATUSES,
  assertItems,
  assertParties,
  assertSourceKind,
  assertTaxDetails,
  type FiscalItemDraft,
  type FiscalPartyDraft,
  type FiscalTaxDetailDraft,
} from './fiscal-document';

export class FiscalValidationError extends Error {
  constructor(readonly field: string) {
    super(field);
  }
}

export type CreateFiscalDocumentInput = {
  unitId: string;
  sourceKind: string;
  sourceId?: string;
  billingDocumentId?: string;
  /** Estabelecimento emissor (registry da própria empresa). Obrigatório na emissão nova. */
  establishmentId?: string;
  description: string;
  currencyCode: string;
  issuedOn: string;
  certificateRef?: string;
  idempotencyKey: string;
  parties: FiscalPartyDraft[];
  items: FiscalItemDraft[];
  taxDetails?: FiscalTaxDetailDraft[];
};

function requireNonEmpty(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new FiscalValidationError(field);
  }
  return trimmed;
}

function requireDate(value: string | undefined | null, field: string): string {
  const trimmed = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && !/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    throw new FiscalValidationError(field);
  }
  return trimmed.slice(0, 10);
}

export function validateCreateFiscalDocumentInput(
  input: CreateFiscalDocumentInput,
): CreateFiscalDocumentInput {
  const sourceKind = assertSourceKind(requireNonEmpty(input.sourceKind, 'sourceKind'));
  if (input.sourceId) {
    assertUuid(input.sourceId, 'sourceId');
  }
  if (input.billingDocumentId) {
    assertUuid(input.billingDocumentId, 'billingDocumentId');
  }
  if (input.establishmentId) {
    assertUuid(input.establishmentId, 'establishmentId');
  }
  const parties = input.parties ?? [];
  const items = input.items ?? [];
  const taxDetails = input.taxDetails ?? [];
  assertParties(parties, { requireIssuer: input.establishmentId ? false : true });
  assertItems(items);
  assertTaxDetails(taxDetails);
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    sourceKind,
    sourceId: input.sourceId,
    billingDocumentId: input.billingDocumentId,
    establishmentId: input.establishmentId,
    description: requireNonEmpty(input.description, 'description'),
    currencyCode: assertCurrencyCode(input.currencyCode),
    issuedOn: requireDate(input.issuedOn, 'issuedOn'),
    certificateRef: input.certificateRef?.trim() || undefined,
    idempotencyKey: requireNonEmpty(input.idempotencyKey, 'idempotencyKey'),
    parties,
    items,
    taxDetails,
  };
}

export function validateCancelInput(input: { rowVersion: number; reason: string }): {
  rowVersion: number;
  reason: string;
} {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new FiscalValidationError('rowVersion');
  }
  return { rowVersion: input.rowVersion, reason: requireNonEmpty(input.reason, 'reason') };
}

/** Whitelist de status aceitos no filtro de listagem (mesmo vocabulario do dominio). */
const FISCAL_STATUS_FILTERS = new Set<string>(Object.values(FISCAL_STATUSES));
const FISCAL_SOURCE_KIND_FILTERS = new Set<string>(Object.values(FISCAL_SOURCE_KINDS));

function optionalWhitelist(
  value: string | undefined | null,
  allowed: ReadonlySet<string>,
  field: string,
): string | undefined {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') {
    return undefined;
  }
  const normalized = trimmed.toUpperCase();
  if (!allowed.has(normalized)) {
    throw new FiscalValidationError(field);
  }
  return normalized;
}

export { optionalWhitelist as optionalFiscalWhitelist };

function optionalDateFilter(value: string | undefined | null, field: string): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : requireDate(trimmed, field);
}

export { optionalDateFilter as optionalFiscalDate };

export function requireFiscalPage(value: unknown, field: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 0) {
    throw new FiscalValidationError(field);
  }
  return numeric;
}

export function requireFiscalPageSize(value: unknown, field: string): number {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof numeric !== 'number' || !Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    throw new FiscalValidationError(field);
  }
  return numeric;
}

export type FiscalDocumentListQuery = {
  unitId: string;
  status?: string;
  sourceKind?: string;
  billingDocumentId?: string;
  issuedFrom?: string;
  issuedTo?: string;
  page: number;
  pageSize: number;
};

/**
 * Filtros de listagem de documentos fiscais. `unitId` e obrigatorio: a autorizacao de
 * listagem e resolvida por escopo de unidade (mesmo criterio das listas de contabilidade e
 * dos recursos), portanto a consulta nunca varre outra unidade por omissao.
 */
export function validateFiscalDocumentListQuery(
  input: Omit<FiscalDocumentListQuery, 'page' | 'pageSize'> & { page?: unknown; pageSize?: unknown },
): FiscalDocumentListQuery {
  const billingDocumentId = input.billingDocumentId?.trim() ?? '';
  if (billingDocumentId !== '') {
    assertUuid(billingDocumentId, 'billingDocumentId');
  }
  const issuedFrom = optionalDateFilter(input.issuedFrom, 'issuedFrom');
  const issuedTo = optionalDateFilter(input.issuedTo, 'issuedTo');
  if (issuedFrom && issuedTo && issuedFrom > issuedTo) {
    throw new FiscalValidationError('period');
  }
  return {
    unitId: requireNonEmpty(input.unitId, 'unitId'),
    status: optionalWhitelist(input.status, FISCAL_STATUS_FILTERS, 'status'),
    sourceKind: optionalWhitelist(input.sourceKind, FISCAL_SOURCE_KIND_FILTERS, 'sourceKind'),
    billingDocumentId: billingDocumentId === '' ? undefined : billingDocumentId,
    issuedFrom,
    issuedTo,
    page: requireFiscalPage(input.page, 'page'),
    pageSize: requireFiscalPageSize(input.pageSize, 'pageSize'),
  };
}
