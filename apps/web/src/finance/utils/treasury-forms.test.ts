import { describe, expect, it } from 'vitest';
import {
  TREASURY_ORIGIN_KINDS,
  buildPostMovementPayload,
  buildReverseTreasuryPayload,
  buildTransferPayload,
  hasReversalContent,
} from './treasury-forms';

describe('buildPostMovementPayload', () => {
  it('usa o originKind ESCOLHIDO, nao uma constante — quitar título nao é despesa manual', () => {
    const { payload, missing } = buildPostMovementPayload({
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      accountRowVersion: 2,
      direction: 'debit',
      amount: '  50.0000 ',
      reference: 'Saque para caixa',
      originKind: TREASURY_ORIGIN_KINDS.ManualAuthorized,
      originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      originReference: 'AUT-0001',
      idempotencyKey: 'idem-1',
    });
    expect(missing).toEqual([]);
    expect(payload).toMatchObject({
      direction: 'DEBIT',
      amount: '50.0000',
      rowVersion: 2,
      idempotencyKey: 'idem-1',
      reference: 'Saque para caixa',
      originKind: TREASURY_ORIGIN_KINDS.ManualAuthorized,
      originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      originReference: 'AUT-0001',
    });
  });

  it('preserva a natureza REAL da origem quando o operador escolhe um título a pagar', () => {
    const { payload } = buildPostMovementPayload({
      accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      accountRowVersion: 2,
      direction: 'debit',
      amount: '50.0000',
      reference: 'Pagamento de título',
      originKind: TREASURY_ORIGIN_KINDS.PayablePayment,
      originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      originReference: 'PAG-0001',
      idempotencyKey: 'idem-2',
    });

    // O ponto do teste: antes este campo era SEMPRE `MANUAL_AUTHORIZED`, então um pagamento de
    // título real se declarava despesa manual. A origem persistida mentia sobre a natureza.
    expect(payload.originKind).toBe(TREASURY_ORIGIN_KINDS.PayablePayment);
    expect(payload.originKind).not.toBe(TREASURY_ORIGIN_KINDS.ManualAuthorized);
  });

  it('recusa o payload SEM tipo de origem em vez de assumir MANUAL_AUTHORIZED', () => {
    const { missing } = buildPostMovementPayload({
      accountId: 'a',
      accountRowVersion: 1,
      direction: 'CREDIT',
      amount: '10.0000',
      reference: 'Entrada',
      originKind: '',
      originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      originReference: 'REF-1',
      idempotencyKey: 'idem-3',
    });

    // Assumir um tipo faria a origem persistida mentir. Escolher é responsabilidade do operador.
    expect(missing).toContain('originKind');
  });

  it('reports every required field that is missing without inventing origin data', () => {
    const { missing } = buildPostMovementPayload({
      accountId: 'a',
      accountRowVersion: 1,
      direction: 'CREDIT',
      amount: '',
      reference: '  ',
      originKind: '',
      originId: '',
      originReference: '',
      idempotencyKey: 'idem-2',
    });
    // `originKind` passou a ser obrigatório: antes era constante no cliente, e assumir um tipo
    // fazia a origem persistida mentir sobre a natureza do movimento.
    expect(missing).toEqual(['amount', 'reference', 'originReference', 'originKind', 'originId']);
  });
});

describe('buildTransferPayload', () => {
  it('carries the row versions of both accounts', () => {
    const { payload } = buildTransferPayload({
      fromAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      fromAccountRowVersion: 4,
      toAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      toAccountRowVersion: 7,
      amount: '200.0000',
      reference: 'Aporte entre contas',
      originId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      originReference: 'AUT-0002',
      idempotencyKey: 'idem-3',
    });
    expect(payload.fromAccountId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
    expect(payload.toAccountId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3');
    expect(payload.rowVersionFrom).toBe(4);
    expect(payload.rowVersionTo).toBe(7);
    expect(payload.amount).toBe('200.0000');
  });
});

describe('buildReverseTreasuryPayload', () => {
  it('keeps only the keys the reverse endpoints accept', () => {
    const payload = buildReverseTreasuryPayload({
      rowVersion: 3,
      reference: 'REV-2026-01',
      reason: 'Lançamento incorreto',
      idempotencyKey: 'idem-4',
    });
    expect(payload).toEqual({
      rowVersion: 3,
      idempotencyKey: 'idem-4',
      reference: 'REV-2026-01',
      reason: 'Lançamento incorreto',
    });
  });

  it('includes an explicit amount only when informed', () => {
    const payload = buildReverseTreasuryPayload({
      rowVersion: 1,
      reference: 'REV-1',
      reason: 'Motivo',
      amount: '10.0000',
      idempotencyKey: 'idem-5',
    });
    expect(payload.amount).toBe('10.0000');
  });
});

describe('hasReversalContent', () => {
  it('requires a reason of at least three characters and a reference', () => {
    expect(hasReversalContent({ reference: 'REV-1', reason: 'abc' })).toBe(true);
    expect(hasReversalContent({ reference: 'REV-1', reason: 'ab' })).toBe(false);
    expect(hasReversalContent({ reference: '', reason: 'abc' })).toBe(false);
  });
});
