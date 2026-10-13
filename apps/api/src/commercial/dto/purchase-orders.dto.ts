import { isPurchaseOrderPricingStructure, isPurchaseOrderStatus } from '../domain/purchase-order';
import {
  isPurchaseOrderListDirection,
  isPurchaseOrderListSort,
  parsePurchaseOrderAdvancedFilter,
} from '../repositories/purchase-order-list-sql';
import type { PurchaseOrderListQuery } from '../services/purchase-orders-access.service';
import type {
  CancelPurchaseOrderInput,
  CreatePurchaseOrderInput,
  LinkPurchaseOrderDocumentInput,
  PurchaseOrderBillingRuleInput,
  PurchaseOrderItemInput,
  UpdatePurchaseOrderDraftInput,
} from '../domain/purchase-order.validation';
import {
  assertRecordBody,
  parseCommercialEntityListQuery,
  parseLenientRowVersionBody,
  parseLinkDocumentInput,
  parseOptionalStringField,
  parseRequiredStringField,
} from '../../infrastructure/http/contracts';
import { assertNoPrivilegedFields } from '../../security/domain/forbidden-payload-fields';

function parseContact(raw: unknown): CreatePurchaseOrderInput['buyerContact'] {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return {
    name: parseOptionalStringField(record, 'name'),
    email: parseOptionalStringField(record, 'email'),
    phone: parseOptionalStringField(record, 'phone'),
  };
}

function parseLocation(raw: unknown): CreatePurchaseOrderInput['deliveryLocation'] {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  return {
    label: parseOptionalStringField(record, 'label'),
    street: parseOptionalStringField(record, 'street'),
    city: parseOptionalStringField(record, 'city'),
    state: parseOptionalStringField(record, 'state'),
    postalCode: parseOptionalStringField(record, 'postalCode'),
    countryCode: parseOptionalStringField(record, 'countryCode'),
  };
}

function parseItems(raw: unknown): PurchaseOrderItemInput[] | undefined {
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
      rcLineReference: parseOptionalStringField(record, 'rcLineReference'),
    };
  });
}

function parseBillingRules(raw: unknown): PurchaseOrderBillingRuleInput[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  return raw.map((rule) => {
    if (!rule || typeof rule !== 'object') {
      throw new Error('billingRules invalid');
    }
    const record = rule as Record<string, unknown>;
    return {
      ruleType: parseRequiredStringField(record, 'ruleType') as PurchaseOrderBillingRuleInput['ruleType'],
      ruleConfig:
        record['ruleConfig'] && typeof record['ruleConfig'] === 'object'
          ? (record['ruleConfig'] as Record<string, unknown>)
          : undefined,
    };
  });
}

export function parseCreatePurchaseOrderInput(body: unknown): CreatePurchaseOrderInput {
  const record = assertRecordBody(body);
  assertNoPrivilegedFields(record);
  const pricingStructure = parseRequiredStringField(record, 'pricingStructure');
  if (!isPurchaseOrderPricingStructure(pricingStructure)) {
    throw new Error('pricingStructure invalid');
  }
  return {
    clientId: parseRequiredStringField(record, 'clientId'),
    unitId: parseRequiredStringField(record, 'unitId'),
    poNumber: parseRequiredStringField(record, 'poNumber'),
    rcNumber: parseOptionalStringField(record, 'rcNumber'),
    issueDate: parseOptionalStringField(record, 'issueDate'),
    buyerContact: parseContact(record['buyerContact']),
    serviceManager: parseOptionalStringField(record, 'serviceManager'),
    deliveryLocation: parseLocation(record['deliveryLocation']),
    billingLocation: parseLocation(record['billingLocation']),
    currencyCode: parseOptionalStringField(record, 'currencyCode'),
    pricingStructure,
    totalAmount: parseOptionalStringField(record, 'totalAmount'),
    paymentTerms: parseOptionalStringField(record, 'paymentTerms'),
    paymentMethod: parseOptionalStringField(record, 'paymentMethod'),
    originalDocumentId: parseOptionalStringField(record, 'originalDocumentId'),
    items: parseItems(record['items']),
    billingRules: parseBillingRules(record['billingRules']),
  };
}

