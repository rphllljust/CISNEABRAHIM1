'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function CisneLogout() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/cisne/auth/logout', { method: 'POST', credentials: 'same-origin' });
      router.replace('/cisne-v2/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type='button' onClick={logout} disabled={busy}
      className='hover:bg-muted rounded-lg border px-3 py-2 text-sm disabled:opacity-50'>
      {busy ? 'Saindo…' : 'Sair'}
    </button>
  );
}
