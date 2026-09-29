import { MEASUREMENT_STATUSES, type MeasurementDetail } from '../../service-orders/types/measurement.types';
import type { ServiceOrderDetail } from '../../service-orders/types/service-order.types';
import {
  BILLING_PROCESS_BUCKETS,
  BILLING_RECORD_STATUSES,
  PAYMENT_TERMS_SOURCES,
  type BillingProcessBucket,
  type BillingRecordDetail,
  type BillingWorkQueueItem,
  type CommercialTermsDivergence,
} from '../types/billing.types';
import { sumMoneyLines } from './billing-format';

export type AuthoritativePaymentTerms = {
  value: string;
  source: string;
  label: string;
};

export function readClientLabel(order: ServiceOrderDetail): string {
  const snapshot = order.clientSnapshot;
  if (!snapshot) {
    return 'Cliente';
  }
  const tradeName = snapshot.tradeName;
  const legalName = snapshot.legalName;
  if (typeof tradeName === 'string' && tradeName.trim()) {
    return tradeName;
  }
  if (typeof legalName === 'string' && legalName.trim()) {
    return legalName;
  }
  return 'Cliente';
}

export function resolveAuthoritativePaymentTerms(order: ServiceOrderDetail): AuthoritativePaymentTerms | null {
  const poSnapshot = order.purchaseOrderSnapshot as { paymentTerms?: string | null } | null | undefined;
  if (poSnapshot?.paymentTerms?.trim()) {
    return {
      value: poSnapshot.paymentTerms.trim(),
      source: PAYMENT_TERMS_SOURCES.PurchaseOrder,
      label: 'Pedido de compra (PO)',
    };
  }

  const proposalSnapshot = order.proposalSnapshot as { paymentTerms?: string | null } | null | undefined;
  if (proposalSnapshot?.paymentTerms?.trim()) {
    return {
      value: proposalSnapshot.paymentTerms.trim(),
      source: PAYMENT_TERMS_SOURCES.ProposalSnapshot,
      label: 'Proposta comercial',
    };
  }

  const contractSnapshot = order.contractSnapshot as { paymentTerms?: string | null } | null | undefined;
  if (contractSnapshot?.paymentTerms?.trim()) {
    return {
      value: contractSnapshot.paymentTerms.trim(),
      source: PAYMENT_TERMS_SOURCES.ContractSnapshot,
      label: 'Contrato',
    };
  }

  return null;
}

