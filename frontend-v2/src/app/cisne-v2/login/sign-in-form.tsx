'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function CisneLoginForm() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/cisne/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ login, password })
      });
      if (!response.ok) {
        const result: unknown = await response.json().catch(() => null);
        const data = result && typeof result === 'object'
          ? result as Record<string, unknown> : {};
        setError(typeof data.error === 'string' ? data.error : 'Não foi possível autenticar.');
        return;
      }
      router.replace('/cisne-v2/clients');
      router.refresh();
    } catch {
      setError('A autenticação está indisponível.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className='space-y-4'>
      <div className='space-y-1.5'>
        <label htmlFor='cisne-login' className='text-sm font-medium'>Usuário</label>
        <input id='cisne-login' autoComplete='username' value={login}
          onChange={event => setLogin(event.target.value)}
          required minLength={3} maxLength={254}
          className='bg-background focus:ring-ring h-11 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none' />
      </div>
      <div className='space-y-1.5'>
        <label htmlFor='cisne-password' className='text-sm font-medium'>Senha</label>
        <input id='cisne-password' type='password' autoComplete='current-password'
          value={password} onChange={event => setPassword(event.target.value)}
          required maxLength={1024}
          className='bg-background focus:ring-ring h-11 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none' />
      </div>
      {error && <p role='alert' className='text-destructive text-sm'>{error}</p>}
      <button type='submit' disabled={loading}
        className='bg-primary text-primary-foreground hover:bg-primary/90 h-11 w-full rounded-lg text-sm font-semibold disabled:opacity-50'>
        {loading ? 'Autenticando…' : 'Entrar no CISNE'}
      </button>
    </form>
  );
}
