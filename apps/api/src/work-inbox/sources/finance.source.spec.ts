import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PAYABLE_AGING_BUCKETS, PAYABLE_STATUSES } from '../../finance/domain/payable';
import { RECEIVABLE_STATUSES } from '../../finance/domain/receivable';
import type { PayableDetailResponse } from '../../finance/serializers/payables-response.serializer';
import type { ReceivableDetailResponse } from '../../finance/serializers/receivables-response.serializer';
import {
  FinanceWorkSource,
  toPayableWorkItem,
  toReceivableWorkItem,
} from './finance.source';

/**
 * FONTE FINANCEIRA — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - "vencido" e o status que o PROPRIO dominio deriva: nada liquidado/cancelado entra na fila;
 * - chaves logicas `FINANCEIRO:RECEIVABLE:<id>` / `FINANCEIRO:PAYABLE:<id>`;
 * - referencias humanas (nunca uuid) e prazo real (`dueDate`), com omissao quando o dado nao serve;
 * - rota real do detalhe do titulo;
 * - sem autorizacao (403 do dominio dono) a fonte devolve lista VAZIA.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const RECEIVABLE_ID = '11111111-1111-4111-8111-111111111111';
const PAYABLE_ID = '22222222-2222-4222-8222-222222222222';

function receivable(overrides: Partial<ReceivableDetailResponse> = {}): ReceivableDetailResponse {
  return {
    id: RECEIVABLE_ID,
    unitId: 'UN-A',
    clientId: '33333333-3333-4333-8333-333333333333',
    origin: {
      kind: 'BILLING_DOCUMENT',
      billingDocumentId: '44444444-4444-4444-8444-444444444444',
      billingRecordId: '55555555-5555-4555-8555-555555555555',
      serviceOrderId: '66666666-6666-4666-8666-666666666666',
      measurementId: '77777777-7777-4777-8777-777777777777',
    },
    principal: '1000',
    currencyCode: 'BRL',
    dueDate: '2026-01-15',
    paymentTerms: '30 dias',
    externalReference: 'NF-1234',
    status: RECEIVABLE_STATUSES.Overdue,
    remainingBalance: '1000',
    settledAmount: '0',
    lifecycle: 'ACTIVE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    installments: [],
    settlements: [],
    ...overrides,
  };
}

function payable(overrides: Partial<PayableDetailResponse> = {}): PayableDetailResponse {
  return {
    id: PAYABLE_ID,
    unitId: 'UN-A',
    counterpartyId: '88888888-8888-4888-8888-888888888888',
    origin: {
      kind: 'SUPPLIER_INVOICE',
      id: '99999999-9999-4999-8999-999999999999',
      reference: 'NF-ENTRADA-77',
    },
    expenseCategoryId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    costCenter: { id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', code: 'CC-1' },
    principal: '500',
    currencyCode: 'BRL',
    dueDate: '2026-01-10',
    paymentTerms: '30 dias',
    externalReference: null,
    status: PAYABLE_STATUSES.Overdue,
    agingBucket: PAYABLE_AGING_BUCKETS.Days1To30,
    remainingBalance: '500',
    paidAmount: '0',
    lifecycle: 'ACTIVE',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    installments: [],
    payments: [],
    ...overrides,
  };
}

describe('finance source — titulo vencido vira trabalho', () => {
  it('recebivel vencido: chave logica, natureza, prazo real e rota real', () => {
    const item = toReceivableWorkItem(receivable());

    expect(item).toMatchObject({
      id: `FINANCEIRO:RECEIVABLE:${RECEIVABLE_ID}`,
      domain: 'FINANCEIRO',
      kind: 'OVERDUE',
      businessReference: 'NF-1234',
      status: RECEIVABLE_STATUSES.Overdue,
      dueAt: '2026-01-15T00:00:00.000Z',
      targetRoute: `/app/finance/receivables/${RECEIVABLE_ID}`,
      unitId: 'UN-A',
    });
  });

  it.each([
    RECEIVABLE_STATUSES.Paid,
    RECEIVABLE_STATUSES.PartiallyPaid,
    RECEIVABLE_STATUSES.Open,
    RECEIVABLE_STATUSES.Cancelled,
  ])('recebivel em %s nao entra na fila', (status) => {
    expect(toReceivableWorkItem(receivable({ status }))).toBeNull();
  });

  it('sem referencia externa persistida deriva rotulo humano dos dados reais do titulo', () => {
    const item = toReceivableWorkItem(receivable({ externalReference: null }));

    expect(item?.businessReference).toBe('A RECEBER 2026-01-15 · BRL 1000');
    expect(item?.businessReference).not.toContain(RECEIVABLE_ID);
  });

  it('vencimento em formato inesperado omite o item em vez de inventar prazo', () => {
    expect(toReceivableWorkItem(receivable({ dueDate: '15/01/2026' }))).toBeNull();
  });

  it('conta a pagar vencida: referencia humana prefere a externa e cai para a origem', () => {
    const fromOrigin = toPayableWorkItem(payable());
    const fromExternal = toPayableWorkItem(payable({ externalReference: 'PED-4455' }));

    expect(fromOrigin).toMatchObject({
      id: `FINANCEIRO:PAYABLE:${PAYABLE_ID}`,
      kind: 'OVERDUE',
      businessReference: 'NF-ENTRADA-77',
      dueAt: '2026-01-10T00:00:00.000Z',
      targetRoute: `/app/finance/payables/${PAYABLE_ID}`,
    });
    expect(fromExternal?.businessReference).toBe('PED-4455');
    expect(fromOrigin?.reason).toContain(PAYABLE_AGING_BUCKETS.Days1To30);
  });

  it.each([PAYABLE_STATUSES.Paid, PAYABLE_STATUSES.Open, PAYABLE_STATUSES.Cancelled])(
    'conta a pagar em %s nao entra na fila',
    (status) => {
      expect(toPayableWorkItem(payable({ status }))).toBeNull();
    },
  );
});

describe('finance source — leitura e autorizacao', () => {
  it('le recebiveis e contas a pagar pelas autoridades do dominio (uma leitura por carteira)', async () => {
    const receivables = { list: vi.fn().mockResolvedValue([receivable()]) };
    const payables = { list: vi.fn().mockResolvedValue([payable()]) };

    const items = await new FinanceWorkSource(
      receivables as never,
      payables as never,
    ).collect(ACTOR);

    expect(receivables.list).toHaveBeenCalledWith(ACTOR);
    expect(payables.list).toHaveBeenCalledWith(ACTOR);
    expect(items.map((item) => item.id)).toEqual([
      `FINANCEIRO:RECEIVABLE:${RECEIVABLE_ID}`,
      `FINANCEIRO:PAYABLE:${PAYABLE_ID}`,
    ]);
  });

  it('carteira sem autorizacao nao gera item e nao impede a outra carteira', async () => {
    const receivables = {
      list: vi.fn().mockRejectedValue(new HttpException('Access denied.', 403)),
    };
    const payables = { list: vi.fn().mockResolvedValue([payable()]) };

    const items = await new FinanceWorkSource(
      receivables as never,
      payables as never,
    ).collect(ACTOR);

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(`FINANCEIRO:PAYABLE:${PAYABLE_ID}`);
  });

  it('falha real do dominio nao vira fila vazia', async () => {
    const receivables = { list: vi.fn().mockRejectedValue(new Error('connection refused')) };
    const payables = { list: vi.fn().mockResolvedValue([]) };

    await expect(
      new FinanceWorkSource(receivables as never, payables as never).collect(ACTOR),
    ).rejects.toThrow('connection refused');
  });
});
