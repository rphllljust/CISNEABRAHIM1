import type { ServiceOrderDetail } from '../../service-orders/types/service-order.types';
import {
  PAYMENT_TERMS_SOURCES,
  type CommercialTermsDivergence,
} from '../types/billing.types';

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

/**
 * Rótulo da REFERÊNCIA COMERCIAL do faturamento.
 *
 * O snapshot do faturamento congela `proposalId`/`purchaseOrderId` — UUIDs — e não o número
 * humano que identifica o documento comercial do cliente. Quando o snapshot já traz o número,
 * ele manda. Quando não traz, a segunda fonte é o próprio registro de origem (OS), que carrega
 * `proposalSnapshot.proposalNumber` e `purchaseOrderSnapshot.poNumber` congelados no nascimento
 * da OS. Ambas são fontes autoritativas já persistidas — nenhuma é derivada aqui.
 *
 * Sem nenhuma das duas o rótulo diz "Referência não registrada": ausência explícita, nunca um
 * genérico que pareça dado.
 */
export function readCommercialReferenceLabel(
  snapshot: Record<string, unknown> | null | undefined,
  fallback?: { proposalNumber?: string | null; purchaseOrderNumber?: string | null } | null,
): string {
  const poNumber =
    snapshot?.poNumber ??
    snapshot?.purchaseOrderNumber ??
    fallback?.purchaseOrderNumber ??
    null;
  if (typeof poNumber === 'string' && poNumber.trim()) {
    return `PO ${poNumber.trim()}`;
  }
  const proposalNumber = snapshot?.proposalNumber ?? fallback?.proposalNumber ?? null;
  if (typeof proposalNumber === 'string' && proposalNumber.trim()) {
    return `Proposta ${proposalNumber.trim()}`;
  }
  const contractReference = snapshot?.contractReference;
  if (typeof contractReference === 'string' && contractReference.trim()) {
    return `Contrato ${contractReference.trim()}`;
  }
  return 'Referência não registrada';
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
 * Base comercial elegível -> Preparação -> Documento interno -> Recebível.
 */
export const BILLING_PROCESS_STEPS = [
  { id: 'measurement', label: 'Base de faturamento elegível' },
  { id: 'preparation', label: 'Preparação da cobrança' },
  { id: 'document', label: 'Nota Fatura (documento interno)' },
  { id: 'receivable', label: 'Recebível' },
] as const;

/** O recebivel existe como etapa real do processo, com destino proprio. */
export const BILLING_RECEIVABLE_HREF = '/app/finance/receivables';
