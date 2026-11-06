import 'server-only';
import { cookies } from 'next/headers';
export { isSameOriginMutation } from './security';

export const CISNE_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Host-cisne-v2-session'
  : 'cisne-v2-session-dev';

export type CisneSession = {
  identityId: string;
  session: { id: string; expiresAt: string; status: string };
};

export type SessionResult =
  | { kind: 'ok'; value: CisneSession; token: string }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable' };

export async function cisneFetch(
  path: '/api/v1/auth/login' | '/api/v1/auth/session' | '/api/v1/auth/logout' | '/api/v1/clients',
  init: RequestInit = {},
  query?: URLSearchParams
): Promise<Response> {
  const configured = process.env.CISNE_API_INTERNAL_URL;
  if (!configured) throw new Error('CISNE_API_INTERNAL_URL is not configured');
  const base = new URL(configured);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password ||
    base.search || base.hash || base.pathname !== '/') {
    throw new Error('Invalid CISNE_API_INTERNAL_URL: expected HTTP(S) origin');
  }
  const target = new URL(path, base);
  if (query) target.search = query.toString();
  return fetch(target, {
    ...init,
    cache: 'no-store',
    redirect: 'manual',
    signal: init.signal ?? AbortSignal.timeout(12000),
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {})
    }
  });
}

function validSession(data: unknown): data is CisneSession {
  if (!data || typeof data !== 'object') return false;
  const v = data as Record<string, unknown>;
  const s = v.session;
  return typeof v.identityId === 'string' &&
    v.identityId.length > 0 &&
    !!s && typeof s === 'object' &&
    typeof (s as Record<string, unknown>).id === 'string' &&
    typeof (s as Record<string, unknown>).expiresAt === 'string' &&
    typeof (s as Record<string, unknown>).status === 'string';
}

export async function verifyAccessToken(accessToken: string): Promise<SessionResult> {
  if (!accessToken) return { kind: 'unauthorized' };
  try {
    const response = await cisneFetch('/api/v1/auth/session', {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 403) return { kind: 'forbidden' };
    if (!response.ok) return { kind: 'unavailable' };
    const body: unknown = await response.json();
    if (!validSession(body)) return { kind: 'unavailable' };
    return { kind: 'ok', value: body, token: accessToken };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function getCisneSession(): Promise<SessionResult> {
  const store = await cookies();
  return verifyAccessToken(store.get(CISNE_COOKIE)?.value ?? '');
}
