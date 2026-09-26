import { describe, expect, it } from 'vitest';
import { buildListClientsQuery } from './clients-api';
import {
  CLIENT_LIST_DIRECTIONS,
  CLIENT_LIST_SORTS,
  CLIENT_STATUSES,
  PURCHASE_ORDER_REQUIREMENTS,
} from '../types/client.types';

describe('buildListClientsQuery', () => {
  it('builds pagination and status query params', () => {
    expect(buildListClientsQuery({ limit: 20, offset: 40, status: CLIENT_STATUSES.Active })).toBe(
      'limit=20&offset=40&status=ACTIVE',
    );
  });

  it('always reports pagination, since every list is paginated server-side', () => {
    const query = buildListClientsQuery({ limit: 20, offset: 0 });
    expect(query).toContain('limit=20');
    expect(query).toContain('offset=0');
  });

  it('sends the search term so filtering happens on the server', () => {
    const query = buildListClientsQuery({ limit: 20, offset: 0, q: 'Madeira' });
    expect(new URLSearchParams(query).get('q')).toBe('Madeira');
  });

  it('omits a blank search instead of sending an empty filter', () => {
    const query = buildListClientsQuery({ limit: 20, offset: 0, q: '   ' });
    expect(new URLSearchParams(query).has('q')).toBe(false);
  });

  it('trims the search term', () => {
    const query = buildListClientsQuery({ limit: 20, offset: 0, q: '  Madeira  ' });
    expect(new URLSearchParams(query).get('q')).toBe('Madeira');
  });

  it('encodes a formatted CNPJ without corrupting it', () => {
    const query = buildListClientsQuery({ limit: 20, offset: 0, q: '11.222.333/0001-81' });
    expect(new URLSearchParams(query).get('q')).toBe('11.222.333/0001-81');
  });

  it('carries the secondary filter and the ordering', () => {
    const query = buildListClientsQuery({
      limit: 20,
      offset: 0,
      purchaseOrderRequirement: PURCHASE_ORDER_REQUIREMENTS.BeforeBilling,
      sort: CLIENT_LIST_SORTS.UpdatedAt,
      direction: CLIENT_LIST_DIRECTIONS.Desc,
    });
    const params = new URLSearchParams(query);
    expect(params.get('purchaseOrderRequirement')).toBe('BEFORE_BILLING');
    expect(params.get('sort')).toBe('updatedAt');
    expect(params.get('direction')).toBe('desc');
  });

  it('omits absent optional filters so the backend default applies', () => {
    const params = new URLSearchParams(buildListClientsQuery({ limit: 20, offset: 0 }));
    expect(params.has('status')).toBe(false);
    expect(params.has('purchaseOrderRequirement')).toBe(false);
    expect(params.has('sort')).toBe(false);
    expect(params.has('direction')).toBe(false);
  });
});
