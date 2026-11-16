import { NextRequest, NextResponse } from 'next/server';
import { CISNE_COOKIE, cisneFetch, isSameOriginMutation } from '@/cisne/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }
  const token = request.cookies.get(CISNE_COOKIE)?.value;
  let revoked = !token;
  if (token) {
    try {
      const backend = await cisneFetch('/api/v1/auth/logout', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }
      });
      revoked = backend.ok || backend.status === 401;
    } catch {
      revoked = false;
    }
  }
  // Clear the browser credential even when the backend cannot be reached.
  // Explicitly report failed server-side revocation rather than silently claiming success.
  const response = NextResponse.json(
    { loggedOutLocally: true, revoked },
    { status: revoked ? 200 : 502, headers: { 'Cache-Control': 'no-store' } }
  );
  response.cookies.set(CISNE_COOKIE, '', {
    path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 0
  });
  return response;
}
