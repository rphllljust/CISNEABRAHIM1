import {
  isPositiveMoneyAmount,
  moneyAmountsEqual,
  normalizeMoneyAmount,
  parseOptionalMoneyAmount,
  sumMoneyAmounts,
} from './money';
import {
  isProposalAcceptanceOrigin,
  isProposalDocumentLinkPurpose,
  isProposalItemKind,
  isProposalPricingStructure,
  PROPOSAL_PRICING_STRUCTURES,
  type ProposalItemKind,
  type ProposalPricingStructure,
} from './proposal';

export type ProposalItemInput = {
  lineNumber: number;
  itemKind: ProposalItemKind;
  description: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  quantity?: string;
  unitCode?: string;
  customerItemReference?: string;
  customerUnitCode?: string;
  unitSalePrice?: string;
  unitInternalCost?: string;
  lineSaleAmount?: string;
  lineInternalCost?: string;
};

export type CreateProposalInput = {
  clientId: string;
  contactId?: string;
  unitId: string;
  title: string;
  pricingStructure: ProposalPricingStructure;
  currencyCode?: string;
  globalSalePrice?: string;
  globalInternalCost?: string;
  commercialTerms?: Record<string, unknown>;
  validUntil?: string;
  notes?: string;
  items?: ProposalItemInput[];
};

export type UpdateProposalDraftInput = {
  rowVersion: number;
  title?: string;
  pricingStructure?: ProposalPricingStructure;
  currencyCode?: string;
  globalSalePrice?: string | null;
  globalInternalCost?: string | null;
  commercialTerms?: Record<string, unknown>;
  validUntil?: string | null;
  notes?: string | null;
  items?: ProposalItemInput[];
};

export type AcceptProposalInput = {
  rowVersion: number;
  acceptanceOriginCode: string;
  acceptanceEvidenceDocumentId?: string;
};

export type RejectProposalInput = {
  rowVersion: number;
  rejectionReason?: string;
};

export type CancelProposalInput = {
  rowVersion: number;
  cancellationReason?: string;
};

export type LinkProposalDocumentInput = {
  documentId: string;
  linkPurpose: string;
};

export class ProposalValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function multiplyMoney(quantity: string, unitPrice: string): string {
  const qtyParts = quantity.split('.');
  const priceParts = unitPrice.split('.');
  const qtyWhole = BigInt(qtyParts[0] ?? '0');
  const qtyFrac = (qtyParts[1] ?? '').padEnd(4, '0').slice(0, 4);
  const priceWhole = BigInt(priceParts[0] ?? '0');
  const priceFrac = (priceParts[1] ?? '').padEnd(4, '0').slice(0, 4);
  const qtyScaled = qtyWhole * 10000n + BigInt(qtyFrac || '0');
  const priceScaled = priceWhole * 10000n + BigInt(priceFrac || '0');
  const product = qtyScaled * priceScaled;
  const whole = product / 100000000n;
  const frac = (product % 100000000n).toString().padStart(8, '0').slice(0, 4);
  return normalizeMoneyAmount(`${whole}.${frac}`);
}

function parseItems(items: ProposalItemInput[] | undefined): ProposalItemInput[] {
  if (!items || items.length === 0) {
    return [];
  }
  return items.map((item, index) => {
    if (!isProposalItemKind(item.itemKind)) {
      throw new ProposalValidationError('INVALID_ITEM_KIND');
    }
    const description = item.description?.trim();
    if (!description) {
      throw new ProposalValidationError('INVALID_ITEM_DESCRIPTION');
    }
    const lineNumber = item.lineNumber ?? index + 1;
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      throw new ProposalValidationError('INVALID_LINE_NUMBER');
    }
    const quantity = item.quantity ? normalizeMoneyAmount(item.quantity) : undefined;
    if (quantity && !isPositiveMoneyAmount(quantity)) {
      throw new ProposalValidationError('INVALID_QUANTITY');
    }
    const unitSalePrice = parseOptionalMoneyAmount(item.unitSalePrice) ?? undefined;
    const lineSaleAmount = parseOptionalMoneyAmount(item.lineSaleAmount) ?? undefined;
    if (quantity && unitSalePrice && lineSaleAmount) {
      const expected = multiplyMoney(quantity, unitSalePrice);
      if (!moneyAmountsEqual(expected, lineSaleAmount)) {
        throw new ProposalValidationError('LINE_TOTAL_MISMATCH');
      }
    }
    return {
      ...item,
      lineNumber,
      description,
      quantity,
      unitSalePrice,
      unitInternalCost: parseOptionalMoneyAmount(item.unitInternalCost) ?? undefined,
      lineSaleAmount,
      lineInternalCost: parseOptionalMoneyAmount(item.lineInternalCost) ?? undefined,
    };
  });
}

