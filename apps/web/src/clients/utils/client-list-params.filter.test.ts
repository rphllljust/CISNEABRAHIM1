import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLIENT_LIST_PARAMS,
  buildClientListSearchParamsWithAdvancedFilter,
} from './client-list-params';

describe('Clientes — persistência do filtro avançado na URL', () => {
  it('preserva a árvore ao aplicar busca básica e ao paginar', () => {
    const tree = JSON.stringify({ operator: 'and', conditions: [{ field: 'legal_name', value: 'ACME' }] });
    const previous = new URLSearchParams({ filter: tree, offset: '80', status: 'ACTIVE' });
    const filters = { ...EMPTY_CLIENT_LIST_PARAMS, q: 'ACME' };
    const first = buildClientListSearchParamsWithAdvancedFilter(filters, previous);
    expect(first.get('filter')).toBe(tree);
    expect(first.get('q')).toBe('ACME');
    expect(first.has('offset')).toBe(false);
    const nextPage = buildClientListSearchParamsWithAdvancedFilter(filters, first, 20);
    expect(nextPage.get('filter')).toBe(tree);
    expect(nextPage.get('offset')).toBe('20');
  });

  it('não restaura filtro avançado após limpeza explícita', () => {
    const cleared = buildClientListSearchParamsWithAdvancedFilter(
      EMPTY_CLIENT_LIST_PARAMS, new URLSearchParams(), 0,
    );
    expect(cleared.has('filter')).toBe(false);
  });
});
