import { isContractStatus } from '../domain/contract';
import {
  isContractListDirection,
  isContractListSort,
  parseContractAdvancedFilter,
} from '../repositories/contract-list-sql';
import type { ContractListQuery } from '../services/contracts-access.service';
import type {
  CloseContractInput,
  CreateContractInput,
  LinkContractDocumentInput,
  ContractItemInput,
  UpdateContractDraftInput,
} from '../domain/contract.validation';
import {
  assertRecordBody,
  parseCommercialEntityListQuery,
  parseLenientRowVersionBody,
  parseLinkDocumentInput,
  parseOptionalStringField,
  parseRequiredStringField,
} from '../../infrastructure/http/contracts';
import { assertNoPrivilegedFields } from '../../security/domain/forbidden-payload-fields';

function parseItems(raw: unknown): ContractItemInput[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error('items invalid');
    }
    const record = item as Record<string, unknown>;
    return {
      lineNumber: Number(record['lineNumber'] ?? index + 1),
      description: parseRequiredStringField(record, 'description'),
      serviceDefinitionId: parseOptionalStringField(record, 'serviceDefinitionId'),
      serviceDefinitionVersionId: parseOptionalStringField(record, 'serviceDefinitionVersionId'),
      quantity: parseOptionalStringField(record, 'quantity'),
      unitCode: parseOptionalStringField(record, 'unitCode'),
      unitPrice: parseOptionalStringField(record, 'unitPrice'),
      lineTotal: parseOptionalStringField(record, 'lineTotal'),
    };
  });
}

function parseCommercialTerms(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

export function parseCreateContractInput(body: unknown): CreateContractInput {
  const record = assertRecordBody(body);
  assertNoPrivilegedFields(record);
  return {
    clientId: parseRequiredStringField(record, 'clientId'),
    unitId: parseRequiredStringField(record, 'unitId'),
    contractNumber: parseRequiredStringField(record, 'contractNumber'),
    title: parseRequiredStringField(record, 'title'),
    scopeDescription: parseOptionalStringField(record, 'scopeDescription'),
    validFrom: parseRequiredStringField(record, 'validFrom'),
    validTo: parseOptionalStringField(record, 'validTo'),
    currencyCode: parseOptionalStringField(record, 'currencyCode'),
    paymentTerms: parseOptionalStringField(record, 'paymentTerms'),
    paymentMethod: parseOptionalStringField(record, 'paymentMethod'),
    commercialTerms: parseCommercialTerms(record['commercialTerms']),
    items: parseItems(record['items']),
  };
}

export function parseUpdateContractDraftInput(body: unknown): UpdateContractDraftInput {
  const record = assertRecordBody(body);
  assertNoPrivilegedFields(record, { allowVersion: true, allowRowVersion: true });
  return {
    rowVersion: Number(record['rowVersion']),
    contractNumber: parseOptionalStringField(record, 'contractNumber'),
    title: parseOptionalStringField(record, 'title'),
    scopeDescription:
      record['scopeDescription'] === null
        ? null
        : parseOptionalStringField(record, 'scopeDescription'),
    validFrom: parseOptionalStringField(record, 'validFrom'),
    validTo: record['validTo'] === null ? null : parseOptionalStringField(record, 'validTo'),
    currencyCode: parseOptionalStringField(record, 'currencyCode'),
    paymentTerms:
      record['paymentTerms'] === null ? null : parseOptionalStringField(record, 'paymentTerms'),
    paymentMethod:
      record['paymentMethod'] === null ? null : parseOptionalStringField(record, 'paymentMethod'),
    commercialTerms: parseCommercialTerms(record['commercialTerms']),
    items: parseItems(record['items']),
  };
}

export function parseRowVersionBody(body: unknown): { rowVersion: number } {
  return parseLenientRowVersionBody(body);
}

export function parseCloseContractInput(body: unknown): CloseContractInput {
  const record = assertRecordBody(body);
  return {
    rowVersion: Number(record['rowVersion']),
    closureReason: parseOptionalStringField(record, 'closureReason'),
  };
}

export function parseLinkContractDocumentInput(body: unknown): LinkContractDocumentInput {
  return parseLinkDocumentInput(body);
}

export function parseListContractsQuery(query: Record<string, unknown>): ContractListQuery {
  const base = parseCommercialEntityListQuery(query);
  const status = typeof query['status'] === 'string' ? query['status'] : undefined;
  if (status && !isContractStatus(status)) {
    throw new Error('status invalid');
  }
  const sort = typeof query['sort'] === 'string' ? query['sort'] : undefined;
  const direction = typeof query['direction'] === 'string' ? query['direction'] : undefined;
  if (sort !== undefined && !isContractListSort(sort)) {
    throw new Error('sort invalid');
  }
  if (direction !== undefined && !isContractListDirection(direction)) {
    throw new Error('direction invalid');
  }
  return {
    ...base,
    status,
    currencyCode: typeof query['currencyCode'] === 'string' ? query['currencyCode'] : undefined,
    effectiveFrom: typeof query['effectiveFrom'] === 'string' ? query['effectiveFrom'] : undefined,
    effectiveTo: typeof query['effectiveTo'] === 'string' ? query['effectiveTo'] : undefined,
    search: typeof query['q'] === 'string' ? query['q'] : undefined,
    advanced: parseContractAdvancedFilter(query['filters']),
    sort: sort && isContractListSort(sort) ? sort : undefined,
    direction: direction && isContractListDirection(direction) ? direction : undefined,
  };
}
