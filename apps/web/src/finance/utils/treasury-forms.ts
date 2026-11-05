/**
 * Construtores de payload dos formulários de tesouraria.
 *
 * Os campos seguem exatamente o que o backend valida em
 * apps/api/src/finance/domain/treasury.validation.ts:
 * - movimento manual (POST finance/treasury/accounts/:accountId/movements):
 *   validatePostTreasuryMovementInput — originKind fixo MANUAL_AUTHORIZED e
 *   origem nunca TRANSFER/REVERSAL;
 * - transferência (POST finance/treasury/transfers):
 *   validateTransferTreasuryInput — rowVersionFrom/rowVersionTo das contas;
 * - estornos (POST finance/treasury/movements/:id/reverse e
 *   finance/treasury/transfers/:id/reverse):
 *   validateReverseTreasuryInput — reason >= 3 caracteres; reference obrigatória.
 * As funções são puras: não tocam em estado nem em fetch.
 */

export const TREASURY_ORIGIN_KINDS = {
  OpeningBalance: 'OPENING_BALANCE',
  ManualAuthorized: 'MANUAL_AUTHORIZED',
  PayablePayment: 'PAYABLE_PAYMENT',
  ReceivableSettlement: 'RECEIVABLE_SETTLEMENT',
  Transfer: 'TRANSFER',
  Reversal: 'REVERSAL',
} as const;

export type TreasuryDirection = 'CREDIT' | 'DEBIT';

export type PostMovementPayload = {
  direction: string;
  amount: string;
  rowVersion: number;
  idempotencyKey: string;
  reference: string;
  originKind: string;
  originId: string;
  originReference: string;
  occurredAt?: string;
};

export type TransferPayload = {
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  rowVersionFrom: number;
  rowVersionTo: number;
  idempotencyKey: string;
  reference: string;
  originId: string;
  originReference: string;
  occurredAt?: string;
};

export type ReverseTreasuryPayload = {
  rowVersion: number;
  idempotencyKey: string;
  reference: string;
  reason: string;
  amount?: string;
};

function trimmed(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function buildPostMovementPayload(input: {
  accountId: string;
  accountRowVersion: number;
  direction: string;
  amount: string;
  reference: string;
  /**
   * TIPO DA ORIGEM — vem da ESCOLHA do operador, nao de constante.
   *
   * Antes era `TREASURY_ORIGIN_KINDS.ManualAuthorized` fixo: todo movimento se declarava despesa
   * manual autorizada, mesmo quando quitava um titulo real. Isso corrompia a natureza da origem
   * persistida — e `originKind` e justamente o campo que a contabilidade usa para explicar de onde
   * o dinheiro veio. Ausente, o payload e recusado aqui em vez de assumir um tipo.
   */
  originKind: string;
  originId: string;
  originReference: string;
  idempotencyKey: string;
  occurredAt?: string;
}): { payload: PostMovementPayload; missing: string[] } {
  const missing: string[] = [];
  const reference = trimmed(input.reference);
  const originReference = trimmed(input.originReference);
  const amount = trimmed(input.amount);
  const originKind = trimmed(input.originKind);
  if (!amount) {
    missing.push('amount');
  }
  if (!reference) {
    missing.push('reference');
  }
  if (!originReference) {
    missing.push('originReference');
  }
  if (!originKind) {
    // Sem tipo nao se assume `MANUAL_AUTHORIZED`: escolher pelo operador e o ponto do campo.
    missing.push('originKind');
  }
  if (!input.originId.trim()) {
    missing.push('originId');
  }
  return {
    payload: {
      direction: input.direction.toUpperCase(),
      amount,
      rowVersion: input.accountRowVersion,
      idempotencyKey: input.idempotencyKey,
      reference,
      originKind,
      originId: input.originId.trim(),
      originReference,
      occurredAt: input.occurredAt,
    },
    missing,
  };
}

export function buildTransferPayload(input: {
  fromAccountId: string;
  fromAccountRowVersion: number;
  toAccountId: string;
  toAccountRowVersion: number;
  amount: string;
  reference: string;
  originId: string;
  originReference: string;
  idempotencyKey: string;
  occurredAt?: string;
}): { payload: TransferPayload; missing: string[] } {
  const missing: string[] = [];
  const reference = trimmed(input.reference);
  const originReference = trimmed(input.originReference);
  const amount = trimmed(input.amount);
  if (!amount) {
    missing.push('amount');
  }
  if (!reference) {
    missing.push('reference');
  }
  if (!originReference) {
    missing.push('originReference');
  }
  if (!input.originId.trim()) {
    missing.push('originId');
  }
  if (!input.toAccountId.trim()) {
    missing.push('toAccountId');
  }
  return {
    payload: {
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId.trim(),
      amount,
      rowVersionFrom: input.fromAccountRowVersion,
      rowVersionTo: input.toAccountRowVersion,
      idempotencyKey: input.idempotencyKey,
      reference,
      originId: input.originId.trim(),
      originReference,
      occurredAt: input.occurredAt,
    },
    missing,
  };
}

export function buildReverseTreasuryPayload(input: {
  rowVersion: number;
  reference: string;
  reason: string;
  amount?: string;
  idempotencyKey: string;
}): ReverseTreasuryPayload {
  const payload: ReverseTreasuryPayload = {
    rowVersion: input.rowVersion,
    idempotencyKey: input.idempotencyKey,
    reference: trimmed(input.reference),
    reason: trimmed(input.reason),
  };
  const amount = trimmed(input.amount);
  if (amount) {
    payload.amount = amount;
  }
  return payload;
}

export function hasReversalContent(input: { reference: string; reason: string }): boolean {
  return trimmed(input.reason).length >= 3 && trimmed(input.reference).length > 0;
}
