import type { Metadata } from 'next';
import Link from 'next/link';
import { cisneFetch, getCisneSession } from '@/cisne/server';
import { clientsQuery } from '@/cisne/security';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Clientes | CISNE Enterprise', robots: 'noindex' };

type ClientSummary = {
  id: string; legalName: string; tradeName: string | null;
  taxId: string; status: string; groupName: string | null;
  parentClientName: string | null;
};

type ClientList = {
  items: ClientSummary[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function validList(value: unknown): value is ClientList {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return Array.isArray(data.items) &&
    data.items.every(item => item && typeof item.id === 'string' &&
      typeof item.legalName === 'string' && typeof item.status === 'string') &&
    Number.isInteger(data.total) && Number.isInteger(data.totalPages) &&
    Number.isInteger(data.limit) && Number.isInteger(data.offset);
}

export default async function ClientsPage({
  searchParams
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page, q } = await searchParams;
  const { pageNumber, query, params } = clientsQuery(page, q);
  const session = await getCisneSession();

  let data: ClientList | null = null;
  let error: string | null = null;
  if (session.kind !== 'ok') {
    error = 'Sessão não disponível. Não foi possível consultar os clientes.';
  } else {
    try {
      const response = await cisneFetch('/api/v1/clients', {
        headers: { Authorization: 'Bearer ' + session.token }
      }, params);
      if (!response.ok) {
        error = response.status === 403 ? 'Você não tem permissão para visualizar clientes.' :
          response.status === 401 ? 'Sessão expirada. Entre novamente.' :
          'Falha na consulta de clientes (' + response.status + ').';
      } else {
        const body: unknown = await response.json();
        if (validList(body)) data = body;
        else error = 'A API retornou um formato inesperado.';
      }
    } catch {
      error = 'API indisponível; os dados não foram carregados.';
    }
  }

  const href = (n: number) => '/cisne-v2/clients?' + new URLSearchParams({
    page: String(n), ...(query ? { q: query } : {})
  }).toString();

  return (
    <div className='mx-auto max-w-7xl space-y-6'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <p className='text-muted-foreground text-xs font-semibold uppercase tracking-widest'>
            Cadastro mestre / CISNE
          </p>
          <h2 className='mt-2 text-3xl font-bold tracking-tight'>Clientes</h2>
          <p className='text-muted-foreground mt-2 text-sm'>
            Consulta diretamente à API empresarial, com autorização no servidor.
          </p>
        </div>
        {data && <p className='bg-card rounded-xl border px-5 py-3 text-sm'>
          <strong className='text-xl'>{data.total.toLocaleString('pt-BR')}</strong>
          <span className='text-muted-foreground ml-2'>registros encontrados</span>
        </p>}
      </div>
      <section className='bg-card overflow-hidden rounded-xl border'>
        <form method='GET' action='/cisne-v2/clients'
          className='flex flex-wrap items-center gap-3 border-b p-4'>
          <label htmlFor='client-q' className='text-sm font-medium'>Pesquisar clientes</label>
          <input id='client-q' name='q' defaultValue={query} maxLength={120}
            placeholder='Nome, razão social ou documento'
            className='bg-background min-w-52 flex-1 rounded-md border px-3 py-2 text-sm' />
          <button type='submit'
            className='bg-primary text-primary-foreground rounded-md px-5 py-2 text-sm font-semibold'>
            Pesquisar
          </button>
        </form>
        {error ? (
          <div role='alert' className='text-destructive p-8 text-sm'>
            {error}
          </div>
        ) : data ? (
          <>
            <div className='overflow-x-auto'>
              <table className='w-full min-w-[760px] text-left text-sm'>
                <thead className='bg-muted/40 text-muted-foreground border-b'>
                  <tr>
                    <th className='px-5 py-3 font-medium'>Razão social</th>
                    <th className='px-5 py-3 font-medium'>Nome fantasia</th>
                    <th className='px-5 py-3 font-medium'>CPF/CNPJ</th>
                    <th className='px-5 py-3 font-medium'>Grupo</th>
                    <th className='px-5 py-3 font-medium'>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(client => (
                    <tr key={client.id} className='border-b last:border-b-0 hover:bg-muted/20'>
                      <td className='px-5 py-4 font-medium'>{client.legalName}</td>
                      <td className='text-muted-foreground px-5 py-4'>{client.tradeName ?? 'Não informado'}</td>
                      <td className='px-5 py-4 font-mono text-xs'>{client.taxId}</td>
                      <td className='px-5 py-4'>{client.groupName ?? 'Não declarado'}</td>
                      <td className='px-5 py-4'><span className='bg-muted rounded-full px-3 py-1 text-xs'>{client.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.items.length === 0 && <p className='text-muted-foreground p-8 text-sm'>
              Nenhum cliente encontrado para os filtros selecionados.
            </p>}
            <footer className='flex items-center justify-between gap-3 border-t p-4 text-sm'>
              <span className='text-muted-foreground'>Página {pageNumber} de {Math.max(1, data.totalPages)}</span>
              <div className='flex gap-2'>
                {pageNumber > 1 && <Link className='rounded-md border px-3 py-2' href={href(pageNumber - 1)}>Anterior</Link>}
                {pageNumber < data.totalPages && <Link className='rounded-md border px-3 py-2' href={href(pageNumber + 1)}>Próxima</Link>}
              </div>
            </footer>
          </>
        ) : (
          <div className='p-8 text-sm'>Carregando...</div>
        )}
      </section>
      <p className='text-muted-foreground text-xs'>
        Tela piloto somente de leitura; ações de cadastro, edição e transição de estado
        permanecem na interface oficial até a validação das permissões e comandos.
      </p>
    </div>
  );
}
