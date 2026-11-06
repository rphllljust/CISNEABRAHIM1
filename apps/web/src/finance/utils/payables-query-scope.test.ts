import { describe, expect, it } from 'vitest';
import { hasPayablesActiveQuery } from './payables-query-scope';

const EMPTY = {
  search: '', dueFrom: '', dueTo: '', status: '', agingBucket: '', advancedActive: false,
};

describe('Contas a pagar — classificação de filtros ativos', () => {
  it('não classifica carteira sem filtro como recorte', () => {
    expect(hasPayablesActiveQuery(EMPTY)).toBe(false);
  });
  it('reconhece filtro avançado isolado mesmo sem URL ou saved view', () => {
    expect(hasPayablesActiveQuery({ ...EMPTY, advancedActive: true })).toBe(true);
  });
  it('reconhece filtros de situação, vencimento e aging', () => {
    expect(hasPayablesActiveQuery({ ...EMPTY, status: 'OPEN' })).toBe(true);
    expect(hasPayablesActiveQuery({ ...EMPTY, dueFrom: '2026-11-01' })).toBe(true);
    expect(hasPayablesActiveQuery({ ...EMPTY, agingBucket: '90_PLUS' })).toBe(true);
  });
});
