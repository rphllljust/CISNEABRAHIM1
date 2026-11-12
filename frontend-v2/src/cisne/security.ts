export function isSameOriginMutation(request: Pick<Request, 'headers' | 'url'>): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const expected = new URL(request.url);
    const site = request.headers.get('sec-fetch-site');
    return parsed.origin === expected.origin &&
      (site === null || site === 'same-origin' || site === 'none');
  } catch {
    return false;
  }
}
export function clientsQuery(rawPage?: string, rawQuery?: string) {
  const pageNumber = typeof rawPage === 'string' && /^[1-9][0-9]{0,5}$/.test(rawPage)
    ? Number(rawPage) : 1;
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 120) : '';
  const params = new URLSearchParams({ limit: '20', offset: String((pageNumber - 1) * 20) });
  if (query) params.set('q', query);
  return { pageNumber, query, params };
}
