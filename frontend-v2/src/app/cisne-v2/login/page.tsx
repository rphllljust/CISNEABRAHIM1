import type { Metadata } from 'next';
import { getCisneSession } from '@/cisne/server';
import { redirect } from 'next/navigation';
import CisneLoginForm from './sign-in-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Entrar | CISNE Enterprise', robots: 'noindex' };

export default async function LoginPage() {
  const session = await getCisneSession();
  if (session.kind === 'ok') redirect('/cisne-v2/clients');
  return (
    <main className='bg-muted/40 flex min-h-screen items-center justify-center p-5'>
      <section className='bg-card w-full max-w-md rounded-2xl border p-8 shadow-xl'>
        <p className='text-primary text-sm font-semibold tracking-widest'>CISNE ENTERPRISE</p>
        <h1 className='mt-3 text-2xl font-bold'>Acesso operacional</h1>
        <p className='text-muted-foreground mt-2 text-sm'>
          Entre com suas credenciais existentes do CISNE. Nenhuma conta Clerk é necessária nesta área.
        </p>
        <div className='mt-7'><CisneLoginForm /></div>
        <p className='text-muted-foreground mt-7 border-t pt-4 text-xs'>
          Frontend V2 em homologação isolada. A aplicação oficial permanece disponível.
        </p>
      </section>
    </main>
  );
}
