import type { BillingDocumentItem, BillingRecordDetail } from '../types/billing.types';
import { formatAddressLine } from './billing-document-format';

/**
 * Rótulos do documento interno de cobrança (Release 1). Não contêm dados de
 * identidade fiscal da empresa emissora — o emissor chega do documento emitido
 * (originado no registro do estabelecimento, no backend).
 */
export const BILLING_DOCUMENT_PREVIEW_LABELS = {
  documentCategory: 'NOTA FATURA',
  fiscalDisclaimer:
    'Documento comercial interno — não substitui documento fiscal eletrônico quando exigível.',
} as const;

export type BillingEmitterPreviewInput = {
  legalName?: string | null;
  taxId?: string | null;
  addressLine?: string | null;
};

export type BillingDocumentPreviewModel = {
  documentNumberLabel: string;
  documentCategory: string;
  fiscalDisclaimer: string;
  emitterLegalName: string;
  emitterTaxId: string;
  emitterAddressLine: string;
  clientLegalName: string;
  clientTaxId: string | null;
  billingAddressLine: string;
  paymentTerms: string;
  dueDate: string | null;
  issuedAt: string | null;
  status: string | null;
  currencyCode: string;
  totalAmount: string;
  purchaseOrderNumber: string | null;
  customerPurchaseOrderNumber: string | null;
  rcNumber: string | null;
  contractReference: string | null;
  commercialReferenceLabel: string;
  /** Rastreabilidade exibida no documento impresso. Ausente = travessão, nunca suposição. */
  serviceOrderNumber: string | null;
  proposalNumber: string | null;
  measurementNumber: string | null;
  /** Nome do serviço faturado — texto comercial real do snapshot da OS, não o placeholder. */
  serviceName: string | null;
  servicePeriodLabel: string | null;
  items: Array<BillingDocumentItem & { description: string }>;
};

/**
 * `line_label` do faturamento é placeholder sintético (`Linha N`) criado na preparação. A
 * descrição da linha usa o nome do serviço quando o rótulo não descreve nada — e imprime
 * travessão quando não há nenhuma das duas fontes. Espelha a regra do PDF no backend.
 */
const PLACEHOLDER_LINE_LABEL = /^Linha\s+\d+$/i;

export function buildBillingDocumentPreview(
  billing: BillingRecordDetail,
  options: {
    dueDate?: string | null;
    documentNumber?: string | null;
    purchaseOrderNumber?: string | null;
    customerPurchaseOrderNumber?: string | null;
    rcNumber?: string | null;
    serviceOrderNumber?: string | null;
    proposalNumber?: string | null;
    measurementNumber?: string | null;
    serviceName?: string | null;
    servicePeriodLabel?: string | null;
    issuedAt?: string | null;
    status?: string | null;
    commercialReferenceLabel: string;
    /** Emissor vindo do documento emitido (backend/registry). Nunca hardcoded. */
    emitter?: BillingEmitterPreviewInput | null;
  },
): BillingDocumentPreviewModel {
  const emitter = options.emitter ?? null;
  const serviceName = options.serviceName?.trim() || null;
  return {
    documentNumberLabel: options.documentNumber?.trim() || 'Atribuído na emissão',
    documentCategory: BILLING_DOCUMENT_PREVIEW_LABELS.documentCategory,
    fiscalDisclaimer: BILLING_DOCUMENT_PREVIEW_LABELS.fiscalDisclaimer,
    emitterLegalName: emitter?.legalName?.trim() || '',
    emitterTaxId: emitter?.taxId?.trim() || '',
    emitterAddressLine: emitter?.addressLine?.trim() || '',
    clientLegalName: billing.clientLegalNameSnapshot,
    clientTaxId: billing.clientTaxIdSnapshot,
    billingAddressLine: formatAddressLine(billing.billingAddressSnapshot),
    paymentTerms: billing.paymentTerms,
    dueDate: options.dueDate ?? null,
    issuedAt: options.issuedAt ?? null,
    status: options.status ?? null,
    currencyCode: billing.currencyCode,
    totalAmount: billing.totalAmount,
    purchaseOrderNumber: options.purchaseOrderNumber ?? null,
    customerPurchaseOrderNumber: options.customerPurchaseOrderNumber ?? null,
    rcNumber: options.rcNumber ?? null,
    contractReference: billing.contractReference,
    commercialReferenceLabel: options.commercialReferenceLabel,
    serviceOrderNumber: options.serviceOrderNumber ?? null,
    proposalNumber: options.proposalNumber ?? null,
    measurementNumber: options.measurementNumber ?? null,
    serviceName,
    servicePeriodLabel: options.servicePeriodLabel ?? null,
    items: billing.items.map((item) => {
      const label = item.lineLabel?.trim() ?? '';
      const usableLabel = label.length > 0 && !PLACEHOLDER_LINE_LABEL.test(label);
      return {
        id: item.id,
        lineNumber: item.lineNumber,
        billingItemId: item.id,
        measurementItemId: item.measurementItemId,
        unitCode: item.unitCode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineAmount: item.lineAmount,
        lineLabel: item.lineLabel,
        pricingLineSnapshot: item.pricingLineSnapshot,
        // Nome real do serviço quando o rótulo gravado é só "Linha N"; senão, o próprio rótulo.
        description: usableLabel ? label : (serviceName ?? '—'),
      };
    }),
  };
}

export function resolveBillingRecordTermsDivergence(
  billing: BillingRecordDetail,
): { authoritativeValue: string; declaredValue: string } | null {
  const authoritative = billing.paymentTermsAuthoritative?.trim();
  if (!authoritative) {
    return null;
  }
  const declared = billing.paymentTerms.trim();
  if (!declared) {
    return null;
  }
  if (declared.toLowerCase().replace(/\s+/g, ' ') === authoritative.toLowerCase().replace(/\s+/g, ' ')) {
    return null;
  }
  return { authoritativeValue: authoritative, declaredValue: declared };
}

export function hasActiveFinalizedDocument(
  documents: Array<{ status: string }>,
): boolean {
  return documents.some((doc) => doc.status === 'FINALIZED');
}
