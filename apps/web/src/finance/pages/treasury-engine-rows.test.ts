import { describe, expect, it } from 'vitest';
import { treasuryEngineRows } from './treasury-engine-rows';
import type { FinancialAccount } from '../types/finance.types';

/**
 * PARIDADE DA LISTA DE CAIXA E BANCOS.
 *
 * Este arquivo prova, item a item, que NENHUMA capacidade visível da versão artesanal
 * (`git show HEAD:apps/web/src/finance/pages/TreasuryListPage.tsx`) se perdeu na migração
 * para a engine. Cada `it` corresponde a um item da lista de paridade; o comentário diz de onde
 * o dado vinha antes e de onde vem agora.
 *
 * A regra que o arquivo protege: o frontend NÃO calcula regra financeira. Saldo, créditos e
 * débitos são os valores do servidor, transportados sem reinterpretação.
 */

function account(overrides: Partial<FinancialAccount> = {}): FinancialAccount {
  return {
    id: 'acc-1',
    unitId: 'unit-1',
    kind: 'BANK',
    code: 'BB-001',
    name: 'Conta corrente BB',
    currencyCode: 'BRL',
    overdraftAllowed: false,
    lifecycle: 'ACTIVE',
    rowVersion: 3,
    balance: '1250.7500',
    bank: { bankCode: '001', agency: '1234', accountNumber: '56789-0' },
    cash: null,
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('paridade de caixa e bancos — colunas do original', () => {
  it('transporta name e code (coluna "Conta": rótulo + código monoespaçado)', () => {
    const [row] = treasuryEngineRows([account()]);
    expect(row!['name']).toBe('Conta corrente BB');
    expect(row!['code']).toBe('BB-001');
  });

  it('transporta kind (coluna "Tipo", badge por TREASURY_KIND_LABELS)', () => {
    const [row] = treasuryEngineRows([account({ kind: 'CASH' })]);
    expect(row!['kind']).toBe('CASH');
  });

  it('transporta lifecycle (coluna "Situação", badge por TREASURY_LIFECYCLE_LABELS)', () => {
    const [row] = treasuryEngineRows([account({ lifecycle: 'CLOSED' })]);
    expect(row!['lifecycle']).toBe('CLOSED');
  });

  it('transporta currency_code sem reinterpretação', () => {
    const [row] = treasuryEngineRows([account({ currencyCode: 'USD' })]);
    expect(row!['currency_code']).toBe('USD');
  });

  it('transporta o SALDO DO SERVIDOR literal — o frontend não recalcula', () => {
    const [row] = treasuryEngineRows([account({ balance: '1250.7500' })]);
    expect(row!['balance']).toBe('1250.7500');
    // Nenhuma aritmética: um saldo negativo do servidor chega negativo, não normalizado.
    const [negative] = treasuryEngineRows([account({ balance: '-300.0000' })]);
    expect(negative!['balance']).toBe('-300.0000');
  });

  it('transporta created_at (coluna "Criada em" da view list)', () => {
    const [row] = treasuryEngineRows([account()]);
    expect(row!['created_at']).toBe('2026-01-05T10:00:00.000Z');
  });

  it('preserva a identidade da linha para navegação e drilldown', () => {
    const [row] = treasuryEngineRows([account({ id: 'acc-xyz' })]);
    expect(row!['id']).toBe('acc-xyz');
  });

  it('mantém UMA linha por conta e a ordem devolvida pelo servidor', () => {
    const rows = treasuryEngineRows([
      account({ id: 'a', name: 'Primeira' }),
      account({ id: 'b', name: 'Segunda' }),
    ]);
    expect(rows.map((row) => row['id'])).toEqual(['a', 'b']);
    expect(rows).toHaveLength(2);
  });
});
