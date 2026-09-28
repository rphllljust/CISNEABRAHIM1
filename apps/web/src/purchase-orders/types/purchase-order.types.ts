export const PURCHASE_ORDER_ERROR_CODES = {
  VALIDATION_FAILED: 'COMMERCIAL_VALIDATION_FAILED',
  DENIED: 'COMMERCIAL_DENIED',
  NOT_FOUND: 'COMMERCIAL_PURCHASE_ORDER_NOT_FOUND',
  INVALID_STATE: 'COMMERCIAL_PURCHASE_ORDER_INVALID_STATE',
  VERSION_CONFLICT: 'COMMERCIAL_PURCHASE_ORDER_VERSION_CONFLICT',
  DUPLICATE: 'COMMERCIAL_PURCHASE_ORDER_DUPLICATE',
  CLIENT_NOT_FOUND: 'COMMERCIAL_CLIENT_NOT_FOUND',
  CLIENT_INACTIVE: 'COMMERCIAL_CLIENT_INACTIVE',
  UNIT_NOT_REGISTERED: 'COMMERCIAL_UNIT_NOT_REGISTERED',
  SERVICE_NOT_FOUND: 'COMMERCIAL_SERVICE_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'COMMERCIAL_DOCUMENT_NOT_FOUND',
} as const;

export type PurchaseOrderErrorCode =
  (typeof PURCHASE_ORDER_ERROR_CODES)[keyof typeof PURCHASE_ORDER_ERROR_CODES];

export const PURCHASE_ORDER_STATUSES = {
  Draft: 'DRAFT',
  Registered: 'REGISTERED',
  Cancelled: 'CANCELLED',
} as const;

export type PurchaseOrderStatus =
  (typeof PURCHASE_ORDER_STATUSES)[keyof typeof PURCHASE_ORDER_STATUSES];

export const PURCHASE_ORDER_PRICING_STRUCTURES = {
  LineItems: 'LINE_ITEMS',
  HeaderTotal: 'HEADER_TOTAL',
} as const;

export type PurchaseOrderPricingStructure =
  (typeof PURCHASE_ORDER_PRICING_STRUCTURES)[keyof typeof PURCHASE_ORDER_PRICING_STRUCTURES];

export const PURCHASE_ORDER_RULE_TYPES = {
  PoNumberRequiredOnInvoice: 'PO_NUMBER_REQUIRED_ON_INVOICE',
  XmlRequired: 'XML_REQUIRED',
  PdfRequired: 'PDF_REQUIRED',
  BillingCutoff: 'BILLING_CUTOFF',
  Recipient: 'RECIPIENT',
} as const;

export type PurchaseOrderRuleType =
  (typeof PURCHASE_ORDER_RULE_TYPES)[keyof typeof PURCHASE_ORDER_RULE_TYPES];

export const PURCHASE_ORDER_DOCUMENT_LINK_PURPOSES = {
  Original: 'ORIGINAL',
  XmlAttachment: 'XML_ATTACHMENT',
  PdfAttachment: 'PDF_ATTACHMENT',
  Supporting: 'SUPPORTING',
} as const;

export type PurchaseOrderDocumentLinkPurpose =
  (typeof PURCHASE_ORDER_DOCUMENT_LINK_PURPOSES)[keyof typeof PURCHASE_ORDER_DOCUMENT_LINK_PURPOSES];

export type PurchaseOrder = {
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
  pricingStructure: PurchaseOrderPricingStructure;
  totalAmount: string | null;
  itemsLineTotal: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  clientSnapshot: Record<string, unknown> | null;
  commercialSnapshot: Record<string, unknown> | null;
  originalDocumentId: string | null;
  status: PurchaseOrderStatus;
  registeredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  /**
   * Ledger do pedido, exposto pela listagem com a regra de saldo do proprio dominio.
   *
   * `consumedAmount` e `authorizedOverrunAmount` sao valores persistidos. `balance` e `null`
   * quando a regra de dominio recusa apurar (valor autorizado indisponivel ou consumo acima do
   * autorizado) — a interface declara "não apurável" em vez de exibir número inventado.
   */
  consumedAmount: string;
  authorizedOverrunAmount: string;
  balance: PurchaseOrderBalance | null;
};

export type PurchaseOrderBalance = {
  authorizedAmount: string;
  consumedAmount: string;
  authorizedOverrunAmount: string;
  availableBalance: string;
};

export type PurchaseOrderItem = {
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

export type PurchaseOrderBillingRule = {
  id: string;
  ruleType: string;
  ruleConfig: Record<string, unknown>;
  precedenceTier: string;
  createdAt: string;
};

export type PurchaseOrderDocumentLink = {
  id: string;
  documentId: string;
  linkPurpose: string;
  createdAt: string;
};

export type PurchaseOrderLinkedRecord = {
  kind: string;
  id: string;
  label: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  occurredAt: string;
  parentId: string | null;
};

export type PurchaseOrderDetail = {
  purchaseOrder: PurchaseOrder;
  items: PurchaseOrderItem[];
  billingRules: PurchaseOrderBillingRule[];
  documentLinks: PurchaseOrderDocumentLink[];
  /** Cadeia relacionada: solicitacao, OS, medicao e faturamento ligados a este pedido. */
  linked?: PurchaseOrderLinkedRecord[];
};

export type PurchaseOrderListResponse = {
  items: PurchaseOrder[];
  limit: number;
  offset: number;
};

export type PurchaseOrderItemInput = {
  lineNumber?: number;
  description: string;
  serviceDefinitionId?: string;
  serviceDefinitionVersionId?: string;
  quantity?: string;
  unitCode?: string;
  unitPrice?: string;
  lineTotal?: string;
  rcLineReference?: string;
};

export type PurchaseOrderBillingRuleInput = {
  ruleType: PurchaseOrderRuleType;
  ruleConfig?: Record<string, unknown>;
};

export type CreatePurchaseOrderPayload = {
  clientId: string;
  unitId: string;
  poNumber: string;
  rcNumber?: string;
  issueDate?: string;
  buyerContact?: { name?: string; email?: string; phone?: string };
  serviceManager?: string;
  deliveryLocation?: Record<string, unknown>;
  billingLocation?: Record<string, unknown>;
  currencyCode?: string;
  pricingStructure: PurchaseOrderPricingStructure;
  totalAmount?: string;
  paymentTerms?: string;
  paymentMethod?: string;
  originalDocumentId?: string;
  items?: PurchaseOrderItemInput[];
  billingRules?: PurchaseOrderBillingRuleInput[];
};

export type UpdatePurchaseOrderDraftPayload = {
  rowVersion: number;
  poNumber?: string;
  rcNumber?: string | null;
  issueDate?: string | null;
  buyerContact?: { name?: string; email?: string; phone?: string };
  serviceManager?: string | null;
  deliveryLocation?: Record<string, unknown>;
  billingLocation?: Record<string, unknown>;
  currencyCode?: string;
  pricingStructure?: PurchaseOrderPricingStructure;
  totalAmount?: string | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  originalDocumentId?: string | null;
  items?: PurchaseOrderItemInput[];
  billingRules?: PurchaseOrderBillingRuleInput[];
};

export type CancelPurchaseOrderPayload = {
  rowVersion: number;
  cancellationReason?: string;
};

export type LinkPurchaseOrderDocumentPayload = {
  documentId: string;
  linkPurpose: PurchaseOrderDocumentLinkPurpose;
};