export function parseUpdatePurchaseOrderDraftInput(body: unknown): UpdatePurchaseOrderDraftInput {
  const record = assertRecordBody(body);
  assertNoPrivilegedFields(record, { allowVersion: true, allowRowVersion: true });
  const pricingStructure = parseOptionalStringField(record, 'pricingStructure');
  if (pricingStructure && !isPurchaseOrderPricingStructure(pricingStructure)) {
    throw new Error('pricingStructure invalid');
  }
  return {
    rowVersion: Number(record['rowVersion']),
    poNumber: parseOptionalStringField(record, 'poNumber'),
    rcNumber:
      record['rcNumber'] === null
        ? null
        : parseOptionalStringField(record, 'rcNumber'),
    issueDate:
      record['issueDate'] === null ? null : parseOptionalStringField(record, 'issueDate'),
    buyerContact: parseContact(record['buyerContact']),
    serviceManager:
      record['serviceManager'] === null
        ? null
        : parseOptionalStringField(record, 'serviceManager'),
    deliveryLocation: parseLocation(record['deliveryLocation']),
    billingLocation: parseLocation(record['billingLocation']),
    currencyCode: parseOptionalStringField(record, 'currencyCode'),
    pricingStructure:
      pricingStructure && isPurchaseOrderPricingStructure(pricingStructure)
        ? pricingStructure
        : undefined,
    totalAmount:
      record['totalAmount'] === null
        ? null
        : parseOptionalStringField(record, 'totalAmount'),
    paymentTerms:
      record['paymentTerms'] === null ? null : parseOptionalStringField(record, 'paymentTerms'),
    paymentMethod:
      record['paymentMethod'] === null ? null : parseOptionalStringField(record, 'paymentMethod'),
    originalDocumentId:
      record['originalDocumentId'] === null
        ? null
        : parseOptionalStringField(record, 'originalDocumentId'),
    items: parseItems(record['items']),
    billingRules: parseBillingRules(record['billingRules']),
  };
}

export function parseRowVersionBody(body: unknown): { rowVersion: number } {
  return parseLenientRowVersionBody(body);
}

export function parseCancelPurchaseOrderInput(body: unknown): CancelPurchaseOrderInput {
  const record = assertRecordBody(body);
  return {
    rowVersion: Number(record['rowVersion']),
    cancellationReason: parseOptionalStringField(record, 'cancellationReason'),
  };
}

export function parseAuthorizePurchaseOrderOverrunInput(body: unknown): {
  rowVersion: number;
  amount: string;
  justification: string;
} {
  const record = assertRecordBody(body);
  const amount = typeof record['amount'] === 'string' ? record['amount'] : '';
  const justification = typeof record['justification'] === 'string' ? record['justification'] : '';
  return {
    rowVersion: Number(record['rowVersion']),
    amount,
    justification,
  };
}

export function parseLinkPurchaseOrderDocumentInput(
  body: unknown,
): LinkPurchaseOrderDocumentInput {
  return parseLinkDocumentInput(body);
}

export function parseListPurchaseOrdersQuery(query: Record<string, unknown>): PurchaseOrderListQuery {
  const base = parseCommercialEntityListQuery(query);
  const status = typeof query['status'] === 'string' ? query['status'] : undefined;
  if (status && !isPurchaseOrderStatus(status)) {
    throw new Error('status invalid');
  }
  const sort = typeof query['sort'] === 'string' ? query['sort'] : undefined;
  const direction = typeof query['direction'] === 'string' ? query['direction'] : undefined;
  if (sort !== undefined && !isPurchaseOrderListSort(sort)) {
    throw new Error('sort invalid');
  }
  if (direction !== undefined && !isPurchaseOrderListDirection(direction)) {
    throw new Error('direction invalid');
  }
  return {
    ...base,
    status,
    currencyCode: typeof query['currencyCode'] === 'string' ? query['currencyCode'] : undefined,
    issueFrom: typeof query['issueFrom'] === 'string' ? query['issueFrom'] : undefined,
    issueTo: typeof query['issueTo'] === 'string' ? query['issueTo'] : undefined,
    search: typeof query['q'] === 'string' ? query['q'] : undefined,
    advanced: parsePurchaseOrderAdvancedFilter(query['filters']),
    sort: sort && isPurchaseOrderListSort(sort) ? sort : undefined,
    direction: direction && isPurchaseOrderListDirection(direction) ? direction : undefined,
  };
}
