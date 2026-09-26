import { formatMoneyAmountForApi } from '../../platform/kernel/money-math';
import {
  deriveReceivableStatus,
  postedSettlementAmounts,
  remainingBalance,
  reconcileReceivable,
} from '../domain/receivable';
import type {
  ReceivableInstallmentRow,
  ReceivableRow,
  SettlementRow,
} from '../repositories/receivables.repository.types';

export type ReceivableInstallmentResponse = {
  id: string;
  installmentNumber: number;
  principal: string;
  dueDate: string;
};

export type SettlementResponse = {
  id: string;
  installmentId: string | null;
  amount: string;
  currencyCode: string;
  status: string;
  settledAt: string;
  idempotencyKey: string;
  externalReference: string | null;
  /** Reversao registrada sobre o recebimento original (nunca o substitui). */
  reversedAt: string | null;
  reversalReason: string | null;
};

export type ReceivableDetailResponse = {
  id: string;
  unitId: string;
  clientId: string;
  origin: {
    kind: string;
    billingDocumentId: string;
    billingRecordId: string;
    serviceOrderId: string;
    measurementId: string;
  };
  principal: string;
  currencyCode: string;
  dueDate: string;
  paymentTerms: string;
  externalReference: string | null;
  status: string;
  remainingBalance: string;
  settledAmount: string;
  lifecycle: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  installments: ReceivableInstallmentResponse[];
  settlements: SettlementResponse[];
};

export function toReceivableDetailResponse(
  row: ReceivableRow,
  installments: ReceivableInstallmentRow[],
  settlements: SettlementRow[],
  asOf?: Date,
): ReceivableDetailResponse {
  const postedAmounts = postedSettlementAmounts(settlements);
  const reconciliation = reconcileReceivable({
    principal: row.principal,
    postedAmounts,
  });
  return {
    id: row.id,
    unitId: row.unit_id,
    clientId: row.client_id,
    origin: {
      kind: row.origin_kind,
      billingDocumentId: row.origin_billing_document_id,
      billingRecordId: row.origin_billing_record_id,
      serviceOrderId: row.origin_service_order_id,
      measurementId: row.origin_measurement_id,
    },
    principal: formatMoneyAmountForApi(row.principal) ?? row.principal,
    currencyCode: row.currency_code,
    dueDate: row.due_date,
    paymentTerms: row.payment_terms,
    externalReference: row.external_reference,
    status: deriveReceivableStatus({
      lifecycle: row.lifecycle,
      principal: row.principal,
      postedAmounts,
      dueDate: row.due_date,
      asOf,
    }),
    remainingBalance: formatMoneyAmountForApi(reconciliation.remaining) ?? remainingBalance(row.principal, postedAmounts),
    settledAmount: formatMoneyAmountForApi(reconciliation.settled) ?? reconciliation.settled,
    lifecycle: row.lifecycle,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    rowVersion: row.row_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    installments: installments.map((item) => ({
      id: item.id,
      installmentNumber: item.installment_number,
      principal: formatMoneyAmountForApi(item.principal) ?? item.principal,
      dueDate: item.due_date,
    })),
      settlements: settlements.map((item) => ({
        id: item.id,
        installmentId: item.installment_id,
        amount: formatMoneyAmountForApi(item.amount) ?? item.amount,
        currencyCode: item.currency_code,
        status: item.status,
        settledAt: item.settled_at,
        idempotencyKey: item.idempotency_key,
        externalReference: item.external_reference,
        reversedAt: item.reversed_at,
        reversalReason: item.reversal_reason,
      })),
  };
}
