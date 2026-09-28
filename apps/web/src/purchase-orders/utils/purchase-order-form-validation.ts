import {
  PURCHASE_ORDER_PRICING_STRUCTURES,
  type CreatePurchaseOrderPayload,
  type PurchaseOrderPricingStructure,
} from '../types/purchase-order.types';

/**
 * Linha de item do pedido de compra.
 *
 * `rowId` e a chave LOCAL do repetidor (nunca vai para a tela nem para o payload);
 * `lineTotal` e o valor NORMALIZADO do `CurrencyField` (ex.: "1500.50") ou string vazia.
 */
export type PurchaseOrderItemFormValues = {
  rowId: string;
  description: string;
  lineTotal: string;
};

export type PurchaseOrderFormValues = {
  clientId: string;
  unitId: string;
  poNumber: string;
  rcNumber: string;
  issueDate: string;
  serviceManager: string;
  currencyCode: string;
  pricingStructure: PurchaseOrderPricingStructure;
  totalAmount: string;
  paymentTerms: string;
  paymentMethod: string;
  /** Itens do pedido, na ordem das linhas enviadas ao servidor. */
  items: PurchaseOrderItemFormValues[];
};

export type PurchaseOrderItemFieldErrors = {
  description?: string;
  lineTotal?: string;
};

export type PurchaseOrderFormFieldErrors = Partial<
  Record<
    | 'clientId'
    | 'unitId'
    | 'poNumber'
    | 'rcNumber'
    | 'issueDate'
    | 'serviceManager'
    | 'currencyCode'
    | 'totalAmount'
    | 'paymentTerms'
    | 'paymentMethod',
    string
  >
> & {
  /** Erro por linha de item, na MESMA ordem das linhas. */
  items?: PurchaseOrderItemFieldErrors[];
  /** Erro do bloco de itens quando nao existe linha alguma para apontar. */
  itemsRequired?: string;
};

let rowSequence = 0;

/** Cria uma linha de item vazia com chave local estavel. */
export function createPurchaseOrderItemRow(
  description = '',
  lineTotal = '',
): PurchaseOrderItemFormValues {
  rowSequence += 1;
  return { rowId: `purchase-order-line-${rowSequence}`, description, lineTotal };
}

export const EMPTY_PURCHASE_ORDER_FORM: PurchaseOrderFormValues = {
  clientId: '',
  unitId: '',
  poNumber: '',
  rcNumber: '',
  issueDate: '',
  serviceManager: '',
  currencyCode: 'BRL',
  pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.LineItems,
  totalAmount: '',
  paymentTerms: '',
  paymentMethod: '',
  items: [],
};

/**
 * Regras da tela: identificacao obrigatoria, valor total autorizado quando a estrutura e de
 * total no cabecalho e, na estrutura por itens, ao menos uma linha com descricao e total.
 */
export function validatePurchaseOrderForm(
  values: PurchaseOrderFormValues,
): PurchaseOrderFormFieldErrors {
  const errors: PurchaseOrderFormFieldErrors = {};

  if (!values.clientId.trim()) {
    errors.clientId = 'Selecione um cliente.';
  }
  if (!values.unitId.trim()) {
    errors.unitId = 'Informe a unidade operacional.';
  }
  if (!values.poNumber.trim()) {
    errors.poNumber = 'Informe o número do pedido de compra.';
  }

  if (values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal) {
    if (!values.totalAmount.trim()) {
      errors.totalAmount = 'Informe o valor total autorizado.';
    }
  }

  if (values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.LineItems) {
    if (values.items.length === 0) {
      errors.itemsRequired = 'Inclua ao menos um item no pedido.';
    } else {
      const itemErrors = values.items.map<PurchaseOrderItemFieldErrors>((item) => {
        const row: PurchaseOrderItemFieldErrors = {};
        if (!item.description.trim()) {
          row.description = 'Informe a descrição do item.';
        }
        if (!item.lineTotal.trim()) {
          row.lineTotal = 'Informe o total da linha.';
        }
        return row;
      });
      if (itemErrors.some((row) => Object.keys(row).length > 0)) {
        errors.items = itemErrors;
      }
    }
  }

  return errors;
}

export function buildCreatePurchaseOrderPayload(
  values: PurchaseOrderFormValues,
): CreatePurchaseOrderPayload {
  const payload: CreatePurchaseOrderPayload = {
    clientId: values.clientId.trim(),
    unitId: values.unitId.trim(),
    poNumber: values.poNumber.trim(),
    pricingStructure: values.pricingStructure,
    currencyCode: values.currencyCode.trim() || 'BRL',
    rcNumber: values.rcNumber.trim() || undefined,
    issueDate: values.issueDate.trim() || undefined,
    serviceManager: values.serviceManager.trim() || undefined,
    paymentTerms: values.paymentTerms.trim() || undefined,
    paymentMethod: values.paymentMethod.trim() || undefined,
  };

  if (values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal) {
    payload.totalAmount = values.totalAmount.trim();
  }

  if (values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.LineItems) {
    payload.items = values.items.map((item, index) => ({
      lineNumber: index + 1,
      description: item.description.trim(),
      lineTotal: item.lineTotal.trim(),
    }));
  }

  return payload;
}

export function buildUpdatePurchaseOrderPayload(
  values: PurchaseOrderFormValues,
  rowVersion: number,
) {
  return {
    rowVersion,
    poNumber: values.poNumber.trim(),
    rcNumber: values.rcNumber.trim() || null,
    issueDate: values.issueDate.trim() || null,
    serviceManager: values.serviceManager.trim() || null,
    currencyCode: values.currencyCode.trim() || 'BRL',
    pricingStructure: values.pricingStructure,
    totalAmount:
      values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal
        ? values.totalAmount.trim()
        : null,
    paymentTerms: values.paymentTerms.trim() || null,
    paymentMethod: values.paymentMethod.trim() || null,
    items:
      values.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.LineItems
        ? values.items.map((item, index) => ({
            lineNumber: index + 1,
            description: item.description.trim(),
            lineTotal: item.lineTotal.trim(),
          }))
        : undefined,
  };
}
