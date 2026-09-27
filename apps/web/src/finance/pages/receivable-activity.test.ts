import { describe, expect, it } from 'vitest';
import { receivableActivityFacts } from './ReceivableDetailPage';
import type { ReceivableDetail } from '../types/finance.types';

/**
 * HISTORY: o histórico só afirma o que está persistido.
 */

function receivable(overrides: Partial<ReceivableDetail> = {}): ReceivableDetail {
  return {
    id: 'rec-1',
    unitId: 'unit-1',
    clientId: 'client-1',
    origin: {
      kind: 'BILLING',
      billingDocumentId: 'doc-1',
      billingRecordId: 'billing-1',
      serviceOrderId: 'so-1',
      measurementId: 'm-1',
    },
    principal: '1500.0000',
    currencyCode: 'BRL',
    dueDate: '2026-09-10',
    paymentTerms: '30 dias',
    externalReference: 'AR-001',
    status: 'OPEN',
    remainingBalance: '1500.0000',
    settledAmount: '0.0000',
    lifecycle: 'OPEN',
    cancelledAt: null,
    cancelReason: null,
    rowVersion: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T11:00:00.000Z',
    installments: [],
    settlements: [],
    ...overrides,
  };
}

describe('receivableActivityFacts', () => {
  it('usa apenas os timestamps persistidos quando não há liquidação nem cancelamento', () => {
    const facts = receivableActivityFacts(receivable());

    expect(facts.map((fact) => fact.event)).toEqual(['Título criado', 'Título atualizado']);
    expect(facts[0]!.at).toBe('2026-08-01T10:00:00.000Z');
  });

  it('não inventa ator — o payload de recebíveis não guarda quem agiu', () => {
    for (const fact of receivableActivityFacts(receivable())) {
      expect(fact.actor).toBeUndefined();
    }
  });

  it('inclui cancelamento com o motivo persistido como referência', () => {
    const facts = receivableActivityFacts(
      receivable({
        status: 'CANCELLED',
        cancelledAt: '2026-08-05T09:00:00.000Z',
        cancelReason: 'Cliente contestou o faturamento',
      }),
    );

    const cancel = facts.find((fact) => fact.event === 'Título cancelado');
    expect(cancel?.at).toBe('2026-08-05T09:00:00.000Z');
    expect(cancel?.reference).toBe('Cliente contestou o faturamento');
  });

  it('converte cada liquidação persistida em um fato, sem estado anterior fabricado', () => {
    const facts = receivableActivityFacts(
      receivable({
        settlements: [
          {
            id: 's1',
            installmentId: 'i1',
            amount: '500.0000',
            currencyCode: 'BRL',
            status: 'SETTLED',
            settledAt: '2026-08-10T08:00:00.000Z',
            idempotencyKey: 'key-1',
            externalReference: 'PIX-1',
          },
        ],
      }),
    );

    const settlement = facts.find((fact) => fact.event === 'Recebimento registrado');
    expect(settlement?.at).toBe('2026-08-10T08:00:00.000Z');
    expect(settlement?.reference).toContain('500.0000');
    // Estado anterior não é conhecido pelo payload, então não é afirmado.
    expect(settlement?.fromState).toBeUndefined();
  });

  it('NÃO cria fato de transição de status que não foi persistido', () => {
    const facts = receivableActivityFacts(receivable({ status: 'OVERDUE' }));
    expect(facts.some((fact) => /vencid/i.test(fact.event))).toBe(false);
  });
});
