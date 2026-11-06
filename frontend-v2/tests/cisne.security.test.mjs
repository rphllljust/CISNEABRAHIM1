import { describe, expect, test } from 'bun:test';
import { clientsQuery, isSameOriginMutation } from '../src/cisne/security.ts';

function request(origin: string | null, site?: string) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (site) headers.set('sec-fetch-site', site);
  return { url: 'https://erp.example.com/api/cisne/auth/login', headers };
}

describe('CISNE V2 request isolation', () => {
  test('accepts a same-origin mutation', () => {
    expect(isSameOriginMutation(request('https://erp.example.com', 'same-origin'))).toBe(true);
  });
  test('blocks missing, malformed, remote and cross-site origins', () => {
    expect(isSameOriginMutation(request(null))).toBe(false);
    expect(isSameOriginMutation(request('https://evil.example', 'cross-site'))).toBe(false);
    expect(isSameOriginMutation(request('https://erp.example.com', 'cross-site'))).toBe(false);
    expect(isSameOriginMutation(request('not-an-origin'))).toBe(false);
  });
  test('sends pagination and search to the backend', () => {
    const value = clientsQuery('3', '  Acme  ');
    expect(value.pageNumber).toBe(3);
    expect(value.params.get('limit')).toBe('20');
    expect(value.params.get('offset')).toBe('40');
    expect(value.params.get('q')).toBe('Acme');
  });
  test('never invents results on bad page/search values', () => {
    const value = clientsQuery('-1', '');
    expect(value.pageNumber).toBe(1);
    expect(value.params.get('offset')).toBe('0');
    expect(value.params.has('q')).toBe(false);
  });
});
