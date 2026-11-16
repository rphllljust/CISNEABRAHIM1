import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLIENT_LIST_PARAMS,
  buildClientListSearchParamsWithAdvancedFilter,
  parseClientListOffset,
} from './client-list-params';

describe('Clientes — persistência do filtro avançado na URL', () => {
  it('rejeita offsets inseguros ou em notação não decimal em links externos', () => {
    expect(parseClientListOffset(new URLSearchParams({ offset: '40' }))).toBe(40);
    expect(parseClientListOffset(new URLSearchParams({ offset: '0x10' }))).toBe(0);
    expect(parseClientListOffset(new URLSearchParams({ offset: '1e3' }))).toBe(0);
    expect(parseClientListOffset(new URLSearchParams({ offset: '-20' }))).toBe(0);
    expect(parseClientListOffset(new URLSearchParams({ offset: '9007199254740992' }))).toBe(0);
  });

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
