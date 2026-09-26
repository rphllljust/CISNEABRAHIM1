import { describe, expect, it } from 'vitest';
import {
  buildClientListSearchParams,
  buildClientsListHref,
  EMPTY_CLIENT_LIST_PARAMS,
  hasActiveClientListFilters,
  isApplicableClientSearchTerm,
  parseClientListParams,
  toggleClientListSort,
} from './client-list-params';
import {
  CLIENT_LIST_DIRECTIONS,
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  PURCHASE_ORDER_REQUIREMENTS,
} from '../types/client.types';

describe('parseClientListParams', () => {
  it('falls back to the defaults for an empty query string', () => {
    expect(parseClientListParams(new URLSearchParams())).toEqual(EMPTY_CLIENT_LIST_PARAMS);
  });

  it('reads search, filters and ordering from the URL', () => {
    const parsed = parseClientListParams(
      new URLSearchParams(
        'q=Madeira&status=ACTIVE&purchaseOrderRequirement=BEFORE_BILLING&sort=updatedAt&direction=desc',
      ),
    );
    expect(parsed).toEqual({
      q: 'Madeira',
      status: CLIENT_STATUSES.Active,
      purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeBilling,
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
  });

  it('ignores unrecognised values instead of breaking the page', () => {
    // Link antigo ou adulterado abre a listagem no padrão, e não uma tela de erro.
    const parsed = parseClientListParams(
      new URLSearchParams('status=SUSPENDED&sort=createdAt&direction=sideways&purchaseOrderRequirement=NOPE'),
    );
    expect(parsed).toEqual(EMPTY_CLIENT_LIST_PARAMS);
  });

  it('round-trips through the URL without loss', () => {
    const params = {
      q: 'Madeira',
      status: CLIENT_STATUSES.Inactive,
      purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeExecution,
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    } as const;

    expect(parseClientListParams(buildClientListSearchParams({ ...params }, 40))).toEqual(params);
  });

  it('discards a term below the published minimum instead of asking for a rejected search', () => {
    // `GET /api/v1/clients?q=a` responde 400 por contrato. Um link antigo ou o histórico do
    // navegador não podem transformar a listagem em tela de erro.
    expect(parseClientListParams(new URLSearchParams('q=a')).q).toBe('');
    expect(parseClientListParams(new URLSearchParams('q=a&status=ACTIVE')).q).toBe('');
  });

  it('keeps a term exactly at the published minimum', () => {
    expect(parseClientListParams(new URLSearchParams('q=ab')).q).toBe('ab');
    expect(parseClientListParams(new URLSearchParams('q=1')).q).toBe('');
    expect(parseClientListParams(new URLSearchParams('q=11')).q).toBe('11');
  });
});

describe('isApplicableClientSearchTerm', () => {
  it('accepts "no search" and terms from the published minimum upwards', () => {
    expect(isApplicableClientSearchTerm('')).toBe(true);
    expect(isApplicableClientSearchTerm('   ')).toBe(true);
    expect(isApplicableClientSearchTerm('ab')).toBe(true);
    expect(isApplicableClientSearchTerm('  ab  ')).toBe(true);
  });

  it('rejects the draft terms that the backend refuses', () => {
    expect(isApplicableClientSearchTerm('a')).toBe(false);
    expect(isApplicableClientSearchTerm('  a  ')).toBe(false);
  });
});

describe('buildClientListSearchParams', () => {
  it('omits the default ordering to keep the address clean', () => {
    expect(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS).toString()).toBe('');
  });

  it('omits an empty search so the backend can tell "no search" from "blank search"', () => {
    const query = buildClientListSearchParams({ ...EMPTY_CLIENT_LIST_PARAMS, q: '   ' });
    expect(query.has('q')).toBe(false);
  });

  it('never puts a below-minimum term in the address', () => {
    // O endereço é o estado da tela: ele não pode descrever uma busca que o backend recusa.
    expect(buildClientListSearchParams({ ...EMPTY_CLIENT_LIST_PARAMS, q: 'a' }).has('q')).toBe(
      false,
    );
    expect(buildClientListSearchParams({ ...EMPTY_CLIENT_LIST_PARAMS, q: 'ab' }).get('q')).toBe(
      'ab',
    );
  });

  it('trims the search term', () => {
    const query = buildClientListSearchParams({ ...EMPTY_CLIENT_LIST_PARAMS, q: '  Madeira  ' });
    expect(query.get('q')).toBe('Madeira');
  });

  it('omits the first page offset and includes later pages', () => {
    expect(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS, 0).has('offset')).toBe(false);
    expect(buildClientListSearchParams(EMPTY_CLIENT_LIST_PARAMS, 20).get('offset')).toBe('20');
  });
});

describe('buildClientsListHref', () => {
  it('builds the bare path when there is nothing to carry', () => {
    expect(buildClientsListHref({})).toBe('/app/clients');
  });

  it('builds a shareable path with the applied context', () => {
    expect(buildClientsListHref({ q: 'Madeira', status: CLIENT_STATUSES.Active })).toBe(
      '/app/clients?q=Madeira&status=ACTIVE',
    );
  });
});

describe('hasActiveClientListFilters', () => {
  it('is false for the pristine state', () => {
    expect(hasActiveClientListFilters(EMPTY_CLIENT_LIST_PARAMS)).toBe(false);
  });

  it.each([
    ['search', { q: 'Madeira' }],
    ['status', { status: CLIENT_STATUSES.Inactive }],
    ['purchase order requirement', { purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.NotRequired }],
    ['ordering', { sort: CLIENT_LIST_SORTS.UpdatedAt }],
    ['direction', { direction: CLIENT_LIST_DIRECTIONS.Desc }],
  ])('is true when %s is applied', (_label, overrides) => {
    expect(hasActiveClientListFilters({ ...EMPTY_CLIENT_LIST_PARAMS, ...overrides })).toBe(true);
  });
});

describe('toggleClientListSort', () => {
  it('flips the direction when the already active column is clicked', () => {
    // A ordenação padrão é razão social ascendente, então o primeiro clique em "Cliente" inverte.
    expect(toggleClientListSort(EMPTY_CLIENT_LIST_PARAMS, CLIENT_LIST_SORTS.LegalName)).toEqual({
      sort: CLIENT_LIST_SORTS.LegalName,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
  });

  it('starts ascending when switching to the client column', () => {
    const other = {
      ...EMPTY_CLIENT_LIST_PARAMS,
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    } as const;
    expect(toggleClientListSort(other, CLIENT_LIST_SORTS.LegalName)).toEqual({
      sort: CLIENT_LIST_SORTS.LegalName,
      direction: CLIENT_LIST_DIRECTIONS.Asc,
    });
  });

  it('starts descending on last update, where the interest is the most recent', () => {
    expect(toggleClientListSort(EMPTY_CLIENT_LIST_PARAMS, CLIENT_LIST_SORTS.UpdatedAt)).toEqual({
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
  });

  it('flips the direction when the same column is clicked again', () => {
    const descending = {
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    } as const;
    expect(
      toggleClientListSort({ ...EMPTY_CLIENT_LIST_PARAMS, ...descending }, CLIENT_LIST_SORTS.UpdatedAt),
    ).toEqual({
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Asc,
    });
  });
});