export function validateCreateProposalInput(input: CreateProposalInput): {
  pricingStructure: ProposalPricingStructure;
  currencyCode: string;
  globalSalePrice: string | null;
  globalInternalCost: string | null;
  items: ProposalItemInput[];
} {
  if (!isProposalPricingStructure(input.pricingStructure)) {
    throw new ProposalValidationError('INVALID_PRICING_STRUCTURE');
  }
  const currencyCode = (input.currencyCode ?? 'BRL').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode)) {
    throw new ProposalValidationError('INVALID_CURRENCY_CODE');
  }
  const globalSalePrice = parseOptionalMoneyAmount(input.globalSalePrice);
  const globalInternalCost = parseOptionalMoneyAmount(input.globalInternalCost);
  const items = parseItems(input.items);

  if (input.pricingStructure === PROPOSAL_PRICING_STRUCTURES.Itemized) {
    if (items.length === 0) {
      throw new ProposalValidationError('ITEMIZED_ITEMS_REQUIRED');
    }
    for (const item of items) {
      if (!item.lineSaleAmount) {
        throw new ProposalValidationError('ITEMIZED_LINE_AMOUNT_REQUIRED');
      }
    }
  }

  return {
    pricingStructure: input.pricingStructure,
    currencyCode,
    globalSalePrice,
    globalInternalCost,
    items,
  };
}

export function validateUpdateProposalDraftInput(
  input: UpdateProposalDraftInput,
): UpdateProposalDraftInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ProposalValidationError('INVALID_ROW_VERSION');
  }
  if (input.pricingStructure && !isProposalPricingStructure(input.pricingStructure)) {
    throw new ProposalValidationError('INVALID_PRICING_STRUCTURE');
  }
  if (input.currencyCode && !/^[A-Z]{3}$/.test(input.currencyCode.trim().toUpperCase())) {
    throw new ProposalValidationError('INVALID_CURRENCY_CODE');
  }
  if (input.items) {
    parseItems(input.items);
  }
  return input;
}

export function validateAcceptProposalInput(input: AcceptProposalInput): AcceptProposalInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ProposalValidationError('INVALID_ROW_VERSION');
  }
  if (!isProposalAcceptanceOrigin(input.acceptanceOriginCode)) {
    throw new ProposalValidationError('ACCEPTANCE_ORIGIN_REQUIRED');
  }
  return input;
}

export function validateRejectProposalInput(input: RejectProposalInput): RejectProposalInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ProposalValidationError('INVALID_ROW_VERSION');
  }
  return input;
}

export function validateCancelProposalInput(input: CancelProposalInput): CancelProposalInput {
  if (!Number.isInteger(input.rowVersion) || input.rowVersion < 1) {
    throw new ProposalValidationError('INVALID_ROW_VERSION');
  }
  return input;
}

export function validateLinkProposalDocumentInput(
  input: LinkProposalDocumentInput,
): LinkProposalDocumentInput {
  if (!isProposalDocumentLinkPurpose(input.linkPurpose)) {
    throw new ProposalValidationError('INVALID_DOCUMENT_LINK_PURPOSE');
  }
  return input;
}

export function sumLineSaleAmounts(items: ProposalItemInput[]): string {
  return sumMoneyAmounts(items.map((item) => item.lineSaleAmount));
}
