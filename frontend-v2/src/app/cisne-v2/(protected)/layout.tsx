import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCisneSession } from '@/cisne/server';
import CisneLogout from './logout-button';

export const dynamic = 'force-dynamic';

export default async function ProtectedCisneLayout({ children }: { children: React.ReactNode }) {
  const result = await getCisneSession();
  if (result.kind === 'unauthorized') redirect('/cisne-v2/login');
  if (result.kind === 'forbidden') {
    return <main className='p-12' role='alert'>Acesso negado pelo CISNE.</main>;
  }
  if (result.kind === 'unavailable') {
    return <main className='p-12' role='alert'>
      API do CISNE indisponível. Nenhum dado empresarial foi carregado.
    </main>;
  }
  return (
    <div className='bg-muted/25 flex min-h-screen'>
      <aside className='bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 border-r p-6 md:block'>
        <div className='mb-10'>
          <span className='text-primary text-lg font-black tracking-wide'>CISNE</span>
          <p className='text-muted-foreground text-xs tracking-widest'>ENTERPRISE / V2</p>
        </div>
        <nav aria-label='Menu empresarial'>
          <Link href='/cisne-v2/clients' aria-current='page'
            className='bg-sidebar-accent text-sidebar-accent-foreground block rounded-lg px-4 py-3 text-sm font-medium'>
            Clientes
          </Link>
        </nav>
        <p className='text-muted-foreground mt-8 text-xs'>Integração piloto — módulos em migração controlada.</p>
      </aside>
      <div className='min-w-0 flex-1'>
        <header className='bg-background flex h-16 items-center justify-between gap-3 border-b px-5 md:px-8'>
          <div>
            <h1 className='text-sm font-semibold'>CISNE Enterprise</h1>
            <p className='text-muted-foreground text-xs'>Identidade verificada na API CISNE</p>
          </div>
          <CisneLogout />
        </header>
        <div className='p-5 md:p-8'>{children}</div>
      </div>
    </div>
  );
}