export function paymentTermsMatch(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildCommercialTermsDivergence(
  authoritative: AuthoritativePaymentTerms,
  declaredTerms: string,
): CommercialTermsDivergence | null {
  if (!declaredTerms.trim() || paymentTermsMatch(authoritative.value, declaredTerms)) {
    return null;
  }
  return {
    authoritativeLabel: authoritative.label,
    authoritativeValue: authoritative.value,
    declaredLabel: 'Condição informada na preparação',
    declaredValue: declaredTerms.trim(),
  };
}

export function suggestDeclaredPaymentTerms(order: ServiceOrderDetail): string {
  return resolveAuthoritativePaymentTerms(order)?.value ?? '';
}

export function classifyBillingBucket(
  measurement: MeasurementDetail | null,
  billing: BillingRecordDetail | null,
  declaredTerms: string,
  order: ServiceOrderDetail,
): BillingProcessBucket {
  if (billing?.status === BILLING_RECORD_STATUSES.Prepared) {
    return BILLING_PROCESS_BUCKETS.Prepared;
  }

  const authoritative = resolveAuthoritativePaymentTerms(order);
  if (
    measurement?.status === MEASUREMENT_STATUSES.Approved &&
    authoritative &&
    declaredTerms.trim() &&
    buildCommercialTermsDivergence(authoritative, declaredTerms)
  ) {
    return BILLING_PROCESS_BUCKETS.Divergence;
  }

  if (measurement?.status === MEASUREMENT_STATUSES.Approved) {
    return BILLING_PROCESS_BUCKETS.Ready;
  }

  return BILLING_PROCESS_BUCKETS.Ready;
}

export function buildWorkQueueItem(
  order: ServiceOrderDetail,
  measurement: MeasurementDetail | null,
  billing: BillingRecordDetail | null,
  declaredTerms: string,
): BillingWorkQueueItem | null {
  if (!measurement || measurement.status !== MEASUREMENT_STATUSES.Approved) {
    if (billing?.status === BILLING_RECORD_STATUSES.Prepared) {
      // keep prepared records visible even if measurement fetch failed
    } else {
      return null;
    }
  }

  const bucket = classifyBillingBucket(measurement, billing, declaredTerms, order);
  const authoritative = resolveAuthoritativePaymentTerms(order);
  const termsDivergence =
    authoritative && declaredTerms.trim()
      ? buildCommercialTermsDivergence(authoritative, declaredTerms)
      : null;

  const totalAmount =
    billing?.totalAmount ??
    (measurement ? sumMoneyLines(measurement.items.map((item) => item.lineAmount)) : null);

  return {
    serviceOrderId: order.id,
    orderNumber: order.orderNumber,
    clientLabel: readClientLabel(order),
    measurementId: measurement?.id ?? billing?.measurementId ?? null,
    billingId: billing?.id ?? null,
    totalAmount,
    bucket: termsDivergence ? BILLING_PROCESS_BUCKETS.Divergence : bucket,
    termsDivergence,
  };
}

export function readCommercialReferenceLabel(snapshot: Record<string, unknown> | null | undefined): string {
  if (!snapshot) {
    return '—';
  }
  const poNumber = snapshot.poNumber ?? snapshot.purchaseOrderNumber;
  if (typeof poNumber === 'string' && poNumber.trim()) {
    return `PO ${poNumber.trim()}`;
  }
  const proposalNumber = snapshot.proposalNumber;
  if (typeof proposalNumber === 'string' && proposalNumber.trim()) {
    return `Proposta ${proposalNumber.trim()}`;
  }
  const contractReference = snapshot.contractReference;
  if (typeof contractReference === 'string' && contractReference.trim()) {
    return `Contrato ${contractReference.trim()}`;
  }
  return 'Referência comercial';
}

export function readDocumentLabels(snapshot: Record<string, unknown> | null | undefined): string[] {
  if (!snapshot) {
    return [];
  }
  const documents = snapshot.documents;
  if (!Array.isArray(documents)) {
    return [];
  }
  return documents
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const label = record.label ?? record.name ?? record.documentId;
        return typeof label === 'string' ? label : null;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value?.trim()));
}

/**
 * ETAPAS DO PROCESSO — o que EXISTE e o que ainda nao existe.
 *
 * CORRECAO DE VERDADE DE PRODUTO: "Contas a receber" estava listado aqui como
 * INDISPONIVEL. Isso era falso — o backend cria o recebivel a partir do documento
 * de faturamento e a cadeia de negocio ja o devolve como no a jusante
 * (`BILLING_DOCUMENT` -> `RECEIVABLE`), com tela propria em
 * `/app/finance/receivables`. Declarar indisponivel o que existe e a contradicao
 * que a auditoria apontou.
 *
 * O que continua fora: emissao fiscal OFICIAL (NF-e/NFS-e) e liquidacao/
 * conciliacao por este fluxo. Isso permanece explicitamente separado.
 */
export const BILLING_FUTURE_PROCESS_STEPS = [
  { id: 'official_fiscal', label: 'Emissão fiscal oficial (NF-e/NFS-e)', available: false },
  { id: 'settlement', label: 'Liquidação e conciliação por este fluxo', available: false },
] as const;

/**
 * ETAPAS REAIS DO PROCESSO — a cadeia que o produto de fato executa hoje.
 * Medição aprovada -> Preparação -> Documento interno -> Recebível.
 */
export const BILLING_PROCESS_STEPS = [
  { id: 'measurement', label: 'Medição aprovada' },
  { id: 'preparation', label: 'Preparação da cobrança' },
  { id: 'document', label: 'Nota Fatura (documento interno)' },
  { id: 'receivable', label: 'Recebível' },
] as const;

/** O recebivel existe como etapa real do processo, com destino proprio. */
export const BILLING_RECEIVABLE_HREF = '/app/finance/receivables';

export function groupWorkQueueByBucket(
  items: BillingWorkQueueItem[],
): Record<BillingProcessBucket, BillingWorkQueueItem[]> {
  return {
    [BILLING_PROCESS_BUCKETS.Ready]: items.filter((item) => item.bucket === BILLING_PROCESS_BUCKETS.Ready),
    [BILLING_PROCESS_BUCKETS.Prepared]: items.filter((item) => item.bucket === BILLING_PROCESS_BUCKETS.Prepared),
    [BILLING_PROCESS_BUCKETS.Divergence]: items.filter(
      (item) => item.bucket === BILLING_PROCESS_BUCKETS.Divergence,
    ),
  };
}
