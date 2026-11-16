import { describe, expect, it } from 'vitest';
import { hasReceivablesActiveQuery } from './receivables-query-scope';

const EMPTY = {
  search: '', dueFrom: '', dueTo: '', status: '', advancedActive: false,
};

describe('Contas a receber — recorte autoritativo', () => {
  it('distingue carteira sem filtro de resultado vazio por filtro avançado isolado', () => {
    expect(hasReceivablesActiveQuery(EMPTY)).toBe(false);
    expect(hasReceivablesActiveQuery({ ...EMPTY, advancedActive: true })).toBe(true);
  });
  it('contabiliza busca, situação e intervalo de vencimento como recorte', () => {
    expect(hasReceivablesActiveQuery({ ...EMPTY, search: 'AR-100' })).toBe(true);
    expect(hasReceivablesActiveQuery({ ...EMPTY, status: 'OPEN' })).toBe(true);
    expect(hasReceivablesActiveQuery({ ...EMPTY, dueTo: '2026-11-30' })).toBe(true);
  });
});
