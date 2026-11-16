import { NextResponse } from 'next/server';
import { getCisneSession } from '@/cisne/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getCisneSession();
  if (session.kind !== 'ok') {
    const status = session.kind === 'unavailable' ? 503 :
      session.kind === 'forbidden' ? 403 : 401;
    return NextResponse.json(
      { authenticated: false },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(
    { authenticated: true, identityId: session.value.identityId, session: session.value.session },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
