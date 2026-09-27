import type { BadgeTone } from '../ui';

export function labelOrRaw(value: string | null | undefined, labels: Record<string, string>): string {
  if (!value) {
    return '—';
  }
  return labels[value] ?? value;
}

export function toneForStatus(status: string | null | undefined): BadgeTone {
  switch (status) {
    case 'PAID':
    case 'SETTLED':
    case 'POSTED':
    case 'ACTIVE':
    case 'AUTHORIZED':
    case 'CONFIRMED':
    case 'MATCHED':
    case 'SUCCEEDED':
    case 'OPEN':
    case 'CURRENT':
      return 'success';
    case 'PARTIALLY_PAID':
    case 'OVERDUE':
    case 'DRAFT':
    case 'REVIEW_REQUIRED':
    case 'PENDING':
    case 'PROCESSING':
    case 'SUBMITTED':
    case 'PENDING_APPROVAL':
    case 'READY':
    case '1_30':
    case '31_60':
      return 'warning';
    case 'CANCELLED':
    case 'CLOSED':
    case 'BLOCKED':
    case 'REJECTED':
    case 'FAILED':
    case 'UNMATCHED':
    case '90_PLUS':
    case 'REVERSED':
      return 'error';
    default:
      return 'neutral';
  }
}

export const RECEIVABLE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Em aberto',
  PARTIALLY_PAID: 'Parcialmente recebido',
  PAID: 'Recebido',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
};

export const PAYABLE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Em aberto',
  PARTIALLY_PAID: 'Parcialmente pago',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
};

export const AGING_BUCKET_LABELS: Record<string, string> = {
  SETTLED: 'Quitados',
  CANCELLED: 'Cancelados',
  CURRENT: 'A vencer',
  '1_30': '1 a 30 dias',
  '31_60': '31 a 60 dias',
  '61_90': '61 a 90 dias',
  '90_PLUS': 'Mais de 90 dias',
};

export const TREASURY_KIND_LABELS: Record<string, string> = {
  BANK: 'Conta bancária',
  CASH: 'Caixa',
};

export const TREASURY_LIFECYCLE_LABELS: Record<string, string> = {
  ACTIVE: 'Ativa',
  CLOSED: 'Encerrada',
};

export const MOVEMENT_DIRECTION_LABELS: Record<string, string> = {
  CREDIT: 'Crédito',
  DEBIT: 'Débito',
  IN: 'Entrada',
  OUT: 'Saída',
};

export const STATEMENT_STATUS_LABELS: Record<string, string> = {
  IMPORTED: 'Importado',
  MATCHING: 'Em conciliação',
  RECONCILED: 'Conciliado',
  DRAFT: 'Rascunho',
};

export const MATCH_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: 'Sem vínculo',
  SUGGESTED: 'Sugerido',
  MATCHED: 'Conciliado',
  REVIEW_REQUIRED: 'Revisão',
};

export const FISCAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  READY: 'Pronto',
  SUBMITTED: 'Enviado',
  AUTHORIZED: 'Autorizado',
  REJECTED: 'Rejeitado',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
};

export const JOURNAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  POSTED: 'Lançado',
  REVERSED: 'Estornado',
};

export const PERIOD_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  CLOSED: 'Fechado',
};

export const ACCOUNT_CLASS_LABELS: Record<string, string> = {
  ASSET: 'Ativo',
  LIABILITY: 'Passivo',
  EQUITY: 'Patrimônio líquido',
  REVENUE: 'Receita',
  EXPENSE: 'Despesa',
};

export const EXPENSE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Enviada',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
};

export const BUDGET_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovado',
  SUPERSEDED: 'Substituído',
};

export const PROCUREMENT_REQUEST_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
};

export const SUPPLIER_PO_STATUS_LABELS: Record<string, string> = {
  ISSUED: 'Emitido',
  RECEIVED: 'Recebido',
  PARTIALLY_RECEIVED: 'Parcialmente recebido',
  CANCELLED: 'Cancelado',
};

export const SUPPLIER_INVOICE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  VALIDATED: 'Validada',
  REJECTED: 'Rejeitada',
};

export const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

export const PAYROLL_PERIOD_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  CALCULATED: 'Calculado',
  CLOSED: 'Fechado',
};

export const COLLECTION_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Aberto',
  CLOSED: 'Encerrado',
};

export const TAX_ASSESSMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  FINALIZED: 'Finalizado',
  ADJUSTED: 'Ajustado',
  CANCELLED: 'Cancelado',
};

export const WAREHOUSE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

export const INVENTORY_ITEM_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};
