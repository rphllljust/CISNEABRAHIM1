import { NextRequest, NextResponse } from 'next/server';
import { CISNE_COOKIE, cisneFetch, isSameOriginMutation, verifyAccessToken } from '@/cisne/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Origem não permitida.' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length') || 0) > 4096) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }
  const form = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (typeof form.login !== 'string' || form.login.trim().length < 3 ||
      form.login.length > 254 || typeof form.password !== 'string' ||
      form.password.length < 1 || form.password.length > 1024) {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 400 });
  }
  try {
    const backend = await cisneFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: form.login, password: form.password })
    });
    if (!backend.ok) {
      const status = [400, 401, 403, 429].includes(backend.status) ? backend.status : 502;
      return NextResponse.json({
        error: status === 429 ? 'Muitas tentativas. Tente novamente mais tarde.' :
          status === 502 ? 'Autenticação temporariamente indisponível.' :
          'Credenciais inválidas.'
      }, { status });
    }
    const payload: unknown = await backend.json();
    const result = payload && typeof payload === 'object'
      ? payload as Record<string, unknown> : {};
    if (result.tokenType !== 'Bearer' || typeof result.accessToken !== 'string' ||
      typeof result.expiresIn !== 'number' || !Number.isFinite(result.expiresIn) || result.expiresIn <= 0) {
      return NextResponse.json({ error: 'Resposta de autenticação inválida.' }, { status: 502 });
    }
    // Never trust a token until the existing CISNE API validates the session.
    const verified = await verifyAccessToken(result.accessToken);
    if (verified.kind !== 'ok') {
      return NextResponse.json({ error: 'Não foi possível confirmar a sessão.' }, { status: 502 });
    }
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(CISNE_COOKIE, result.accessToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: Math.min(Math.floor(Number(result.expiresIn)), 3600)
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Serviço de autenticação indisponível.' }, { status: 503 });
  }
}
