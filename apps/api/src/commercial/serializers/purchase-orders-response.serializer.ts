import { formatMoneyAmountForApi } from '../domain/money';
import {
  resolvePurchaseOrderCommercialFields,
  resolvePurchaseOrderItemFields,
} from '../domain/purchase-order-commercial-snapshot';
import {
  toDocumentLinkResponse as toSharedDocumentLinkResponse,
  type DocumentLinkResponse,
} from '../../infrastructure/http/contracts';
import {
  computePurchaseOrderAvailableBalance,
  resolvePurchaseOrderAuthorizedAmount,
  type PurchaseOrderBalanceSource,
} from '../domain/purchase-order-balance';
import type {
  PurchaseOrderBillingRuleRow,
  PurchaseOrderDocumentLinkRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
} from '../repositories/purchase-orders.repository.types';

export type PurchaseOrderItemResponse = {
  id: string;
  lineNumber: number;
  description: string;
  serviceDefinitionId: string | null;
  serviceDefinitionVersionId: string | null;
  serviceSnapshot: Record<string, unknown> | null;
  commercialSnapshot: Record<string, unknown> | null;
  quantity: string | null;
  unitCode: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
  rcLineReference: string | null;
};

export type PurchaseOrderBillingRuleResponse = {
  id: string;
  ruleType: string;
  ruleConfig: Record<string, unknown>;
  precedenceTier: string;
  createdAt: string;
};

export type PurchaseOrderDocumentLinkResponse = DocumentLinkResponse;

