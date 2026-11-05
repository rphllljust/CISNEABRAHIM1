import {
  isPositiveMoneyAmount,
  normalizeMoneyAmount,
  subtractMoneyAmounts,
  sumMoneyAmounts,
} from '../../platform/kernel/money-math';
import { AccountingError } from './ledger';

export const FIXED_ASSET_STATUSES = {
  Registered: 'REGISTERED',
  Capitalized: 'CAPITALIZED',
  Disposed: 'DISPOSED',
} as const;

export type FixedAssetStatus = (typeof FIXED_ASSET_STATUSES)[keyof typeof FIXED_ASSET_STATUSES];

const FIXED_ASSET_STATUS_SET: ReadonlySet<string> = new Set(Object.values(FIXED_ASSET_STATUSES));

/**
 * Predicado do conjunto FECHADO de status de imobilizado.
 *
 * Usado na borda da listagem: valor desconhecido e RECUSADO ali, em vez de descer ao SQL como
 * comparacao que nunca casa — o que devolveria lista vazia e seria lido como "nao ha registros".
 */
export function isFixedAssetStatus(value: string): value is FixedAssetStatus {
  return FIXED_ASSET_STATUS_SET.has(value);
}

export const FIXED_ASSET_MOVEMENT_KINDS = {
  Acquisition: 'ACQUISITION',
  Disposal: 'DISPOSAL',
  Transfer: 'TRANSFER',
  Depreciation: 'DEPRECIATION',
} as const;

export const FIXED_ASSET_MOVEMENT_STATUSES = {
  Posted: 'POSTED',
  Reversed: 'REVERSED',
} as const;

export const FIXED_ASSET_ACCOUNTING_ORIGIN = 'FIXED_ASSET';

export const FIXED_ASSET_ACCOUNTING_EVENTS = {
  Acquired: 'FIXED_ASSET_ACQUIRED',
  Disposed: 'FIXED_ASSET_DISPOSED',
  Transferred: 'FIXED_ASSET_TRANSFERRED',
  Depreciated: 'FIXED_ASSET_DEPRECIATED',
} as const;

export type FixedAssetMovementSnapshot = {
  kind: string;
  status: string;
  amount: string;
};

export function assertUsefulLifeMonths(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
  }
  return value;
}

export function assertFixedAssetCanAcquire(status: string): void {
  if (status === FIXED_ASSET_STATUSES.Capitalized) {
    return;
  }
  if (status !== FIXED_ASSET_STATUSES.Registered) {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
  }
}

export function assertFixedAssetCanDispose(status: string): void {
  if (status === FIXED_ASSET_STATUSES.Disposed) {
    return;
  }
  if (status !== FIXED_ASSET_STATUSES.Capitalized) {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED');
  }
}

export function assertFixedAssetCanTransfer(status: string): void {
  if (status !== FIXED_ASSET_STATUSES.Capitalized) {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED');
  }
}

export function assertFixedAssetCanReverseAcquisition(status: string): void {
  if (status !== FIXED_ASSET_STATUSES.Capitalized) {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED');
  }
}

export function deriveFixedAssetBookValue(movements: FixedAssetMovementSnapshot[]): string {
  const posted = movements.filter((item) => item.status === FIXED_ASSET_MOVEMENT_STATUSES.Posted);
  const acquired = sumMoneyAmounts(
    posted.filter((item) => item.kind === FIXED_ASSET_MOVEMENT_KINDS.Acquisition).map((item) => item.amount),
  );
  const reductions = sumMoneyAmounts(
    posted
      .filter(
        (item) =>
          item.kind === FIXED_ASSET_MOVEMENT_KINDS.Disposal ||
          item.kind === FIXED_ASSET_MOVEMENT_KINDS.Depreciation,
      )
      .map((item) => item.amount),
  );
  const bookValue = subtractMoneyAmounts(acquired, reductions);
  if (!isPositiveMoneyAmount(bookValue) && bookValue !== '0' && bookValue !== '0.0000') {
    throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
  }
  return normalizeMoneyAmount(bookValue === '0' ? '0.0000' : bookValue);
}

export function assertDepreciationRateNotInvented(): never {
  throw new AccountingError('ACCOUNTING_DEPRECIATION_RATE_NOT_CONFIGURED');
}

export function eventKindForFixedAssetMovement(kind: string): string {
  switch (kind) {
    case FIXED_ASSET_MOVEMENT_KINDS.Acquisition:
      return FIXED_ASSET_ACCOUNTING_EVENTS.Acquired;
    case FIXED_ASSET_MOVEMENT_KINDS.Disposal:
      return FIXED_ASSET_ACCOUNTING_EVENTS.Disposed;
    case FIXED_ASSET_MOVEMENT_KINDS.Transfer:
      return FIXED_ASSET_ACCOUNTING_EVENTS.Transferred;
    case FIXED_ASSET_MOVEMENT_KINDS.Depreciation:
      return FIXED_ASSET_ACCOUNTING_EVENTS.Depreciated;
    default:
      throw new AccountingError('ACCOUNTING_FIXED_ASSET_INVALID');
  }
}
