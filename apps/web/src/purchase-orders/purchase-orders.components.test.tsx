import { describe, expect, it } from 'vitest';
import { mapPurchaseOrderErrorToMessage } from './api/purchase-order-error-messages';
import { PURCHASE_ORDER_ERROR_CODES } from './types/purchase-order.types';
import {
  formatDate,
  formatMoney,
  formatPurchaseOrderStatus,
} from './utils/purchase-order-labels';
import {
  purchaseOrderAuthorizedAmount,
  purchaseOrderNextAction,
  purchaseOrderNotice,
  purchaseOrderUsage,
} from './utils/purchase-order-list-presentation';
import { PURCHASE_ORDER_STATUSES } from './types/purchase-order.types';

describe('PurchaseOrderStatusBadge labels', () => {
  it('formats status labels in Portuguese', () => {
    expect(formatPurchaseOrderStatus(PURCHASE_ORDER_STATUSES.Draft)).toBe('Rascunho');
    expect(formatPurchaseOrderStatus(PURCHASE_ORDER_STATUSES.Registered)).toBe('Registrado');
  });
});

describe('purchase order error messages', () => {
  it('maps version conflict', () => {
    expect(
      mapPurchaseOrderErrorToMessage(PURCHASE_ORDER_ERROR_CODES.VERSION_CONFLICT, 409),
    ).toMatch(/alterado por outro usuário/i);
  });

  it('maps duplicate PO', () => {
    expect(mapPurchaseOrderErrorToMessage(PURCHASE_ORDER_ERROR_CODES.DUPLICATE, 409)).toMatch(
      /já existe/i,
    );
  });
});

describe('purchase order money formatting', () => {
  it('formats BRL amounts with alignment class support', () => {
    expect(formatMoney('9999.99', 'BRL')).toMatch(/9\.999,99/);
  });
});

describe('purchase order date formatting', () => {
  it('preserves date-only values without UTC timezone drift', () => {
    expect(formatDate('2026-08-21')).toBe('21/08/2026');
  });
});

/**
 * LEITURA DO CONSUMO AUTORIZADO — contrato de apresentacao da worklist.
 *
 * O percentual e a UNICA coisa que a tela acrescenta sobre o ledger do dominio. As provas aqui
 * garantem que ele nunca vira numero inventado: sem apuracao do dominio, com autorizado zero ou
 * com valor nao numerico, a leitura devolve `null` e a interface declara a indisponibilidade.
 */
describe('purchase order usage reading', () => {
  const balance = (authorizedAmount: string, consumedAmount: string) => ({
    authorizedAmount,
    consumedAmount,
  });

  it('derives the consumption ratio from the domain ledger', () => {
    const usage = purchaseOrderUsage(balance('48250', '12000'));
    expect(usage).not.toBeNull();
    expect(usage?.percent).toBeCloseTo(24.87, 1);
    expect(usage?.overAuthorized).toBe(false);
  });

  it('flags consumption above the authorized amount without inventing a status', () => {
    const usage = purchaseOrderUsage(balance('1000', '1500'));
    expect(usage?.percent).toBeCloseTo(150, 5);
    expect(usage?.overAuthorized).toBe(true);
  });

  it('never invents a percentage when the domain refuses to apurate', () => {
    expect(purchaseOrderUsage(null)).toBeNull();
  });

  it('never divides by an unavailable or invalid authorized amount', () => {
    expect(purchaseOrderUsage(balance('0', '12000'))).toBeNull();
    expect(purchaseOrderUsage(balance('0.0000', '0'))).toBeNull();
    expect(purchaseOrderUsage(balance('indisponivel', '12000'))).toBeNull();
    expect(purchaseOrderUsage(balance('1000', 'nao-numerico'))).toBeNull();
  });

  it('reads zero consumption as zero percent, not as missing data', () => {
    const usage = purchaseOrderUsage(balance('18750', '0'));
    expect(usage?.percent).toBe(0);
    expect(usage?.overAuthorized).toBe(false);
  });
});

describe('purchase order authorized amount reading', () => {
  it('prefers the domain balance over the raw header total', () => {
    expect(
      purchaseOrderAuthorizedAmount({ totalAmount: '48250.0000', balance: { authorizedAmount: '48250' } }),
    ).toBe('48250');
  });

  it('falls back to the header total when the domain refuses to apurate', () => {
    expect(purchaseOrderAuthorizedAmount({ totalAmount: '18750.0000', balance: null })).toBe(
      '18750.0000',
    );
  });

  it('declares absence instead of zero when neither source exists', () => {
    expect(purchaseOrderAuthorizedAmount({ totalAmount: null, balance: null })).toBeNull();
  });
});

describe('purchase order exception reading', () => {
  const base = { registeredAt: null, cancelledAt: null };

  it('only exposes an exception when a persisted fact sustains it', () => {
    expect(
      purchaseOrderNotice({ status: PURCHASE_ORDER_STATUSES.Draft, ...base }),
    ).toMatch(/não registrado/i);
    expect(
      purchaseOrderNotice({
        status: PURCHASE_ORDER_STATUSES.Registered,
        registeredAt: '2026-08-22T13:45:00.000Z',
        cancelledAt: null,
      }),
    ).toBeNull();
    expect(
      purchaseOrderNotice({
        status: PURCHASE_ORDER_STATUSES.Cancelled,
        registeredAt: null,
        cancelledAt: '2026-08-23T10:00:00.000Z',
      }),
    ).toMatch(/cancelado/i);
  });
});

describe('purchase order next action reading', () => {
  it('names the step the current state allows', () => {
    expect(purchaseOrderNextAction(PURCHASE_ORDER_STATUSES.Draft)).toMatch(/registrar/i);
    expect(purchaseOrderNextAction(PURCHASE_ORDER_STATUSES.Registered)).toMatch(/consumo/i);
    expect(purchaseOrderNextAction(PURCHASE_ORDER_STATUSES.Cancelled)).toMatch(/histórico/i);
  });
});