export type PurchaseOrderResponse = {
  id: string;
  internalCode: string;
  clientId: string;
  unitId: string;
  poNumber: string;
  rcNumber: string | null;
  issueDate: string | null;
  buyerContact: Record<string, unknown>;
  serviceManager: string | null;
  deliveryLocation: Record<string, unknown>;
  billingLocation: Record<string, unknown>;
  currencyCode: string;
  pricingStructure: string;
  totalAmount: string | null;
  itemsLineTotal: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  clientSnapshot: Record<string, unknown> | null;
  commercialSnapshot: Record<string, unknown> | null;
  originalDocumentId: string | null;
  status: string;
  registeredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderBalanceResponse = {
  authorizedAmount: string;
  consumedAmount: string;
  authorizedOverrunAmount: string;
  availableBalance: string;
};

export type PurchaseOrderDetailResponse = {
  purchaseOrder: PurchaseOrderResponse;
  items: PurchaseOrderItemResponse[];
  billingRules: PurchaseOrderBillingRuleResponse[];
  documentLinks: PurchaseOrderDocumentLinkResponse[];
  balance: PurchaseOrderBalanceResponse;
};

/**
 * Item da LISTAGEM: pedido + saldo do ledger.
 *
 * `consumed_amount`, `authorized_overrun_amount` e `items_line_total_amount` JA sao selecionados
 * por `PO_SELECT` — a listagem nao ganha consulta nova nem consulta por linha (sem N+1).
 *
 * O saldo reusa a regra de dominio existente (`resolvePurchaseOrderAuthorizedAmount` /
 * `computePurchaseOrderAvailableBalance`). Na detalhe, `lineTotals` vem das linhas; aqui vem do
 * total de linhas PERSISTIDO na emissao (`items_line_total_amount`), que e a soma das mesmas
 * linhas — mesmo insumo, mesma matematica, sem carregar itens para listar.
 */
export type PurchaseOrderListItemResponse = PurchaseOrderResponse & {
  consumedAmount: string;
  authorizedOverrunAmount: string;
  /**
   * `null` quando a propria regra de dominio recusa apurar (valor autorizado indisponivel ou
   * consumo acima do autorizado). A interface declara "nao apuravel" em vez de exibir numero
   * inventado; `consumedAmount` continua disponivel.
   */
  balance: PurchaseOrderBalanceResponse | null;
};

function toListBalanceResponse(
  purchaseOrder: PurchaseOrderRow,
): PurchaseOrderBalanceResponse | null {
  const source = {
    pricingStructure:
      purchaseOrder.pricing_structure as PurchaseOrderBalanceSource['pricingStructure'],
    totalAmount: purchaseOrder.total_amount,
    lineTotals: [purchaseOrder.items_line_total_amount],
    consumedAmount: purchaseOrder.consumed_amount,
    authorizedOverrunAmount: purchaseOrder.authorized_overrun_amount ?? '0',
  };
  try {
    return {
      authorizedAmount: formatMoneyAmountForApi(resolvePurchaseOrderAuthorizedAmount(source))!,
      consumedAmount: formatMoneyAmountForApi(purchaseOrder.consumed_amount)!,
      authorizedOverrunAmount: formatMoneyAmountForApi(source.authorizedOverrunAmount)!,
      availableBalance: formatMoneyAmountForApi(computePurchaseOrderAvailableBalance(source))!,
    };
  } catch {
    return null;
  }
}

export function toPurchaseOrderListItemResponse(
  row: PurchaseOrderRow,
): PurchaseOrderListItemResponse {
  const balance = toListBalanceResponse(row);
  return {
    ...toPurchaseOrderResponse(row),
    consumedAmount: formatMoneyAmountForApi(row.consumed_amount) ?? '0',
    authorizedOverrunAmount: formatMoneyAmountForApi(row.authorized_overrun_amount ?? '0') ?? '0',
    balance,
  };
}

function toItemResponse(row: PurchaseOrderItemRow): PurchaseOrderItemResponse {
  const commercial = resolvePurchaseOrderItemFields(row);
  return {
    id: row.id,
    lineNumber: row.line_number,
    description: commercial.description,
    serviceDefinitionId: row.service_definition_id,
    serviceDefinitionVersionId: row.service_definition_version_id,
    serviceSnapshot: row.service_snapshot,
    commercialSnapshot: row.commercial_snapshot,
    quantity: commercial.quantity,
    unitCode: commercial.unitCode,
    unitPrice: commercial.unitPrice,
    lineTotal: commercial.lineTotal,
    rcLineReference: commercial.rcLineReference,
  };
}

function toRuleResponse(row: PurchaseOrderBillingRuleRow): PurchaseOrderBillingRuleResponse {
  return {
    id: row.id,
    ruleType: row.rule_type,
    ruleConfig: row.rule_config,
    precedenceTier: row.precedence_tier,
    createdAt: row.created_at,
  };
}

function toDocumentLinkResponse(row: PurchaseOrderDocumentLinkRow): PurchaseOrderDocumentLinkResponse {
  return toSharedDocumentLinkResponse(row);
}

export function toPurchaseOrderResponse(row: PurchaseOrderRow): PurchaseOrderResponse {
  const commercial = resolvePurchaseOrderCommercialFields(row);
  return {
    id: row.id,
    internalCode: row.internal_code,
    clientId: row.client_id,
    unitId: row.unit_id,
    poNumber: commercial.poNumber,
    rcNumber: commercial.rcNumber,
    issueDate: commercial.issueDate,
    buyerContact: commercial.buyerContact,
    serviceManager: commercial.serviceManager,
    deliveryLocation: commercial.deliveryLocation,
    billingLocation: commercial.billingLocation,
    currencyCode: commercial.currencyCode,
    pricingStructure: commercial.pricingStructure,
    totalAmount: commercial.totalAmount,
    itemsLineTotal: formatMoneyAmountForApi(row.items_line_total_amount),
    paymentTerms: commercial.paymentTerms,
    paymentMethod: commercial.paymentMethod,
    clientSnapshot: row.client_snapshot,
    commercialSnapshot: row.commercial_snapshot,
    originalDocumentId: row.original_document_id,
    status: row.status,
    registeredAt: row.registered_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBalanceResponse(
  purchaseOrder: PurchaseOrderRow,
  items: PurchaseOrderItemRow[],
): PurchaseOrderBalanceResponse {
  const source = {
    pricingStructure: purchaseOrder.pricing_structure as PurchaseOrderBalanceSource['pricingStructure'],
    totalAmount: purchaseOrder.total_amount,
    lineTotals: items.map((item) => item.line_total_amount),
    consumedAmount: purchaseOrder.consumed_amount,
    authorizedOverrunAmount: purchaseOrder.authorized_overrun_amount ?? '0',
  };
  return {
    authorizedAmount: formatMoneyAmountForApi(resolvePurchaseOrderAuthorizedAmount(source))!,
    consumedAmount: formatMoneyAmountForApi(purchaseOrder.consumed_amount)!,
    authorizedOverrunAmount: formatMoneyAmountForApi(source.authorizedOverrunAmount)!,
    availableBalance: formatMoneyAmountForApi(computePurchaseOrderAvailableBalance(source))!,
  };
}

export function toPurchaseOrderDetailResponse(
  purchaseOrder: PurchaseOrderRow,
  items: PurchaseOrderItemRow[],
  billingRules: PurchaseOrderBillingRuleRow[],
  documentLinks: PurchaseOrderDocumentLinkRow[],
): PurchaseOrderDetailResponse {
  return {
    purchaseOrder: toPurchaseOrderResponse(purchaseOrder),
    items: items.map(toItemResponse),
    billingRules: billingRules.map(toRuleResponse),
    documentLinks: documentLinks.map(toDocumentLinkResponse),
    balance: toBalanceResponse(purchaseOrder, items),
  };
}
